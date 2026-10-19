package phone

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestParseBroadcast(t *testing.T) {
	tests := []struct {
		name, out string
		code      int
		state     string
		err       bool
	}{
		{"running", "Broadcasting: Intent { act=x }\nBroadcast completed: result=-1, data=\"{\"state\":\"running\",\"proxy\":\"ok\",\"version\":\"0.1.0\",\"error\":null}\"\n", -1, "running", false},
		{"consent", "Broadcast completed: result=2, data=\"{\"state\":\"stopped\",\"consent\":false}\"", 2, "stopped", false},
		{"not installed", "Broadcasting: Intent { act=x }\nBroadcast completed: result=0\n", 0, "", true},
		{"garbage", "Error: bad component", 0, "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			st, code, err := parseBroadcast(tt.out)
			if code != tt.code || st.State != tt.state || (err != nil) != tt.err {
				t.Fatalf("%+v %d %v", st, code, err)
			}
		})
	}
}

type tunnelADB struct {
	fakeADB
	installed bool
	running   bool
}

func (f *tunnelADB) Shell(ctx context.Context, cmd string) (string, error) {
	_, _ = f.fakeADB.Shell(ctx, cmd)
	f.mu.Lock()
	defer f.mu.Unlock()
	switch {
	case !strings.HasPrefix(cmd, "am broadcast -n "+tunnelReceiver):
		return "", nil
	case !f.installed:
		return "Broadcast completed: result=0\n", nil
	case strings.Contains(cmd, ".START"):
		f.running = true
	case strings.Contains(cmd, ".STOP"):
		f.running = false
	}
	state := "stopped"
	if f.running {
		state = "running"
	}
	return `Broadcast completed: result=-1, data="{"state":"` + state + `","proxy":"ok","version":"0.1.0"}"`, nil
}

func (f *tunnelADB) Install(ctx context.Context, apk string) error {
	_ = f.fakeADB.Install(ctx, apk)
	f.mu.Lock()
	f.installed = true
	f.mu.Unlock()
	return nil
}

func TestTunnel(t *testing.T) {
	adb := &tunnelADB{}
	adb.states = []string{"device", "device"}
	tun := &Tunnel{Port: 29180, HostPort: 41234, IPv6: true}
	app := App{APK: "/opt/tunnel.apk", Version: "0.2.1"}
	p := New(Config{BootTimeout: time.Second, Poll: time.Millisecond, Misses: 1}, adb, Session{App: app, Tunnel: tun, Resume: true}, slog.New(slog.DiscardHandler))
	booted := false
	_ = p.Run(context.Background(), func() { booted = true })
	if !booted {
		t.Fatal("not booted")
	}
	calls := strings.Join(adb.calls, "\n")
	for _, want := range []string{
		"install /opt/tunnel.apk",
		"appops set " + TunnelPackage + " ACTIVATE_VPN allow; svc wifi disable; svc data disable",
		"reverse 29180 41234",
		".START --ei port 29180 --ez ipv6 true",
	} {
		if !strings.Contains(calls, want) {
			t.Errorf("missing %q in\n%s", want, calls)
		}
	}
}

type appADB struct {
	fakeADB
	status  string
	install []error
}

func (f *appADB) Shell(ctx context.Context, cmd string) (string, error) {
	_, _ = f.fakeADB.Shell(ctx, cmd)
	if strings.Contains(cmd, ".STATUS") {
		return f.status, nil
	}
	return "", nil
}

func (f *appADB) Install(ctx context.Context, apk string) error {
	_ = f.fakeADB.Install(ctx, apk)
	err := f.install[0]
	f.install = f.install[1:]
	return err
}

func TestAppEnsure(t *testing.T) {
	ctx := context.Background()
	incompatible := errors.New("adb install: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match]")
	for _, tc := range []struct {
		name, status string
		install      []error
		want         []string
		err          bool
	}{
		{"current", `Broadcast completed: result=-1, data="{"version":"0.2.1"}"`, nil, nil, false},
		{"missing", "Broadcast completed: result=0", []error{nil}, []string{"install /a.apk"}, false},
		{
			"debug build", `Broadcast completed: result=-1, data="{"version":"0.1.0","owner":{"device_owner":false}}"`,
			[]error{incompatible, nil},
			[]string{"install /a.apk", "pm uninstall " + TunnelPackage, "install /a.apk"},
			false,
		},
		{"owner with another key", `Broadcast completed: result=-1, data="{"version":"0.2.0","owner":{"device_owner":true}}"`, []error{incompatible}, []string{"install /a.apk"}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			adb := &appADB{status: tc.status, install: tc.install}
			err := App{APK: "/a.apk", Version: "0.2.1"}.Ensure(ctx, adb)
			var calls []string
			for _, c := range adb.calls {
				if !strings.Contains(c, "am broadcast") {
					calls = append(calls, c)
				}
			}
			if (err != nil) != tc.err || strings.Join(calls, "|") != strings.Join(tc.want, "|") {
				t.Fatalf("err %v, calls %q", err, calls)
			}
		})
	}
}

func TestOwnerActions(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		name     string
		owner    ownerStatus
		lockdown bool
	}{
		{"fresh owner", ownerStatus{DeviceOwner: true}, true},
		{"usb restricted", ownerStatus{DeviceOwner: true, Restrictions: []string{"no_modify_accounts", "no_usb_file_transfer"}}, true},
		{"locked down", ownerStatus{DeviceOwner: true, Restrictions: []string{"no_modify_accounts", "no_sms"}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			adb := &appADB{}
			_ = ownerActions(ctx, adb, tc.owner)
			calls := strings.Join(adb.calls, "\n")
			if !strings.Contains(calls, ".SESSION_END") || !strings.Contains(calls, ".CLEAR_PASSWORD") ||
				strings.Contains(calls, ".LOCKDOWN --es skip no_usb_file_transfer") != tc.lockdown {
				t.Fatalf("calls:\n%s", calls)
			}
		})
	}
}
