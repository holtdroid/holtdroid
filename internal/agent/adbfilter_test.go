package agent

import (
	"net"
	"slices"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/adbproto"
)

func TestRefusedService(t *testing.T) {
	for service, refused := range map[string]bool{
		"shell:ls":          false,
		"shell,v2,pty:":     false,
		"exec:logcat -B":    false,
		"sync:":             false,
		"root:":             false,
		"reverse:forward:x": false,
		"reboot:":           true,
		"reboot:bootloader": true,
		"unroot:":           true,
		"remount:":          true,
		"tcpip:5555":        true,
		"usb:":              true,
		"sideload-host:1:2": true,
		"disable-verity:":   true,
	} {
		if got := refusedService(service); got != refused {
			t.Errorf("%q: refused %v, want %v", service, got, refused)
		}
	}
}

func TestFilterADB(t *testing.T) {
	client, clientEnd := net.Pipe()
	device, deviceEnd := net.Pipe()
	done := make(chan struct{})
	go func() {
		filterADB(clientEnd, deviceEnd, ShellFull)
		close(done)
	}()
	_ = client.SetDeadline(time.Now().Add(5 * time.Second))
	_ = device.SetDeadline(time.Now().Add(5 * time.Second))

	go func() {
		_ = adbproto.Write(client, adbproto.Packet{Command: adbproto.OPEN, Arg0: 3, Payload: []byte("reboot:\x00")}, 0)
	}()
	p, err := adbproto.Read(client)
	if err != nil || p.Command != adbproto.CLSE || p.Arg0 != 0 || p.Arg1 != 3 {
		t.Fatalf("refused open answered with %+v, %v", p, err)
	}

	go func() {
		_ = adbproto.Write(client, adbproto.Packet{Command: adbproto.OPEN, Arg0: 4, Payload: []byte("shell:id\x00")}, 0)
	}()
	p, err = adbproto.Read(device)
	if err != nil || p.Command != adbproto.OPEN || p.Service() != "shell:id" {
		t.Fatalf("device got %+v, %v", p, err)
	}

	go func() { _ = adbproto.Write(device, adbproto.Packet{Command: adbproto.OKAY, Arg0: 9, Arg1: 4}, 0) }()
	p, err = adbproto.Read(client)
	if err != nil || p.Command != adbproto.OKAY || p.Arg0 != 9 {
		t.Fatalf("client got %+v, %v", p, err)
	}

	_, _ = client.Write([]byte("not an adb packet at all"))
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("garbage did not end the connection")
	}
}

