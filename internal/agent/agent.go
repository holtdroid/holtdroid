// Package agent runs inside a session next to the device: it brings the app
// up under instrumentation and serves the Agent API, the screen and DevTools.
package agent

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/kriakiku/holtdroid/internal/agent/emulator"
	"github.com/kriakiku/holtdroid/internal/contract"
)

type Config struct {
	Listen           string
	ArtifactURL      string
	Package          string
	Location         string
	ADB              string
	Serial           string
	Script           string
	NoVNC            string
	VNC              string
	ClashAPI         string
	IPInfoURL        string
	DevToolsFrontend string
	CacheDir         string
	Emulator         emulator.Config
}

func DefaultConfig() Config {
	return Config{
		Listen:           ":8080",
		ADB:              "adb",
		Serial:           "emulator-5554",
		Script:           "/opt/holtdroid/script",
		NoVNC:            "/opt/novnc",
		VNC:              "127.0.0.1:5900",
		IPInfoURL:        "https://ipinfo.io/json",
		DevToolsFrontend: "https://chrome-devtools-frontend.appspot.com/serve_rev/",
		CacheDir:         filepath.Join(os.TempDir(), "holtdroid"),
		Emulator:         emulator.DefaultConfig(),
	}
}

// Instrumenter starts an app with WebView debugging and the clipboard hooks.
type Instrumenter interface {
	Spawn(ctx context.Context, pkg string, onClip func(string)) (App, error)
}

// App is one instrumented run of the app.
type App interface {
	Done() <-chan struct{}
	Clipboard(ctx context.Context) (string, error)
	SetClipboard(ctx context.Context, text string) error
	Kill(ctx context.Context) error
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
	display  *Display
	frontend *Frontend
	actions  chan contract.AppAction

	mu     sync.Mutex
	status contract.StatusEvent
	clip   string
	app    App
	subs   map[chan struct{}]struct{}
}

func New(cfg Config, dev Device, inst Instrumenter, boot BootFunc, log *slog.Logger) *Agent {
	return &Agent{
		cfg:      cfg,
		dev:      dev,
		inst:     inst,
		boot:     boot,
		log:      log,
		hc:       &http.Client{Timeout: 10 * time.Minute},
		devtools: NewDevTools(dev, log),
		network:  NewNetwork(cfg.ClashAPI, cfg.IPInfoURL),
		display:  NewDisplay(cfg.NoVNC, cfg.VNC, log),
		frontend: NewFrontend(cfg.DevToolsFrontend, filepath.Join(cfg.CacheDir, "devtools-frontend")),
		actions:  make(chan contract.AppAction, 1),
		status:   contract.StatusEvent{State: contract.StateProvisioning},
		subs:     map[chan struct{}]struct{}{},
	}
}

func (a *Agent) Handler() http.Handler {
	mux := http.NewServeMux()
	contract.RegisterAgent(contract.NewAPI(mux, "Holtdroid device agent"), a)
	a.display.Register(mux)
	mux.HandleFunc("GET /devtools/{socket}/page/{id}", a.devtools.ServeCDP)
	mux.Handle("GET /devtools-frontend/{rev}/{file...}", a.frontend)
	return mux
}

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

func (a *Agent) run(ctx context.Context) error {
	a.setStatus(contract.StateInstalling, "Downloading the APK")
	apk, err := a.download(ctx)
	if err != nil {
		return err
	}
	defer os.Remove(apk)
	a.setStatus(contract.StateInstalling, "Installing the APK")
	if err := a.dev.Install(ctx, apk); err != nil {
		return err
	}
	if a.cfg.Location != "" && a.cfg.ClashAPI != "" {
		if _, err := a.network.SetLocation(ctx, a.cfg.Location); err != nil {
			a.log.Warn("initial location", "location", a.cfg.Location, "err", err)
		}
	}

	var crashes []time.Time
	for {
		a.setStatus(contract.StateInstrumenting, "Enabling WebView debugging")
		app, err := a.inst.Spawn(ctx, a.cfg.Package, a.onClip)
		if err != nil {
			return fmt.Errorf("start %s: %w", a.cfg.Package, err)
		}
		a.setApp(app)
		a.setStatus(contract.StateReady, "")

		select {
		case <-ctx.Done():
			_ = app.Kill(context.WithoutCancel(ctx))
			return nil
		case <-app.Done():
			a.setApp(nil)
			now := time.Now()
			crashes = append(crashes, now)
			for len(crashes) > 0 && now.Sub(crashes[0]) > time.Minute {
				crashes = crashes[1:]
			}
			if len(crashes) >= 5 {
				return fmt.Errorf("%s exited %d times within a minute", a.cfg.Package, len(crashes))
			}
			a.log.Info("app exited, starting it again", "package", a.cfg.Package)
		case action := <-a.actions:
			a.setApp(nil)
			if err := app.Kill(ctx); err != nil {
				a.log.Warn("kill app", "err", err)
			}
			if action == contract.AppReinstall {
				a.setStatus(contract.StateInstalling, "Reinstalling the APK")
				if _, err := a.dev.Shell(ctx, "pm uninstall "+a.cfg.Package); err != nil {
					a.log.Warn("uninstall", "err", err)
				}
				if err := a.dev.Install(ctx, apk); err != nil {
					return err
				}
			}
		}
	}
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

func (a *Agent) download(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.cfg.ArtifactURL, nil)
	if err != nil {
		return "", err
	}
	resp, err := a.hc.Do(req)
	if err != nil {
		return "", fmt.Errorf("download APK: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download APK: %s", resp.Status)
	}
	f, err := os.CreateTemp("", "holtdroid-*.apk")
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(f.Name())
		return "", fmt.Errorf("download APK: %w", err)
	}
	return f.Name(), f.Close()
}

func (a *Agent) setStatus(state contract.SessionState, detail string) {
	a.mu.Lock()
	a.status = contract.StatusEvent{State: state, Detail: detail}
	a.mu.Unlock()
	a.notify()
}

func (a *Agent) setApp(app App) {
	a.mu.Lock()
	a.app = app
	a.mu.Unlock()
}

func (a *Agent) currentApp() App {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.app
}

func (a *Agent) onClip(text string) {
	a.mu.Lock()
	a.clip = text
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
	return a.status, a.clip
}

func (a *Agent) Ready(context.Context) bool {
	s, _ := a.snapshot()
	return s.State == contract.StateReady
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

func (a *Agent) Clipboard(ctx context.Context) (string, error) {
	if app := a.currentApp(); app != nil {
		text, err := app.Clipboard(ctx)
		if err == nil {
			return text, nil
		}
		a.log.Warn("read clipboard", "err", err)
	}
	_, clip := a.snapshot()
	return clip, nil
}

func (a *Agent) SetClipboard(ctx context.Context, text string) error {
	app := a.currentApp()
	if app == nil {
		return errors.New("the app is not running")
	}
	return app.SetClipboard(ctx, text)
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
	if !a.Ready(context.Background()) {
		return errors.New("the app is not running")
	}
	select {
	case a.actions <- action:
		return nil
	default:
		return errors.New("another app action is in progress")
	}
}
