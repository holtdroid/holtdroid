package phone

import (
	"context"
	"slices"
	"strings"
	"testing"
)

type cleanADB struct {
	fakeADB
	packages string
	settings map[string]string
}

func (f *cleanADB) Shell(ctx context.Context, cmd string) (string, error) {
	_, _ = f.fakeADB.Shell(ctx, cmd)
	switch {
	case strings.HasPrefix(cmd, "pm list packages"):
		return f.packages, nil
	case strings.HasPrefix(cmd, "settings list "):
		return f.settings[strings.TrimPrefix(cmd, "settings list ")], nil
	case strings.HasPrefix(cmd, "cmd package resolve-activity"):
		return "priority=0 preferredOrder=0\ncom.sec.android.app.launcher/.activities.LauncherActivity\n", nil
	case strings.HasPrefix(cmd, "cmd package query-activities"):
		return "com.sec.android.app.sbrowser/.SBrowserMainActivity\ncom.android.settings/.Settings\ncom.example.shop/.Main\n", nil
	case cmd == "dumpsys activity recents":
		return "  * Recent #0: Task{38eef28 #73 type=home I=com.sec.android.app.launcher/.activities.LauncherActivity}\n" +
			"  * Recent #1: Task{71bb68e #5 type=standard A=10123:com.example.shop}\n" +
			"  * Recent #2: Task{1 #6 type=standard I=com.android.vending/.AssetBrowserActivity}\n", nil
	case cmd == "cmd wifi list-networks":
		return "Network Id      SSID                         Security type\n0            Guest        wpa3-sae\n4            Office       wpa2-psk\n", nil
	}
	return "", nil
}

func TestCapture(t *testing.T) {
	adb := &cleanADB{
		packages: "package:com.android.settings\npackage:io.github.kriakiku.holtdroid.tunnel\npackage:com.sec.android.app.sbrowser\n",
		settings: map[string]string{"global": "adb_enabled=1\nhttp_proxy=null\n", "secure": "x=a=b\n", "system": "font_scale=1.0\n"},
	}
	b, err := Capture(context.Background(), adb)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(b.Packages, []string{"com.android.settings", "com.sec.android.app.sbrowser", TunnelPackage}) {
		t.Fatalf("packages %v", b.Packages)
	}
	if b.Settings["secure"]["x"] != "a=b" || b.Settings["global"]["http_proxy"] != "null" {
		t.Fatalf("settings %v", b.Settings)
	}
}

func TestClean(t *testing.T) {
	base := &Baseline{
		Packages: []string{"com.android.settings", "com.android.vending", "com.sec.android.app.launcher", "com.sec.android.app.sbrowser"},
		Settings: map[string]map[string]string{
			"global": {"http_proxy": "null", "boot_count": "3", "development_settings_enabled": "1"},
			"system": {"font_scale": "1.0", "screen_brightness": "128", "screen_brightness_mode": "1", "ringtone": "it's"},
			"secure": {},
		},
	}
	adb := &cleanADB{
		packages: "package:com.android.settings\npackage:com.sec.android.app.launcher\npackage:com.sec.android.app.sbrowser\npackage:com.example.shop\npackage:" + TunnelPackage + "\n",
		settings: map[string]string{
			"global": "http_proxy=10.0.0.1:8080\nboot_count=4\ndevelopment_settings_enabled=1\nnew_key=1\n",
			"system": "font_scale=1.3\nscreen_brightness=1\nscreen_brightness_mode=0\nringtone=x\n",
		},
	}
	if err := Clean(context.Background(), adb, Cleanup{Package: "com.example.shop", Baseline: base, Offline: true, End: true}); err != nil {
		t.Fatal(err)
	}
	calls := strings.Join(adb.calls, "\n")
	for _, want := range []string{
		"pm uninstall com.example.shop",
		"cmd package install-existing --user 0 com.android.vending",
		"pm clear --user 0 com.sec.android.app.sbrowser",
		"am force-stop com.android.vending",
		"settings delete global http_proxy",
		"settings delete global new_key",
		"mkdir -p Alarms Audiobooks DCIM",
		"settings put system font_scale '1.0'",
		`settings put system ringtone 'it'\''s'`,
		"cmd wifi forget-network 0; cmd wifi forget-network 4",
		"cmd wifi set-wifi-enabled disabled",
		"cmd power set-mode 1",
		"cmd sensor_privacy enable 0 microphone",
		"cmd media_session volume --stream $s --set 0",
		"cmd media_session volume --stream 4 --set 1",
		"input keyevent KEYCODE_SLEEP",
		"remove-all",
	} {
		if !strings.Contains(calls, want) {
			t.Errorf("missing %q", want)
		}
	}
	for _, unwanted := range []string{
		"pm uninstall " + TunnelPackage,
		"pm clear --user 0 com.android.settings",
		"pm clear --user 0 com.sec.android.app.launcher",
		"boot_count",
		"settings put system screen_brightness '128'",
	} {
		if strings.Contains(calls, unwanted) {
			t.Errorf("unexpected %q in\n%s", unwanted, calls)
		}
	}
}

func TestCleanForASession(t *testing.T) {
	base := &Baseline{Packages: []string{"com.android.settings"}, Settings: map[string]map[string]string{"system": {"screen_brightness": "128", "screen_brightness_mode": "1"}}}
	adb := &cleanADB{packages: "package:com.android.settings\n", settings: map[string]string{}}
	if err := Clean(context.Background(), adb, Cleanup{Package: "com.example.shop", Baseline: base}); err != nil {
		t.Fatal(err)
	}
	calls := strings.Join(adb.calls, "\n")
	if !strings.Contains(calls, "cmd power set-mode 0") || !strings.Contains(calls, "settings put system screen_brightness '128'") ||
		!strings.Contains(calls, "svc wifi enable") || strings.Contains(calls, "KEYCODE_SLEEP") {
		t.Fatalf("calls:\n%s", calls)
	}
}
