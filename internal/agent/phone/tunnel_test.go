package phone

import (
	"context"
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
	tun := &Tunnel{APK: "/opt/tunnel.apk", Port: 29180, HostPort: 41234, IPv6: true}
	p := New(Config{BootTimeout: time.Second, Poll: time.Millisecond, Misses: 1}, adb, tun, slog.New(slog.DiscardHandler))
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
