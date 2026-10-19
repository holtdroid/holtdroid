// Package physical is the device provider for phones plugged into this host
// over USB. Slots are phones; every session runs its agent in this process
// against one phone, without root. Session state is kept in a file so a
// restart picks the sessions up again.
package physical

import (
	"cmp"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/kriakiku/holtdroid/internal/agent"
	"github.com/kriakiku/holtdroid/internal/agent/phone"
	"github.com/kriakiku/holtdroid/internal/apk"
	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/vpn"
)

type Config struct {
	Listen       string
	TunnelListen string
	PublicURL    string
	TunnelURL    string
	ADB          ADBConfig
	StateFile    string
	Refresh      time.Duration
	ResetTimeout time.Duration
	Phones       []Phone
	Phone        phone.Config
	Agent        AgentConfig
	VPN          vpn.Config
	SingBox      string
	Tunnel       TunnelConfig
}

// TunnelConfig is the Holtdroid Tunnel app that carries a phone's traffic
// to the session's sing-box when VPN locations are configured.
type TunnelConfig struct {
	APK     string
	Version string
	Port    int
	IPv6    bool
}

// Phone is one phone in the inventory, by its adb serial.
type Phone struct {
	Serial string
	Label  string
}

// ADBConfig is the host's adb and what users may do through it.
type ADBConfig struct {
	Bin    string
	Server string
	Shell  agent.ShellPolicy
}

// AgentConfig is what session agents get from the provider's config.
type AgentConfig struct {
	Scrcpy           agent.ScrcpyConfig
	DevToolsFrontend string
	CacheDir         string
}

func DefaultConfig() Config {
	a := agent.DefaultConfig()
	return Config{
		Listen:       ":8080",
		TunnelListen: ":8081",
		PublicURL:    "http://localhost:8080",
		ADB:          ADBConfig{Bin: "adb", Server: "127.0.0.1:5037", Shell: agent.ShellAllowlist},
		StateFile:    "holtdroid-physical.json",
		Refresh:      5 * time.Second,
		ResetTimeout: 5 * time.Minute,
		Phone:        phone.DefaultConfig(),
		Agent:        AgentConfig{Scrcpy: a.Scrcpy, DevToolsFrontend: a.DevToolsFrontend, CacheDir: a.CacheDir},
		VPN:          vpn.DefaultConfig(),
		SingBox:      "sing-box",
		Tunnel:       TunnelConfig{APK: "/opt/holtdroid/holtdroid-tunnel.apk", Port: 29180, IPv6: true},
	}
}

func (c Config) Validate() error {
	var errs []error
	seen := map[string]bool{}
	for _, p := range c.Phones {
		switch {
		case p.Serial == "":
			errs = append(errs, errors.New("phones: every phone needs a serial"))
		case seen[p.Serial]:
			errs = append(errs, fmt.Errorf("phones: %s is listed twice", p.Serial))
		}
		seen[p.Serial] = true
	}
	if c.ADB.Server == "" {
		errs = append(errs, errors.New("adb.server is required"))
	}
	if err := c.ADB.Shell.Validate(); err != nil {
		errs = append(errs, err)
	}
	if c.StateFile == "" {
		errs = append(errs, errors.New("stateFile is required"))
	}
	if err := c.VPN.Validate(); err != nil {
		errs = append(errs, err)
	}
	if c.VPN.Enabled() && (c.Tunnel.Port < 1 || c.Tunnel.Port > 65535) {
		errs = append(errs, fmt.Errorf("tunnel.port %d is not a port", c.Tunnel.Port))
	}
	if c.VPN.Enabled() && c.Tunnel.APK == "" {
		errs = append(errs, errors.New("tunnel.apk is required with vpn locations"))
	}
	return errors.Join(errs...)
}

