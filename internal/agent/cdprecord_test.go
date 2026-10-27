package agent

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/holtdroid/holtdroid/internal/contract"
)

type devtoolsLines struct {
	mu    sync.Mutex
	t     int64
	off   bool
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

func (s *devtoolsLines) Clock() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.t
}

func (s *devtoolsLines) At(clock int64) int64 { return clock }

func (s *devtoolsLines) Recording() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.off
}

func (s *devtoolsLines) Elapsed() int64 { return s.Clock() }

func (s *devtoolsLines) Watching() bool { return false }

func (s *devtoolsLines) Live(contract.DevToolsEntry) {}

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

// fakeWebView is a WebView's DevTools socket: with browser, a browser target
// that auto-attaches a page and an iframe in it, paused until they are told
// to run; without, only the page's own endpoint.
func fakeWebView(t *testing.T, browser bool, events map[string][]string) int {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /json/version", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"Android-Package":"com.example.shop"}`)
	})
	mux.HandleFunc("GET /json/list", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `[{"id":"P1","type":"page","title":"Cart","url":"https://shop.example/cart"}]`)
	})
	serve := func(w http.ResponseWriter, r *http.Request, attach bool) {
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
		send := func(v any) {
			b, _ := json.Marshal(v)
			_ = c.Write(ctx, websocket.MessageText, b)
		}
		replay := func(session string) {
			for _, e := range events[session] {
				var m map[string]any
				_ = json.Unmarshal([]byte(e), &m)
				if session != "" {
					m["sessionId"] = session
				}
				send(m)
			}
		}
		for {
			_, data, err := c.Read(ctx)
			if err != nil {
				return
			}
			var m struct {
				ID        int64  `json:"id"`
				SessionID string `json:"sessionId"`
				Method    string `json:"method"`
			}
			_ = json.Unmarshal(data, &m)
			result := `{}`
			switch m.Method {
			case "Network.getResponseBody":
				result = `{"body":"{\"total\":3}","base64Encoded":false}`
			case "Runtime.callFunctionOn":
				result = `{"result":{"type":"string","value":"{\"total\":3}"}}`
			}
			reply := map[string]any{"id": m.ID, "result": json.RawMessage(result)}
			if m.SessionID != "" {
				reply["sessionId"] = m.SessionID
			}
			send(reply)
			switch {
			case attach && m.Method == "Target.setAutoAttach" && m.SessionID == "":
				send(map[string]any{"method": "Target.attachedToTarget", "params": map[string]any{
					"sessionId": "S1", "waitingForDebugger": true,
					"targetInfo": map[string]any{"targetId": "P1", "type": "page", "title": "Cart", "url": "https://shop.example/cart"},
				}})
			case attach && m.Method == "Target.setAutoAttach" && m.SessionID == "S1":
				send(map[string]any{"sessionId": "S1", "method": "Target.attachedToTarget", "params": map[string]any{
					"sessionId": "S2", "waitingForDebugger": true,
					"targetInfo": map[string]any{"targetId": "F1", "type": "iframe", "url": "https://pay.example/frame"},
				}})
			case attach && m.Method == "Runtime.runIfWaitingForDebugger":
				replay(m.SessionID)
			case !attach && m.Method == "Log.enable":
				replay("S1")
			}
		}
	}
	if browser {
		mux.HandleFunc("GET /devtools/browser", func(w http.ResponseWriter, r *http.Request) { serve(w, r, true) })
	}
	mux.HandleFunc("GET /devtools/page/{id}", func(w http.ResponseWriter, r *http.Request) { serve(w, r, false) })
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv.Listener.Addr().(*net.TCPAddr).Port
}

