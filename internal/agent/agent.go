// Package agent runs inside a session next to the device: it brings the app
// up under instrumentation and serves the Agent API, the screen and DevTools.
package agent

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/holtdroid/holtdroid/internal/agent/conns"
	"github.com/holtdroid/holtdroid/internal/agent/dns"
	"github.com/holtdroid/holtdroid/internal/agent/redroid"
	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/netem"
	"github.com/holtdroid/holtdroid/internal/recording"
	"github.com/holtdroid/holtdroid/internal/vpn"
)

type Config struct {
	Listen       string
	TunnelListen string
	ADBAddr      string
	ADBServer    string
	ADBShell     ShellPolicy
	ArtifactURL  string
	AppData      contract.AppDataRestore
	WebView      contract.WebViewInstall
	Recording    contract.RecordingTarget
	DarkMode     *bool
	Frontend     string
	Package      string
	Location     string
	ADB          string
	Serial       string
	Script       string
	ToolsDex     string
	FFmpeg       string
	// CameraFeed is where holtdroid-redroid's camera HAL asks for frames;
	// CameraFont draws the test card's clock.
	CameraFeed string
	CameraFont string
	Scrcpy     ScrcpyConfig
	ClashAPI   string
	// ConnectionsAPI is the sidecar's sing-box API service; without one the
	// agent polls the clash API for connections.
	ConnectionsAPI string
	IPInfoURL      string
	IPInfoProxy    string
	// NetworkRoute is the route last measured through Location, as JSON.
	NetworkRoute string
	ChromiumDash string
	CacheDir     string
	Redroid      redroid.Config
	Session      Session
	Version      string
	Resume       bool
	// Root means the agent can act as root on the device (redroid's adbd, or
	// su with RootShell): app data, fake GPS and the battery.
	Root      bool
	RootShell bool
	// Geo maps a VPN location id to where it is, so the GPS and timezone
	// follow the active location (a rooted phone fakes them).
	Geo         map[string]LocationGeo
	AppLanguage bool
	USBNetwork  bool
	// HostCgroup is where the node's cgroup tree is mounted read-only, so the
	// device card reads Android's container in the session Pod found by
	// PodUID; empty leaves the Pod out of the metrics.
	HostCgroup string
	PodUID     string
	// DataLimit is the size limit of redroid's /data emptyDir in bytes: the
	// device's storage is that limit and du of /data instead of the node's disk.
	DataLimit int64
	// FridaHost is frida-server's address when the agent shares the
	// device's network namespace (redroid); empty goes through adb.
	FridaHost   string
	SpawnGating bool
	// NoWallpaper skips the session wallpaper. The Frida wallpaper attaches to
	// system_server, whose detach crashes it on some phones (Samsung A05);
	// on redroid that attach breaks frida-server for the app (decision #82).
	NoWallpaper bool
}

func DefaultConfig() Config {
	return Config{
		Listen:       ":8080",
		TunnelListen: ":8081",
		ADBAddr:      "127.0.0.1:5555",
		ADBShell:     ShellFull,
		ADB:          "adb",
		Serial:       "127.0.0.1:5555",
		FridaHost:    "127.0.0.1:27042",
		Script:       "/opt/holtdroid/script",
		ToolsDex:     "/opt/holtdroid/tools.dex",
		FFmpeg:       "ffmpeg",
		CameraFeed:   "@holtdroid-camera",
		CameraFont:   "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
		Scrcpy:       DefaultScrcpyConfig(),
		IPInfoURL:    "https://ipinfo.io/json",
		ChromiumDash: "https://chromiumdash.appspot.com",
		CacheDir:     filepath.Join(os.TempDir(), "holtdroid"),
		Redroid:      redroid.DefaultConfig(),
		Root:         true,
		NoWallpaper:  true,
	}
}

// LocationGeo is where a VPN location is: a session's GPS is faked to a
// random point within Radius metres (0 means 10km) and the timezone is set.
type LocationGeo struct {
	Lat      float64
	Lng      float64
	Radius   float64
	Timezone string
}

// FridaConfig says how the agent reaches frida-server: through adb by the
// device's Serial, or directly at Host. Gating catches app launches from the
// device through spawn gating instead of polling; never on redroid, where it
// stops every new process of the node (decision #82).
type FridaConfig struct {
	Serial string
	Host   string
	Dir    string
	Gating bool
}