var packageName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$`)

type Provider struct {
	cfg  Config
	host Host
	now  func() time.Time
	log  *slog.Logger
	ver  string
	sec  vpn.Secrets
	apk  func(string) (apk.Metadata, []byte, error)
	base context.Context
	stop context.CancelFunc

	mu        sync.Mutex
	vpnDir    string
	inventory map[string]phoneInfo
	baselines map[string]*phone.Baseline
	sessions  map[string]*session
	resets    map[string]string
}

type phoneInfo struct {
	state string
	caps  *contract.SlotCapabilities
}

type session struct {
	s           contract.Session
	artifactURL string
	agent       Agent
	handler     http.Handler
	tunnel      http.Handler
	cancel      context.CancelFunc
	done        chan struct{}
}

// stored is what the state file keeps of a session.
type stored struct {
	Session     contract.Session `json:"session"`
	ArtifactURL string           `json:"artifactUrl"`
}

type state struct {
	Sessions  []stored                   `json:"sessions"`
	Resets    map[string]string          `json:"resets,omitempty"`
	Baselines map[string]*phone.Baseline `json:"baselines,omitempty"`
}

type Option func(*Provider)

func WithClock(now func() time.Time) Option { return func(p *Provider) { p.now = now } }

func WithLogger(log *slog.Logger) Option { return func(p *Provider) { p.log = log } }

func WithVersion(v string) Option { return func(p *Provider) { p.ver = v } }

func WithSecrets(sec vpn.Secrets) Option { return func(p *Provider) { p.sec = sec } }

// New loads the state file and starts the agents of the sessions in it again,
// without reinstalling their apps.
func New(cfg Config, host Host, opts ...Option) (*Provider, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	base, stop := context.WithCancel(context.Background())
	p := &Provider{
		cfg: cfg, host: host, now: time.Now, log: slog.Default(), apk: apk.Parse, base: base, stop: stop,
		inventory: map[string]phoneInfo{}, sessions: map[string]*session{}, resets: map[string]string{}, baselines: map[string]*phone.Baseline{},
	}
	for _, opt := range opts {
		opt(p)
	}
	if err := p.checkTunnel(); err != nil {
		stop()
		return nil, err
	}
	st, err := p.load()
	if err != nil {
		stop()
		return nil, err
	}
	for serial, b := range st.Baselines {
		if p.listed(serial) && b != nil {
			p.baselines[serial] = b
		}
	}
	resets := maps.Clone(st.Resets)
	if resets == nil {
		resets = map[string]string{}
	}
	for _, s := range st.Sessions {
		if !p.listed(s.Session.Slot) {
			p.log.Warn("dropping a session on a phone that is no longer listed", "session", s.Session.ID, "slot", s.Session.Slot)
			continue
		}
		v, err := p.prepareVPN(base, s.Session.ID, s.Session.Location)
		if err != nil {
			p.log.Warn("dropping a session whose VPN can't be set up again", "session", s.Session.ID, "err", err)
			resets[s.Session.Slot] = s.Session.Package
			continue
		}
		p.mu.Lock()
		p.start(s.Session, s.ArtifactURL, true, v)
		p.mu.Unlock()
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for serial, pkg := range resets {
		if p.listed(serial) {
			p.resets[serial] = pkg
			go p.reset(serial, pkg, nil)
		}
	}
	return p, nil
}

// Run keeps the inventory fresh until ctx ends, then stops every agent and
// leaves the sessions in the state file for the next start.
func (p *Provider) Run(ctx context.Context) {
	for {
		p.refresh(ctx)
		select {
		case <-ctx.Done():
			p.Close()
			return
		case <-time.After(p.cfg.Refresh):
		}
	}
}

// Close stops every agent without ending its session.
func (p *Provider) Close() {
	p.stop()
	p.mu.Lock()
	running := make([]*session, 0, len(p.sessions))
	for _, s := range p.sessions {
		running = append(running, s)
	}
	p.mu.Unlock()
	for _, s := range running {
		<-s.done
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.vpnDir != "" {
		os.RemoveAll(p.vpnDir)
		p.vpnDir = ""
	}
}

func (p *Provider) refresh(ctx context.Context) {
	devices, err := p.host.Devices(ctx)
	if err != nil {
		p.log.Warn("list phones", "err", err)
	}
	for _, ph := range p.cfg.Phones {
		st := devices[ph.Serial]
		p.mu.Lock()
		info := p.inventory[ph.Serial]
		p.mu.Unlock()
		info.state = st
		if st == "device" && info.caps == nil {
			caps, err := p.host.Props(ctx, ph.Serial)
			if err != nil {
				p.log.Warn("describe phone", "serial", ph.Serial, "err", err)
			} else {
				info.caps = &caps
			}
		}
		p.mu.Lock()
		p.inventory[ph.Serial] = info
		p.mu.Unlock()
		p.capture(ctx, ph.Serial)
	}
}

// capture records a free phone's baseline the first time it is seen.
func (p *Provider) capture(ctx context.Context, serial string) {
	p.mu.Lock()
	free := slices.ContainsFunc(p.slots(), func(s contract.Slot) bool { return s.ID == serial && s.State == contract.SlotFree })
	_, known := p.baselines[serial]
	p.mu.Unlock()
	if !free || known {
		return
	}
	b, err := p.host.Capture(ctx, serial)
	if err != nil {
		p.log.Warn("record the phone's baseline", "serial", serial, "err", err)
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.baselines[serial] = b
	if err := p.saveLocked(); err != nil {
		p.log.Warn("save state", "err", err)
	}
	p.log.Info("recorded the phone's baseline", "serial", serial, "packages", len(b.Packages))
}

func (p *Provider) listed(serial string) bool {
	return slices.ContainsFunc(p.cfg.Phones, func(ph Phone) bool { return ph.Serial == serial })
}

func (p *Provider) Capabilities(context.Context) (contract.Capabilities, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	abis := []string{}
	for _, info := range p.inventory {
		if info.caps == nil {
			continue
		}
		for _, abi := range info.caps.ABIs {
			if !slices.Contains(abis, abi) {
				abis = append(abis, abi)
			}
		}
	}
	slices.Sort(abis)
	return contract.Capabilities{
		Kind:            "physical",
		Display:         contract.DisplayScrcpy,
		DevTools:        true,
		Clipboard:       true,
		Locations:       p.cfg.VPN.Offered(),
		DefaultLocation: p.cfg.VPN.DefaultLocation(),
		ABIs:            abis,
	}, nil
}

func (p *Provider) Capacity(context.Context) (contract.Capacity, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return contract.Capacity{Slots: p.slots()}, nil
}

func (p *Provider) slots() []contract.Slot {
	busy := map[string]bool{}
	for _, s := range p.sessions {
		busy[s.s.Slot] = true
	}
	for serial := range p.resets {
		busy[serial] = true
	}
	slots := []contract.Slot{}
	for _, ph := range p.cfg.Phones {
		info := p.inventory[ph.Serial]
		state := contract.SlotFree
		switch {
		case busy[ph.Serial]:
			state = contract.SlotBusy
		case info.state != "device" || info.caps == nil:
			state = contract.SlotOffline
		}
		label := ph.Label
		if label == "" && info.caps != nil {
			label = info.caps.Model
		}
		slots = append(slots, contract.Slot{ID: ph.Serial, Label: cmp.Or(label, ph.Serial), State: state, Capabilities: info.caps})
	}
	return slots
}

func (p *Provider) List(ctx context.Context) ([]contract.Session, error) {
	p.mu.Lock()
	all := make([]*session, 0, len(p.sessions))
	for _, s := range p.sessions {
		all = append(all, s)
	}
	p.mu.Unlock()
	out := make([]contract.Session, len(all))
	for i, s := range all {
		out[i] = p.view(ctx, s)
	}
	slices.SortFunc(out, func(a, b contract.Session) int { return a.CreatedAt.Compare(b.CreatedAt) })
	return out, nil
}

func (p *Provider) view(ctx context.Context, s *session) contract.Session {
	p.mu.Lock()
	out := s.s
	p.mu.Unlock()
	ev := s.agent.Status(ctx)
	out.State, out.Detail = ev.State, ev.Detail
	if ev.State == contract.StateFailed {
		out.Reason = cmp.Or(ev.Reason, ev.Detail)
	}
	return out
}

func (p *Provider) Create(ctx context.Context, req contract.CreateSession) (contract.Session, error) {
	location := ""
	if p.cfg.VPN.Enabled() {
		location = cmp.Or(req.Location, p.cfg.VPN.DefaultLocation())
	}
	switch {
	case !packageName.MatchString(req.Package):
		return contract.Session{}, fmt.Errorf("%w: bad package name %q", contract.ErrInvalid, req.Package)
	case req.Location != "" && !slices.ContainsFunc(p.cfg.VPN.Offered(), func(l contract.Location) bool { return l.ID == req.Location }):
		return contract.Session{}, fmt.Errorf("%w: unknown location %q", contract.ErrInvalid, req.Location)
	case req.AppData != nil:
		return contract.Session{}, fmt.Errorf("%w: phones without root can't restore app data", contract.ErrInvalid)
	}
	id := randomID()
	v, err := p.prepareVPN(ctx, id, location)
	if err != nil {
		return contract.Session{}, err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	slots := p.slots()
	i, err := contract.Capacity{Slots: slots}.Pick(req.Slot)
	if err != nil {
		v.remove()
		return contract.Session{}, err
	}
	now := p.now().UTC()
	s := contract.Session{
		ID:           id,
		Slot:         slots[i].ID,
		Owner:        req.Owner,
		Package:      req.Package,
		ArtifactRef:  req.ArtifactRef,
		Location:     location,
		State:        contract.StateProvisioning,
		Capabilities: slots[i].Capabilities,
		AgentURL:     strings.TrimRight(p.cfg.PublicURL, "/") + "/agents/" + id,
		CreatedAt:    now,
		LastActivity: now,
	}
	if p.cfg.TunnelURL != "" {
		s.TunnelURL = strings.TrimRight(p.cfg.TunnelURL, "/") + "/agents/" + id
	}
	sess := p.start(s, req.ArtifactURL, false, v)
	if err := p.saveLocked(); err != nil {
		sess.cancel()
		delete(p.sessions, id)
		return contract.Session{}, err
	}
	return s, nil
}

// start runs the session's agent, and its sing-box when v is set; p.mu must
// be held.
func (p *Provider) start(s contract.Session, artifactURL string, resume bool, v *vpnRun) *session {
	cfg := agent.DefaultConfig()
	cfg.ArtifactURL = artifactURL
	cfg.Package = s.Package
	cfg.ADB = p.cfg.ADB.Bin
	cfg.Serial = s.Slot
	cfg.ADBAddr = ""
	cfg.ADBServer = p.cfg.ADB.Server
	cfg.ADBShell = p.cfg.ADB.Shell
	cfg.Scrcpy = p.cfg.Agent.Scrcpy
	cfg.Scrcpy.KeepAudio = true
	cfg.LocalesDex = ""
	cfg.DevToolsFrontend = p.cfg.Agent.DevToolsFrontend
	cfg.CacheDir = p.cfg.Agent.CacheDir
	cfg.Root = false
	cfg.HostMetrics = false
	cfg.EmulatorConsole = false
	cfg.AppLanguage = true
	cfg.Resume = resume
	cfg.Version = p.ver
	cfg.Session = agent.Session{ID: s.ID, Owner: s.Owner, ArtifactRef: s.ArtifactRef, Slot: s.Slot, CreatedAt: s.CreatedAt.Format(time.RFC3339)}
	if s.Capabilities == nil {
		if info := p.inventory[s.Slot]; info.caps != nil {
			s.Capabilities = info.caps
		}
	}
	var tunnel *phone.Tunnel
	if v != nil {
		cfg.Location = s.Location
		cfg.ClashAPI = "http://" + v.clash
		cfg.IPInfoProxy = "http://" + v.mixed.String()
		tunnel = &phone.Tunnel{Port: p.cfg.Tunnel.Port, HostPort: int(v.mixed.Port()), IPv6: p.cfg.Tunnel.IPv6}
	}
	log := p.log.With("session", s.ID, "serial", s.Slot)
	ctx, cancel := context.WithCancel(p.base)
	sess := &session{s: s, artifactURL: artifactURL, cancel: cancel, done: make(chan struct{})}
	sess.agent = p.host.Agent(cfg, phone.Session{Package: s.Package, App: phone.App{APK: p.cfg.Tunnel.APK, Version: p.cfg.Tunnel.Version}, Tunnel: tunnel, Baseline: p.baselines[s.Slot], Resume: resume}, log)
	sess.handler, sess.tunnel = sess.agent.Handler(), sess.agent.TunnelHandler()
	p.sessions[s.ID] = sess
	go func() {
		defer close(sess.done)
		var wg sync.WaitGroup
		if v != nil {
			wg.Go(func() { p.runSingBox(ctx, v, log) })
		}
		sess.agent.Run(ctx)
		wg.Wait()
		v.remove()
	}()
	return sess
}

// checkTunnel makes sure tunnel.apk is Holtdroid Tunnel and takes its
// version from the APK when tunnel.version is empty. Without VPN locations
// a missing APK only costs the wallpaper and the device owner.
func (p *Provider) checkTunnel() error {
	if p.cfg.Tunnel.APK == "" {
		return nil
	}
	meta, _, err := p.apk(p.cfg.Tunnel.APK)
	if errors.Is(err, os.ErrNotExist) && !p.cfg.VPN.Enabled() {
		p.log.Warn("no Holtdroid Tunnel apk: phones get no wallpaper and no device owner", "apk", p.cfg.Tunnel.APK)
		p.cfg.Tunnel.APK = ""
		return nil
	}
	if err != nil {
		return fmt.Errorf("tunnel.apk: %w", err)
	}
	if meta.Package != phone.TunnelPackage {
		return fmt.Errorf("tunnel.apk is %s, not %s", meta.Package, phone.TunnelPackage)
	}
	if p.cfg.Tunnel.Version == "" {
		p.cfg.Tunnel.Version = meta.VersionName
	}
	return nil
}

type vpnRun struct {
	file  string
	mixed netip.AddrPort
	clash string
}

func (v *vpnRun) remove() {
	if v != nil {
		os.Remove(v.file)
	}
}

// prepareVPN writes the session's sing-box config, with resolved secrets, to
// a private directory that lives as long as this process; nil without VPN.
func (p *Provider) prepareVPN(ctx context.Context, id, location string) (*vpnRun, error) {
	if !p.cfg.VPN.Enabled() {
		return nil, nil
	}
	ports, err := freePorts(2)
	if err != nil {
		return nil, err
	}
	v := &vpnRun{mixed: netip.AddrPortFrom(netip.AddrFrom4([4]byte{127, 0, 0, 1}), uint16(ports[0])), clash: fmt.Sprintf("127.0.0.1:%d", ports[1])}
	raw, err := p.cfg.VPN.RenderProxy(ctx, p.sec, location, v.mixed, v.clash)
	if err != nil {
		return nil, err
	}
	p.mu.Lock()
	if p.vpnDir == "" {
		p.vpnDir, err = os.MkdirTemp("", "holtdroid-vpn-")
	}
	dir := p.vpnDir
	p.mu.Unlock()
	if err != nil {
		return nil, fmt.Errorf("vpn config: %w", err)
	}
	v.file = filepath.Join(dir, id+".json")
	if err := os.WriteFile(v.file, raw, 0o600); err != nil {
		return nil, fmt.Errorf("vpn config: %w", err)
	}
	return v, nil
}

func freePorts(n int) ([]int, error) {
	var lc net.ListenConfig
	var ports []int
	for range n {
		ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
		if err != nil {
			return nil, err
		}
		defer ln.Close()
		ports = append(ports, ln.Addr().(*net.TCPAddr).Port)
	}
	return ports, nil
}

// runSingBox keeps the session's sing-box running until ctx ends.
func (p *Provider) runSingBox(ctx context.Context, v *vpnRun, log *slog.Logger) {
	for {
		cmd := exec.CommandContext(ctx, p.cfg.SingBox, "run", "-c", v.file)
		cmd.Stdout, cmd.Stderr = os.Stderr, os.Stderr
		cmd.WaitDelay = 5 * time.Second
		err := cmd.Run()
		if ctx.Err() != nil {
			return
		}
		log.Warn("sing-box exited, starting it again", "err", err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

func (p *Provider) session(id string) (*session, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	s, ok := p.sessions[id]
	if !ok {
		return nil, fmt.Errorf("%w: session %s", contract.ErrNotFound, id)
	}
	return s, nil
}

func (p *Provider) Get(ctx context.Context, id string) (contract.Session, error) {
	s, err := p.session(id)
	if err != nil {
		return contract.Session{}, err
	}
	return p.view(ctx, s), nil
}

// Delete stops the agent and puts the phone back in the background; the
// phone stays busy until that is done.
func (p *Provider) Delete(_ context.Context, id string) error {
	p.mu.Lock()
	s, ok := p.sessions[id]
	if !ok {
		p.mu.Unlock()
		return fmt.Errorf("%w: session %s", contract.ErrNotFound, id)
	}
	delete(p.sessions, id)
	p.resets[s.s.Slot] = s.s.Package
	err := p.saveLocked()
	p.mu.Unlock()
	s.cancel()
	go p.reset(s.s.Slot, s.s.Package, s.done)
	return err
}

func (p *Provider) reset(serial, pkg string, done <-chan struct{}) {
	if done != nil {
		<-done
	}
	ctx, cancel := context.WithTimeout(p.base, p.cfg.ResetTimeout)
	defer cancel()
	p.mu.Lock()
	baseline := p.baselines[serial]
	p.mu.Unlock()
	if err := p.host.Clean(ctx, serial, phone.Cleanup{Package: pkg, Baseline: baseline, Offline: p.cfg.VPN.Enabled(), End: true, Suspend: p.cfg.Phone.Suspend}); err != nil {
		p.log.Warn("reset phone", "serial", serial, "err", err)
	} else {
		p.log.Info("phone reset", "serial", serial, "package", pkg)
	}
	if p.base.Err() != nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.resets, serial)
	if err := p.saveLocked(); err != nil {
		p.log.Warn("save state", "err", err)
	}
}

func (p *Provider) Touch(_ context.Context, id string, at time.Time) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	s, ok := p.sessions[id]
	if !ok {
		return fmt.Errorf("%w: session %s", contract.ErrNotFound, id)
	}
	s.s.LastActivity = at.UTC()
	return p.saveLocked()
}

func (p *Provider) Install(ctx context.Context, id string, req contract.Install) (contract.Session, error) {
	s, err := p.session(id)
	if err != nil {
		return contract.Session{}, err
	}
	if s.agent.Status(ctx).State != contract.StateReady {
		return contract.Session{}, fmt.Errorf("%w: session %s is not ready", contract.ErrInvalid, id)
	}
	if err := s.agent.Install(ctx, req); err != nil {
		return contract.Session{}, err
	}
	p.mu.Lock()
	s.s.ArtifactRef = req.ArtifactRef
	s.artifactURL = req.ArtifactURL
	if err := p.saveLocked(); err != nil {
		p.log.Warn("save state", "err", err)
	}
	p.mu.Unlock()
	return p.view(ctx, s), nil
}

// AgentHandler serves every session's agent under /agents/{id}/.
func (p *Provider) AgentHandler() http.Handler {
	return p.agents(func(s *session) http.Handler { return s.handler })
}

// TunnelHandler serves every session's tunnel endpoints under /agents/{id}/,
// for the ssh-gateway only.
func (p *Provider) TunnelHandler() http.Handler {
	return p.agents(func(s *session) http.Handler { return s.tunnel })
}

func (p *Provider) agents(handler func(*session) http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/agents/{id}/", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		s, err := p.session(id)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		http.StripPrefix("/agents/"+id, handler(s)).ServeHTTP(w, r)
	})
	return mux
}

func (p *Provider) load() (state, error) {
	var st state
	b, err := os.ReadFile(p.cfg.StateFile)
	if errors.Is(err, os.ErrNotExist) {
		return st, nil
	}
	if err != nil {
		return st, fmt.Errorf("read state: %w", err)
	}
	if err := json.Unmarshal(b, &st); err != nil {
		return st, fmt.Errorf("read state %s: %w", p.cfg.StateFile, err)
	}
	return st, nil
}

func (p *Provider) saveLocked() error {
	st := state{Sessions: []stored{}, Resets: p.resets, Baselines: p.baselines}
	for _, s := range p.sessions {
		st.Sessions = append(st.Sessions, stored{Session: s.s, ArtifactURL: s.artifactURL})
	}
	slices.SortFunc(st.Sessions, func(a, b stored) int { return strings.Compare(a.Session.ID, b.Session.ID) })
	b, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(p.cfg.StateFile), ".holtdroid-physical-*")
	if err != nil {
		return fmt.Errorf("save state: %w", err)
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return fmt.Errorf("save state: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("save state: %w", err)
	}
	if err := os.Rename(tmp.Name(), p.cfg.StateFile); err != nil {
		return fmt.Errorf("save state: %w", err)
	}
	return nil
}

func randomID() string {
	b := make([]byte, 5)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
