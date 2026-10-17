package agent

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// Device is what the agent needs from a booted Android device.
type Device interface {
	Shell(ctx context.Context, cmd string) (string, error)
	Install(ctx context.Context, apk string) error
	Forward(ctx context.Context, socket string) (int, error)
	RemoveForward(ctx context.Context, port int) error
	Reverse(ctx context.Context, port, local int) error
	RemoveReverse(ctx context.Context, port int) error
	Screencap(ctx context.Context) ([]byte, error)
	ScrcpyDevice
}

// ADB drives one device through the adb CLI.
type ADB struct {
	Bin    string
	Serial string
}

func (a ADB) run(ctx context.Context, args ...string) (string, error) {
	out, err := exec.CommandContext(ctx, a.Bin, append([]string{"-s", a.Serial}, args...)...).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("adb %s: %w: %s", strings.Join(args, " "), err, bytes.TrimSpace(out))
	}
	return string(out), nil
}

func (a ADB) Shell(ctx context.Context, cmd string) (string, error) {
	return a.run(ctx, "shell", cmd)
}

func (a ADB) Screencap(ctx context.Context) ([]byte, error) {
	var stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, a.Bin, "-s", a.Serial, "exec-out", "screencap", "-p")
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("adb screencap: %w: %s", err, bytes.TrimSpace(stderr.Bytes()))
	}
	return out, nil
}

// ExecOut runs cmd on the device with its raw stdout copied to w.
func (a ADB) ExecOut(ctx context.Context, cmd string, w io.Writer) error {
	var stderr bytes.Buffer
	c := exec.CommandContext(ctx, a.Bin, "-s", a.Serial, "exec-out", cmd)
	c.Stdout, c.Stderr = w, &stderr
	c.WaitDelay = 5 * time.Second
	if err := c.Run(); err != nil {
		return fmt.Errorf("adb exec-out: %w: %s", err, bytes.TrimSpace(stderr.Bytes()))
	}
	return nil
}

// ExecIn runs cmd on the device with r as its stdin.
func (a ADB) ExecIn(ctx context.Context, cmd string, r io.Reader) error {
	var out bytes.Buffer
	c := exec.CommandContext(ctx, a.Bin, "-s", a.Serial, "exec-in", cmd)
	c.Stdin, c.Stdout, c.Stderr = r, &out, &out
	c.WaitDelay = 5 * time.Second
	if err := c.Run(); err != nil {
		return fmt.Errorf("adb exec-in: %w: %s", err, bytes.TrimSpace(out.Bytes()))
	}
	return nil
}

// Emu sends a command to the emulator console.
func (a ADB) Emu(ctx context.Context, cmd string) (string, error) {
	out, err := a.run(ctx, append([]string{"emu"}, strings.Fields(cmd)...)...)
	if err == nil && strings.HasPrefix(strings.TrimSpace(out), "KO") {
		err = fmt.Errorf("adb emu %s: %s", cmd, strings.TrimSpace(out))
	}
	return out, err
}

func (a ADB) Install(ctx context.Context, apk string) error {
	_, err := a.run(ctx, "install", "-r", "-d", "-g", apk)
	return err
}

func (a ADB) Push(ctx context.Context, local, remote string) error {
	_, err := a.run(ctx, "push", local, remote)
	return err
}

func (a ADB) Forward(ctx context.Context, socket string) (int, error) {
	return a.ForwardTo(ctx, "localabstract:"+socket)
}

// Run runs a long-lived shell command until it exits or ctx ends; closing
// the adb connection hangs the remote process up.
func (a ADB) Run(ctx context.Context, cmd string) error {
	var out bytes.Buffer
	c := exec.CommandContext(ctx, a.Bin, "-s", a.Serial, "shell", cmd)
	c.Stdout, c.Stderr = &out, &out
	c.WaitDelay = 5 * time.Second
	if err := c.Run(); err != nil && ctx.Err() == nil {
		return fmt.Errorf("%w: %s", err, bytes.TrimSpace(out.Bytes()))
	}
	return nil
}

func (a ADB) ForwardTo(ctx context.Context, remote string) (int, error) {
	out, err := a.run(ctx, "forward", "tcp:0", remote)
	if err != nil {
		return 0, err
	}
	port, err := strconv.Atoi(strings.TrimSpace(out))
	if err != nil {
		return 0, fmt.Errorf("adb forward: unexpected output %q", out)
	}
	return port, nil
}

func (a ADB) RemoveForward(ctx context.Context, port int) error {
	_, err := a.run(ctx, "forward", "--remove", "tcp:"+strconv.Itoa(port))
	return err
}

// Reverse makes the device's localhost:port reach local on this host.
func (a ADB) Reverse(ctx context.Context, port, local int) error {
	_, err := a.run(ctx, "reverse", "tcp:"+strconv.Itoa(port), "tcp:"+strconv.Itoa(local))
	return err
}

func (a ADB) RemoveReverse(ctx context.Context, port int) error {
	_, err := a.run(ctx, "reverse", "--remove", "tcp:"+strconv.Itoa(port))
	return err
}

// WaitBoot blocks until the device reports sys.boot_completed.
func (a ADB) WaitBoot(ctx context.Context) error {
	if _, err := a.run(ctx, "wait-for-device"); err != nil {
		return err
	}
	for {
		out, err := a.Shell(ctx, "getprop sys.boot_completed")
		if err == nil && strings.TrimSpace(out) == "1" {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

// Root restarts adbd as root and waits until it is back.
func (a ADB) Root(ctx context.Context) error {
	if _, err := a.run(ctx, "root"); err != nil {
		return err
	}
	for {
		_, _ = a.run(ctx, "wait-for-device")
		out, err := a.Shell(ctx, "id -u")
		if err == nil && strings.TrimSpace(out) == "0" {
			return nil
		}
		select {
		case <-ctx.Done():
			return errors.Join(ctx.Err(), err)
		case <-time.After(time.Second):
		}
	}
}
