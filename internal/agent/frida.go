//go:build frida

package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/frida/frida-go/frida"
)

// Frida spawns apps through frida-server on the device with the bundles in
// Dir: agent.js for the app, system.js for system_server (CompileScripts).
type Frida struct {
	FridaConfig
	log *slog.Logger

	mu      sync.Mutex
	dev     *frida.Device
	bundle  string
	system  string
	tracked map[int]bool
}

func NewFrida(cfg FridaConfig, log *slog.Logger) (Instrumenter, error) {
	return &Frida{FridaConfig: cfg, log: log, tracked: map[int]bool{}}, nil
}

func (f *Frida) prepare() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.dev != nil {
		return nil
	}
	bundle, err := os.ReadFile(filepath.Join(f.Dir, "agent.js"))
	if err != nil {
		return fmt.Errorf("frida script: %w", err)
	}
	system, err := os.ReadFile(filepath.Join(f.Dir, "system.js"))
	if err != nil {
		return fmt.Errorf("frida system script: %w", err)
	}
	var dev *frida.Device
	if f.Host != "" {
		d, err := frida.NewDeviceManager().AddRemoteDevice(f.Host, frida.NewRemoteDeviceOptions())
		if err != nil {
			return fmt.Errorf("frida-server at %s: %w", f.Host, err)
		}
		dev = d.(*frida.Device)
	} else {
		d, err := frida.DeviceByID(f.Serial)
		if err != nil {
			return fmt.Errorf("frida device %s: %w", f.Serial, err)
		}
		dev = d
	}
	f.dev, f.bundle, f.system = dev, string(bundle), string(system)
	return nil
}

// deviceGone matches the FError frida-server raises once the device handle is
// stale — the phone re-enumerated on USB (reboot or replug). Narrow on
// purpose so every other failure propagates unretried.
func deviceGone(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "device is gone")
}

// withDevice resolves the cached device and runs op against it. If op fails
// because the handle went stale, it drops the handle, re-resolves the device
// and retries op exactly once.
func (f *Frida) withDevice(op func(dev *frida.Device) error) error {
	if err := f.prepare(); err != nil {
		return err
	}
	f.mu.Lock()
	dev := f.dev
	f.mu.Unlock()
	err := op(dev)
	if !deviceGone(err) {
		return err
	}
	f.log.Warn("frida device gone, re-resolving", "serial", f.Serial, "err", err)
	f.mu.Lock()
	if f.dev == dev {
		f.dev = nil
	}
	f.mu.Unlock()
	if err := f.prepare(); err != nil {
		return err
	}
	f.mu.Lock()
	dev = f.dev
	f.mu.Unlock()
	return op(dev)
}

// CompileScripts bundles agent.ts and system.ts in dir, with the node_modules
// next to them, into agent.js and system.js.
func CompileScripts(dir string) error {
	opts := frida.NewCompilerOptions()
	opts.SetProjectRoot(dir)
	opts.SetTypeCheckMode(frida.TypeCheckModeNone)
	opts.SetSourceMaps(frida.SourceMapsOmitted)
	compiler := frida.NewCompiler()
	for _, name := range []string{"agent", "system"} {
		bundle, err := compiler.Build(filepath.Join(dir, name+".ts"), opts)
		if err != nil {
			return fmt.Errorf("compile %s.ts: %w", name, err)
		}
		if err := os.WriteFile(filepath.Join(dir, name+".js"), []byte(bundle), 0o644); err != nil {
			return err
		}
	}
	return nil
}

// SetWallpaper renders w with the device's own Canvas and fonts: the logo on
// the home screen, the logo with w's rows on the lock screen.
func (f *Frida) SetWallpaper(ctx context.Context, w Wallpaper) error {
	raw, err := json.Marshal(w)
	if err != nil {
		return err
	}
	return f.callSystem(ctx, "setWallpaper", string(raw))
}

func (f *Frida) callSystem(ctx context.Context, fn string, args ...any) error {
	return f.withDevice(func(dev *frida.Device) error {
		sess, err := dev.AttachWithContext(ctx, "system_server", nil)
		if err != nil {
			return fmt.Errorf("attach system_server: %w", err)
		}
		defer func() { _ = sess.Detach() }()
		script, err := sess.CreateScript(f.system)
		if err != nil {
			return fmt.Errorf("create script: %w", err)
		}
		if err := script.Load(); err != nil {
			return fmt.Errorf("load script: %w", err)
		}
		defer func() { _ = script.Unload() }()
		_, err = callScript(ctx, script, fn, args...)
		return err
	})
}

func (f *Frida) Spawn(_ context.Context, pkg string) (App, error) {
	var app App
	err := f.withDevice(func(dev *frida.Device) error {
		pid, err := dev.Spawn(pkg, nil)
		if err != nil {
			return fmt.Errorf("spawn: %w", err)
		}
		app, err = f.instrument(pid, true)
		return err
	})
	return app, err
}

