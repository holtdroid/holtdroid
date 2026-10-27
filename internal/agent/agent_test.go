package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

type fakeApp struct {
	done chan struct{}
	once sync.Once
	inst *fakeInstrumenter
}

func (a *fakeApp) exit()                 { a.once.Do(func() { close(a.done) }) }
func (a *fakeApp) Done() <-chan struct{} { return a.done }

func (a *fakeApp) Kill(context.Context) error {
	a.exit()
	return nil
}

type fakeInstrumenter struct {
	mu       sync.Mutex
	spawns   int
	app      *fakeApp
	walls    []Wallpaper
	launched func(App)
}

func (f *fakeInstrumenter) Watch(_ context.Context, _ string, launched func(App)) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.launched = launched
	return nil
}

func (f *fakeInstrumenter) launchOnDevice() {
	f.mu.Lock()
	f.app = &fakeApp{done: make(chan struct{}), inst: f}
	app, launched := f.app, f.launched
	f.mu.Unlock()
	launched(app)
}

func (f *fakeInstrumenter) Spawn(context.Context, string) (App, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.spawns++
	f.app = &fakeApp{done: make(chan struct{}), inst: f}
	return f.app, nil
}

func (f *fakeInstrumenter) SetWallpaper(_ context.Context, w Wallpaper) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.walls = append(f.walls, w)
	return nil
}

func (f *fakeInstrumenter) wallpapers() []Wallpaper {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Wallpaper(nil), f.walls...)
}

func (f *fakeInstrumenter) current() (*fakeApp, int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.app, f.spawns
}

type fakeClipboard struct {
	mu   sync.Mutex
	text string
}

func (c *fakeClipboard) Run(ctx context.Context, _ func(string)) { <-ctx.Done() }

func (c *fakeClipboard) Set(_ context.Context, text string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.text = text
	return nil
}

type harness struct {
	t         *testing.T
	agent     *Agent
	dev       *fakeDevice
	inst      *fakeInstrumenter
	url       string
	artifacts string
	cancel    context.CancelFunc
	done      chan struct{}
}

func newHarness(t *testing.T, boot BootFunc) *harness {
	t.Helper()
	return newHarnessWith(t, boot, nil)
}

func newHarnessWith(t *testing.T, boot BootFunc, configure func(*Config)) *harness {
	t.Helper()
	artifact := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "PK "+r.URL.Path)
	}))
	t.Cleanup(artifact.Close)

	cfg := DefaultConfig()
	cfg.ArtifactURL = artifact.URL + "/internal/artifacts/local/app.apk"
	cfg.Package = "com.example.shop"
	cfg.IPInfoURL = ""
	cfg.CacheDir = t.TempDir()
	cfg.NoWallpaper = false
	if configure != nil {
		configure(&cfg)
	}
	h := &harness{t: t, dev: &fakeDevice{}, inst: &fakeInstrumenter{}, artifacts: artifact.URL, done: make(chan struct{})}
	if boot == nil {
		boot = func(ctx context.Context, booted func()) error {
			booted()
			<-ctx.Done()
			return nil
		}
	}
	h.agent = New(cfg, h.dev, h.inst, boot, slog.New(slog.DiscardHandler))
	h.agent.clip = &fakeClipboard{}
	srv := httptest.NewServer(h.agent.Handler())
	t.Cleanup(srv.Close)
	h.url = srv.URL

	ctx, cancel := context.WithCancel(context.Background())
	h.cancel = cancel
	go func() {
		h.agent.Run(ctx)
		close(h.done)
	}()
	t.Cleanup(func() {
		cancel()
		<-h.done
	})
	return h
}

func (h *harness) waitState(want contract.SessionState) contract.StatusEvent {
	h.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if s, _ := h.agent.snapshot(); s.State == want {
			return s
		}
		time.Sleep(5 * time.Millisecond)
	}
	s, _ := h.agent.snapshot()
	h.t.Fatalf("state %+v, want %s", s, want)
	return s
}