// Instrumenter starts an app with WebView debugging. Watch instruments the
// app whenever the device starts it by itself (the launcher icon, a
// broadcast) and hands it to launched.
type Instrumenter interface {
	Spawn(ctx context.Context, pkg string) (App, error)
	Watch(ctx context.Context, pkg string, launched func(App)) error
	SetWallpaper(ctx context.Context, w Wallpaper) error
}

// App is one instrumented run of the app.
type App interface {
	Done() <-chan struct{}
	Kill(ctx context.Context) error
}

type clipboardSync interface {
	Run(ctx context.Context, onChange func(string))
	Set(ctx context.Context, text string) error
}

// BootFunc brings the device up, calls booted once it accepts adb commands
// and keeps it running until ctx ends. An error means the device is gone.
type BootFunc func(ctx context.Context, booted func()) error

type Agent struct {
	cfg      Config
	dev      Device
	inst     Instrumenter
	boot     BootFunc
	log      *slog.Logger
	hc       *http.Client
	devtools *DevTools
	watch    *devtoolsWatch
	network  *Network
	resolver *dns.Server
	conns    *conns.Tracker
	screen   *Scrcpy
	clip     clipboardSync
	controls *Controls
	tunnels  *Tunnels
	metrics  *Metrics
	vibes    *Vibrations
	display  *ScreenState
	mic      *Microphone
	cam      *Camera
	actions  chan appRequest
	launches chan App
	busy     atomic.Bool

	mu       sync.Mutex
	status   contract.StatusEvent
	text     string
	app      App
	artifact string
	subs     map[chan struct{}]struct{}

	recMu     sync.Mutex
	recCtx    context.Context
	rec       *recording.Recorder
	recID     string
	recCancel context.CancelFunc
	recThumb  *thumbPicker
	recLast   contract.RecordingState
}

func New(cfg Config, dev Device, inst Instrumenter, boot BootFunc, log *slog.Logger) *Agent {
	screen := NewScrcpy(cfg.Scrcpy, dev, log)
	var host, cgroup fs.FS = noFS{}, noFS{}
	if cfg.HostCgroup != "" {
		host, cgroup = os.DirFS("/"), os.DirFS(cfg.HostCgroup)
	}
	devtools := NewDevTools(dev, Frontends{Package: cfg.Package, App: cfg.Frontend, WebView: cfg.WebView.Frontend}, cfg.ChromiumDash, log)
	a := &Agent{
		cfg:      cfg,
		dev:      dev,
		inst:     inst,
		boot:     boot,
		log:      log,
		hc:       &http.Client{Timeout: 10 * time.Minute},
		devtools: devtools,
		watch:    newDevToolsWatch(devtools, log),
		network:  NewNetwork(cfg.ClashAPI, cfg.IPInfoURL, cfg.IPInfoProxy),
		screen:   screen,
		clip:     NewClipboard(screen, log),
		controls: newControls(cfg, dev, log),
		tunnels:  NewTunnels(newADBTunnels(cfg, dev, log), cfg.ADBShell, log),
		metrics:  NewMetrics(dev, cfg.Package, host, cgroup, cfg.PodUID, cfg.DataLimit, log),
		vibes:    NewVibrations(dev, log),
		display:  NewScreenState(dev, log),
		cam:      NewCamera(dev, cfg.FFmpeg, cfg.CameraFont, filepath.Join(cfg.CacheDir, "camera"), log),
		mic:      NewMicrophone(dev, cfg.ToolsDex, cfg.FFmpeg, filepath.Join(cfg.CacheDir, "media"), cfg.Root && !cfg.RootShell, log),
		actions:  make(chan appRequest, 1),
		launches: make(chan App),
		status:   contract.StatusEvent{State: contract.StateProvisioning},
		artifact: cfg.Session.ArtifactRef,
		subs:     map[chan struct{}]struct{}{},
		recCtx:   context.Background(),
	}
	if cfg.Redroid.VPN {
		a.resolver = dns.New(dns.NetUpstream{Addr: vpn.DNSUpstream}, a.flushDNS, log)
	}
	if cfg.ClashAPI != "" || cfg.ConnectionsAPI != "" {
		a.conns = conns.New(log)
	}
	return a
}

