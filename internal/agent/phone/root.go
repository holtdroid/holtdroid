package phone

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

const fridaRemote = "/data/local/tmp/frida-server"

// rootShell runs cmd as root through Magisk's su. It is the one place the
// agent escalates; a later hardening step replaces it with a privileged
// helper reachable only through the agent (architecture.md, layer 3).
func rootShell(ctx context.Context, adb ADB, cmd string) (string, error) {
	return adb.Shell(ctx, "su -c "+shellQuote(cmd))
}

// shellQuote wraps s in single quotes so su runs it as one command; the
// callers build these strings in code, not from user input.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// prepareRoot pushes frida-server and starts it as root, so the agent's Frida
// instrumenter can reach it. It mirrors the emulator's prepare but escalates
// through su instead of a root adbd.
func (p *Phone) prepareRoot(ctx context.Context) error {
	if p.cfg.FridaServer == "" {
		return errors.New("no frida-server configured")
	}
	if out, err := rootShell(ctx, p.adb, "id -u"); err != nil || strings.TrimSpace(out) != "0" {
		return fmt.Errorf("su did not give root (%q): %w", strings.TrimSpace(out), err)
	}
	if err := p.adb.Push(ctx, p.cfg.FridaServer, fridaRemote); err != nil {
		return fmt.Errorf("push frida-server: %w", err)
	}
	// A frida-server left by an earlier session holds the port and makes a
	// fresh start fail, so stop it first.
	if _, err := rootShell(ctx, p.adb, "pkill -x frida-server 2>/dev/null; true"); err != nil {
		return err
	}
	if _, err := rootShell(ctx, p.adb, "chmod 755 "+fridaRemote+" && "+fridaRemote+" -D </dev/null >/dev/null 2>&1"); err != nil {
		return fmt.Errorf("start frida-server: %w", err)
	}
	for {
		out, err := p.adb.Shell(ctx, "pidof frida-server")
		if err == nil && strings.TrimSpace(out) != "" {
			p.log.Info("frida-server is up")
			break
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("frida-server did not start: %w", ctx.Err())
		case <-time.After(500 * time.Millisecond):
		}
	}
	return nil
}

// hideRoot adds the app under test to the Magisk DenyList so it gets a
// root-free view. It is idempotent and best-effort: it is retried each poll
// because the app is installed only after the session boots.
func (p *Phone) hideRoot(ctx context.Context) {
	if !packageName.MatchString(p.s.Package) {
		return
	}
	if out, err := p.adb.Shell(ctx, "pm path "+p.s.Package+" >/dev/null 2>&1 && echo yes || echo no"); err != nil || strings.TrimSpace(out) != "yes" {
		return
	}
	if _, err := rootShell(ctx, p.adb, denylist("add", p.s.Package)); err != nil && ctx.Err() == nil {
		p.log.Warn("hide root from the app under test", "err", err)
	}
}

// denylist builds the Magisk DenyList command that hides root from the app
// under test: a package on the list gets a clean, root-free view.
func denylist(action, pkg string) string {
	return "magisk --denylist enable >/dev/null 2>&1; magisk --denylist " + action + " " + pkg
}

// CallApps are the dialer and emergency UIs disabled for a rooted session so
// the screen has no way to place a call. Missing packages are skipped.
var CallApps = []string{
	"com.samsung.android.dialer", "com.android.dialer", "com.google.android.dialer",
	"com.samsung.android.emergency", "com.android.emergency", "com.android.phone.EmergencyDialer",
}

// lockdownCalls makes a rooted phone unable to place calls from its screen:
// airplane mode (so the normal radios are down), every dialer and emergency
// UI disabled, and the lock screen off so its emergency button is gone.
// Android never lets emergency calls be blocked outright, so this pairs with
// SIM-less phones out of cellular range and the Frida call hook; see
// architecture.md. Reversed by unlockCalls at cleanup.
func lockdownCalls(ctx context.Context, adb ADB) error {
	// Airplane mode turns off the cellular radio (and wifi); wifi is turned
	// back on because the transparent tunnel needs it as the underlying
	// interface, while cellular stays off for calls.
	cmds := []string{"cmd connectivity airplane-mode enable >/dev/null 2>&1", "svc wifi enable >/dev/null 2>&1"}
	for _, p := range CallApps {
		cmds = append(cmds, "pm disable-user --user 0 "+p+" >/dev/null 2>&1")
	}
	cmds = append(cmds, "locksettings set-disabled true >/dev/null 2>&1", "true")
	_, err := rootShell(ctx, adb, strings.Join(cmds, "; "))
	return err
}

// unlockCalls undoes lockdownCalls.
func unlockCalls(ctx context.Context, adb ADB) string {
	cmds := make([]string, 0, len(CallApps)+2)
	for _, p := range CallApps {
		cmds = append(cmds, "pm enable "+p+" >/dev/null 2>&1")
	}
	cmds = append(cmds, "locksettings set-disabled false >/dev/null 2>&1", "true")
	return "su -c " + shellQuote(strings.Join(cmds, "; "))
}