func (h *harness) do(method, path, body string) (int, string) {
	h.t.Helper()
	req, _ := http.NewRequest(method, h.url+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(raw)
}

func TestAgentLifecycle(t *testing.T) {
	h := newHarness(t, nil)
	h.waitState(contract.StateReady)
	if code, _ := h.do(http.MethodGet, "/v1/health", ""); code != http.StatusOK {
		t.Fatalf("health %d", code)
	}
	h.dev.mu.Lock()
	installs := h.dev.installs
	h.dev.mu.Unlock()
	if installs != 1 {
		t.Fatalf("installs %d", installs)
	}

	clips := make(chan string, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	go func() {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, h.url+"/v1/clipboard/events", nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			close(clips)
			return
		}
		defer resp.Body.Close()
		events := bufio.NewScanner(resp.Body)
		for events.Scan() {
			if data, ok := strings.CutPrefix(events.Text(), "data: "); ok {
				var c contract.Clipboard
				_ = json.Unmarshal([]byte(data), &c)
				clips <- c.Text
				return
			}
		}
		close(clips)
	}()
	waitFor(t, func() bool {
		h.agent.mu.Lock()
		defer h.agent.mu.Unlock()
		return len(h.agent.subs) > 0
	})

	h.agent.controls.mu.Lock()
	h.agent.controls.apiLevel = 33
	h.agent.controls.mu.Unlock()
	if code, body := h.do(http.MethodPost, "/v1/clipboard", `{"text":"hello from the browser"}`); code != http.StatusNoContent {
		t.Fatalf("set clipboard %d %s", code, body)
	}
	if code, body := h.do(http.MethodGet, "/v1/clipboard", ""); code != http.StatusOK || !strings.Contains(body, "hello from the browser") {
		t.Fatalf("get clipboard %d %s", code, body)
	}
	if clip := <-clips; clip != "hello from the browser" {
		t.Fatalf("clip event %q", clip)
	}
	h.dev.mu.Lock()
	shells := strings.Join(h.dev.shells, ";")
	h.dev.mu.Unlock()
	if !strings.Contains(shells, `su 2000 sh -c "CLASSPATH=/data/local/tmp/holtdroid-tools.dex app_process / Clip /data/local/tmp/holtdroid-clip-`) {
		t.Fatalf("redroid's clipboard must skip SystemUI's preview: %s", shells)
	}
	if !strings.Contains(shells, "databases/launcher.db") || !strings.Contains(shells, "-a android.intent.action.MAIN com.example.shop |") {
		t.Fatalf("the app is not put on the home screen: %s", shells)
	}

	app, _ := h.inst.current()
	if code, _ := h.do(http.MethodPost, "/v1/app/restart", ""); code != http.StatusAccepted {
		t.Fatalf("restart %d", code)
	}
	waitFor(t, func() bool { a, n := h.inst.current(); return n == 2 && a != app })
	h.waitState(contract.StateReady)

	if code, _ := h.do(http.MethodPost, "/v1/app/reinstall", ""); code != http.StatusAccepted {
		t.Fatalf("reinstall %d", code)
	}
	waitFor(t, func() bool { _, n := h.inst.current(); return n == 3 })
	h.dev.mu.Lock()
	installs, shells = h.dev.installs, strings.Join(h.dev.shells, ";")
	h.dev.mu.Unlock()
	if installs != 2 || !strings.Contains(shells, "pm uninstall com.example.shop") ||
		strings.Count(shells, "android.app.role.BROWSER com.example.shop") != 2 || !strings.Contains(shells, "--disable-fre") ||
		!strings.Contains(shells, `--policy='\''{"DnsOverHttpsMode":"off"}'\''`) ||
		!strings.Contains(shells, "wm dismiss-keyguard") {
		t.Fatalf("reinstall: installs %d, shells %s", installs, shells)
	}

	app, _ = h.inst.current()
	app.exit()
	waitFor(t, func() bool { s, _ := h.agent.snapshot(); return !s.AppRunning })
	if s, _ := h.agent.snapshot(); s.State != contract.StateReady {
		t.Fatalf("closing the app must keep the device ready: %+v", s)
	}
	time.Sleep(20 * time.Millisecond)
	if _, n := h.inst.current(); n != 3 {
		t.Fatalf("the app was started again by itself: %d spawns", n)
	}
	h.agent.controls.mu.Lock()
	h.agent.controls.apiLevel = 32
	h.agent.controls.mu.Unlock()
	if code, body := h.do(http.MethodPost, "/v1/clipboard", `{"text":"x"}`); code != http.StatusNoContent {
		t.Fatalf("clipboard without a running app %d %s", code, body)
	}
	if clip := h.agent.clip.(*fakeClipboard); clip.text != "x" {
		t.Fatalf("Android 12 has no clipboard preview and keeps scrcpy: %q", clip.text)
	}

	h.inst.launchOnDevice()
	if s, _ := h.agent.snapshot(); !s.AppRunning {
		waitFor(t, func() bool { s, _ := h.agent.snapshot(); return s.AppRunning })
	}
	if _, n := h.inst.current(); n != 3 {
		t.Fatalf("a launch from the device must not spawn: %d", n)
	}
	if code, body := h.do(http.MethodPost, "/v1/clipboard", `{"text":"from the launcher"}`); code != http.StatusNoContent {
		t.Fatalf("clipboard after a launch from the device %d %s", code, body)
	}

	app, _ = h.inst.current()
	app.exit()
	waitFor(t, func() bool { s, _ := h.agent.snapshot(); return !s.AppRunning })
	if code, _ := h.do(http.MethodPost, "/v1/app/restart", ""); code != http.StatusAccepted {
		t.Fatalf("start %d", code)
	}
	waitFor(t, func() bool { s, _ := h.agent.snapshot(); _, n := h.inst.current(); return s.AppRunning && n == 4 })

	if code, body := h.do(http.MethodGet, "/v1/network", ""); code != http.StatusOK || !strings.Contains(body, `"location":"direct"`) {
		t.Fatalf("network %d %s", code, body)
	}
	if code, _ := h.do(http.MethodPut, "/v1/network/location", `{"location":"pl"}`); code != http.StatusBadRequest {
		t.Fatalf("location without vpn: %d", code)
	}

	h.cancel()
	<-h.done
	h.waitState(contract.StateStopping)
}

func TestAgentResume(t *testing.T) {
	h := newHarnessWith(t, nil, func(c *Config) { c.Resume = true })
	h.waitState(contract.StateReady)
	h.dev.mu.Lock()
	installs := h.dev.installs
	h.dev.mu.Unlock()
	h.inst.mu.Lock()
	spawns, walls := h.inst.spawns, len(h.inst.walls)
	h.inst.mu.Unlock()
	if installs != 0 || spawns != 1 || walls != 0 {
		t.Fatalf("installs %d, spawns %d, wallpapers %d", installs, spawns, walls)
	}
}

func TestAgentWebView(t *testing.T) {
	for _, tc := range []struct {
		name   string
		resume bool
		path   string
		pkg    string
		apks   []string
		state  contract.SessionState
	}{
		{"before the app", false, "/internal/webview/chromium-158.apk", "", []string{"PK /internal/webview/chromium-158.apk", "PK /internal/artifacts/local/app.apk"}, contract.StateReady},
		{"not again on resume", true, "/internal/webview/chromium-158.apk", "", nil, contract.StateReady},
		{"a failed install fails the session", false, "/internal/webview/broken.apk", "", nil, contract.StateFailed},
		{"another provider becomes the WebView", false, "/internal/webview/google-156.apk", "com.google.android.webview", []string{"PK /internal/webview/google-156.apk", "PK /internal/artifacts/local/app.apk"}, contract.StateReady},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var base string
			h := newHarnessWith(t, func(ctx context.Context, booted func()) error {
				booted()
				<-ctx.Done()
				return nil
			}, func(c *Config) {
				base = strings.TrimSuffix(c.ArtifactURL, "/internal/artifacts/local/app.apk")
				c.WebView = contract.WebViewInstall{URL: base + tc.path, Version: "158.0.8123.0", Package: tc.pkg}
				c.Resume = tc.resume
			})
			s := h.waitState(tc.state)
			h.dev.mu.Lock()
			apks := slices.Clone(h.dev.apks)
			h.dev.mu.Unlock()
			if !slices.Equal(apks, tc.apks) {
				t.Fatalf("installed %q, want %q", apks, tc.apks)
			}
			if tc.state == contract.StateFailed && !strings.Contains(s.Reason, "install WebView 158.0.8123.0") {
				t.Fatalf("reason %q", s.Reason)
			}
			h.dev.mu.Lock()
			switched := slices.Contains(h.dev.shells, "cmd webviewupdate set-webview-implementation com.google.android.webview")
			h.dev.mu.Unlock()
			if switched != (tc.pkg != "") {
				t.Fatalf("set-webview-implementation run: %v, package %q", switched, tc.pkg)
			}
		})
	}
}

