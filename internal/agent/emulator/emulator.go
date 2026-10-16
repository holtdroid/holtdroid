// Package emulator runs the Android emulator inside the session container:
// Xvfb, the emulator on that display, x11vnc for the screen and frida-server
// on the booted device.
package emulator

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"
)

type Config struct {
	Bin         string
	AVD         string
	Args        []string
	DNSServer   string
	Display     string
	Screen      string
	Clip        string
	VNCPort     int
	FridaServer string
	BootTimeout time.Duration
}

func DefaultConfig() Config {
	return Config{
		Bin:         "emulator",
		AVD:         "holtdroid",
		Display:     ":0",
		Screen:      "800x1300x24",
		Clip:        "720x1280+0+0",
		VNCPort:     5900,
		FridaServer: "/opt/holtdroid/frida-server",
		BootTimeout: 5 * time.Minute,
	}
}

// ADB is what the emulator needs from adb to prepare a booted device.
type ADB interface {
	WaitBoot(ctx context.Context) error
	Root(ctx context.Context) error
	Push(ctx context.Context, local, remote string) error
	Shell(ctx context.Context, cmd string) (string, error)
}

type Emulator struct {
	cfg Config
	adb ADB
	log *slog.Logger
}

func New(cfg Config, adb ADB, log *slog.Logger) *Emulator {
	return &Emulator{cfg: cfg, adb: adb, log: log}
}

// Args returns the emulator command line.
func (e *Emulator) Args() []string {
	args := []string{
		"-avd", e.cfg.AVD,
		"-no-snapshot",
		"-no-audio",
		"-no-boot-anim",
		"-no-metrics",
		"-fixed-scale",
		"-gpu", "swiftshader_indirect",
		"-camera-back", "none",
		"-camera-front", "none",
	}
	if e.cfg.DNSServer != "" {
		args = append(args, "-dns-server", e.cfg.DNSServer)
	}
	return append(args, e.cfg.Args...)
}

// Run starts every process, calls booted once Android is up, rooted and
// running frida-server, and returns when ctx ends or a process exits.
func (e *Emulator) Run(ctx context.Context, booted func()) error {
	g, ctx := errgroup.WithContext(ctx)
	start := func(name string, args ...string) {
		cmd := exec.CommandContext(ctx, name, args...)
		cmd.Env = append(os.Environ(), "DISPLAY="+e.cfg.Display)
		cmd.Stdout, cmd.Stderr = os.Stderr, os.Stderr
		cmd.WaitDelay = 10 * time.Second
		g.Go(func() error {
			err := cmd.Run()
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if err == nil {
				err = errors.New("unexpected exit")
			}
			return fmt.Errorf("%s exited: %w", name, err)
		})
	}

	start("Xvfb", e.cfg.Display, "-screen", "0", e.cfg.Screen, "-nolisten", "tcp")
	if err := waitFile(ctx, "/tmp/.X11-unix/X"+strings.TrimPrefix(e.cfg.Display, ":")); err != nil {
		return cmp.Or(g.Wait(), err)
	}
	start(e.cfg.Bin, e.Args()...)
	vnc := []string{"-display", e.cfg.Display, "-forever", "-shared", "-nopw", "-localhost", "-rfbport", strconv.Itoa(e.cfg.VNCPort), "-quiet", "-noxdamage"}
	if e.cfg.Clip != "" {
		vnc = append(vnc, "-clip", e.cfg.Clip)
	}
	start("x11vnc", vnc...)

	g.Go(func() error {
		bootCtx, cancel := context.WithTimeout(ctx, e.cfg.BootTimeout)
		defer cancel()
		if err := e.prepare(bootCtx); err != nil {
			return cmp.Or(ctx.Err(), err)
		}
		booted()
		return nil
	})
	return g.Wait()
}

func (e *Emulator) prepare(ctx context.Context) error {
	e.log.Info("waiting for Android to boot")
	if err := e.adb.WaitBoot(ctx); err != nil {
		return fmt.Errorf("boot: %w", err)
	}
	e.log.Info("android booted")
	if err := e.adb.Root(ctx); err != nil {
		return fmt.Errorf("adb root: %w", err)
	}
	const remote = "/data/local/tmp/frida-server"
	if err := e.adb.Push(ctx, e.cfg.FridaServer, remote); err != nil {
		return err
	}
	if _, err := e.adb.Shell(ctx, "chmod 755 "+remote+" && "+remote+" -D </dev/null >/dev/null 2>&1"); err != nil {
		return fmt.Errorf("start frida-server: %w", err)
	}
	for {
		out, err := e.adb.Shell(ctx, "pidof frida-server")
		if err == nil && strings.TrimSpace(out) != "" {
			e.log.Info("device is ready")
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("frida-server did not start: %w", ctx.Err())
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func waitFile(ctx context.Context, path string) error {
	for {
		if _, err := os.Stat(path); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}