func newControls(cfg Config, dev Device, log *slog.Logger) *Controls {
	c := NewControls(dev, cfg.ToolsDex, cfg.Root, cfg.RootShell)
	c.usbNetwork = cfg.USBNetwork
	c.redroid = cfg.Root && !cfg.RootShell
	if cfg.Redroid.VPN {
		s := netem.NewShaper(vpn.TunInterface, vpn.TunNetwork, cfg.IPInfoProxy, log)
		var route contract.NetworkRoute
		if err := json.Unmarshal([]byte(cfg.NetworkRoute), &route); cfg.NetworkRoute != "" && err == nil {
			s.Seed(route)
		}
		c.shaper = s
	}
	if cfg.AppLanguage && packageName.MatchString(cfg.Package) {
		c.appLocales = cfg.Package
	}
	return c
}

type noFS struct{}

func (noFS) Open(string) (fs.File, error) { return nil, fs.ErrNotExist }

func (a *Agent) Handler() http.Handler {
	mux := http.NewServeMux()
	contract.RegisterAgent(contract.NewAPI(mux, "Holtdroid device agent"), a)
	a.screen.Register(mux)
	mux.HandleFunc("GET "+contract.AgentADBPath, a.tunnels.ServeADB(contract.ADBClientBrowser))
	mux.HandleFunc("GET "+contract.AgentMicrophonePath, a.mic.ServeBrowser)
	mux.HandleFunc("GET "+contract.AgentCameraPath, a.cam.ServeBrowser)
	mux.HandleFunc("GET /devtools/{socket}/page/{id}", a.devtools.ServeCDP)
	return mux
}

// TunnelHandler serves the ssh-gateway's tunnels; it must never be reachable
// through the api proxy.
func (a *Agent) TunnelHandler() http.Handler { return a.tunnels.Handler() }

// Run boots the device, installs and instruments the app and keeps it
// running until ctx ends. Failures end in the failed state; the API keeps
// serving so the UI can show the reason.
func (a *Agent) Run(parent context.Context) {
	ctx, cancel := context.WithCancelCause(parent)
	defer cancel(nil)
	defer a.shutdownRecording()
	a.recMu.Lock()
	a.recCtx = ctx
	a.recMu.Unlock()
	go a.controls.watchNetwork(ctx)
	switch {
	case a.cfg.ConnectionsAPI != "":
		go a.conns.Follow(ctx, a.cfg.ConnectionsAPI, vpn.Own)
	case a.conns != nil:
		go a.conns.Poll(ctx, a.network.Connections, connectionsPoll)
	}
	if a.conns != nil && a.cfg.IPInfoProxy != "" {
		go newEdgeProber(a.conns, a.cfg.IPInfoProxy).run(ctx)
	}
	if a.resolver != nil {
		go func() {
			if err := a.resolver.ListenAndServe(ctx, vpn.DNSForwarder); err != nil {
				a.log.Error("dns forwarder", "err", err)
			}
		}()
	}

	a.setStatus(contract.StateBooting, "Booting Android")
	booted := make(chan struct{})
	go func() {
		err := a.boot(ctx, sync.OnceFunc(func() { close(booted) }))
		if err == nil {
			err = errors.New("device stopped")
		}
		cancel(fmt.Errorf("device: %w", err))
	}()
	select {
	case <-booted:
	case <-ctx.Done():
		a.stop(parent, ctx)
		return
	}
	go a.devtools.Run(ctx, 2*time.Second)
	go a.watch.run(ctx, time.Second)
	go a.screen.Run(ctx)
	go a.mic.Run(ctx)
	if a.cfg.Root && !a.cfg.RootShell {
		go a.cam.Run(ctx, a.cfg.CameraFeed)
	}
	go a.clip.Run(ctx, a.onClip)
	go a.controls.syncRadios(ctx, 2*time.Second, a.log)
	if err := a.controls.resetNetwork(ctx); err != nil {
		a.log.Warn("reset network profile", "err", err)
	}
	if a.resolver != nil {
		go a.learnBackends(ctx)
		if _, err := a.dev.Shell(ctx, "settings put global private_dns_mode off"); err != nil {
			a.log.Warn("turn private DNS off", "err", err)
		}
	}

	if err := a.run(ctx); err != nil {
		a.fail(err)
		<-ctx.Done()
		if parent.Err() != nil {
			a.setStatus(contract.StateStopping, "")
		}
		return
	}
	a.stop(parent, ctx)
}

type appRequest struct {
	action  contract.AppAction
	install *contract.Install
	export  *exportRequest
	done    chan error
}

type exportRequest struct {
	ctx    context.Context
	req    contract.AppDataExport
	result chan exportResult
	w      *io.PipeWriter
}

type exportResult struct {
	info contract.AppDataInfo
	err  error
}

