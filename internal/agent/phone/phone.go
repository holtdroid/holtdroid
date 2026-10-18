// Package phone prepares a physical phone on USB for a session and puts it
// back afterwards. It needs no root.
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
}

func DefaultConfig() Config {
	return Config{BootTimeout: 2 * time.Minute, Poll: 5 * time.Second, Misses: 3}
}

// ADB is what a phone session needs from adb.
type ADB interface {
	WaitBoot(ctx context.Context) error
	State(ctx context.Context) (string, error)
	Shell(ctx context.Context, cmd string) (string, error)
	Install(ctx context.Context, apk string) error
	Reverse(ctx context.Context, port, local int) error
	RemoveAll(ctx context.Context) error
}

type Phone struct {
	cfg    Config
	adb    ADB
	tunnel *Tunnel
	log    *slog.Logger
}

// New prepares a session on the phone; with a tunnel the phone reaches the
// internet only through it.
func New(cfg Config, adb ADB, tunnel *Tunnel, log *slog.Logger) *Phone {
	return &Phone{cfg: cfg, adb: adb, tunnel: tunnel, log: log}
}

const wake = "svc power stayon usb; input keyevent KEYCODE_WAKEUP; wm dismiss-keyguard"

// Run waits for the phone, wakes it, starts the tunnel, calls booted and
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
	if _, err := p.adb.Shell(ctx, wake); err != nil {
		p.log.Warn("could not wake the phone", "err", err)
	}
	if p.tunnel != nil {
		if err := p.tunnel.start(ctx, p.adb); err != nil {
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
	if p.tunnel == nil {
		return
	}
	if ok, err := p.tunnel.running(ctx, p.adb); ok || ctx.Err() != nil {
		return
	} else if err != nil {
		p.log.Warn("tunnel status", "err", err)
	}
	p.log.Warn("the tunnel is down, starting it again")
	if err := p.tunnel.start(ctx, p.adb); err != nil && ctx.Err() == nil {
		p.log.Warn("restart the tunnel", "err", err)
	}
}

// resetScript undoes what a session can change through the agent: the app,
// the device settings the portal offers, and files the agent pushed.
const resetScript = stopTunnel + `
am force-stop %[1]s; pm uninstall %[1]s >/dev/null 2>&1
cmd connectivity airplane-mode disable; svc wifi enable; svc data enable
dumpsys battery reset; cmd power set-mode 0
settings put system font_scale 1.0; wm density reset; wm size reset
settings put system accelerometer_rotation 1
settings put global auto_time 1; settings put global auto_time_zone 1
rm -rf /data/local/tmp/holtdroid-*
input keyevent KEYCODE_HOME
true`

var packageName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$`)

// Reset puts the phone back for the next session. Every step is best effort;
// the error says what could not be undone.
func Reset(ctx context.Context, adb ADB, pkg string) error {
	if !packageName.MatchString(pkg) {
		return fmt.Errorf("bad package name %q", pkg)
	}
	_, serr := adb.Shell(ctx, fmt.Sprintf(resetScript, pkg))
	return errors.Join(serr, adb.RemoveAll(ctx))
}