var pageEvents = []string{
	`{"method":"Network.requestWillBeSent","params":{"requestId":"1","timestamp":100,"wallTime":1793000000.5,"type":"Fetch","request":{"url":"https://api.example.com/cart","method":"POST","headers":{"Content-Type":"application/json"},"postData":"{\"a\":1}"}}}`,
	`{"method":"Network.responseReceived","params":{"requestId":"1","response":{"url":"https://api.example.com/cart","status":200,"statusText":"OK","headers":{"content-type":"application/json"},"mimeType":"application/json","remoteIPAddress":"203.0.113.10","remotePort":443,"protocol":"h2","encodedDataLength":120,"timing":{"requestTime":100.002,"dnsStart":-1,"dnsEnd":-1,"connectStart":-1,"connectEnd":-1,"sslStart":-1,"sslEnd":-1,"sendStart":1,"sendEnd":1.5,"receiveHeadersEnd":40}}}}`,
	`{"method":"Network.loadingFinished","params":{"requestId":"1","timestamp":100.06,"encodedDataLength":180}}`,
	`{"method":"Runtime.consoleAPICalled","params":{"type":"log","timestamp":1793000001000,"args":[{"type":"string","value":"cart %o"},{"type":"object","objectId":"o1","description":"Object","preview":{"properties":[{"name":"total","type":"number","value":"3"}]}}]}}`,
}

func watchFor(t *testing.T, browser bool, events map[string][]string) (*devtoolsWatch, *devtoolsLines, context.CancelFunc) {
	t.Helper()
	port := fakeWebView(t, browser, events)
	dev := &fakeDevice{unix: procNetUnix, ports: map[string]int{"webview_devtools_remote_4242": port, "chrome_devtools_remote": 1}}
	dt := NewDevTools(dev, Frontends{}, "", slog.New(slog.DiscardHandler))
	ctx, cancel := context.WithCancel(context.Background())
	if err := dt.scan(ctx); err != nil {
		t.Fatal(err)
	}
	dt.mu.Lock()
	delete(dt.sockets, "chrome_devtools_remote")
	dt.mu.Unlock()
	sink := &devtoolsLines{t: 1000}
	w := newDevToolsWatch(dt, slog.New(slog.DiscardHandler))
	w.record(sink, "rec-1")
	go w.run(ctx, 20*time.Millisecond)
	return w, sink, cancel
}

