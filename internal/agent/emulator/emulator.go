// Package emulator runs the Android emulator inside the session container,
// headless, and frida-server on the booted device.
package emulator

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"
)

// GPU modes: host renders on the node's GPU through Xvfb and VirtualGL,
// software with SwiftShader.
const (
	GPUHost     = "host"
	GPUSoftware = "software"
)

const display = ":0"

type Config struct {
	Bin         string
	AVD         string
	Args        []string
	DNSServer   string
	FridaServer string
	BootTimeout time.Duration
	GPU         string
	DRI         string
	Xvfb        string
	VGLRun      string
}

func DefaultConfig() Config {
	return Config{
		Bin:         "emulator",
		AVD:         "holtdroid",
		FridaServer: "/opt/holtdroid/frida-server",
		BootTimeout: 5 * time.Minute,
		GPU:         GPUHost,
		DRI:         "/dev/dri",
		Xvfb:        "Xvfb",
		VGLRun:      "/opt/VirtualGL/bin/vglrun",
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

// Args returns the emulator command line for rendering on the host GPU or
// in software.
func (e *Emulator) Args(hostGPU bool) []string {
	gpu := "swiftshader_indirect"
	if hostGPU {
		gpu = "host"
	}
	args := []string{
		"-avd", e.cfg.AVD,
		"-no-snapshot",
		"-no-audio",
		"-no-boot-anim",
		"-no-metrics",
		"-no-window",
		"-gpu", gpu,
		"-camera-back", "none",
		"-camera-front", "none",
	}
	if e.cfg.DNSServer != "" {
		args = append(args, "-dns-server", e.cfg.DNSServer)
	}
	return append(args, e.cfg.Args...)
}

// device returns the DRI card the emulator renders on, or "" for software
// rendering.
func (e *Emulator) device() (string, error) {
	switch e.cfg.GPU {
	case GPUSoftware:
		return "", nil
	case GPUHost:
	default:
		return "", fmt.Errorf("unknown gpu mode %q (want %s or %s)", e.cfg.GPU, GPUHost, GPUSoftware)
	}
	cards, _ := filepath.Glob(filepath.Join(e.cfg.DRI, "card*"))
	if len(cards) == 0 {
		e.log.Warn("no GPU in the container, rendering in software", "dri", e.cfg.DRI)
		return "", nil
	}
	return cards[0], nil
}

// Run starts every process, calls booted once Android is up, rooted and
// running frida-server, and returns when ctx ends or a process exits.
func (e *Emulator) Run(ctx context.Context, booted func()) error {
	card, err := e.device()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	g, ctx := errgroup.WithContext(ctx)
	start := func(env []string, name string, args ...string) {
		cmd := exec.CommandContext(ctx, name, args...)
		if env != nil {
			cmd.Env = append(os.Environ(), env...)
		}
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

	if card == "" {
		start(nil, e.cfg.Bin, e.Args(false)...)
	} else {
		e.log.Info("rendering on the host GPU", "device", card)
		start(nil, e.cfg.Xvfb, display, "-screen", "0", "1280x1280x24", "-nolisten", "tcp")
		if err := waitDisplay(ctx); err != nil {
			cancel()
			if werr := g.Wait(); werr != nil && !errors.Is(werr, context.Canceled) {
				return werr
			}
			return err
		}
		start([]string{"DISPLAY=" + display}, e.cfg.VGLRun, append([]string{"-d", card, e.cfg.Bin}, e.Args(true)...)...)
	}

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

func waitDisplay(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	for {
		if _, err := os.Stat("/tmp/.X11-unix/X" + strings.TrimPrefix(display, ":")); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("xvfb did not start: %w", ctx.Err())
		case <-time.After(100 * time.Millisecond):
		}
	}
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
