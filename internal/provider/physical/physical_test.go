package physical

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"

	"github.com/kriakiku/holtdroid/internal/agent"
	"github.com/kriakiku/holtdroid/internal/agent/phone"
	"github.com/kriakiku/holtdroid/internal/apk"
	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/vpn"
)

type fakeHost struct {
	mu       sync.Mutex
	devices  map[string]string
	agents   []*fakeAgent
	resets   []string
	captures []string
	cleanups []phone.Cleanup
	release  chan struct{}
}

func (h *fakeHost) Devices(context.Context) (map[string]string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return maps.Clone(h.devices), nil
}

func (h *fakeHost) Props(_ context.Context, serial string) (contract.SlotCapabilities, error) {
	return contract.SlotCapabilities{Model: "Phone " + serial, Android: "15", ABIs: []string{"arm64-v8a"}, DevTools: contract.DevToolsDebuggable}, nil
}

func (h *fakeHost) Inspect(_ context.Context, serial string) (contract.DeviceInfo, error) {
	return contract.DeviceInfo{Model: "Phone " + serial, Android: "15", Battery: &contract.Battery{Level: 80, Celsius: 30}}, nil
}

func (h *fakeHost) Agent(cfg agent.Config, s phone.Session, _ *slog.Logger) Agent {
	h.mu.Lock()
	defer h.mu.Unlock()
	a := &fakeAgent{cfg: cfg, tunnel: s.Tunnel, session: s, state: contract.StateReady}
	h.agents = append(h.agents, a)
	return a
}

func (h *fakeHost) Capture(_ context.Context, serial string) (*phone.Baseline, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.captures = append(h.captures, serial)
	return &phone.Baseline{Packages: []string{"com.android.settings"}}, nil
}

func (h *fakeHost) Clean(_ context.Context, serial string, c phone.Cleanup) error {
	pkg := c.Package
	h.mu.Lock()
	h.cleanups = append(h.cleanups, c)
	h.mu.Unlock()
	if h.release != nil {
		<-h.release
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.resets = append(h.resets, serial+" "+pkg)
	return nil
}

func (h *fakeHost) agent(i int) *fakeAgent {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.agents[i]
}

type fakeAgent struct {
	cfg     agent.Config
	tunnel  *phone.Tunnel
	session phone.Session
	mu      sync.Mutex
	state   contract.SessionState
	stopped bool
	install error
}

func (a *fakeAgent) Run(ctx context.Context) {
	<-ctx.Done()
	a.mu.Lock()
	a.stopped = true
	a.mu.Unlock()
}

func (a *fakeAgent) Status(context.Context) contract.StatusEvent {
	a.mu.Lock()
	defer a.mu.Unlock()
	return contract.StatusEvent{State: a.state}
}

func (a *fakeAgent) Install(context.Context, contract.Install) error { return a.install }

func (a *fakeAgent) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("agent " + a.cfg.Serial + " " + r.URL.Path))
	})
}

func (a *fakeAgent) TunnelHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("tunnel " + r.URL.Path)) })
}

