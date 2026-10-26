// Package redroid prepares a redroid container (Android on the node's
// kernel, next to the agent in the session Pod) once it boots: root adbd,
// frida-server and, with a VPN, the routes that send apps into its tun.
package redroid

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/holtdroid/holtdroid/internal/vpn"
)

type Config struct {
	FridaServer string
	BootTimeout time.Duration
	Poll        time.Duration
	// VPN routes every app's traffic into the VPN sidecar's tun; Bypass are
	// the destinations that stay on the Pod network.
	VPN    bool
	Bypass []string
	// TunTimeout is how long to wait for the VPN sidecar's tun after boot.
	TunTimeout time.Duration
	// Cutout is the display cutout to emulate: one of Android's
	// DisplayCutoutEmulation overlays (corner, double, hole, tall, waterfall).
	Cutout string
}

func DefaultConfig() Config {
	return Config{
		FridaServer: "/opt/holtdroid/frida-server",
		BootTimeout: 3 * time.Minute,
		Poll:        10 * time.Second,
		TunTimeout:  time.Minute,
		Bypass:      []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"},
	}
}

// ADB is what preparing the device needs from adb.
type ADB interface {
	WaitBoot(ctx context.Context) error
	Root(ctx context.Context) error
	Push(ctx context.Context, local, remote string) error
	Shell(ctx context.Context, cmd string) (string, error)
}

type Redroid struct {
	cfg Config
	adb ADB
	log *slog.Logger
}

func New(cfg Config, adb ADB, log *slog.Logger) *Redroid {
	return &Redroid{cfg: cfg, adb: adb, log: log}
}

// Run waits for Android, prepares it, calls booted and keeps the VPN routes
// in place until ctx ends. Android itself is the Pod's other container, so a
// crash there ends the Pod rather than this loop.
func (r *Redroid) Run(ctx context.Context, booted func()) error {
	bootCtx, cancel := context.WithTimeout(ctx, r.cfg.BootTimeout)
	err := r.prepare(bootCtx)
	cancel()
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return err
	}
	booted()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(r.cfg.Poll):
		}
		if err := r.route(ctx); err != nil && ctx.Err() == nil {
			r.log.Warn("vpn routes", "err", err)
		}
	}
}

const allowHomeRotation = `for p in com.google.android.apps.nexuslauncher com.android.launcher3; do
  [ -d /data/data/$p ] || continue
  d=/data/data/$p/shared_prefs; f=$d/com.android.launcher3.prefs.xml
  grep -q pref_allowRotation $f 2>/dev/null && continue
  am force-stop $p
  if [ -f $f ]; then
    sed -i -e 's|<map />|<map></map>|' -e 's|<map>|<map><boolean name="pref_allowRotation" value="true" />|' $f
  else
    mkdir -p $d
    echo '<?xml version="1.0" encoding="utf-8" standalone="yes" ?><map><boolean name="pref_allowRotation" value="true" /></map>' >$f
    u=$(stat -c %u /data/data/$p); chown -R $u:$u $d; restorecon -R $d
  fi
done
am start -a android.intent.action.MAIN -c android.intent.category.HOME >/dev/null`

const fridaRemote = "/data/local/tmp/frida-server"

func (r *Redroid) prepare(ctx context.Context) error {
	r.log.Info("waiting for Android to boot")
	if err := r.adb.WaitBoot(ctx); err != nil {
		return fmt.Errorf("boot: %w", err)
	}
	r.log.Info("android booted")
	if err := r.adb.Root(ctx); err != nil {
		return fmt.Errorf("adb root: %w", err)
	}
	if err := r.waitRoute(ctx); err != nil {
		return fmt.Errorf("vpn routes: %w", err)
	}
	if c := r.cfg.Cutout; c != "" && c != "none" {
		if _, err := r.adb.Shell(ctx, "cmd overlay enable --user 0 com.android.internal.display.cutout.emulation."+c); err != nil {
			r.log.Warn("could not enable the display cutout", "cutout", c, "err", err)
		}
	}
	if _, err := r.adb.Shell(ctx, allowHomeRotation); err != nil {
		r.log.Warn("could not allow home screen rotation", "err", err)
	}
	if _, err := r.adb.Shell(ctx, "dumpsys battery set present 1 && dumpsys battery unplug && dumpsys battery set status 3 && dumpsys battery set level 65"); err != nil {
		r.log.Warn("could not set the battery", "err", err)
	}
	if err := r.adb.Push(ctx, r.cfg.FridaServer, fridaRemote); err != nil {
		return err
	}
	if _, err := r.adb.Shell(ctx, "pkill -x frida-server; chmod 755 "+fridaRemote+" && "+fridaRemote+" -D </dev/null >/dev/null 2>&1"); err != nil {
		return fmt.Errorf("start frida-server: %w", err)
	}
	for {
		out, err := r.adb.Shell(ctx, "pidof frida-server")
		if err == nil && strings.TrimSpace(out) != "" {
			r.log.Info("device is ready")
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("frida-server did not start: %w", ctx.Err())
		case <-time.After(500 * time.Millisecond):
		}
	}
}

// waitRoute retries route until the sidecar has created its tun: the
// containers start in parallel and Android may boot first.
func (r *Redroid) waitRoute(ctx context.Context) error {
	deadline := time.Now().Add(r.cfg.TunTimeout)
	for {
		err := r.route(ctx)
		if err == nil {
			return nil
		}
		if !time.Now().Before(deadline) {
			return fmt.Errorf("tun %s not ready after %s: %w", vpn.TunInterface, r.cfg.TunTimeout, err)
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("tun %s not ready: %w", vpn.TunInterface, err)
		case <-time.After(500 * time.Millisecond):
		}
	}
}

// route runs Routes as root inside Android, which shares the Pod's network
// namespace with the VPN sidecar.
func (r *Redroid) route(ctx context.Context) error {
	if !r.cfg.VPN {
		return nil
	}
	_, err := r.adb.Shell(ctx, Routes(r.cfg.Bypass))
	return err
}

// Routes sends every uid but root into the VPN tun, except bypass and the
// tun's own network, where the sing-box system stack answers. Android's netd
// owns the policy routing and flushes rules it doesn't know when it starts,
// so sing-box can't route by itself; the script is idempotent and re-run.
func Routes(bypass []string) string {
	table := vpn.TunTable
	cmds := []string{
		"ip link show " + vpn.TunInterface + " >/dev/null",
		"ip route replace default dev " + vpn.TunInterface + " table " + table,
		"ip route replace unreachable default metric 1000 table " + table,
	}
	for _, cidr := range bypass {
		if strings.Contains(cidr, ":") {
			continue
		}
		cmds = append(cmds, "ip route replace throw "+cidr+" table "+table)
	}
	cmds = append(cmds,
		"{ ip rule list pref 8999 | grep -q . || ip rule add to "+vpn.TunNetwork+" lookup "+table+" pref 8999; }",
		"{ ip rule list pref 9000 | grep -q . || ip rule add not uidrange 0-0 lookup "+table+" pref 9000; }",
	)
	return strings.Join(cmds, " && ")
}
