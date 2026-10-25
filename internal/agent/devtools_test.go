package agent

import (
	"archive/tar"
	"context"
	"errors"
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
		{"537.36 (@0000000000000000000000000000000000000000)", ""},
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
	reverses map[int]int
	installs int
	shells   []string
	apks     []string
	appData  []byte
	restored []*tar.Header
}

func (d *fakeDevice) Shell(_ context.Context, cmd string) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.shells = append(d.shells, cmd)
	switch {
	case cmd == "cat /proc/net/unix":
		return d.unix, nil
	case cmd == "date +%s%N":
		return strconv.FormatInt(time.Now().UnixNano(), 10), nil
	case strings.Contains(cmd, "du -sk"):
		return "8 /data/data/com.example.shop/files\n4 /data/data/com.example.shop/shared_prefs\n200 /data/data/com.example.shop/cache\n", nil
	case strings.Contains(cmd, "stat -c"):
		return "root /data/data/com.example.shop 10234 u:object_r:app_data_file:s0:c234,c256,c512,c768\n", nil
	case strings.HasPrefix(cmd, "tar -xf "+restoreFile):
		return "rc=0\n", nil
	}
	return "", nil
}

func (d *fakeDevice) ExecOut(_ context.Context, cmd string, w io.Writer) error {
	d.mu.Lock()
	d.shells = append(d.shells, cmd)
	raw := d.appData
	d.mu.Unlock()
	_, err := w.Write(raw)
	return err
}

func (d *fakeDevice) Install(_ context.Context, apk string) error {
	raw, err := os.ReadFile(apk)
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if strings.Contains(string(raw), "broken") {
		return errors.New("adb install: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]")
	}
	d.installs++
	d.apks = append(d.apks, string(raw))
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

func (d *fakeDevice) Reverse(_ context.Context, port, local int) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.reverses == nil {
		d.reverses = map[int]int{}
	}
	d.reverses[port] = local
	return nil
}

func (d *fakeDevice) RemoveReverse(_ context.Context, port int) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.reverses, port)
	return nil
}

func (d *fakeDevice) reversed(port int) (int, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	local, ok := d.reverses[port]
	return local, ok
}

func (d *fakeDevice) Push(_ context.Context, local, remote string) error {
	if remote != restoreFile {
		return nil
	}
	f, err := os.Open(local)
	if err != nil {
		return err
	}
	defer f.Close()
	tr := tar.NewReader(f)
	var headers []*tar.Header
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
		headers = append(headers, h)
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.restored = headers
	return nil
}

func (d *fakeDevice) ForwardTo(context.Context, string) (int, error) {
	return 0, errors.New("no scrcpy here")
}

func (d *fakeDevice) Run(ctx context.Context, _ string) error {
	<-ctx.Done()
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
	d := NewDevTools(dev, "", slog.New(slog.DiscardHandler))
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
	d := NewDevTools(dev, "", slog.New(slog.DiscardHandler))
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

func TestDevToolsFallbackRev(t *testing.T) {
	const zeros, fallback = "0000000000000000000000000000000000000000", "7d74334854bbfcbaf1c955e86589d8b7cc9acc31"
	mux := http.NewServeMux()
	mux.HandleFunc("GET /json/version", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"Android-Package":"com.example.shop","WebKit-Version":"537.36 (@`+zeros+`)"}`)
	})
	mux.HandleFunc("GET /json/list", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `[{"id":"P1","type":"page","url":"https://shop.example/","devtoolsFrontendUrl":"https://chrome-devtools-frontend.appspot.com/serve_rev/@`+zeros+`/inspector.html"}]`)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	port := srv.Listener.Addr().(*net.TCPAddr).Port
	for _, tc := range []struct{ rev, want string }{{fallback, fallback}, {"", ""}, {"not-a-rev", ""}} {
		dev := &fakeDevice{unix: procNetUnix, ports: map[string]int{"webview_devtools_remote_4242": port, "chrome_devtools_remote": port}}
		d := NewDevTools(dev, tc.rev, slog.New(slog.DiscardHandler))
		if err := d.scan(context.Background()); err != nil {
			t.Fatal(err)
		}
		targets, err := d.Targets(context.Background())
		if err != nil || len(targets) == 0 {
			t.Fatalf("targets %+v, %v", targets, err)
		}
		if got := targets[0].FrontendRev; got != tc.want {
			t.Errorf("fallback %q: frontend rev %q, want %q", tc.rev, got, tc.want)
		}
	}
}