func newProvider(t *testing.T, host *fakeHost, state string, configure ...func(*Config)) (*Provider, *contract.ProviderClient) {
	t.Helper()
	cfg := DefaultConfig()
	for _, f := range configure {
		f(&cfg)
	}
	cfg.PublicURL = "http://phones"
	cfg.TunnelURL = "http://phones:8081"
	cfg.StateFile = state
	if cfg.Phones == nil {
		cfg.Phones = []Phone{{Serial: "A1"}, {Serial: "B2", Label: "Desk phone"}}
	}
	p, err := New(cfg, host, WithLogger(slog.New(slog.DiscardHandler)), func(p *Provider) {
		p.apk = func(string) (apk.Metadata, []byte, error) {
			return apk.Metadata{Package: phone.TunnelPackage, VersionName: "0.1.0"}, nil, nil
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	p.refresh(context.Background())
	mux := http.NewServeMux()
	contract.RegisterProvider(humago.New(mux, huma.DefaultConfig("test", "v1")), p)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return p, contract.NewProviderClient(srv.URL, nil)
}

func TestProviderRoundTrip(t *testing.T) {
	host := &fakeHost{devices: map[string]string{"A1": "device", "B2": "unauthorized", "C3": "device"}}
	state := filepath.Join(t.TempDir(), "state.json")
	p, c := newProvider(t, host, state)
	ctx := context.Background()

	caps, err := c.Capabilities(ctx)
	if err != nil || caps.Kind != "physical" || !slices.Equal(caps.ABIs, []string{"arm64-v8a"}) || len(caps.Locations) != 0 {
		t.Fatalf("capabilities %+v, %v", caps, err)
	}
	capacity, err := c.Capacity(ctx)
	if err != nil {
		t.Fatal(err)
	}
	want := []contract.Slot{
		{ID: "A1", Label: "Phone A1", State: contract.SlotFree, Capabilities: &contract.SlotCapabilities{Model: "Phone A1", Android: "15", ABIs: []string{"arm64-v8a"}, DevTools: contract.DevToolsDebuggable}},
		{ID: "B2", Label: "Desk phone", State: contract.SlotOffline},
	}
	if len(capacity.Slots) != 2 || capacity.Slots[0].Capabilities == nil || capacity.Slots[0].Label != want[0].Label || capacity.Slots[0].State != want[0].State ||
		capacity.Slots[1] != want[1] {
		t.Fatalf("capacity %+v", capacity.Slots)
	}

	for _, req := range []contract.CreateSession{
		{ArtifactURL: "http://api/x", ArtifactRef: "src/x", Package: "x; reboot", Owner: "otter"},
		{ArtifactURL: "http://api/x", ArtifactRef: "src/x", Package: "com.x", Owner: "otter", Location: "pl"},
		{ArtifactURL: "http://api/x", ArtifactRef: "src/x", Package: "com.x", Owner: "otter", AppData: &contract.AppDataRestore{URL: "http://api/d"}},
	} {
		if _, err := c.Create(ctx, req); !errors.Is(err, contract.ErrInvalid) {
			t.Errorf("create %+v: %v, want invalid", req, err)
		}
	}

	s, err := c.Create(ctx, contract.CreateSession{ArtifactURL: "http://api/x", ArtifactRef: "src/x@1", Package: "com.x", Owner: "otter"})
	if err != nil || s.Slot != "A1" || s.AgentURL != "http://phones/agents/"+s.ID || s.TunnelURL != "http://phones:8081/agents/"+s.ID ||
		s.Capabilities == nil || s.Capabilities.Root || s.Capabilities.DevTools != contract.DevToolsDebuggable {
		t.Fatalf("create %+v, %v", s, err)
	}
	cfg := host.agent(0).cfg
	if cfg.Serial != "A1" || cfg.Package != "com.x" || cfg.ArtifactURL != "http://api/x" || cfg.Root || cfg.HostMetrics || cfg.Resume || cfg.ADBAddr != "" ||
		cfg.ADBServer != "127.0.0.1:5037" || cfg.ADBShell != agent.ShellAllowlist {
		t.Fatalf("agent config %+v", cfg)
	}
	if _, err := c.Create(ctx, contract.CreateSession{ArtifactURL: "http://api/x", ArtifactRef: "src/x", Package: "com.x", Owner: "otter"}); !errors.Is(err, contract.ErrNoCapacity) {
		t.Fatalf("second create: %v, want no capacity", err)
	}

	got, err := c.Get(ctx, s.ID)
	if err != nil || got.State != contract.StateReady {
		t.Fatalf("get %+v, %v", got, err)
	}
	got, err = c.Install(ctx, s.ID, contract.Install{ArtifactURL: "http://api/y", ArtifactRef: "src/x@2"})
	if err != nil || got.ArtifactRef != "src/x@2" {
		t.Fatalf("install %+v, %v", got, err)
	}
	at := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	if err := c.Touch(ctx, s.ID, at); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	p.AgentHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/agents/"+s.ID+"/v1/status", nil))
	if rec.Body.String() != "agent A1 /v1/status" {
		t.Fatalf("agent handler: %q", rec.Body.String())
	}
	rec = httptest.NewRecorder()
	p.TunnelHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/agents/nope/tunnel/adb", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown session tunnel: %d", rec.Code)
	}

	host.release = make(chan struct{})
	if err := c.Delete(ctx, s.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Get(ctx, s.ID); !errors.Is(err, contract.ErrNotFound) {
		t.Fatalf("get after delete: %v", err)
	}
	if capacity, _ := c.Capacity(ctx); capacity.Slots[0].State != contract.SlotBusy {
		t.Fatalf("phone is not busy while it resets: %+v", capacity.Slots[0])
	}
	close(host.release)
	waitFor(t, func() bool {
		capacity, _ := c.Capacity(ctx)
		return capacity.Slots[0].State == contract.SlotFree
	})
	if !slices.Equal(host.resets, []string{"A1 com.x"}) || !host.agent(0).stopped {
		t.Fatalf("resets %v, stopped %v", host.resets, host.agent(0).stopped)
	}
	if !slices.Equal(host.captures, []string{"A1"}) {
		t.Fatalf("captures %v, want only the free online phone", host.captures)
	}
	if ps := host.agent(0).session; ps.Baseline == nil || ps.Resume || ps.Package != "com.x" {
		t.Fatalf("phone session %+v", ps)
	}
	if c := host.cleanups[0]; !c.End || c.Baseline == nil || c.Offline {
		t.Fatalf("cleanup %+v", c)
	}
}

func TestRestartResumesSessions(t *testing.T) {
	state := filepath.Join(t.TempDir(), "state.json")
	host := &fakeHost{devices: map[string]string{"A1": "device", "B2": "device"}}
	p, c := newProvider(t, host, state)
	ctx := context.Background()
	s, err := c.Create(ctx, contract.CreateSession{ArtifactURL: "http://api/x", ArtifactRef: "src/x@1", Package: "com.x", Owner: "otter"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Install(ctx, s.ID, contract.Install{ArtifactURL: "http://api/y", ArtifactRef: "src/x@2"}); err != nil {
		t.Fatal(err)
	}
	other, err := c.Create(ctx, contract.CreateSession{ArtifactURL: "http://api/z", ArtifactRef: "src/z@1", Package: "com.z", Owner: "otter"})
	if err != nil {
		t.Fatal(err)
	}
	host.release = make(chan struct{})
	if err := c.Delete(ctx, other.ID); err != nil {
		t.Fatal(err)
	}
	p.Close()
	close(host.release)

	host2 := &fakeHost{devices: host.devices}
	_, c2 := newProvider(t, host2, state)
	got, err := c2.Get(ctx, s.ID)
	if err != nil || got.ArtifactRef != "src/x@2" || got.Owner != "otter" || got.Slot != "A1" {
		t.Fatalf("resumed session %+v, %v", got, err)
	}
	if cfg := host2.agent(0).cfg; !cfg.Resume || !host2.agent(0).session.Resume || cfg.ArtifactURL != "http://api/y" {
		t.Fatalf("resumed agent config %+v", cfg)
	}
	waitFor(t, func() bool {
		host2.mu.Lock()
		defer host2.mu.Unlock()
		return slices.Equal(host2.resets, []string{"B2 com.z"})
	})
}

func TestVPN(t *testing.T) {
	dir := t.TempDir()
	singBox := filepath.Join(dir, "sing-box")
	if err := os.WriteFile(singBox, []byte("#!/bin/sh\necho \"$@\" > \"$(dirname \"$0\")/args\"\nexec sleep 600\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	host := &fakeHost{devices: map[string]string{"A1": "device"}}
	_, c := newProvider(t, host, filepath.Join(dir, "state.json"), func(cfg *Config) {
		cfg.SingBox = singBox
		cfg.Tunnel.APK = "/opt/holtdroid/holtdroid-tunnel.apk"
		cfg.VPN.Locations = []vpn.Location{{ID: "de", Label: "Germany", Outbound: map[string]any{"type": "socks", "server": "gateway.example", "server_port": 1080}}}
		cfg.VPN.Default = "de"
	})
	ctx := context.Background()

	caps, err := c.Capabilities(ctx)
	if err != nil || len(caps.Locations) != 2 || caps.DefaultLocation != "de" {
		t.Fatalf("capabilities %+v, %v", caps, err)
	}
	if _, err := c.Create(ctx, contract.CreateSession{ArtifactURL: "http://api/x", ArtifactRef: "src/x", Package: "com.x", Owner: "otter", Location: "pl"}); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("unknown location: %v", err)
	}
	s, err := c.Create(ctx, contract.CreateSession{ArtifactURL: "http://api/x", ArtifactRef: "src/x", Package: "com.x", Owner: "otter"})
	if err != nil || s.Location != "de" {
		t.Fatalf("create %+v, %v", s, err)
	}
	a := host.agent(0)
	tun := a.tunnel
	if tun == nil || tun.Port != 29180 || tun.HostPort == 0 || a.session.App.APK != "/opt/holtdroid/holtdroid-tunnel.apk" || a.session.App.Version != "0.1.0" || !tun.IPv6 {
		t.Fatalf("tunnel %+v", tun)
	}
	if a.cfg.Location != "de" || !a.cfg.USBNetwork || a.cfg.ClashAPI == "" || a.cfg.IPInfoProxy != fmt.Sprintf("http://127.0.0.1:%d", tun.HostPort) {
		t.Fatalf("agent config: location %q, clash %q, ipinfo proxy %q", a.cfg.Location, a.cfg.ClashAPI, a.cfg.IPInfoProxy)
	}
	var args string
	waitFor(t, func() bool {
		b, err := os.ReadFile(filepath.Join(dir, "args"))
		args = strings.TrimSpace(string(b))
		return err == nil
	})
	file := strings.TrimPrefix(args, "run -c ")
	info, err := os.Stat(file)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("sing-box config %s: %v, %v", file, info, err)
	}
	raw, _ := os.ReadFile(file)
	if !strings.Contains(string(raw), fmt.Sprintf(`"listen_port": %d`, tun.HostPort)) || !strings.Contains(string(raw), `"default": "de"`) {
		t.Fatalf("sing-box config:\n%s", raw)
	}
	if err := c.Delete(ctx, s.ID); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		_, err := os.Stat(file)
		return errors.Is(err, os.ErrNotExist)
	})
}

func waitFor(t *testing.T, ok func() bool) {
	t.Helper()
	for range 200 {
		if ok() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out")
}

func TestParseDevices(t *testing.T) {
	got := parseDevices("List of devices attached\nA1\tdevice\nB2\tunauthorized\n\n* daemon started successfully\n")
	if len(got) != 2 || got["A1"] != "device" || got["B2"] != "unauthorized" {
		t.Fatalf("%v", got)
	}
}

func TestParseProps(t *testing.T) {
	tests := []struct {
		name, out string
		model     string
		abis      []string
	}{
		{"pixel", "[ro.product.manufacturer]: [Google]\n[ro.product.model]: [Pixel 7]\n[ro.build.version.release]: [15]\n[ro.product.cpu.abilist]: [arm64-v8a,armeabi-v7a,armeabi]\n", "Google Pixel 7", []string{"arm64-v8a", "armeabi-v7a", "armeabi"}},
		{"maker in model", "[ro.product.manufacturer]: [samsung]\n[ro.product.model]: [Samsung SM-S918B]\n", "Samsung SM-S918B", []string{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseProps(tt.out)
			if got.Model != tt.model || !slices.Equal(got.ABIs, tt.abis) || got.Root || !got.ADB || got.DevTools != contract.DevToolsDebuggable {
				t.Fatalf("%+v", got)
			}
		})
	}
}

func TestValidateADB(t *testing.T) {
	for shell, ok := range map[agent.ShellPolicy]bool{agent.ShellFull: true, agent.ShellAllowlist: true, agent.ShellOff: true, "": false, "some": false} {
		cfg := DefaultConfig()
		cfg.ADB.Shell = shell
		if err := cfg.Validate(); (err == nil) != ok {
			t.Errorf("shell %q: %v", shell, err)
		}
	}
}

func TestTunnelAPKMustBeTheTunnel(t *testing.T) {
	cfg := DefaultConfig()
	cfg.StateFile = filepath.Join(t.TempDir(), "state.json")
	cfg.Tunnel.APK = "../../apk/testdata/" + firstAPK(t)
	cfg.VPN.Locations = []vpn.Location{{ID: "de", Outbound: map[string]any{"type": "socks", "server": "gateway.example", "server_port": 1080}}}
	if _, err := New(cfg, &fakeHost{}); err == nil || !strings.Contains(err.Error(), "not "+phone.TunnelPackage) {
		t.Fatalf("err %v", err)
	}
}

func firstAPK(t *testing.T) string {
	t.Helper()
	m, _ := filepath.Glob("../../apk/testdata/*.apk")
	if len(m) == 0 {
		t.Skip("no test APK")
	}
	return filepath.Base(m[0])
}

func TestMaintenance(t *testing.T) {
	host := &fakeHost{devices: map[string]string{"A1": "device", "B2": "device"}}
	state := filepath.Join(t.TempDir(), "state.json")
	_, c := newProvider(t, host, state)
	ctx := context.Background()

	if err := c.SetMaintenance(ctx, contract.SetMaintenance{Slot: "Z9", Enabled: true}); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("unknown phone: %v", err)
	}
	if err := c.SetMaintenance(ctx, contract.SetMaintenance{Slot: "A1", Enabled: true, Reason: "new cable", By: "otter"}); err != nil {
		t.Fatal(err)
	}
	inv, err := c.Inventory(ctx)
	if err != nil || len(inv.Devices) != 2 || inv.Host == nil {
		t.Fatalf("inventory %+v, %v", inv, err)
	}
	a1, b2 := inv.Devices[0], inv.Devices[1]
	if a1.Slot.State != contract.SlotMaintenance || a1.Slot.Maintenance.Reason != "new cable" || a1.Device == nil || a1.Device.Model != "Phone A1" {
		t.Errorf("A1 %+v", a1)
	}
	if b2.Slot.State != contract.SlotFree || b2.Device.Battery.Level != 80 {
		t.Errorf("B2 %+v", b2)
	}
	s, err := c.Create(ctx, contract.CreateSession{ArtifactURL: "http://api/x", ArtifactRef: "src/x", Package: "com.example.app", Owner: "otter"})
	if err != nil || s.Slot != "B2" {
		t.Fatalf("create %+v, %v", s, err)
	}
	if _, err := c.Create(ctx, contract.CreateSession{ArtifactURL: "http://api/x", ArtifactRef: "src/x", Package: "com.example.app", Owner: "otter"}); !errors.Is(err, contract.ErrNoCapacity) {
		t.Fatalf("create on a held phone: %v", err)
	}

	if err := c.SetMaintenance(ctx, contract.SetMaintenance{Enabled: true, Reason: "moving"}); err != nil {
		t.Fatal(err)
	}
	p2, _ := newProvider(t, host, state)
	capacity, _ := p2.Capacity(ctx)
	if capacity.Maintenance == nil || capacity.Maintenance.Reason != "moving" || capacity.Slots[0].Maintenance.Reason != "new cable" || capacity.Slots[1].State != contract.SlotBusy {
		t.Fatalf("after a restart %+v", capacity)
	}
	if err := p2.SetMaintenance(ctx, contract.SetMaintenance{Enabled: false}); err != nil {
		t.Fatal(err)
	}
	capacity, _ = p2.Capacity(ctx)
	if capacity.Maintenance != nil || capacity.Slots[0].State != contract.SlotMaintenance || capacity.Slots[1].Maintenance != nil {
		t.Fatalf("after releasing the provider %+v", capacity)
	}
}
