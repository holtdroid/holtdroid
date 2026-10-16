package agent

import (
	"bytes"
	"context"
	"errors"
	"fmt"
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

func (a ADB) Install(ctx context.Context, apk string) error {
	_, err := a.run(ctx, "install", "-r", "-g", apk)
	return err
}

func (a ADB) Push(ctx context.Context, local, remote string) error {
	_, err := a.run(ctx, "push", local, remote)
	return err
}

func (a ADB) Forward(ctx context.Context, socket string) (int, error) {
	out, err := a.run(ctx, "forward", "tcp:0", "localabstract:"+socket)
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
