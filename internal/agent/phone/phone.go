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
	RemoveAll(ctx context.Context) error
}

type Phone struct {
	cfg Config
	adb ADB
	log *slog.Logger
}

func New(cfg Config, adb ADB, log *slog.Logger) *Phone {
	return &Phone{cfg: cfg, adb: adb, log: log}
}

const wake = "svc power stayon usb; input keyevent KEYCODE_WAKEUP; wm dismiss-keyguard"

// Run waits for the phone, wakes it, calls booted and returns once ctx ends
// or the phone has been gone for Misses polls in a row.
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

// resetScript undoes what a session can change through the agent: the app,
// the device settings the portal offers, and files the agent pushed.
const resetScript = `am force-stop %[1]s; pm uninstall %[1]s >/dev/null 2>&1
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
