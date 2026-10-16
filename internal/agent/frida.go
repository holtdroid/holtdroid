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
// dir (agent.js for the app, system.js for system_server, plus their
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
	bundle, err := compiler.Build(filepath.Join(f.dir, "agent.js"), opts)
	if err != nil {
		return fmt.Errorf("compile frida script: %w", err)
	}
	system, err := compiler.Build(filepath.Join(f.dir, "system.js"), opts)
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

func (f *Frida) Spawn(_ context.Context, pkg string, onClip func(string)) (App, error) {
	if err := f.prepare(); err != nil {
		return nil, err
	}
	dev, bundle := f.dev, f.bundle
	pid, err := dev.Spawn(pkg, nil)
	if err != nil {
		return nil, fmt.Errorf("spawn: %w", err)
	}
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
	script.On("message", func(message string, data []byte) {
		var m struct {
			Type        string `json:"type"`
			Description string `json:"description"`
			Level       string `json:"level"`
			Payload     struct {
				Type string `json:"type"`
			} `json:"payload"`
		}
		if json.Unmarshal([]byte(message), &m) != nil {
			return
		}
		switch {
		case m.Type == "send" && m.Payload.Type == "clip":
			onClip(string(data))
		case m.Type == "error":
			f.log.Warn("frida script error", "description", m.Description)
		case m.Type == "log":
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

func (a *fridaApp) call(ctx context.Context, fn string, args ...any) (map[string]any, error) {
	return callScript(ctx, a.script, fn, args...)
}

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

func (a *fridaApp) Clipboard(ctx context.Context) (string, error) {
	m, err := a.call(ctx, "getClip")
	if err != nil {
		return "", err
	}
	text, _ := m["text"].(string)
	return text, nil
}

func (a *fridaApp) SetClipboard(ctx context.Context, text string) error {
	_, err := a.call(ctx, "setClip", text)
	return err
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