func (a *Agent) run(ctx context.Context) error {
	if a.cfg.WebView.URL != "" && !a.cfg.Resume {
		if err := a.installWebView(ctx, a.cfg.WebView); err != nil {
			return fmt.Errorf("install WebView %s: %w", a.cfg.WebView.Version, err)
		}
	}
	a.setStatus(contract.StateInstalling, "Downloading the APK")
	apk, err := a.download(ctx, a.cfg.ArtifactURL)
	if err != nil {
		return err
	}
	defer func() { os.Remove(apk) }()
	if !a.cfg.Resume {
		a.setStatus(contract.StateInstalling, "Installing the APK")
		if err := a.installApp(ctx, apk); err != nil {
			return err
		}
		if a.cfg.AppData.URL != "" {
			if err := a.restore(ctx, a.cfg.AppData); err != nil {
				return fmt.Errorf("restore app data: %w", err)
			}
		}
		a.setWallpaper(ctx, a.cfg.Session.ArtifactRef, apk)
		if a.controls.redroid && packageName.MatchString(a.cfg.Package) {
			if _, err := a.dev.Shell(ctx, redroid.Home(a.cfg.Package)); err != nil {
				a.log.Warn("could not put the app on the home screen", "err", err)
			}
		}
	}
	if a.cfg.Location != "" && a.cfg.ClashAPI != "" {
		if _, err := a.network.SetLocation(ctx, a.cfg.Location); err != nil {
			a.log.Warn("initial location", "location", a.cfg.Location, "err", err)
		}
	}
	a.followLocationGeo(ctx, a.cfg.Location)
	if err := a.inst.Watch(ctx, a.cfg.Package, a.launched); err != nil {
		a.log.Warn("app launches from the device won't be instrumented", "err", err)
	}
	if !a.cfg.Resume {
		if a.cfg.DarkMode != nil {
			if _, err := a.controls.Update(ctx, contract.DeviceSettings{DarkMode: a.cfg.DarkMode}); err != nil {
				a.log.Warn("set the dark theme", "err", err)
			}
		}
		if err := a.controls.Action(ctx, contract.DeviceUnlock); err != nil {
			a.log.Warn("unlock the screen", "err", err)
		}
	}
	if err := a.spawn(ctx); err != nil {
		return err
	}
	if a.cfg.Recording.URL != "" && !a.cfg.Resume {
		if err := a.startRecording(a.cfg.Recording); err != nil {
			a.log.Warn("start the recording", "err", err)
		}
	}

	for {
		var exited <-chan struct{}
		if app := a.currentApp(); app != nil {
			exited = app.Done()
		}
		select {
		case <-ctx.Done():
			if app := a.currentApp(); app != nil {
				_ = app.Kill(context.WithoutCancel(ctx))
			}
			return nil
		case <-exited:
			a.setApp(nil)
			a.log.Info("app closed", "package", a.cfg.Package)
		case app := <-a.launches:
			a.setApp(app)
			a.log.Info("app started on the device", "package", a.cfg.Package)
		case req := <-a.actions:
			a.busy.Store(true)
			err := a.handle(ctx, req, &apk)
			if err != nil && req.done == nil {
				return err
			}
			if a.currentApp() == nil && (req.export == nil || req.export.req.Restart) {
				if serr := a.spawn(ctx); serr != nil {
					if req.done != nil {
						req.done <- serr
					}
					return serr
				}
			}
			a.busy.Store(false)
			a.setStatus(contract.StateReady, "")
			if req.done != nil {
				req.done <- err
			}
		}
	}
}

func (a *Agent) spawn(ctx context.Context) error {
	a.setStatus(contract.StateInstrumenting, "Enabling WebView debugging")
	app, err := a.inst.Spawn(ctx, a.cfg.Package)
	if err != nil {
		return fmt.Errorf("start %s: %w", a.cfg.Package, err)
	}
	a.setApp(app)
	a.setStatus(contract.StateReady, "")
	return nil
}

