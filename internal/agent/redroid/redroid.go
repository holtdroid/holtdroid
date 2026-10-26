// Package redroid prepares a redroid container (Android on the node's
// kernel, next to the agent in the session Pod) once it boots: root adbd,
// frida-server, the simulated Wi-Fi when the image has one, and the routes
// that send apps into the VPN's tun.
package redroid

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strconv"
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
	uid int
}

func New(cfg Config, adb ADB, log *slog.Logger) *Redroid {
	return &Redroid{cfg: cfg, adb: adb, log: log, uid: os.Getuid()}
}

// Run waits for Android, prepares it, calls booted and keeps the routes in
// place until ctx ends. Android itself is the Pod's other container, so a
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
			r.log.Warn("routes", "err", err)
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

// Home leaves only pkg on Launcher3's home screen, below the row its first
// screen keeps for the search bar that holtdroid-redroid's overlay blanks
// (decision #126). Launcher3 doesn't add icons for adb installs.
func Home(pkg string) string {
	return `l=com.android.launcher3; db=/data/data/$l/databases/launcher.db
[ -d /data/data/$l ] || exit 0
for i in $(seq 40); do [ -f $db ] && sqlite3 $db 'select 1 from favorites limit 0' 2>/dev/null && break; [ $i = 40 ] && exit 0; sleep 0.25; done
c=$(cmd package resolve-activity --brief -c android.intent.category.LAUNCHER -a android.intent.action.MAIN ` + pkg + ` | tail -1)
am force-stop $l
sqlite3 $db 'delete from favorites where container in (select _id from favorites where itemType=2); delete from favorites where container in (-100,-101)'
case $c in */*) sqlite3 $db "insert into favorites (_id,title,intent,container,screen,cellX,cellY,spanX,spanY,itemType,profileId,rank,restored,options,modified)
  values ((select coalesce(max(_id),0)+1 from favorites),'','#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;launchFlags=0x10200000;component=$c;end',-100,0,0,1,1,1,0,0,0,0,0,0)";; esac
am start -a android.intent.action.MAIN -c android.intent.category.HOME >/dev/null`
}

// WiFiProp is set by holtdroid-redroid once the image's simulated Wi-Fi is
// up: two mac80211_hwsim radios, the access point and the mobile uplink in a
// router namespace of their own (decision #105).
const WiFiProp = "vendor.holtdroid.wifi"

// joinWiFi turns the simulated Wi-Fi on and saves its open network, which
// Android then rejoins by itself.
const joinWiFi = `[ "$(getprop ` + WiFiProp + `)" = 1 ] || exit 0
svc wifi enable
for i in $(seq 40); do cmd wifi status 2>/dev/null | grep -q "Wifi is enabled" && break; sleep 0.25; done
cmd wifi connect-network HoltdroidWifi open >/dev/null`

// LockScreenOverlay turns off config_disableLockscreenByDefault, which
// redroid builds with, so locking the screen shows a lock screen (Android 12
// and later; Android 11 can't fabricate overlays and fails quietly). Done at
// boot: the configuration change it causes put the screen back to sleep when
// it came with the first lock.
const LockScreenOverlay = `cmd overlay list android | grep -q holtdroid_lock || cmd overlay fabricate --target android --name holtdroid_lock android:bool/config_disableLockscreenByDefault 0x12 0 >/dev/null 2>&1 && cmd overlay enable --user 0 com.android.shell:holtdroid_lock; true`

