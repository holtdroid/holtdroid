// Package phone prepares a physical phone on USB for a session and puts it
// back afterwards. A session runs without root; a rooted phone (Session.Root)
// additionally starts frida-server through su so the agent can instrument the
// app and apply the extra root capabilities.
package phone

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"time"
)

type Config struct {
	BootTimeout time.Duration
	Poll        time.Duration
	Misses      int
	Suspend     []string
	// ProtectBattery caps charging (Samsung's "Protect battery", at 80% on
	// One UI 6): phones stay plugged in all the time.
	ProtectBattery bool
	// FridaServer is the frida-server binary pushed to a rooted phone and
	// started through su; empty disables root mode even for a root session.
	FridaServer string
	// SingBox is the static arm64 sing-box pushed to a rooted phone for the
	// transparent tun tunnel (RootTunnel).
	SingBox string
}

// DefaultSuspend are the apps a session must not open: settings (a PIN,
// Developer options, resets), calls, messages and SOS, stores, accounts,
// updaters and the camera. Missing packages are skipped; Android refuses
// to suspend the default dialer, launcher and installer.
var DefaultSuspend = []string{
	"com.android.settings",
	"com.android.contacts", "com.samsung.android.app.contacts", "com.google.android.contacts",
	"com.android.messaging", "com.samsung.android.messaging", "com.google.android.apps.messaging",
	"com.android.emergency", "com.sec.android.emergencylauncher", "com.samsung.android.emergency",
	"com.sec.android.app.samsungapps", "com.osp.app.signin",
	"com.samsung.android.app.updatecenter", "com.wssyncmldm", "com.sec.android.soagent", "com.sec.android.easyMover",
	"com.sec.android.app.camera", "com.android.camera2", "com.google.android.GoogleCamera",
}

func DefaultConfig() Config {
	return Config{BootTimeout: 2 * time.Minute, Poll: 5 * time.Second, Misses: 3, Suspend: DefaultSuspend, ProtectBattery: true, FridaServer: "/opt/holtdroid/frida-server", SingBox: "/opt/holtdroid/sing-box-android"}
}

// ADB is what a phone session needs from adb.
type ADB interface {
	WaitBoot(ctx context.Context) error
	State(ctx context.Context) (string, error)
	Shell(ctx context.Context, cmd string) (string, error)
	Push(ctx context.Context, local, remote string) error
	Install(ctx context.Context, apk string) error
	Reverse(ctx context.Context, port, local int) error
	RemoveAll(ctx context.Context) error
}

// Session is what a phone session needs: with a tunnel the phone reaches the
// internet only through it; a new session (not Resume) cleans the phone
// against Baseline first.
type Session struct {
	Package  string
	App      App
	Tunnel   tunnel
	Baseline *Baseline
	Resume   bool
	// Root runs the session with root: frida-server is started through su so
	// the agent instruments the app (DevTools for release builds) and the
	// extra root capabilities apply.
	Root bool
	// WifiSSID and WifiPassword join a rooted phone to a real Wi-Fi network so
	// apps see an ordinary network while the tproxy tunnel carries the traffic
	// (TproxyTunnel). The network needs no internet of its own.
	WifiSSID     string
	WifiPassword string
}

type Phone struct {
	cfg Config
	adb ADB
	s   Session
	log *slog.Logger
}

func New(cfg Config, adb ADB, s Session, log *slog.Logger) *Phone {
	return &Phone{cfg: cfg, adb: adb, s: s, log: log}
}

const wake = "svc power stayon usb; input keyevent KEYCODE_WAKEUP; wm dismiss-keyguard"

// Run waits for the phone, cleans it, wakes it, starts the tunnel, calls booted and
// returns once ctx ends or the phone has been gone for Misses polls in a row.
// A tunnel that went down is started again.
func (p *Phone) Run(ctx context.Context, booted func()) error {
	bootCtx, cancel := context.WithTimeout(ctx, p.cfg.BootTimeout)
	err := p.adb.WaitBoot(bootCtx)
	cancel()
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("phone did not come up: %w", err)
	}
	if !p.s.Resume {
		if err := Clean(ctx, p.adb, Cleanup{Package: p.s.Package, Baseline: p.s.Baseline, Offline: p.s.Tunnel != nil && !p.s.Root, Root: p.s.Root, Suspend: p.cfg.Suspend, ProtectBattery: p.cfg.ProtectBattery}); err != nil {
			p.log.Warn("clean the phone before the session", "err", err)
		}
	}
	if err := p.s.App.Ensure(ctx, p.adb); err != nil {
		return err
	}
	if _, err := p.adb.Shell(ctx, wake); err != nil {
		p.log.Warn("could not wake the phone", "err", err)
	}
	if p.s.Root {
		if err := p.prepareRoot(ctx); err != nil {
			return fmt.Errorf("root mode: %w", err)
		}
		if err := lockdownCalls(ctx, p.adb); err != nil {
			p.log.Warn("lock down calls", "err", err)
		}
		if err := connectWifi(ctx, p.adb, p.s.WifiSSID, p.s.WifiPassword); err != nil {
			p.log.Warn("join wifi", "err", err)
		}
	}
	if p.s.Tunnel != nil {
		if err := p.s.Tunnel.start(ctx, p.adb); err != nil {
			return fmt.Errorf("vpn: %w", err)
		}
	}
	booted()
	misses := 0
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(p.cfg.Poll):
		}
		state, err := p.adb.State(ctx)
		if err == nil && state == "device" {
			misses = 0
			if _, err := p.adb.Shell(ctx, privacy); err != nil && ctx.Err() == nil {
				p.log.Warn("block the microphone", "err", err)
			}
			if p.s.Root {
				p.hideRoot(ctx)
			}
			p.keepTunnel(ctx)
			continue
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if misses++; misses >= p.cfg.Misses {
			return errors.New("phone disconnected")
		}
	}
}

func (p *Phone) keepTunnel(ctx context.Context) {
	if p.s.Tunnel == nil {
		return
	}
	if ok, err := p.s.Tunnel.running(ctx, p.adb); ok || ctx.Err() != nil {
		return
	} else if err != nil {
		p.log.Warn("tunnel status", "err", err)
	}
	p.log.Warn("the tunnel is down, starting it again")
	if err := p.s.Tunnel.start(ctx, p.adb); err != nil && ctx.Err() == nil {
		p.log.Warn("restart the tunnel", "err", err)
	}
}

var packageName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$`)
