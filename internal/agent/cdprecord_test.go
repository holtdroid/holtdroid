package agent

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/holtdroid/holtdroid/internal/contract"
)

type devtoolsLines struct {
	mu    sync.Mutex
	t     int64
	lines []contract.DevToolsEntry
}

func (s *devtoolsLines) DevTools(e contract.DevToolsEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e.T <= 0 {
		e.T = s.t
	}
	s.lines = append(s.lines, e)
}

func (s *devtoolsLines) Elapsed() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.t
}

func (s *devtoolsLines) advance(ms int64) {
	s.mu.Lock()
	s.t += ms
	s.mu.Unlock()
}

func (s *devtoolsLines) of(typ contract.DevToolsEntryType) []contract.DevToolsEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []contract.DevToolsEntry
	for _, l := range s.lines {
		if l.Type == typ {
			out = append(out, l)
		}
	}
	return out
}

func cdpEvent(t *testing.T, p *cdpPage, method, params string) {
	t.Helper()
	if !json.Valid([]byte(params)) {
		t.Fatalf("%s: invalid JSON %s", method, params)
	}
	p.handle(method, json.RawMessage(params))
}

func TestDevToolsRecorderFollowsAPage(t *testing.T) {
	enabled := make(chan string, 8)
	events := []string{
		`{"method":"Network.requestWillBeSent","params":{"requestId":"1","timestamp":100,"wallTime":1793000000.5,"type":"Fetch","request":{"url":"https://api.example.com/cart","method":"POST","headers":{"Content-Type":"application/json"},"postData":"{\"a\":1}"}}}`,
		`{"method":"Network.responseReceived","params":{"requestId":"1","response":{"url":"https://api.example.com/cart","status":200,"statusText":"OK","headers":{"content-type":"application/json"},"mimeType":"application/json","remoteIPAddress":"203.0.113.10","remotePort":443,"protocol":"h2","encodedDataLength":120,"timing":{"requestTime":100.002,"dnsStart":-1,"dnsEnd":-1,"connectStart":-1,"connectEnd":-1,"sslStart":-1,"sslEnd":-1,"sendStart":1,"sendEnd":1.5,"receiveHeadersEnd":40}}}}`,
		`{"method":"Network.loadingFinished","params":{"requestId":"1","timestamp":100.06,"encodedDataLength":180}}`,
		`{"method":"Runtime.consoleAPICalled","params":{"type":"log","timestamp":1793000001000,"args":[{"type":"string","value":"cart %o"},{"type":"object","objectId":"o1","description":"Object","preview":{"properties":[{"name":"total","type":"number","value":"3"}]}}]}}`,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /json/version", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"Android-Package":"com.example.shop"}`)
	})
	mux.HandleFunc("GET /json/list", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `[{"id":"P1","type":"page","title":"Cart","url":"https://shop.example/cart"},{"id":"W1","type":"service_worker","url":"https://shop.example/sw.js"}]`)
	})
	mux.HandleFunc("GET /devtools/page/{id}", func(w http.ResponseWriter, r *http.Request) {
		if r.Host != "localhost" {
			http.Error(w, "bad host", http.StatusForbidden)
			return
		}
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = c.CloseNow() }()
		ctx := r.Context()
		for {
			_, data, err := c.Read(ctx)
			if err != nil {
				return
			}
			var m struct {
				ID     int64  `json:"id"`
				Method string `json:"method"`
			}
			_ = json.Unmarshal(data, &m)
			result := `{}`
			switch m.Method {
			case "Network.getResponseBody":
				result = `{"body":"{\"total\":3}","base64Encoded":false}`
			case "Runtime.callFunctionOn":
				result = `{"result":{"type":"string","value":"{\"total\":3}"}}`
			}
			reply, _ := json.Marshal(map[string]any{"id": m.ID, "result": json.RawMessage(result)})
			_ = c.Write(ctx, websocket.MessageText, reply)
			enabled <- m.Method
			if m.Method == "Log.enable" {
				for _, e := range events {
					_ = c.Write(ctx, websocket.MessageText, []byte(e))
				}
			}
		}
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	port := srv.Listener.Addr().(*net.TCPAddr).Port

	dev := &fakeDevice{unix: procNetUnix, ports: map[string]int{"webview_devtools_remote_4242": port, "chrome_devtools_remote": port}}
	dt := NewDevTools(dev, Frontends{}, "", slog.New(slog.DiscardHandler))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := dt.scan(ctx); err != nil {
		t.Fatal(err)
	}
	sink := &devtoolsLines{t: 1000}
	r := newDevToolsRecorder(dt, sink, slog.New(slog.DiscardHandler))
	r.sync(ctx)

	deadline := time.After(5 * time.Second)
	for len(sink.of(contract.DevToolsRequestEntry)) < 2 || len(sink.of(contract.DevToolsConsoleEntry)) < 2 {
		select {
		case <-deadline:
			t.Fatalf("lines: %+v", sink.lines)
		case <-time.After(10 * time.Millisecond):
		}
	}
	pages := sink.of(contract.DevToolsPageEntry)
	if len(pages) < 2 || pages[0].Page.URL != "https://shop.example/cart" || pages[0].Page.Process != "com.example.shop" {
		t.Fatalf("pages: %+v", pages)
	}
	req := sink.of(contract.DevToolsRequestEntry)[0].Request
	if req.Method != http.MethodPost || req.Status != 200 || req.Body != `{"total":3}` || req.PostData != `{"a":1}` ||
		req.RemoteAddress != "203.0.113.10:443" || req.Wall != 1793000000500 || req.Size != 180 {
		t.Fatalf("request: %+v", req)
	}
	if tm := req.Timing; tm == nil || tm.DNS != -1 || tm.Send != 0.5 || tm.Wait != 38.5 || tm.Blocked != 3 || tm.Receive != 18 {
		t.Fatalf("timing: %+v", req.Timing)
	}
	c := sink.of(contract.DevToolsConsoleEntry)[0].Console
	if c.Text != "cart {total: 3}" || c.Args[1].JSON != `{"total":3}` || c.Level != "info" {
		t.Fatalf("console: %+v", c)
	}
}

