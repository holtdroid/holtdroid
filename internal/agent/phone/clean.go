package phone

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
)

// Baseline is the phone as it was when the provider first saw it free: the
// packages of user 0 and every global, secure and system setting.
type Baseline struct {
	Packages   []string                     `json:"packages"`
	Settings   map[string]map[string]string `json:"settings"`
	CapturedAt time.Time                    `json:"capturedAt"`
}

var namespaces = []string{"global", "secure", "system"}

// Capture records the phone's baseline.
func Capture(ctx context.Context, adb ADB) (*Baseline, error) {
	pkgs, err := packages(ctx, adb)
	if err != nil {
		return nil, err
	}
	b := &Baseline{Packages: pkgs, Settings: map[string]map[string]string{}, CapturedAt: time.Now().UTC()}
	for _, ns := range namespaces {
		if b.Settings[ns], err = settings(ctx, adb, ns); err != nil {
			return nil, err
		}
	}
	return b, nil
}

func packages(ctx context.Context, adb ADB) ([]string, error) {
	out, err := adb.Shell(ctx, "pm list packages --user 0")
	if err != nil {
		return nil, err
	}
	var pkgs []string
	for line := range strings.SplitSeq(out, "\n") {
		if p, ok := strings.CutPrefix(strings.TrimSpace(line), "package:"); ok && packageName.MatchString(p) {
			pkgs = append(pkgs, p)
		}
	}
	if len(pkgs) == 0 {
		return nil, errors.New("pm listed no packages")
	}
	slices.Sort(pkgs)
	return pkgs, nil
}

func settings(ctx context.Context, adb ADB, ns string) (map[string]string, error) {
	out, err := adb.Shell(ctx, "settings list "+ns)
	if err != nil {
		return nil, err
	}
	return parseSettings(out), nil
}

func parseSettings(out string) map[string]string {
	m := map[string]string{}
	for line := range strings.SplitSeq(out, "\n") {
		if k, v, ok := strings.Cut(strings.TrimRight(line, "\r"), "="); ok && settingKey.MatchString(k) {
			m[k] = v
		}
	}
	return m
}

var settingKey = regexp.MustCompile(`^[A-Za-z0-9_.:-]+$`)

// volatileSetting matches settings the system keeps changing by itself, or
// that the cleanup sets on its own; they are never put back.
var volatileSetting = regexp.MustCompile(`(?i)(^phenotype|^_boot|boot_count|_count$|_time_millis$|timestamp|_date$|^android_id$|last_.*(time|report)|^config_update|_version|^gms_|` +
	`^low_power|^screen_brightness|^stay_on_while_plugged_in$|^wifi_on$|^mobile_data|^bluetooth_on$|^location_mode$|^adb_enabled$)`)

// Cleanup is what Clean puts back.
type Cleanup struct {
	Package  string
	Baseline *Baseline
	Offline  bool
	End      bool
	Suspend  []string
}

// keep are never uninstalled or cleared.
var keep = []string{TunnelPackage, "com.android.settings", "com.android.shell"}

