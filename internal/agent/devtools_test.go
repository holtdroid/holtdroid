package agent

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

const procNetUnix = `Num       RefCount Protocol Flags    Type St Inode Path
0000000000000000: 00000002 00000000 00010000 0001 01 12345 @webview_devtools_remote_4242
0000000000000000: 00000003 00000000 00000000 0001 03 12346 @webview_devtools_remote_4242
0000000000000000: 00000002 00000000 00010000 0001 01 12347 @chrome_devtools_remote
0000000000000000: 00000002 00000000 00010000 0001 01 12348 @jdwp-control
0000000000000000: 00000002 00000000 00010000 0001 01 12349 /dev/socket/zygote
0000000000000000: 00000002 00000000 00010000 0001 01 12350
`

func TestParseDevToolsSockets(t *testing.T) {
	got := parseDevToolsSockets(procNetUnix)
	want := []string{"chrome_devtools_remote", "webview_devtools_remote_4242"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestSocketPIDAndRev(t *testing.T) {
	for _, tc := range []struct{ in, rev string }{
		{"https://chrome-devtools-frontend.appspot.com/serve_rev/@0a1b2c3d4e5f60718293a4b5c6d7e8f901234567/inspector.html?ws=localhost/devtools/page/X", "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567"},
		{"537.36 (@abcdef1234)", "abcdef1234"},
		{"/devtools/inspector.html?ws=localhost/devtools/page/X", ""},
	} {
		if got := frontendRev(tc.in); got != tc.rev {
			t.Errorf("frontendRev(%q) = %q, want %q", tc.in, got, tc.rev)
		}
	}
	for in, pid := range map[string]int{"webview_devtools_remote_4242": 4242, "chrome_devtools_remote": 0} {
		if got := socketPID(in); got != pid {
			t.Errorf("socketPID(%q) = %d, want %d", in, got, pid)
		}
	}
}

type fakeDevice struct {
	mu       sync.Mutex
	unix     string
	ports    map[string]int
	removed  []int
	installs int
	shells   []string
}

func (d *fakeDevice) Shell(_ context.Context, cmd string) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.shells = append(d.shells, cmd)
	switch cmd {
	case "cat /proc/net/unix":
		return d.unix, nil
	case "date +%s%N":
		return strconv.FormatInt(time.Now().UnixNano(), 10), nil
	}
	return "", nil
}

func (d *fakeDevice) Install(context.Context, string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.installs++
	return nil
}

func (d *fakeDevice) Forward(_ context.Context, socket string) (int, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.ports[socket], nil
}

func (d *fakeDevice) RemoveForward(_ context.Context, port int) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.removed = append(d.removed, port)
	return nil
}

func (d *fakeDevice) Screencap(context.Context) ([]byte, error) {
	return []byte("\x89PNG"), nil
}

func (d *fakeDevice) setUnix(s string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.unix = s
}

// webviewDevTools imitates a WebView's DevTools server, including its
// refusal of foreign Host and Origin headers.
func webviewDevTools(t *testing.T) (*httptest.Server, int) {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /json/version", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"Android-Package":"com.example.shop","WebKit-Version":"537.36 (@abcdef1234)"}`)
	})
	mux.HandleFunc("GET /json/list", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `[{"id":"P1","type":"page","title":"Checkout","url":"https://shop.example/checkout","devtoolsFrontendUrl":"https://chrome-devtools-frontend.appspot.com/serve_rev/@0123456789abcdef/inspector.html?ws=localhost/devtools/page/P1"},
			{"id":"W1","type":"service_worker","title":"sw.js","url":"https://shop.example/sw.js","devtoolsFrontendUrl":""}]`)
	})
	mux.HandleFunc("GET /devtools/page/{id}", func(w http.ResponseWriter, r *http.Request) {
		if r.Host != "localhost" || r.Header.Get("Origin") != "" {
			http.Error(w, "Host header is specified and is not an IP address or localhost.", http.StatusForbidden)
			return
		}
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = c.CloseNow() }()
		_ = c.Write(r.Context(), websocket.MessageText, []byte("page "+r.PathValue("id")))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, srv.Listener.Addr().(*net.TCPAddr).Port
}

func TestDevToolsTargetsAndCDPProxy(t *testing.T) {
	_, port := webviewDevTools(t)
	dev := &fakeDevice{unix: procNetUnix, ports: map[string]int{"webview_devtools_remote_4242": port, "chrome_devtools_remote": 1}}
	d := NewDevTools(dev, slog.New(slog.DiscardHandler))
	ctx := context.Background()
	if err := d.scan(ctx); err != nil {
		t.Fatal(err)
	}

	targets, err := d.Targets(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 2 {
		t.Fatalf("targets %+v", targets)
	}
	page, sw := targets[0], targets[1]
	if page.Socket != "webview_devtools_remote_4242" || page.PID != 4242 || page.Process != "com.example.shop" || page.ID != "P1" || page.FrontendRev != "0123456789abcdef" {
		t.Fatalf("page %+v", page)
	}
	if sw.Type != "service_worker" || sw.FrontendRev != "abcdef1234" {
		t.Fatalf("worker %+v", sw)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /devtools/{socket}/page/{id}", d.ServeCDP)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/devtools/webview_devtools_remote_4242/page/P1",
		&websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"https://android.example.com"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = c.CloseNow() }()
	_, msg, err := c.Read(ctx)
	if err != nil || string(msg) != "page P1" {
		t.Fatalf("cdp message %q, %v", msg, err)
	}

	dev.setUnix("")
	if err := d.scan(ctx); err != nil {
		t.Fatal(err)
	}
	if targets, _ := d.Targets(ctx); len(targets) != 0 {
		t.Fatalf("targets after the sockets went away: %+v", targets)
	}
	if len(dev.removed) != 2 {
		t.Fatalf("removed forwards %v", dev.removed)
	}
	resp, err := http.Get(srv.URL + "/devtools/webview_devtools_remote_4242/page/P1")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown socket: %d", resp.StatusCode)
	}
}