func TestAgentBootFailure(t *testing.T) {
	h := newHarness(t, func(context.Context, func()) error {
		return errors.New("emulator exited: exit status 1")
	})
	s := h.waitState(contract.StateFailed)
	if !strings.Contains(s.Reason, "emulator exited") {
		t.Fatalf("reason %q", s.Reason)
	}
	if code, _ := h.do(http.MethodGet, "/v1/health", ""); code != http.StatusServiceUnavailable {
		t.Fatalf("health %d", code)
	}
	if code, _ := h.do(http.MethodPost, "/v1/app/restart", ""); code != http.StatusBadRequest {
		t.Fatalf("restart while failed: %d", code)
	}
}

func TestAgentInstall(t *testing.T) {
	h := newHarness(t, nil)
	h.waitState(contract.StateReady)
	install := func(path string, keep bool) (int, string) {
		raw, _ := json.Marshal(contract.Install{ArtifactURL: h.artifacts + path, ArtifactRef: "local" + path + "@1", KeepData: keep})
		return h.do(http.MethodPost, "/v1/install", string(raw))
	}
	state := func() ([]string, string, int) {
		h.dev.mu.Lock()
		defer h.dev.mu.Unlock()
		_, n := h.inst.current()
		return append([]string(nil), h.dev.apks...), strings.Join(h.dev.shells, ";"), n
	}

	if code, body := install("/v2.apk", true); code != http.StatusNoContent {
		t.Fatalf("install %d %s", code, body)
	}
	apks, shells, spawns := state()
	if apks[len(apks)-1] != "PK /v2.apk" || strings.Contains(shells, "pm uninstall") || spawns != 2 {
		t.Fatalf("keep data: apks %v, shells %s, spawns %d", apks, shells, spawns)
	}
	if s := h.waitState(contract.StateReady); !s.AppRunning {
		t.Fatalf("app not running after install: %+v", s)
	}

	code, body := install("/broken.apk", false)
	if code != http.StatusBadRequest || !strings.Contains(body, "INSTALL_FAILED") {
		t.Fatalf("broken install %d %s", code, body)
	}
	apks, shells, spawns = state()
	if apks[len(apks)-1] != "PK /v2.apk" || !strings.Contains(shells, "pm uninstall com.example.shop") || spawns != 3 {
		t.Fatalf("after a failed clean install: apks %v, shells %s, spawns %d", apks, shells, spawns)
	}
	if s := h.waitState(contract.StateReady); !s.AppRunning {
		t.Fatalf("previous build not running after a failed install: %+v", s)
	}

	if code, _ := h.do(http.MethodPost, "/v1/app/reinstall", ""); code != http.StatusAccepted {
		t.Fatalf("reinstall %d", code)
	}
	waitFor(t, func() bool { _, _, n := state(); return n == 4 })
	if apks, _, _ := state(); apks[len(apks)-1] != "PK /v2.apk" {
		t.Fatalf("reinstall must use the current build: %v", apks)
	}
	waitFor(t, func() bool { return len(h.inst.wallpapers()) == 2 })
	if w := h.inst.wallpapers()[1]; !slices.Contains(w.Rows, [2]string{"artifact", "local/v2.apk@1"}) {
		t.Fatalf("wallpaper after install: %v", w.Rows)
	}
}

