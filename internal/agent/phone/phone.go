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

// Session is what a phone session needs: with a tunnel the phone reaches the
// internet only through it; a new session (not Resume) cleans the phone
// against Baseline first.
type Session struct {
	Package  string
	Tunnel   *Tunnel
	Baseline *Baseline
	Resume   bool
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
		if err := Clean(ctx, p.adb, Cleanup{Package: p.s.Package, Baseline: p.s.Baseline, Offline: p.s.Tunnel != nil}); err != nil {
			p.log.Warn("clean the phone before the session", "err", err)
		}
	}
	if _, err := p.adb.Shell(ctx, wake); err != nil {
		p.log.Warn("could not wake the phone", "err", err)
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