// launched takes an app started on the device itself, from the launcher or
// by the system, unless the loop is busy restarting or installing it.
func (a *Agent) launched(app App) {
	for range 100 {
		if a.busy.Load() {
			return
		}
		select {
		case a.launches <- app:
			return
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func (a *Agent) kill(ctx context.Context) {
	if app := a.currentApp(); app != nil {
		a.setApp(nil)
		if err := app.Kill(ctx); err != nil {
			a.log.Warn("kill app", "err", err)
		}
	}
}

// handle runs an app action; the caller starts the app again afterwards.
func (a *Agent) handle(ctx context.Context, req appRequest, apk *string) error {
	if req.install != nil {
		return a.install(ctx, *req.install, apk)
	}
	if req.export != nil {
		return a.export(req.export)
	}
	a.kill(ctx)
	if req.action != contract.AppReinstall {
		return nil
	}
	a.setStatus(contract.StateInstalling, "Reinstalling the APK")
	if _, err := a.dev.Shell(ctx, "pm uninstall "+a.cfg.Package); err != nil {
		a.log.Warn("uninstall", "err", err)
	}
	return a.installApp(ctx, *apk)
}

// install replaces the app with another build. When that fails the previous
// build stays (or is put back) so the session keeps working.
func (a *Agent) install(ctx context.Context, req contract.Install, apk *string) error {
	a.setStatus(contract.StateInstalling, "Downloading the new build")
	next, err := a.download(ctx, req.ArtifactURL)
	if err != nil {
		return err
	}
	a.kill(ctx)
	if !req.KeepData {
		if _, err := a.dev.Shell(ctx, "pm uninstall "+a.cfg.Package); err != nil {
			a.log.Warn("uninstall", "err", err)
		}
	}
	a.setStatus(contract.StateInstalling, "Installing the new build")
	if err := a.installApp(ctx, next); err != nil {
		os.Remove(next)
		if !req.KeepData {
			if rerr := a.installApp(ctx, *apk); rerr != nil {
				a.log.Warn("put the previous build back", "err", rerr)
			}
		}
		return fmt.Errorf("%w: %w", contract.ErrInvalid, err)
	}
	os.Remove(*apk)
	*apk = next
	a.mu.Lock()
	a.artifact = req.ArtifactRef
	a.mu.Unlock()
	a.recMu.Lock()
	if rec := a.rec; rec != nil {
		go a.recordInfo(ctx, rec)
	}
	a.recMu.Unlock()
	a.setWallpaper(ctx, req.ArtifactRef, next)
	a.log.Info("installed another build", "artifact", req.ArtifactRef, "keepData", req.KeepData)
	return nil
}

func (a *Agent) stop(parent, ctx context.Context) {
	if parent.Err() != nil {
		a.setStatus(contract.StateStopping, "")
		return
	}
	a.fail(context.Cause(ctx))
}

// fail keeps the device running so the failure can be inspected.
func (a *Agent) fail(err error) {
	a.log.Error("session failed", "err", err)
	a.mu.Lock()
	a.status = contract.StatusEvent{State: contract.StateFailed, Reason: err.Error(), Recording: a.status.Recording, RecordedAt: a.status.RecordedAt}
	a.app = nil
	a.mu.Unlock()
	a.notify()
}

const builtinWebView = "com.android.webview"

// installWebView installs a com.android.webview build as an update of the
// built-in WebView, which then serves every app. A build of another package
// is installed next to it and made the WebView implementation.
func (a *Agent) installWebView(ctx context.Context, w contract.WebViewInstall) error {
	a.setStatus(contract.StateInstalling, "Downloading WebView "+w.Version)
	file, err := a.fetch(ctx, w.URL, "holtdroid-webview-*.apk", "WebView")
	if err != nil {
		return err
	}
	defer os.Remove(file)
	a.setStatus(contract.StateInstalling, "Installing WebView "+w.Version)
	if err := a.dev.Install(ctx, file); err != nil {
		return err
	}
	if w.Package != "" && w.Package != builtinWebView {
		out, err := a.dev.Shell(ctx, "cmd webviewupdate set-webview-implementation "+w.Package)
		if err != nil {
			return err
		}
		if !strings.Contains(out, "Success") {
			return fmt.Errorf("make %s the WebView: %s", w.Package, strings.TrimSpace(out))
		}
	}
	a.log.Info("installed WebView", "version", w.Version, "package", cmp.Or(w.Package, builtinWebView))
	return nil
}

func (a *Agent) download(ctx context.Context, artifactURL string) (string, error) {
	return a.fetch(ctx, artifactURL, "holtdroid-*.apk", "APK")
}

func (a *Agent) fetch(ctx context.Context, url, pattern, what string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := a.hc.Do(req)
	if err != nil {
		return "", fmt.Errorf("download %s: %w", what, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download %s: %s", what, resp.Status)
	}
	f, err := os.CreateTemp("", pattern)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(f.Name())
		return "", fmt.Errorf("download %s: %w", what, err)
	}
	return f.Name(), f.Close()
}

func (a *Agent) restore(ctx context.Context, req contract.AppDataRestore) error {
	a.setStatus(contract.StateRestoring, "Downloading app data")
	file, err := a.fetch(ctx, req.URL, "holtdroid-*.tar.zst", "app data")
	if err != nil {
		return err
	}
	defer os.Remove(file)
	a.setStatus(contract.StateRestoring, "Restoring app data")
	if err := restoreAppData(ctx, a.appDataDev(), a.cfg.Package, file, req.Cache); err != nil {
		return err
	}
	a.log.Info("restored app data", "cache", req.Cache)
	return nil
}

// export stops the app and streams its data into the request's pipe.
func (a *Agent) export(e *exportRequest) error {
	err := a.exportTo(e)
	e.w.CloseWithError(err)
	return err
}

// appDataDev is the device the app-data commands run on: su-wrapped on a
// rooted phone so reading and writing /data/data works like it does on the
// emulator's root adbd.
func (a *Agent) appDataDev() Device {
	if a.cfg.RootShell {
		if ad, ok := a.dev.(appDataDevice); ok {
			return suDevice{Device: a.dev, ad: ad}
		}
	}
	return a.dev
}

func (a *Agent) exportTo(e *exportRequest) error {
	fail := func(err error) error {
		e.result <- exportResult{err: err}
		return err
	}
	adev := a.appDataDev()
	dev, ok := adev.(appDataDevice)
	if !ok || !a.cfg.Root || !packageName.MatchString(a.cfg.Package) {
		return fail(fmt.Errorf("%w: this device can't export app data", contract.ErrInvalid))
	}
	a.kill(e.ctx)
	entries, err := listAppData(e.ctx, adev, a.cfg.Package)
	if err != nil {
		return fail(err)
	}
	info, paths, err := planExport(entries, e.req)
	if err != nil {
		return fail(err)
	}
	e.result <- exportResult{info: info}
	if err := streamExport(e.ctx, dev, paths, e.w); err != nil {
		a.log.Warn("app data export failed", "err", err)
		return err
	}
	a.log.Info("exported app data", "size", info.Size, "cache", info.Cache)
	return nil
}

func (a *Agent) setStatus(state contract.SessionState, detail string) {
	a.mu.Lock()
	a.status = contract.StatusEvent{
		State: state, Detail: detail, AppRunning: a.app != nil, Recording: a.status.Recording, RecordedAt: a.status.RecordedAt,
	}
	a.mu.Unlock()
	a.notify()
}

func (a *Agent) setApp(app App) {
	a.mu.Lock()
	a.app = app
	a.status.AppRunning = app != nil
	a.mu.Unlock()
	a.notify()
}

func (a *Agent) currentArtifact() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.artifact
}

func (a *Agent) currentApp() App {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.app
}

func (a *Agent) onClip(text string) {
	a.mu.Lock()
	a.text = text
	a.mu.Unlock()
	a.notify()
}

func (a *Agent) notify() {
	a.mu.Lock()
	subs := make([]chan struct{}, 0, len(a.subs))
	for ch := range a.subs {
		subs = append(subs, ch)
	}
	a.mu.Unlock()
	for _, ch := range subs {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (a *Agent) subscribe() (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	a.mu.Lock()
	a.subs[ch] = struct{}{}
	a.mu.Unlock()
	return ch, func() {
		a.mu.Lock()
		delete(a.subs, ch)
		a.mu.Unlock()
	}
}

func (a *Agent) snapshot() (contract.StatusEvent, string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.status, a.text
}

func (a *Agent) Status(context.Context) contract.StatusEvent {
	s, _ := a.snapshot()
	return s
}

func (a *Agent) WatchStatus(ctx context.Context, send func(contract.StatusEvent) error) error {
	updates, cancel := a.subscribe()
	defer cancel()
	var last contract.StatusEvent
	for {
		if s, _ := a.snapshot(); s != last {
			if err := send(s); err != nil {
				return err
			}
			last = s
		}
		select {
		case <-ctx.Done():
			return nil
		case <-updates:
		}
	}
}

func (a *Agent) WatchDevTools(ctx context.Context, send func(contract.DevToolsEntry) error) error {
	return a.watch.watchLive(ctx, send)
}

func (a *Agent) DevToolsBody(ctx context.Context, target, request string) (contract.DevToolsBody, error) {
	return a.watch.body(ctx, target, request)
}

func (a *Agent) Targets(ctx context.Context) ([]contract.DevToolsTarget, error) {
	return a.devtools.Targets(ctx)
}

func (a *Agent) Clipboard(context.Context) (string, error) {
	_, text := a.snapshot()
	return text, nil
}

func (a *Agent) SetClipboard(ctx context.Context, text string) error {
	if err := a.setClipboard(ctx, text); err != nil {
		return err
	}
	a.onClip(text)
	return nil
}

// setClipboard skips SystemUI's clipboard preview on redroid's Android 13+
// and falls back to scrcpy, which every version has.
func (a *Agent) setClipboard(ctx context.Context, text string) error {
	if a.controls.redroid && a.controls.sdk(ctx) >= 33 {
		err := a.controls.setClipboard(ctx, text)
		if err == nil || errors.Is(err, contract.ErrInvalid) {
			return err
		}
		a.log.Warn("clipboard without the preview failed, using scrcpy", "err", err)
	}
	return a.clip.Set(ctx, text)
}

func (a *Agent) WatchClipboard(ctx context.Context, send func(contract.Clipboard) error) error {
	updates, cancel := a.subscribe()
	defer cancel()
	_, last := a.snapshot()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-updates:
			if _, clip := a.snapshot(); clip != last {
				if err := send(contract.Clipboard{Text: clip}); err != nil {
					return err
				}
				last = clip
			}
		}
	}
}

func (a *Agent) Network(ctx context.Context) (contract.Network, error) {
	n, err := a.network.Get(ctx)
	n.Route = a.controls.networkRoute()
	return n, err
}

func (a *Agent) SetLocation(ctx context.Context, location string) (contract.Network, error) {
	net, err := a.network.SetLocation(ctx, location)
	if err != nil {
		return net, err
	}
	a.followLocationGeo(ctx, location)
	a.controls.networkMoved()
	a.record(contract.RecordingEvent{Type: contract.EventNetwork, Network: &net})
	return net, nil
}

// followLocationGeo fakes the GPS to a random point in the location's area and
// sets its timezone, unless the user has overridden the GPS for the session.
func (a *Agent) followLocationGeo(ctx context.Context, location string) {
	g, ok := a.cfg.Geo[location]
	if !ok {
		return
	}
	pt := randomInRadius(g.Lat, g.Lng, g.Radius)
	if err := a.controls.FollowLocation(ctx, &pt, g.Timezone); err != nil {
		a.log.Warn("set the location's geo", "location", location, "err", err)
	}
}

func (a *Agent) App(_ context.Context, action contract.AppAction) error {
	return a.request(appRequest{action: action})
}

func (a *Agent) Install(ctx context.Context, req contract.Install) error {
	done := make(chan error, 1)
	if err := a.request(appRequest{install: &req, done: done}); err != nil {
		return err
	}
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (a *Agent) ExportAppData(ctx context.Context, req contract.AppDataExport) (contract.AppDataInfo, io.ReadCloser, error) {
	pr, pw := io.Pipe()
	e := &exportRequest{ctx: ctx, req: req, result: make(chan exportResult, 1), w: pw}
	if err := a.request(appRequest{export: e, done: make(chan error, 1)}); err != nil {
		return contract.AppDataInfo{}, nil, err
	}
	select {
	case r := <-e.result:
		if r.err != nil {
			pr.Close()
			return contract.AppDataInfo{}, nil, r.err
		}
		return r.info, pr, nil
	case <-ctx.Done():
		pr.CloseWithError(ctx.Err())
		return contract.AppDataInfo{}, nil, ctx.Err()
	}
}

func (a *Agent) request(req appRequest) error {
	if a.Status(context.Background()).State != contract.StateReady {
		return fmt.Errorf("%w: the device is busy or not ready", contract.ErrInvalid)
	}
	select {
	case a.actions <- req:
		return nil
	default:
		return fmt.Errorf("%w: another app action is in progress", contract.ErrBusy)
	}
}

func (a *Agent) Device(ctx context.Context) (contract.DeviceState, error) {
	return a.controls.State(ctx)
}

func (a *Agent) UpdateDevice(ctx context.Context, settings contract.DeviceSettings) (contract.DeviceState, error) {
	st, err := a.controls.Update(ctx, settings)
	if err == nil {
		a.record(contract.RecordingEvent{Type: contract.EventDevice, Device: &st})
	}
	return st, err
}

func (a *Agent) DeviceAction(ctx context.Context, action contract.DeviceAction) error {
	err := a.controls.Action(ctx, action)
	if err == nil {
		a.record(contract.RecordingEvent{Type: contract.EventKey, Key: string(action)})
	}
	return err
}

func (a *Agent) Screenshot(ctx context.Context) ([]byte, error) {
	return a.dev.Screencap(ctx)
}

func (a *Agent) Tunnels(context.Context) (contract.Tunnels, error) {
	return a.tunnels.Snapshot(), nil
}

func (a *Agent) WatchTunnels(ctx context.Context, probe bool, send func(contract.Tunnels) error) error {
	return a.tunnels.Watch(ctx, probe, send)
}

func (a *Agent) WatchVibrations(ctx context.Context, send func(contract.Vibration) error) error {
	return a.vibes.Watch(ctx, send)
}

func (a *Agent) WatchScreen(ctx context.Context, send func(contract.Screen) error) error {
	return a.display.Watch(ctx, send)
}

func (a *Agent) WatchMetrics(ctx context.Context, send func(contract.Metrics) error) error {
	return a.metrics.Watch(ctx, send)
}

var errNoDNS = fmt.Errorf("%w: this device's DNS doesn't go through the agent", contract.ErrInvalid)

func (a *Agent) Microphone(context.Context) contract.Microphone { return a.mic.State() }

func (a *Agent) Camera(context.Context) contract.Camera { return a.cam.State() }

func (a *Agent) SetCamera(ctx context.Context, in contract.SetCamera) (contract.Camera, error) {
	return a.cam.Set(ctx, in)
}

func (a *Agent) SetMicrophone(ctx context.Context, in contract.SetMicrophone) (contract.Microphone, error) {
	return a.mic.Set(ctx, in)
}

func (a *Agent) DNS(context.Context) contract.DNSState {
	if a.resolver == nil {
		return contract.DNSState{Settings: contract.DNSSettings{TTLMode: contract.DNSTTLKeep, Rewrites: []contract.DNSRewrite{}}}
	}
	return contract.DNSState{Available: true, Settings: a.resolver.Settings()}
}

func (a *Agent) SetDNS(ctx context.Context, settings contract.DNSSettings) (contract.DNSState, error) {
	if a.resolver == nil {
		return contract.DNSState{}, errNoDNS
	}
	if _, err := a.resolver.Set(ctx, settings); err != nil {
		return contract.DNSState{}, err
	}
	return a.DNS(ctx), nil
}

func (a *Agent) FlushDNS(ctx context.Context) error {
	if a.resolver == nil {
		return errNoDNS
	}
	return a.resolver.Flush(ctx)
}

func (a *Agent) WatchDNS(ctx context.Context, send func(contract.DNSEvent) error) error {
	if a.resolver == nil {
		return errNoDNS
	}
	return a.resolver.Watch(ctx, send)
}

// connectionsPoll is how often a sidecar without sing-box's API service is
// asked for its open connections; a shorter connection may be missed.
const connectionsPoll = 250 * time.Millisecond

var errNoConnections = fmt.Errorf("%w: this device has no VPN sidecar to report its connections", contract.ErrInvalid)

func (a *Agent) Connections(context.Context) contract.ConnectionsState {
	return contract.ConnectionsState{Available: a.conns != nil}
}

func (a *Agent) WatchConnections(ctx context.Context, send func(contract.Connection) error) error {
	if a.conns == nil {
		return errNoConnections
	}
	return a.conns.Watch(ctx, send)
}

// flushScript clears the resolver cache of every network through
// IDnsResolver.flushNetworkCache, transaction 11 of the stable AIDL (Android
// 11+); netd has no shell command for it.
const flushScript = `for n in $(dumpsys dnsresolver | sed -n 's/^NetId: //p'); do service call dnsresolver 11 i32 "$n" >/dev/null || exit 1; done`

func (a *Agent) flushDNS(ctx context.Context) error {
	_, err := a.dev.Shell(ctx, flushScript)
	return err
}

// learnBackends follows the device's DNS answers for a network region's
// backends.
func (a *Agent) learnBackends(ctx context.Context) {
	events, stop := a.resolver.Subscribe()
	defer stop()
	for {
		select {
		case <-ctx.Done():
			return
		case ev := <-events:
			if ev.Query != nil {
				a.controls.learnDNS(*ev.Query)
			}
		}
	}
}