// Clean undoes a session: it stops the tunnel, uninstalls what wasn't on the
// phone, puts back missing baseline packages, clears the data of every app
// on the launcher, closes apps, wipes shared storage, restores the baseline
// settings and turns the radios off. With End the phone is left in battery
// saver at the lowest brightness with the screen off; otherwise it is
// woken for a session. Every step is best effort; the error lists what failed.
func Clean(ctx context.Context, adb ADB, c Cleanup) error {
	var errs []error
	run := func(what, cmd string) {
		if _, err := adb.Shell(ctx, cmd); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", what, err))
		}
	}
	run("stop", stopTunnel+"; am kill-all")

	home := homePackage(ctx, adb)
	now, err := packages(ctx, adb)
	if err != nil {
		errs = append(errs, err)
	}
	var cmds []string
	if c.Baseline != nil && now != nil {
		for _, p := range now {
			if !slices.Contains(c.Baseline.Packages, p) && !slices.Contains(keep, p) {
				cmds = append(cmds, "pm uninstall "+p+" >/dev/null 2>&1")
			}
		}
		for _, p := range c.Baseline.Packages {
			if !slices.Contains(now, p) {
				cmds = append(cmds, "cmd package install-existing --user 0 "+p+" >/dev/null 2>&1")
			}
		}
	}
	if c.Baseline == nil && packageName.MatchString(c.Package) {
		cmds = append(cmds, "pm uninstall "+c.Package+" >/dev/null 2>&1")
	}
	for _, p := range launcherPackages(ctx, adb) {
		if p != home && !slices.Contains(keep, p) {
			cmds = append(cmds, "am force-stop "+p+"; pm clear --user 0 "+p+" >/dev/null 2>&1")
		}
	}
	for _, p := range recentPackages(ctx, adb) {
		if p != home && !slices.Contains(keep, p) {
			cmds = append(cmds, "am force-stop "+p)
		}
	}
	if len(cmds) > 0 {
		run("apps", strings.Join(cmds, "\n")+"\ntrue")
	}
	if s := suspendScript(c); s != "" {
		run("suspend", s)
	}
	run("storage", wipeStorage)
	run("device", resetDevice)
	run("privacy", privacy)
	if c.Baseline != nil {
		if script := restoreScript(ctx, adb, c.Baseline); script != "" {
			run("settings", script)
		}
	}
	if c.Offline {
		run("radios", offlineRadios(ctx, adb))
	} else {
		run("radios", "svc wifi enable; svc data enable; true")
	}
	if o := owner(ctx, adb); o.DeviceOwner {
		if err := ownerActions(ctx, adb, o); err != nil {
			errs = append(errs, err)
		}
	}
	if c.End {
		run("park", park)
	} else {
		run("wake", "cmd power set-mode 0; svc power stayon usb; "+brightness(c.Baseline)+"; true")
	}
	return errors.Join(append(errs, adb.RemoveAll(ctx))...)
}

const sharedDirs = "Alarms Audiobooks DCIM Documents Download Movies Music Notifications Pictures Podcasts Recordings Ringtones"

// wipeStorage empties shared storage but keeps Android/ and the standard
// directories, which Android doesn't create again by itself.
const wipeStorage = `cd /sdcard && for f in * .[!.]*; do
  [ -e "$f" ] && [ "$f" != Android ] || continue
  case " ` + sharedDirs + ` " in
    *" $f "*) rm -rf "$f"/* "$f"/.[!.]* ;;
    *) rm -rf "$f" ;;
  esac
done
mkdir -p ` + sharedDirs + `
rm -rf /data/local/tmp/holtdroid-*; true`

// resetDevice undoes the portal's device settings; the baseline restore then
// puts back what the phone had.
// http_proxy :0 clears a global proxy; deleting the setting alone leaves it
// applied.
const resetDevice = `dumpsys battery reset; wm density reset; wm size reset; cmd connectivity airplane-mode disable
settings put global http_proxy :0
settings put system font_scale 1.0; settings put system accelerometer_rotation 1
settings put global auto_time 1; settings put global auto_time_zone 1
cmd bluetooth_manager disable >/dev/null 2>&1; svc nfc disable >/dev/null 2>&1; cmd location set-location-enabled false >/dev/null 2>&1
input keyevent KEYCODE_HOME; true`

// park leaves a phone between sessions: battery saver, lowest brightness,
// every stream muted (alarms can't go below 1), screen off.
const park = `cmd power set-mode 1; settings put system screen_brightness_mode 0; settings put system screen_brightness 1
for s in 1 2 3 5; do cmd media_session volume --stream $s --set 0 >/dev/null 2>&1; done
cmd media_session volume --stream 4 --set 1 >/dev/null 2>&1
svc power stayon false; input keyevent KEYCODE_SLEEP; true`

// privacy blocks the microphone, and the camera where the phone has that
// toggle, so apps get silence and a blank picture. Without a device owner
// a user can lift it from the system's prompt, so sessions put it back on
// every poll.
const privacy = "cmd sensor_privacy enable 0 microphone >/dev/null 2>&1; cmd sensor_privacy enable 0 camera >/dev/null 2>&1; true"

