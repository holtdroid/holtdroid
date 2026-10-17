//go:build frida

package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"path/filepath"
	"sync"
	"time"

	"github.com/frida/frida-go/frida"
)

// Frida spawns apps through frida-server on the device with the scripts in
// dir (agent.ts for the app, system.ts for system_server, plus their
// node_modules), bundled once by Frida's compiler.
type Frida struct {
	serial string
	dir    string
	log    *slog.Logger

	mu     sync.Mutex
	dev    *frida.Device
	bundle string
	system string
}

func NewFrida(serial, dir string, log *slog.Logger) (Instrumenter, error) {
	return &Frida{serial: serial, dir: dir, log: log}, nil
}

func (f *Frida) prepare() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.dev != nil {
		return nil
	}
	opts := frida.NewCompilerOptions()
	opts.SetProjectRoot(f.dir)
	opts.SetTypeCheckMode(frida.TypeCheckModeNone)
	opts.SetSourceMaps(frida.SourceMapsOmitted)
	compiler := frida.NewCompiler()
	bundle, err := compiler.Build(filepath.Join(f.dir, "agent.ts"), opts)
	if err != nil {
		return fmt.Errorf("compile frida script: %w", err)
	}
	system, err := compiler.Build(filepath.Join(f.dir, "system.ts"), opts)
	if err != nil {
		return fmt.Errorf("compile frida system script: %w", err)
	}
	dev, err := frida.DeviceByID(f.serial)
	if err != nil {
		return fmt.Errorf("frida device %s: %w", f.serial, err)
	}
	f.dev, f.bundle, f.system = dev, bundle, system
	return nil
}

// SetLocales changes the system language the way the Settings app does,
// from inside system_server, so it applies without a reboot.
func (f *Frida) SetLocales(ctx context.Context, tags string) error {
	if err := f.prepare(); err != nil {
		return err
	}
	sess, err := f.dev.AttachWithContext(ctx, "system_server", nil)
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
	_, err = callScript(ctx, script, "setLocales", tags)
	return err
}

func (f *Frida) Spawn(_ context.Context, pkg string) (App, error) {
	if err := f.prepare(); err != nil {
		return nil, err
	}
	pid, err := f.dev.Spawn(pkg, nil)
	if err != nil {
		return nil, fmt.Errorf("spawn: %w", err)
	}
	return f.instrument(pid)
}

// Watch gates every process the device starts, instruments the app's main
// process and resumes all others straight away.
func (f *Frida) Watch(ctx context.Context, pkg string, launched func(App)) error {
	if err := f.prepare(); err != nil {
		return err
	}
	dev := f.dev
	dev.On("spawn_added", func(spawn *frida.Spawn) {
		pid, id := spawn.PID(), spawn.Identifier()
		go func() {
			if id != pkg {
				if err := dev.Resume(pid); err != nil {
					f.log.Warn("resume gated process", "process", id, "pid", pid, "err", err)
				}
				return
			}
			app, err := f.instrument(pid)
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
}

// instrument loads the script into a suspended process and resumes it.
func (f *Frida) instrument(pid int) (App, error) {
	dev, bundle := f.dev, f.bundle
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
	if err := dev.Resume(pid); err != nil {
		_ = dev.Kill(pid)
		return nil, fmt.Errorf("resume: %w", err)
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
