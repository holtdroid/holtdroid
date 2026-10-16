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
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kriakiku/holtdroid/internal/contract"
)

type fakeApp struct {
	done chan struct{}
	once sync.Once
	inst *fakeInstrumenter
}

func (a *fakeApp) exit()                 { a.once.Do(func() { close(a.done) }) }
func (a *fakeApp) Done() <-chan struct{} { return a.done }

func (a *fakeApp) Clipboard(context.Context) (string, error) {
	a.inst.mu.Lock()
	defer a.inst.mu.Unlock()
	return a.inst.clip, nil
}

func (a *fakeApp) SetClipboard(_ context.Context, text string) error {
	a.inst.mu.Lock()
	a.inst.clip = text
	onClip := a.inst.onClip
	a.inst.mu.Unlock()
	onClip(text)
	return nil
}

func (a *fakeApp) Kill(context.Context) error {
	a.exit()
	return nil
}

type fakeInstrumenter struct {
	mu      sync.Mutex
	spawns  int
	clip    string
	onClip  func(string)
	app     *fakeApp
	locales string
}

func (f *fakeInstrumenter) Spawn(_ context.Context, _ string, onClip func(string)) (App, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.spawns++
	f.onClip = onClip
	f.app = &fakeApp{done: make(chan struct{}), inst: f}
	return f.app, nil
}

func (f *fakeInstrumenter) SetLocales(_ context.Context, tags string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.locales = tags
	return nil
}

func (f *fakeInstrumenter) current() (*fakeApp, int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.app, f.spawns
}

type harness struct {
	t      *testing.T
	agent  *Agent
	dev    *fakeDevice
	inst   *fakeInstrumenter
	url    string
	cancel context.CancelFunc
	done   chan struct{}
}

func newHarness(t *testing.T, boot BootFunc) *harness {
	t.Helper()
	artifact := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "PK fake apk")
	}))
	t.Cleanup(artifact.Close)

	cfg := DefaultConfig()
	cfg.ArtifactURL = artifact.URL + "/internal/artifacts/local/app.apk"
	cfg.Package = "com.example.shop"
	cfg.IPInfoURL = ""
	cfg.CacheDir = t.TempDir()
	h := &harness{t: t, dev: &fakeDevice{}, inst: &fakeInstrumenter{}, done: make(chan struct{})}
	if boot == nil {
		boot = func(ctx context.Context, booted func()) error {
			booted()
			<-ctx.Done()
			return nil
		}
	}
	h.agent = New(cfg, h.dev, h.inst, boot, slog.New(slog.DiscardHandler))
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

	if code, body := h.do(http.MethodPost, "/v1/clipboard", `{"text":"hello from the browser"}`); code != http.StatusNoContent {
		t.Fatalf("set clipboard %d %s", code, body)
	}
	if code, body := h.do(http.MethodGet, "/v1/clipboard", ""); code != http.StatusOK || !strings.Contains(body, "hello from the browser") {
		t.Fatalf("get clipboard %d %s", code, body)
	}
	if clip := <-clips; clip != "hello from the browser" {
		t.Fatalf("clip event %q", clip)
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
	installs, shells := h.dev.installs, strings.Join(h.dev.shells, ";")
	h.dev.mu.Unlock()
	if installs != 2 || !strings.Contains(shells, "pm uninstall com.example.shop") {
		t.Fatalf("reinstall: installs %d, shells %s", installs, shells)
	}

	app, _ = h.inst.current()
	app.exit()
	waitFor(t, func() bool { _, n := h.inst.current(); return n == 4 })
	h.waitState(contract.StateReady)

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
	if code, _ := h.do(http.MethodPost, "/v1/app/restart", ""); code != http.StatusInternalServerError {
		t.Fatalf("restart while failed: %d", code)
	}
}

func TestAgentCrashLoop(t *testing.T) {
	h := newHarness(t, nil)
	for i := 1; i <= 5; i++ {
		waitFor(t, func() bool { _, n := h.inst.current(); return n == i })
		app, _ := h.inst.current()
		app.exit()
	}
	s := h.waitState(contract.StateFailed)
	if !strings.Contains(s.Reason, "exited 5 times") {
		t.Fatalf("reason %q", s.Reason)
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

	n := NewNetwork(clash.URL, ipinfo.URL)
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