// Watch instruments the app whenever the device starts it by itself.
func (f *Frida) Watch(ctx context.Context, pkg string, launched func(App)) error {
	if !f.Gating {
		return f.poll(ctx, pkg, launched)
	}
	return f.withDevice(func(dev *frida.Device) error {
		dev.On("spawn_added", func(spawn *frida.Spawn) {
			pid, id := spawn.PID(), spawn.Identifier()
			go func() {
				if id != pkg {
					if err := dev.Resume(pid); err != nil {
						f.log.Warn("resume gated process", "process", id, "pid", pid, "err", err)
					}
					return
				}
				app, err := f.instrument(pid, true)
				if err != nil {
					f.log.Warn("instrument app started on the device", "pid", pid, "err", err)
					_ = dev.Resume(pid)
					return
				}
				launched(app)
			}()
		})
		if err := dev.EnableSpawnGating(); err != nil {
			return fmt.Errorf("enable spawn gating: %w", err)
		}
		go func() {
			<-ctx.Done()
			_ = dev.DisableSpawnGating()
		}()
		return nil
	})
}

// poll attaches to the app's main process whenever one appears that wasn't
// instrumented yet, a second or so after it starts.
func (f *Frida) poll(ctx context.Context, pkg string, launched func(App)) error {
	if err := f.prepare(); err != nil {
		return err
	}
	go func() {
		t := time.NewTicker(time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
			}
			f.mu.Lock()
			dev := f.dev
			f.mu.Unlock()
			if dev == nil {
				continue
			}
			procs, err := dev.EnumerateProcesses(frida.ScopeMinimal)
			if err != nil {
				continue
			}
			for _, p := range procs {
				pid := p.PID()
				f.mu.Lock()
				seen := f.tracked[pid]
				f.mu.Unlock()
				if p.Name() != pkg || seen {
					continue
				}
				app, err := f.instrument(pid, false)
				if err != nil {
					f.log.Warn("instrument app started on the device", "pid", pid, "err", err)
					continue
				}
				launched(app)
			}
		}
	}()
	return nil
}

// instrument loads the script into the process and resumes it when it was
// spawned suspended.
func (f *Frida) instrument(pid int, suspended bool) (App, error) {
	f.mu.Lock()
	dev, bundle := f.dev, f.bundle
	f.tracked[pid] = true
	f.mu.Unlock()
	app := &fridaApp{dev: dev, pid: pid, done: make(chan struct{})}
	sess, err := dev.Attach(pid, nil)
	if err != nil {
		_ = dev.Kill(pid)
		return nil, fmt.Errorf("attach: %w", err)
	}
	sess.On("detached", func(reason frida.SessionDetachReason, _ *frida.Crash) {
		f.log.Info("app detached", "pid", pid, "reason", reason.String())
		app.closeDone()
	})
	script, err := sess.CreateScript(bundle)
	if err != nil {
		_ = dev.Kill(pid)
		return nil, fmt.Errorf("create script: %w", err)
	}
	script.On("message", func(message string, _ []byte) {
		var m struct {
			Type        string `json:"type"`
			Description string `json:"description"`
		}
		if json.Unmarshal([]byte(message), &m) != nil {
			return
		}
		switch m.Type {
		case "error":
			f.log.Warn("frida script error", "description", m.Description)
		case "log":
			f.log.Info("frida script", "message", message)
		}
	})
	if err := script.Load(); err != nil {
		_ = dev.Kill(pid)
		return nil, fmt.Errorf("load script: %w", err)
	}
	if suspended {
		if err := dev.Resume(pid); err != nil {
			_ = dev.Kill(pid)
			return nil, fmt.Errorf("resume: %w", err)
		}
	}
	app.script = script
	return app, nil
}

type fridaApp struct {
	dev    *frida.Device
	script *frida.Script
	pid    int
	done   chan struct{}
	once   sync.Once
}

func (a *fridaApp) closeDone() { a.once.Do(func() { close(a.done) }) }

func (a *fridaApp) Done() <-chan struct{} { return a.done }

func callScript(ctx context.Context, script *frida.Script, fn string, args ...any) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	ret := script.ExportsCallWithContext(ctx, fn, args...)
	if err, ok := ret.(error); ok {
		return nil, err
	}
	m, ok := ret.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%s: unexpected reply %v", fn, ret)
	}
	if msg, ok := m["error"].(string); ok {
		return nil, fmt.Errorf("%s: %s", fn, msg)
	}
	return m, nil
}

func (a *fridaApp) Kill(ctx context.Context) error {
	if err := a.dev.Kill(a.pid); err != nil {
		return err
	}
	select {
	case <-a.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(10 * time.Second):
		return errors.New("the app did not exit")
	}
}