func brightness(b *Baseline) string {
	if b == nil {
		return "settings put system screen_brightness_mode 1"
	}
	cmds := []string{}
	for _, k := range []string{"screen_brightness", "screen_brightness_mode"} {
		if v, ok := b.Settings["system"][k]; ok {
			cmds = append(cmds, "settings put system "+k+" "+quote(v))
		}
	}
	return strings.Join(cmds, "; ")
}

func offlineRadios(ctx context.Context, adb ADB) string {
	cmds := []string{"svc data disable"}
	out, _ := adb.Shell(ctx, "cmd wifi list-networks")
	for _, id := range wifiNetworks(out) {
		cmds = append(cmds, "cmd wifi forget-network "+id)
	}
	cmds = append(cmds, "cmd wifi set-wifi-enabled disabled", "true")
	return strings.Join(cmds, "; ")
}

var wifiNetworkLine = regexp.MustCompile(`^\s*(\d+)\s`)

func wifiNetworks(out string) []string {
	var ids []string
	for line := range strings.SplitSeq(out, "\n") {
		if m := wifiNetworkLine.FindStringSubmatch(line); m != nil {
			ids = append(ids, m[1])
		}
	}
	return ids
}

// restoreScript puts back every baseline setting whose value changed and
// deletes the ones added since (an http_proxy, say).
func restoreScript(ctx context.Context, adb ADB, b *Baseline) string {
	var cmds []string
	for _, ns := range namespaces {
		cur, err := settings(ctx, adb, ns)
		if err != nil {
			continue
		}
		keys := make([]string, 0, len(b.Settings[ns]))
		for k := range b.Settings[ns] {
			keys = append(keys, k)
		}
		slices.Sort(keys)
		for _, k := range keys {
			v := b.Settings[ns][k]
			if cur[k] == v || volatileSetting.MatchString(k) {
				continue
			}
			if v == "null" {
				cmds = append(cmds, "settings delete "+ns+" "+k+" >/dev/null")
			} else {
				cmds = append(cmds, "settings put "+ns+" "+k+" "+quote(v))
			}
		}
		added := make([]string, 0)
		for k, v := range cur {
			if _, ok := b.Settings[ns][k]; !ok && v != "null" && !volatileSetting.MatchString(k) {
				added = append(added, k)
			}
		}
		slices.Sort(added)
		for _, k := range added {
			cmds = append(cmds, "settings delete "+ns+" "+k+" >/dev/null")
		}
	}
	if len(cmds) == 0 {
		return ""
	}
	return strings.Join(cmds, "\n") + "\ntrue"
}

// suspendScript keeps the risky apps suspended, except the one under test.
func suspendScript(c Cleanup) string {
	var cmds []string
	for _, p := range c.Suspend {
		if p != c.Package && packageName.MatchString(p) {
			cmds = append(cmds, "pm suspend --user 0 "+p+" >/dev/null 2>&1")
		}
	}
	if len(cmds) == 0 {
		return ""
	}
	return strings.Join(cmds, "\n") + "\ntrue"
}

func quote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

func homePackage(ctx context.Context, adb ADB) string {
	out, _ := adb.Shell(ctx, "cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME | tail -1")
	p, _, _ := strings.Cut(strings.TrimSpace(out), "/")
	return p
}

func launcherPackages(ctx context.Context, adb ADB) []string {
	out, _ := adb.Shell(ctx, "cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER")
	return componentPackages(out)
}

var recentTask = regexp.MustCompile(`[ IA]=(?:\d+:)?([A-Za-z][A-Za-z0-9_.]*)/`)

func recentPackages(ctx context.Context, adb ADB) []string {
	out, _ := adb.Shell(ctx, "dumpsys activity recents")
	var pkgs []string
	for _, m := range recentTask.FindAllStringSubmatch(out, -1) {
		if packageName.MatchString(m[1]) && !slices.Contains(pkgs, m[1]) {
			pkgs = append(pkgs, m[1])
		}
	}
	return pkgs
}

func componentPackages(out string) []string {
	var pkgs []string
	for line := range strings.SplitSeq(out, "\n") {
		p, _, ok := strings.Cut(strings.TrimSpace(line), "/")
		if ok && packageName.MatchString(p) && !slices.Contains(pkgs, p) {
			pkgs = append(pkgs, p)
		}
	}
	return pkgs
}