func TestNetworkClash(t *testing.T) {
	var mu sync.Mutex
	now := "direct"
	clash := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/proxies/select" {
			http.NotFound(w, r)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		switch r.Method {
		case http.MethodGet:
			_ = json.NewEncoder(w).Encode(map[string]string{"now": now})
		case http.MethodPut:
			var in struct{ Name string }
			_ = json.NewDecoder(r.Body).Decode(&in)
			if in.Name != "pl" && in.Name != "direct" {
				http.Error(w, `{"message":"Selector update error: not found"}`, http.StatusBadRequest)
				return
			}
			now = in.Name
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	defer clash.Close()
	ipinfo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		ips := map[string]string{"direct": `{"ip":"203.0.113.10","country":"LT"}`, "pl": `{"ip":"198.51.100.7","country":"PL"}`}
		_, _ = io.WriteString(w, ips[now])
	}))
	defer ipinfo.Close()

	n := NewNetwork(clash.URL, ipinfo.URL, "")
	ctx := context.Background()
	got, err := n.Get(ctx)
	if err != nil || got != (contract.Network{Location: "direct", ExternalIP: "203.0.113.10", Country: "LT"}) {
		t.Fatalf("get %+v, %v", got, err)
	}
	got, err = n.SetLocation(ctx, "pl")
	if err != nil || got != (contract.Network{Location: "pl", ExternalIP: "198.51.100.7", Country: "PL"}) {
		t.Fatalf("set %+v, %v", got, err)
	}
	if _, err := n.SetLocation(ctx, "mars"); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("unknown location: %v", err)
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition not met")
}