func TestDevToolsRecorderRedirectsAndFailures(t *testing.T) {
	sink := &devtoolsLines{t: 10}
	p := newCDPPage("P1", sink)
	cdpEvent(t, p, "Network.requestWillBeSent", `{"requestId":"7","timestamp":1,"type":"Document","request":{"url":"http://shop.example/","method":"GET"}}`)
	sink.advance(20)
	cdpEvent(t, p, "Network.requestWillBeSent", `{"requestId":"7","timestamp":1.02,"type":"Document","request":{"url":"https://shop.example/","method":"GET"},"redirectResponse":{"status":301,"headers":{"Location":"https://shop.example/"}}}`)
	sink.advance(30)
	cdpEvent(t, p, "Network.loadingFailed", `{"requestId":"7","timestamp":1.05,"errorText":"net::ERR_CONNECTION_RESET"}`)
	cdpEvent(t, p, "Network.requestWillBeSent", `{"requestId":"8","timestamp":2,"type":"XHR","request":{"url":"https://shop.example/poll","method":"GET"}}`)
	p.flush()

	reqs := sink.of(contract.DevToolsRequestEntry)
	if len(reqs) != 3 {
		t.Fatalf("requests: %+v", reqs)
	}
	first, second, pending := reqs[0].Request, reqs[1].Request, reqs[2].Request
	if first.ID != "7" || first.Status != 301 || first.Redirect != "https://shop.example/" || first.End != 30 {
		t.Fatalf("redirected: %+v", first)
	}
	if second.ID != "7:1" || second.Error != "net::ERR_CONNECTION_RESET" || second.Start != 30 || second.End != 60 {
		t.Fatalf("failed: %+v", second)
	}
	if pending.ID != "8" || pending.End != 0 {
		t.Fatalf("still loading: %+v", pending)
	}
}

func TestDevToolsRecorderSkipsMediaStreams(t *testing.T) {
	sink := &devtoolsLines{}
	p := newCDPPage("P1", sink)
	cdpEvent(t, p, "Network.webSocketCreated", `{"requestId":"s1","url":"wss://rt.example.com/"}`)
	cdpEvent(t, p, "Network.webSocketCreated", `{"requestId":"s2","url":"wss://cam.example.com/"}`)
	cdpEvent(t, p, "Network.webSocketCreated", `{"requestId":"s3","url":"wss://telemetry.example.com/"}`)
	frame := func(id string, opcode int, payload string) {
		b, _ := json.Marshal(map[string]any{"requestId": id, "response": map[string]any{"opcode": opcode, "payloadData": payload}})
		p.handle("Network.webSocketFrameReceived", b)
	}
	h264 := base64.StdEncoding.EncodeToString(append([]byte{0, 0, 0, 1, 0x67}, make([]byte, 400)...))
	bulk := base64.StdEncoding.EncodeToString(make([]byte, 4000))
	for range 200 {
		sink.advance(33)
		frame("s1", 1, `{"type":"tick"}`)
		frame("s2", 2, h264)
		frame("s3", 2, bulk)
	}
	frames := map[string]int{}
	for _, f := range sink.of(contract.DevToolsFrameEntry) {
		frames[f.Frame.Socket]++
		if f.Frame.Socket == "s2" && f.Frame.Data != "" {
			t.Fatal("a video frame's payload was recorded")
		}
	}
	if frames["s1"] != 200 || frames["s2"] != 2 || frames["s3"] < 60 || frames["s3"] > 100 {
		t.Fatalf("frames per socket: %v", frames)
	}
	streams := map[string]bool{}
	for _, s := range sink.of(contract.DevToolsSocketEntry) {
		if s.Socket.State == "stream" {
			streams[s.Socket.ID] = true
		}
	}
	if !streams["s2"] || !streams["s3"] || streams["s1"] {
		t.Fatalf("streams: %v", streams)
	}
	cdpEvent(t, p, "Network.webSocketClosed", `{"requestId":"s2"}`)
	last := sink.of(contract.DevToolsSocketEntry)
	if s := last[len(last)-1].Socket; s.State != "closed" || s.Frames != 200 || s.Bytes != 200*405 {
		t.Fatalf("closed: %+v", s)
	}
}

func TestConsoleText(t *testing.T) {
	str := func(s string) contract.DevToolsValue { return contract.DevToolsValue{Type: "string", Text: s} }
	num := func(s string) contract.DevToolsValue { return contract.DevToolsValue{Type: "number", Text: s} }
	for _, tc := range []struct {
		args []contract.DevToolsValue
		want string
	}{
		{nil, ""},
		{[]contract.DevToolsValue{str("hello"), num("1"), str("x")}, "hello 1 x"},
		{[]contract.DevToolsValue{str("%cbold%c %d%% of %s"), str("font-weight:bold"), str(""), num("42"), str("cart"), num("7")}, "bold 42% of cart 7"},
		{[]contract.DevToolsValue{str("100%")}, "100%"},
	} {
		if got := consoleText(tc.args); got != tc.want {
			t.Errorf("consoleText(%v) = %q, want %q", tc.args, got, tc.want)
		}
	}
	if got, cut := cut(strings.Repeat("я", 10), 5); got != "яя" || !cut {
		t.Errorf("cut = %q, %v", got, cut)
	}
}