func waitLines(t *testing.T, sink *devtoolsLines, ok func() bool) {
	t.Helper()
	deadline := time.After(5 * time.Second)
	for !ok() {
		select {
		case <-deadline:
			t.Fatalf("lines: %+v", sink.lines)
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func TestDevToolsWatchFollowsEveryTarget(t *testing.T) {
	_, sink, cancel := watchFor(t, true, map[string][]string{
		"S1": pageEvents,
		"S2": {`{"method":"Runtime.consoleAPICalled","params":{"type":"warning","args":[{"type":"string","value":"from the iframe"}]}}`},
	})
	defer cancel()
	waitLines(t, sink, func() bool {
		return len(sink.of(contract.DevToolsRequestEntry)) == 1 && len(sink.of(contract.DevToolsConsoleEntry)) == 2
	})
	pages := map[string]contract.DevToolsEntry{}
	for _, p := range sink.of(contract.DevToolsPageEntry) {
		pages[p.Target] = p
	}
	if p := pages["P1"].Page; p == nil || p.Type != "page" || p.URL != "https://shop.example/cart" || p.Process != "com.example.shop" {
		t.Fatalf("page: %+v", pages["P1"])
	}
	if f := pages["F1"].Page; f == nil || f.Type != "iframe" || f.Parent != "P1" {
		t.Fatalf("iframe: %+v", pages["F1"])
	}
	req := sink.of(contract.DevToolsRequestEntry)[0]
	if r := req.Request; req.Target != "P1" || r.Method != http.MethodPost || r.Status != 200 || r.Body != `{"total":3}` || r.PostData != `{"a":1}` ||
		r.RemoteAddress != "203.0.113.10:443" || r.Wall != 1793000000500 || r.Size != 180 {
		t.Fatalf("request: %+v", req)
	}
	if tm := req.Request.Timing; tm == nil || tm.DNS != -1 || tm.Send != 0.5 || tm.Wait != 38.5 || tm.Blocked != 3 || tm.Receive != 18 {
		t.Fatalf("timing: %+v", req.Request.Timing)
	}
	byTarget := map[string]*contract.DevToolsConsole{}
	for _, c := range sink.of(contract.DevToolsConsoleEntry) {
		byTarget[c.Target] = c.Console
	}
	if c := byTarget["P1"]; c == nil || c.Text != "cart {total: 3}" || c.Args[1].JSON != `{"total":3}` || c.Level != "info" {
		t.Fatalf("page console: %+v", c)
	}
	if c := byTarget["F1"]; c == nil || c.Text != "from the iframe" || c.Level != "warning" {
		t.Fatalf("iframe console: %+v", c)
	}
}

func TestDevToolsWatchFollowsPagesWithoutABrowserTarget(t *testing.T) {
	_, sink, cancel := watchFor(t, false, map[string][]string{"S1": pageEvents})
	defer cancel()
	waitLines(t, sink, func() bool { return len(sink.of(contract.DevToolsRequestEntry)) == 1 })
	if p := sink.of(contract.DevToolsPageEntry)[0]; p.Target != "P1" || p.Page.Type != "page" {
		t.Fatalf("page: %+v", p)
	}
}

func TestDevToolsWatchKnowsSocketsOpenedBeforeTheRecording(t *testing.T) {
	sink := &devtoolsLines{off: true}
	p := newCDPPage("P1", sink)
	cdpEvent(t, p, "Network.webSocketCreated", `{"requestId":"s1","url":"wss://api.example.com/socket"}`)
	cdpEvent(t, p, "Network.webSocketFrameReceived", `{"requestId":"s1","response":{"opcode":1,"payloadData":"before"}}`)
	cdpEvent(t, p, "Network.requestWillBeSent", `{"requestId":"9","timestamp":1,"type":"XHR","request":{"url":"https://api.example.com/slow","method":"GET"}}`)
	if len(sink.lines) != 0 {
		t.Fatalf("written without a recording: %+v", sink.lines)
	}
	sink.off = false
	sink.advance(500)
	p.replay()
	cdpEvent(t, p, "Network.webSocketFrameReceived", `{"requestId":"s1","response":{"opcode":1,"payloadData":"after"}}`)
	cdpEvent(t, p, "Network.webSocketFrameReceived", `{"requestId":"s9","response":{"opcode":1,"payloadData":"42[\"hello\"]"}}`)
	cdpEvent(t, p, "Network.loadingFinished", `{"requestId":"9","timestamp":2}`)

	sockets := sink.of(contract.DevToolsSocketEntry)
	if len(sockets) != 2 || sockets[0].Socket.URL != "wss://api.example.com/socket" || sockets[0].Socket.Frames != 1 ||
		sockets[1].Socket.ID != "s9" || sockets[1].Socket.State != "open" {
		t.Fatalf("sockets: %+v", sockets)
	}
	frames := sink.of(contract.DevToolsFrameEntry)
	if len(frames) != 2 || frames[0].Frame.Data != "after" || frames[1].Frame.Socket != "s9" {
		t.Fatalf("frames: %+v", frames)
	}
	if r := sink.of(contract.DevToolsRequestEntry); len(r) != 1 || r[0].Request.Start != 0 {
		t.Fatalf("a request from before the recording: %+v", r)
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
	cdpEvent(t, p, "Log.entryAdded", `{"entry":{"source":"worker","level":"info","text":"worker up [object Object]"}}`)
	cdpEvent(t, p, "Log.entryAdded", `{"entry":{"source":"network","level":"error","text":"Failed to load resource"}}`)
	if c := sink.of(contract.DevToolsConsoleEntry); len(c) != 1 || c[0].Console.Kind != "network" {
		t.Fatalf("browser messages: %+v", c)
	}
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

func TestDevToolsWatchStreamsSocketsLive(t *testing.T) {
	w := newDevToolsWatch(nil, slog.New(slog.DiscardHandler))
	pg := newCDPPage("P1", w)
	w.procs["webview_devtools_remote_1"] = &cdpProcess{w: w, pages: map[string]*cdpPage{"S1": pg}}
	cdpEvent(t, pg, "Network.webSocketCreated", `{"requestId":"s1","url":"wss://api.example.com/socket"}`)

	got := make(chan contract.DevToolsEntry, 16)
	ctx := t.Context()
	go func() { _ = w.watchLive(ctx, func(e contract.DevToolsEntry) error { got <- e; return nil }) }()
	next := func() contract.DevToolsEntry {
		t.Helper()
		select {
		case e := <-got:
			return e
		case <-time.After(2 * time.Second):
			t.Fatal("no line")
			return contract.DevToolsEntry{}
		}
	}
	if e := next(); e.Type != contract.DevToolsSocketEntry || e.Seq != 1 || e.Socket.URL != "wss://api.example.com/socket" || e.Wall == 0 {
		t.Fatalf("history: %+v", e)
	}
	if e := next(); e.Type != contract.DevToolsPageEntry || e.Target != "P1" || e.Seq != 0 {
		t.Fatalf("current page: %+v", e)
	}
	if e := next(); e.Type != contract.DevToolsSocketEntry || e.Seq != 0 {
		t.Fatalf("current socket: %+v", e)
	}
	waitSubscribed(t, w)
	cdpEvent(t, pg, "Network.webSocketFrameReceived", `{"requestId":"s1","response":{"opcode":1,"payloadData":"hi"}}`)
	if e := next(); e.Frame == nil || e.Frame.Data != "hi" || e.Seq != 2 || e.T != 0 || e.Rec != "" || e.Wall < time.Now().Add(-time.Minute).UnixMilli() {
		t.Fatalf("frame without a recording: %+v", e)
	}
	rec := &devtoolsLines{t: 4200}
	w.record(rec, "R1")
	cdpEvent(t, pg, "Network.webSocketFrameSent", `{"requestId":"s1","response":{"opcode":1,"payloadData":"yo"}}`)
	var e contract.DevToolsEntry
	for e = next(); e.Type != contract.DevToolsFrameEntry; e = next() {
	}
	if e.Frame.Data != "yo" || e.Rec != "R1" || e.T < 4000 || e.T > 4200 {
		t.Fatalf("frame while recording: %+v", e)
	}
	if lines := rec.of(contract.DevToolsFrameEntry); len(lines) != 1 || lines[0].Frame.Data != "yo" {
		t.Fatalf("recorded frames: %+v", lines)
	}
}

func waitSubscribed(t *testing.T, w *devtoolsWatch) {
	t.Helper()
	for range 200 {
		w.mu.Lock()
		n := len(w.subs)
		w.mu.Unlock()
		if n > 0 {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("nobody subscribed")
}

func TestDevToolsWatchKeepsSocketHistoryForLaterWatchers(t *testing.T) {
	w := newDevToolsWatch(nil, slog.New(slog.DiscardHandler))
	w.sockets.max = 4 * (256 + 10)
	pg := newCDPPage("P1", w)
	w.procs["webview_devtools_remote_1"] = &cdpProcess{w: w, pages: map[string]*cdpPage{"S1": pg}}
	cdpEvent(t, pg, "Network.webSocketCreated", `{"requestId":"s1","url":"wss://a.example/"}`)
	for i := range 10 {
		b, _ := json.Marshal(map[string]any{"requestId": "s1", "response": map[string]any{"opcode": 1, "payloadData": fmt.Sprintf("frame-%03d", i)}})
		pg.handle("Network.webSocketFrameReceived", b)
	}
	var got []contract.DevToolsEntry
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = w.watchLive(ctx, func(e contract.DevToolsEntry) error {
			got = append(got, e)
			if len(got) == 6 {
				cancel()
			}
			return nil
		})
	}()
	<-done
	var frames []string
	for _, e := range got {
		if e.Frame != nil {
			frames = append(frames, e.Frame.Data)
		}
	}
	if !slices.Equal(frames, []string{"frame-006", "frame-007", "frame-008", "frame-009"}) {
		t.Fatalf("kept frames %v", frames)
	}
	if last := got[len(got)-1]; last.Type != contract.DevToolsSocketEntry || last.Seq != 0 || last.Socket.URL != "wss://a.example/" || last.Socket.Frames != 10 {
		t.Fatalf("the socket as it is now: %+v", last)
	}
}

func TestDevToolsWatchStreamsRequestsWithoutBodies(t *testing.T) {
	w := newDevToolsWatch(nil, slog.New(slog.DiscardHandler))
	pg := newCDPPage("P1", w)
	w.procs["webview_devtools_remote_1"] = &cdpProcess{w: w, pages: map[string]*cdpPage{"S1": pg}}
	cdpEvent(t, pg, "Network.requestWillBeSentExtraInfo", `{"requestId":"r1","headers":{"Cache-Control":"no-cache","Pragma":"no-cache"}}`)
	cdpEvent(t, pg, "Network.requestWillBeSent", `{"requestId":"r1","timestamp":1,"wallTime":1700000000,"type":"Fetch","request":{"url":"https://api.example.com/a","method":"POST","headers":{"cache-control":"max-age=0"},"postData":"secret"}}`)
	cdpEvent(t, pg, "Network.responseReceived", `{"requestId":"r1","response":{"status":200,"headers":{"Cache-Control":"public, max-age=60"}}}`)
	cdpEvent(t, pg, "Network.responseReceivedExtraInfo", `{"requestId":"r1","headers":{"cache-control":"public, max-age=60","set-cookie":"sid=1"}}`)
	cdpEvent(t, pg, "Network.loadingFinished", `{"requestId":"r1","timestamp":2,"encodedDataLength":120}`)

	var got []contract.DevToolsEntry
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	_ = w.watchLive(ctx, func(e contract.DevToolsEntry) error {
		got = append(got, e)
		if e.Type == contract.DevToolsPageEntry {
			cancel()
		}
		return nil
	})
	if len(got) < 1 || got[0].Request == nil {
		t.Fatalf("lines %+v", got)
	}
	r := got[0].Request
	if r.PostData != "" || r.Body != "" || got[0].Seq != 1 || r.Wall != 1700000000000 {
		t.Fatalf("live request %+v", r)
	}
	if r.RequestHeaders["Cache-Control"] != "no-cache" || r.RequestHeaders["Pragma"] != "no-cache" || len(r.RequestHeaders) != 2 {
		t.Fatalf("request headers %v", r.RequestHeaders)
	}
	if r.ResponseHeaders["set-cookie"] != "sid=1" || r.ResponseHeaders["cache-control"] != "public, max-age=60" || len(r.ResponseHeaders) != 2 {
		t.Fatalf("response headers %v", r.ResponseHeaders)
	}
	if len(pg.early) != 0 {
		t.Fatalf("early extra info left: %v", pg.early)
	}
}

func TestDevToolsWatchKeepsRequestsApartFromSockets(t *testing.T) {
	w := newDevToolsWatch(nil, slog.New(slog.DiscardHandler))
	w.requests.max = 2 * 300
	pg := newCDPPage("P1", w)
	cdpEvent(t, pg, "Network.webSocketCreated", `{"requestId":"s1","url":"wss://a.example/"}`)
	for i := range 5 {
		id := fmt.Sprintf("r%d", i)
		b, _ := json.Marshal(map[string]any{"requestId": id, "timestamp": 1, "request": map[string]any{"url": "https://a.example/" + id, "method": "GET"}})
		pg.handle("Network.requestWillBeSent", b)
		b, _ = json.Marshal(map[string]any{"requestId": id, "timestamp": 2})
		pg.handle("Network.loadingFinished", b)
	}
	if len(w.sockets.lines) != 1 || w.sockets.lines[0].Socket == nil {
		t.Fatalf("socket history %+v", w.sockets.lines)
	}
	var urls []string
	for _, e := range w.requests.lines {
		urls = append(urls, e.Request.URL)
	}
	if !slices.Equal(urls, []string{"https://a.example/r3", "https://a.example/r4"}) {
		t.Fatalf("kept requests %v", urls)
	}
}

func TestCDPPageWatchesImages(t *testing.T) {
	sink := &devtoolsLines{t: 1000}
	pg := newCDPPage("P1", sink)
	var evals atomic.Int32
	pg.call = func(_ context.Context, method string, params any) (json.RawMessage, error) {
		if method != "Runtime.evaluate" || params.(map[string]any)["expression"] != imageScan {
			return nil, fmt.Errorf("unexpected %s", method)
		}
		if evals.Add(1) > 1 {
			return json.RawMessage(`{"result":{"type":"object","value":null}}`), nil
		}
		return json.RawMessage(`{"result":{"type":"object","value":{"url":"https://shop.example/","width":412,"height":915,"dpr":2.625,` +
			`"uses":[{"element":1,"src":"https://shop.example/a.png","kind":"img","width":32,"height":32,"naturalWidth":512,"naturalHeight":512,"shown":true}],` +
			`"svgs":["<svg><path d=\"M0 0h24v24H0z\"/></svg>"]}}}`), nil
	}
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		pg.watchImages(ctx)
		close(done)
	}()
	waitLines(t, sink, func() bool { return evals.Load() >= 2 })
	cancel()
	<-done
	lines := sink.of(contract.DevToolsImagesEntry)
	if len(lines) != 1 || lines[0].Target != "P1" {
		t.Fatalf("images lines %+v", lines)
	}
	im := lines[0].Images
	if im.DPR != 2.625 || len(im.Uses) != 1 || im.Uses[0].NaturalWidth != 512 || !im.Uses[0].Shown || len(im.SVGs) != 1 {
		t.Fatalf("images %+v", im)
	}

	worker := newCDPPage("W1", sink)
	worker.kind = "worker"
	worker.watchImages(t.Context())
}

func TestDevToolsRecorderKeepsImageBodiesUpToTheirLimit(t *testing.T) {
	small := base64.StdEncoding.EncodeToString(make([]byte, 1000))
	big := base64.StdEncoding.EncodeToString(make([]byte, cdpImageLimit+1))
	for _, tc := range []struct {
		name, body string
		size       int
		skipped    string
	}{
		{"small", small, 1000, ""},
		{"cached but too big", big, 0, "size"},
		{"too big on the wire", small, cdpImageLimit + 1, "size"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sink := &devtoolsLines{t: 1000}
			pg := newCDPPage("P1", sink)
			pg.call = func(context.Context, string, any) (json.RawMessage, error) {
				return json.Marshal(map[string]any{"body": tc.body, "base64Encoded": true})
			}
			cdpEvent(t, pg, "Network.requestWillBeSent", `{"requestId":"i1","timestamp":1,"type":"Image","request":{"url":"https://shop.example/a.png","method":"GET"}}`)
			cdpEvent(t, pg, "Network.loadingFinished", fmt.Sprintf(`{"requestId":"i1","timestamp":2,"encodedDataLength":%d}`, tc.size))
			waitLines(t, sink, func() bool { return len(sink.of(contract.DevToolsRequestEntry)) == 1 })
			r := sink.of(contract.DevToolsRequestEntry)[0].Request
			if r.BodySkipped != tc.skipped || (tc.skipped == "" && (r.Body != small || !r.BodyBase64)) || (tc.skipped != "" && r.Body != "") {
				t.Fatalf("image request: skipped %q, body %d bytes", r.BodySkipped, len(r.Body))
			}
		})
	}
}

func TestDevToolsWatchHandsOutBodies(t *testing.T) {
	w := newDevToolsWatch(nil, slog.New(slog.DiscardHandler))
	pg := newCDPPage("P1", w)
	pg.call = func(_ context.Context, method string, params any) (json.RawMessage, error) {
		if params.(map[string]any)["requestId"] != "r1" {
			return nil, errors.New("no resource with given identifier found")
		}
		return json.RawMessage(`{"body":"const a=1","base64Encoded":false}`), nil
	}
	w.procs["webview_devtools_remote_1"] = &cdpProcess{w: w, pages: map[string]*cdpPage{"S1": pg}}
	b, err := w.body(t.Context(), "P1", "r1")
	if err != nil || b.Body != "const a=1" || b.Base64 {
		t.Fatalf("body %+v, %v", b, err)
	}
	if _, err := w.body(t.Context(), "P1", "r2"); !errors.Is(err, contract.ErrNotFound) {
		t.Fatalf("missing body: %v", err)
	}
	if _, err := w.body(t.Context(), "P9", "r1"); !errors.Is(err, contract.ErrNotFound) {
		t.Fatalf("missing target: %v", err)
	}
}