func TestFrontendCache(t *testing.T) {
	var hits atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.URL.Path != "/serve_rev/@0123456789abcdef/inspector.html" {
			http.NotFound(w, r)
			return
		}
		_, _ = io.WriteString(w, "<!doctype html>devtools")
	}))
	defer upstream.Close()

	dir := t.TempDir()
	mux := http.NewServeMux()
	mux.Handle("GET /devtools-frontend/{rev}/{file...}", NewFrontend(upstream.URL+"/serve_rev", dir))
	srv := httptest.NewServer(mux)
	defer srv.Close()

	get := func(path string) (int, string) {
		t.Helper()
		resp, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(body)
	}
	for range 2 {
		code, body := get("/devtools-frontend/@0123456789abcdef/inspector.html?wss=x")
		if code != http.StatusOK || body != "<!doctype html>devtools" {
			t.Fatalf("frontend: %d %q", code, body)
		}
	}
	if hits.Load() != 1 {
		t.Fatalf("upstream hits %d, want 1", hits.Load())
	}
	if _, err := os.Stat(filepath.Join(dir, "@0123456789abcdef", "inspector.html")); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		"/devtools-frontend/@0123456789abcdef/missing.js",
		"/devtools-frontend/fake/inspector.html",
		"/devtools-frontend/@0123456789abcdef/..%2F..%2Fetc%2Fpasswd",
	} {
		if code, _ := get(path); code != http.StatusNotFound {
			t.Errorf("%s: %d", path, code)
		}
	}
}

func TestDisplay(t *testing.T) {
	vnc, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer vnc.Close()
	go func() {
		for {
			conn, err := vnc.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				_, _ = io.Copy(conn, conn)
			}()
		}
	}()
	static := t.TempDir()
	if err := os.WriteFile(filepath.Join(static, "vnc.html"), []byte("novnc"), 0o600); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	NewDisplay(static, vnc.Addr().String(), slog.New(slog.DiscardHandler)).Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/display/", nil)
	resp, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if loc := resp.Header.Get("Location"); resp.StatusCode != http.StatusFound || strings.Contains(loc, "path=") || !strings.HasPrefix(loc, "vnc.html?") {
		t.Fatalf("redirect %d %q", resp.StatusCode, loc)
	}
	resp, err = http.Get(srv.URL + "/display/vnc.html")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(body) != "novnc" {
		t.Fatalf("static %q", body)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/display/websockify",
		&websocket.DialOptions{Subprotocols: []string{"binary"}, HTTPHeader: http.Header{"Origin": {"https://android.example.com"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = c.CloseNow() }()
	if c.Subprotocol() != "binary" {
		t.Fatalf("subprotocol %q", c.Subprotocol())
	}
	if err := c.Write(ctx, websocket.MessageBinary, []byte("RFB 003.008\n")); err != nil {
		t.Fatal(err)
	}
	_, msg, err := c.Read(ctx)
	if err != nil || string(msg) != "RFB 003.008\n" {
		t.Fatalf("echo %q, %v", msg, err)
	}
}

func TestDevToolsTargetsSurviveABusyWebView(t *testing.T) {
	var busy atomic.Bool
	mux := http.NewServeMux()
	mux.HandleFunc("GET /json/version", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"Android-Package":"com.example.shop","WebKit-Version":"537.36 (@abcdef1234)"}`)
	})
	mux.HandleFunc("GET /json/list", func(w http.ResponseWriter, _ *http.Request) {
		if busy.Load() {
			http.Error(w, "busy", http.StatusServiceUnavailable)
			return
		}
		_, _ = io.WriteString(w, `[{"id":"P1","type":"page","title":"Checkout","url":"https://shop.example/checkout"}]`)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	port := srv.Listener.Addr().(*net.TCPAddr).Port

	dev := &fakeDevice{unix: procNetUnix, ports: map[string]int{"webview_devtools_remote_4242": port, "chrome_devtools_remote": 1}}
	d := NewDevTools(dev, slog.New(slog.DiscardHandler))
	ctx := context.Background()
	if err := d.scan(ctx); err != nil {
		t.Fatal(err)
	}
	for _, b := range []bool{false, true, false} {
		busy.Store(b)
		targets, err := d.Targets(ctx)
		if err != nil || len(targets) != 1 || targets[0].ID != "P1" {
			t.Fatalf("busy=%v: targets %+v, %v", b, targets, err)
		}
	}
}
