// Package agent runs inside a session next to the device: it brings the app
// up under instrumentation and serves the Agent API, the screen and DevTools.
package agent

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/kriakiku/holtdroid/internal/agent/emulator"
	"github.com/kriakiku/holtdroid/internal/contract"
)

type Config struct {
	Listen           string
	TunnelListen     string
	ADBAddr          string
	ADBServer        string
	ADBShell         ShellPolicy
	ArtifactURL      string
	AppData          contract.AppDataRestore
	Package          string
	Location         string
	ADB              string
	Serial           string
	Script           string
	LocalesDex       string
	Scrcpy           ScrcpyConfig
	ClashAPI         string
	IPInfoURL        string
	IPInfoProxy      string
	DevToolsFrontend string
	CacheDir         string
	Emulator         emulator.Config
	Session          Session
	Version          string
	Resume           bool
	Root             bool
	EmulatorConsole  bool
	HostMetrics      bool
}

func DefaultConfig() Config {
	return Config{
		Listen:           ":8080",
		TunnelListen:     ":8081",
		ADBAddr:          "127.0.0.1:5555",
		ADBShell:         ShellFull,
		ADB:              "adb",
		Serial:           "emulator-5554",
		Script:           "/opt/holtdroid/script",
		LocalesDex:       "/opt/holtdroid/locales.dex",
		Scrcpy:           DefaultScrcpyConfig(),
		IPInfoURL:        "https://ipinfo.io/json",
		DevToolsFrontend: "https://chrome-devtools-frontend.appspot.com/serve_rev/",
		CacheDir:         filepath.Join(os.TempDir(), "holtdroid"),
		Emulator:         emulator.DefaultConfig(),
		Root:             true,
		EmulatorConsole:  true,
		HostMetrics:      true,
	}
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
	network  *Network
	screen   *Scrcpy
	clip     clipboardSync
	frontend *Frontend
	controls *Controls
	tunnels  *Tunnels
	metrics  *Metrics
	vibes    *Vibrations
	actions  chan appRequest
	launches chan App
	busy     atomic.Bool

	mu     sync.Mutex
	status contract.StatusEvent
	text   string
	app    App
	subs   map[chan struct{}]struct{}
}

func New(cfg Config, dev Device, inst Instrumenter, boot BootFunc, log *slog.Logger) *Agent {
	screen := NewScrcpy(cfg.Scrcpy, dev, log)
	var host fs.FS = noFS{}
	if cfg.HostMetrics {
		host = os.DirFS("/")
	}
	return &Agent{
		cfg:      cfg,
		dev:      dev,
		inst:     inst,
		boot:     boot,
		log:      log,
		hc:       &http.Client{Timeout: 10 * time.Minute},
		devtools: NewDevTools(dev, log),
		network:  NewNetwork(cfg.ClashAPI, cfg.IPInfoURL, cfg.IPInfoProxy),
		screen:   screen,
		clip:     NewClipboard(screen, log),
		frontend: NewFrontend(cfg.DevToolsFrontend, filepath.Join(cfg.CacheDir, "devtools-frontend")),
		controls: NewControls(dev, cfg.LocalesDex, cfg.EmulatorConsole),
		tunnels:  NewTunnels(newADBTunnels(cfg, dev, log), log),
		metrics:  NewMetrics(dev, cfg.Package, host, log),
		vibes:    NewVibrations(dev, log),
		actions:  make(chan appRequest, 1),
		launches: make(chan App),
		status:   contract.StatusEvent{State: contract.StateProvisioning},
		subs:     map[chan struct{}]struct{}{},
	}
}

type noFS struct{}

func (noFS) Open(string) (fs.File, error) { return nil, fs.ErrNotExist }