// GestureNavigation and ButtonNavigation pick Android's system navigation by
// its navbar overlays; defaultNavigation turns gestures on unless one was
// already picked.
const (
	navbarOverlay     = "cmd overlay enable-exclusive --category com.android.internal.systemui.navbar."
	GestureNavigation = navbarOverlay + "gestural"
	ButtonNavigation  = navbarOverlay + "threebutton"
	defaultNavigation = `cmd overlay list | grep -q '\[x\] com.android.internal.systemui.navbar' || ` + GestureNavigation
)

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
		return fmt.Errorf("routes: %w", err)
	}
	if _, err := r.adb.Shell(ctx, joinWiFi); err != nil {
		r.log.Warn("could not join the simulated Wi-Fi", "err", err)
	}
	if c := r.cfg.Cutout; c != "" && c != "none" {
		r.enableCutout(ctx, c)
	}
	if _, err := r.adb.Shell(ctx, defaultNavigation); err != nil {
		r.log.Warn("could not turn on gesture navigation", "err", err)
	}
	if _, err := r.adb.Shell(ctx, LockScreenOverlay); err != nil {
		r.log.Warn("could not allow the lock screen", "err", err)
	}
	if _, err := r.adb.Shell(ctx, allowHomeRotation); err != nil {
		r.log.Warn("could not allow home screen rotation", "err", err)
	}
	if _, err := r.adb.Shell(ctx, "dumpsys battery set level 65 && dumpsys battery unplug && dumpsys battery set status 3 && dumpsys battery set present 1"); err != nil {
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

// enableCutout skips the corner, hole and tall emulations on Android 12,
// where they crash SystemUI's ScreenDecorations in a loop (a null bottomLeft
// rounded corner) and leave the screen black. Android 15's SystemUI keeps the
// status bar height it measured at boot, so it is restarted to fit the cutout.
func (r *Redroid) enableCutout(ctx context.Context, cutout string) {
	out, _ := r.adb.Shell(ctx, "getprop ro.build.version.sdk")
	sdk, _ := strconv.Atoi(strings.TrimSpace(out))
	if sdk == 31 && (cutout == "corner" || cutout == "hole" || cutout == "tall") {
		r.log.Warn("display cutout not emulated on Android 12", "cutout", cutout)
		return
	}
	if _, err := r.adb.Shell(ctx, "cmd overlay enable --user 0 com.android.internal.display.cutout.emulation."+cutout); err != nil {
		r.log.Warn("could not enable the display cutout", "cutout", cutout, "err", err)
		return
	}
	if sdk >= 35 {
		if _, err := r.adb.Shell(ctx, "kill $(pidof com.android.systemui)"); err != nil {
			r.log.Warn("could not restart SystemUI", "err", err)
		}
	}
}

// waitRoute retries route until the sidecar has created its tun: the
// containers start in parallel and Android may boot first.
func (r *Redroid) waitRoute(ctx context.Context) error {
	if !r.cfg.VPN {
		return r.route(ctx)
	}
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
// namespace with the VPN sidecar and the agent.
func (r *Redroid) route(ctx context.Context) error {
	_, err := r.adb.Shell(ctx, Routes(r.cfg, r.uid))
	return err
}

// Routes keeps the Pod's policy routing, which Android's netd owns: it
// flushes rules it doesn't know when it starts, so the script is idempotent
// and re-run.
//
// With a VPN every uid but root goes into the tun, except bypass and the
// tun's own network, where the sing-box system stack answers.
//
// With holtdroid-redroid's router namespace (decision #105) Android doesn't
// see the Pod's eth0: its apps reach the Pod through the simulated Wi-Fi or
// the eth1 uplink and the router, which arrives on wifiup, and netd sends
// every other unmarked socket to Android's default network or nowhere. So
// root (sing-box, adbd's clients) and the agent's uid, which answers the
// api, are pinned to the Pod's own routes.
func Routes(cfg Config, agentUID int) string {
	table := vpn.TunTable
	rule := func(pref int, sel string) string {
		p := strconv.Itoa(pref)
		return "{ ip rule list pref " + p + " | grep -q . || ip rule add " + sel + " pref " + p + "; }"
	}
	agent := ""
	if agentUID != 0 {
		agent = "uidrange " + strconv.Itoa(agentUID) + "-" + strconv.Itoa(agentUID)
	}
	router := []string{
		rule(9002, "uidrange 0-0 fwmark 0x0/0xffff lookup main"),
		rule(9500, "iif wifiup lookup main"),
		rule(9501, "to 10.254.0.0/30 lookup main"),
		"{ ndc ipfwd enable holtdroid >/dev/null || true; }",
	}
	if agent != "" {
		router = append(router, rule(9003, agent+" lookup main"))
	}
	cmds := []string{`r=$([ -e /sys/class/net/wifiup ] && echo 1)`}
	if cfg.VPN {
		cmds = append(cmds,
			"ip link show "+vpn.TunInterface+" >/dev/null",
			"ip route replace default dev "+vpn.TunInterface+" table "+table,
			"ip route replace unreachable default metric 1000 table "+table,
		)
		for _, cidr := range cfg.Bypass {
			if strings.Contains(cidr, ":") {
				continue
			}
			cmds = append(cmds, "ip route replace throw "+cidr+" table "+table)
		}
		cmds = append(cmds, rule(8999, "to "+vpn.TunNetwork+" lookup "+table))
		viaWiFi := []string{rule(9000, "iif wifiup lookup "+table)}
		if agent != "" {
			viaWiFi = append(viaWiFi, rule(9001, agent+" lookup "+table))
		}
		cmds = append(cmds, `if [ "$r" = 1 ]; then `+strings.Join(viaWiFi, " && ")+
			"; else "+rule(9000, "not uidrange 0-0 lookup "+table)+"; fi")
	}
	cmds = append(cmds, `{ [ "$r" != 1 ] || { `+strings.Join(router, " && ")+"; }; }")
	return strings.Join(cmds, " && ")
}