func TestShellPolicy(t *testing.T) {
	for _, tc := range []struct {
		service                 string
		full, allowlist, denied bool
	}{
		{"sync:", true, true, true},
		{"jdwp:1234", true, true, true},
		{"track-jdwp", true, true, true},
		{"tcp:8080", true, true, true},
		{"localabstract:webview_devtools_remote_42", true, true, true},
		{"framebuffer:", true, true, true},
		{"shell:", true, false, false},
		{"shell,v2,pty:", true, false, false},
		{"shell:ls /sdcard", true, false, false},
		{"exec:getprop ro.product.model", true, true, false},
		{"exec:dumpsys package 'com.example.shop'", true, true, false},
		{"exec:dumpsys deviceidle get deep", true, true, false},
		{"exec:dumpsys webviewupdate", true, true, false},
		{"exec:dumpsys battery unplug", true, false, false},
		{"exec:dumpsys deviceidle force-idle", true, false, false},
		{"exec:dumpsys battery unplug; dumpsys deviceidle force-idle", true, false, false},
		{"abb_exec:settings\x00get\x00global\x00sysui_tuner_demo_on", true, true, false},
		{"abb_exec:settings\x00put\x00global\x00adb_enabled\x000", true, false, false},
		{"exec:settings put global http_proxy 1.2.3.4:8080", true, false, false},
		{"exec:settings get global http_proxy", true, true, false},
		{"shell,v2,raw:getprop", true, true, false},
		{"shell:/system/bin/getprop", true, true, false},
		{"shell:logcat -B -b main,system,crash -T 2000", true, true, false},
		{"shell:logcat '*:S' chromium:V", true, true, false},
		{"shell:pm list packages -U 'com.example.shop'", true, true, false},
		{"shell:am start -a android.intent.action.VIEW -d 'https://example.com/?a=1&b=2'", true, true, false},
		{`shell:am start -d 'it'\''s'`, true, true, false},
		{`shell:am start -d "plain"`, true, true, false},
		{"exec:cmd package install -S 1024", true, true, false},
		{"exec:cmd package install-create -r", true, true, false},
		{"shell:pm install /data/local/tmp/app.apk", true, true, false},
		{"abb_exec:package\x00install-write\x00-S\x0010\x00123\x00base.apk\x00-", true, true, false},
		{"abb_exec:package\x00list\x00packages", true, true, false},
		{"abb_exec:package\x00uninstall\x00com.android.systemui", true, false, false},
		{"abb_exec:settings\x00put\x00global\x00adb_enabled\x000", true, false, false},
		{"shell:pm uninstall --user 0 com.android.systemui", true, false, false},
		{"shell:cmd package uninstall com.x", true, false, false},
		{"shell:settings put global adb_enabled 0", true, false, false},
		{"shell:getprop; reboot", true, false, false},
		{"shell:getprop && svc usb setFunctions", true, false, false},
		{"shell:getprop | sh", true, false, false},
		{"shell:getprop $(reboot)", true, false, false},
		{"shell:getprop `reboot`", true, false, false},
		{`shell:getprop "$(reboot)"`, true, false, false},
		{"shell:getprop > /sdcard/x", true, false, false},
		{"shell:getprop\nreboot", true, false, false},
		{"shell:logcat 'unterminated", true, false, false},
		{"shell:sh -c getprop", true, false, false},
		{"shell:su", true, false, false},
		{"dev:/dev/null", true, false, false},
		{"root:", false, false, false},
		{"unroot:", false, false, false},
		{"reboot:", false, false, false},
		{"reboot:bootloader", false, false, false},
		{"reboot:recovery", false, false, false},
		{"reboot:sideload", false, false, false},
		{"remount:", false, false, false},
		{"tcpip:5555", false, false, false},
		{"usb:", false, false, false},
		{"disable-verity:", false, false, false},
		{"enable-verity:", false, false, false},
		{"reverse:forward:tcp:8080;tcp:8080", false, false, false},
		{"reverse:list-forward", false, false, false},
		{"tcp:27042", false, false, false},
		{"tcp:127.0.0.1:27042", false, false, false},
		{"tcp:27043", false, false, false},
	} {
		for policy, want := range map[ShellPolicy]bool{ShellFull: tc.full, ShellAllowlist: tc.allowlist, ShellOff: tc.denied} {
			if got := policy.allows(tc.service); got != want {
				t.Errorf("%s %q: allowed %v, want %v", policy, tc.service, got, want)
			}
			direct := want
			if policy == ShellFull {
				direct = !refusedService(tc.service)
			}
			if got := policy.allowsDirect(tc.service); got != direct {
				t.Errorf("%s direct %q: allowed %v, want %v", policy, tc.service, got, direct)
			}
		}
	}
}

func TestSplitWords(t *testing.T) {
	for in, want := range map[string][]string{
		"  logcat   -v  time ":  {"logcat", "-v", "time"},
		`am start -d 'a b'`:     {"am", "start", "-d", "a b"},
		`am start -d 'it'\''s'`: {"am", "start", "-d", "it's"},
		`getprop "ro.x"''`:      {"getprop", "ro.x"},
		`getprop a\ b`:          {"getprop", "a b"},
		"":                      nil,
	} {
		got, ok := splitWords(in)
		if !ok || !slices.Equal(got, want) {
			t.Errorf("%q: %q, %v; want %q", in, got, ok, want)
		}
	}
}