func (a *Agent) Handler() http.Handler {
	mux := http.NewServeMux()
	contract.RegisterAgent(contract.NewAPI(mux, "Holtdroid device agent"), a)
	a.screen.Register(mux)
	mux.HandleFunc("GET "+contract.AgentADBPath, a.tunnels.ServeADB(contract.ADBClientBrowser))
	mux.HandleFunc("GET /devtools/{socket}/page/{id}", a.devtools.ServeCDP)
	mux.Handle("GET /devtools-frontend/{rev}/{file...}", a.frontend)
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
	go a.clip.Run(ctx, a.onClip)

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
	a.setStatus(contract.StateInstalling, "Downloading the APK")
	apk, err := a.download(ctx, a.cfg.ArtifactURL)
	if err != nil {
		return err
	}
	defer func() { os.Remove(apk) }()
	if !a.cfg.Resume {
		a.setStatus(contract.StateInstalling, "Installing the APK")
		if err := a.dev.Install(ctx, apk); err != nil {
			return err
		}
		if a.cfg.AppData.URL != "" {
			if err := a.restore(ctx, a.cfg.AppData); err != nil {
				return fmt.Errorf("restore app data: %w", err)
			}
		}
		a.setWallpaper(ctx, a.cfg.Session.ArtifactRef, apk)
	}
	if a.cfg.Location != "" && a.cfg.ClashAPI != "" {
		if _, err := a.network.SetLocation(ctx, a.cfg.Location); err != nil {
			a.log.Warn("initial location", "location", a.cfg.Location, "err", err)
		}
	}
	if err := a.inst.Watch(ctx, a.cfg.Package, a.launched); err != nil {
		a.log.Warn("app launches from the device won't be instrumented", "err", err)
	}
	if err := a.spawn(ctx); err != nil {
		return err
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
	return a.dev.Install(ctx, *apk)
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
	if err := a.dev.Install(ctx, next); err != nil {
		os.Remove(next)
		if !req.KeepData {
			if rerr := a.dev.Install(ctx, *apk); rerr != nil {
				a.log.Warn("put the previous build back", "err", rerr)
			}
		}
		return fmt.Errorf("%w: %w", contract.ErrInvalid, err)
	}
	os.Remove(*apk)
	*apk = next
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
	a.status = contract.StatusEvent{State: contract.StateFailed, Reason: err.Error()}
	a.app = nil
	a.mu.Unlock()
	a.notify()
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
	if err := restoreAppData(ctx, a.dev, a.cfg.Package, file, req.Cache); err != nil {
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

func (a *Agent) exportTo(e *exportRequest) error {
	fail := func(err error) error {
		e.result <- exportResult{err: err}
		return err
	}
	dev, ok := a.dev.(appDataDevice)
	if !ok || !a.cfg.Root || !packageName.MatchString(a.cfg.Package) {
		return fail(fmt.Errorf("%w: this device can't export app data", contract.ErrInvalid))
	}
	a.kill(e.ctx)
	entries, err := listAppData(e.ctx, a.dev, a.cfg.Package)
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
	a.status = contract.StatusEvent{State: state, Detail: detail, AppRunning: a.app != nil}
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

func (a *Agent) Targets(ctx context.Context) ([]contract.DevToolsTarget, error) {
	return a.devtools.Targets(ctx)
}

func (a *Agent) Clipboard(context.Context) (string, error) {
	_, text := a.snapshot()
	return text, nil
}

func (a *Agent) SetClipboard(ctx context.Context, text string) error {
	if err := a.clip.Set(ctx, text); err != nil {
		return err
	}
	a.onClip(text)
	return nil
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
	return a.network.Get(ctx)
}

func (a *Agent) SetLocation(ctx context.Context, location string) (contract.Network, error) {
	return a.network.SetLocation(ctx, location)
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
	return a.controls.Update(ctx, settings)
}

func (a *Agent) DeviceAction(ctx context.Context, action contract.DeviceAction) error {
	return a.controls.Action(ctx, action)
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

func (a *Agent) WatchMetrics(ctx context.Context, send func(contract.Metrics) error) error {
	return a.metrics.Watch(ctx, send)
}
