package redroid

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"strings"
	"testing"
	"time"
)

type fakeADB struct {
	calls  []string
	pidofs int
	// noTun fails this many route scripts, as before the sidecar's tun exists.
	noTun int
}

func (f *fakeADB) WaitBoot(context.Context) error {
	f.calls = append(f.calls, "wait-boot")
	return nil
}

func (f *fakeADB) Root(context.Context) error {
	f.calls = append(f.calls, "root")
	return nil
}

func (f *fakeADB) Push(_ context.Context, local, remote string) error {
	f.calls = append(f.calls, "push "+local+" "+remote)
	return nil
}

func (f *fakeADB) Shell(_ context.Context, cmd string) (string, error) {
	f.calls = append(f.calls, cmd)
	if strings.HasPrefix(cmd, "ip link show holtdroid0") && f.noTun > 0 {
		f.noTun--
		return "", errors.New(`Device "holtdroid0" does not exist.`)
	}
	if cmd == "pidof frida-server" {
		f.pidofs++
		if f.pidofs < 2 {
			return "", nil
		}
		return "1234\n", nil
	}
	return "", nil
}

func TestPrepare(t *testing.T) {
	tests := []struct {
		name string
		vpn  bool
	}{
		{"direct", false},
		{"vpn", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := DefaultConfig()
			cfg.VPN = tt.vpn
			adb := &fakeADB{}
			if err := New(cfg, adb, slog.New(slog.DiscardHandler)).prepare(context.Background()); err != nil {
				t.Fatal(err)
			}
			want := []string{"wait-boot", "root"}
			if tt.vpn {
				want = append(want, Routes(cfg.Bypass))
			}
			want = append(want,
				allowHomeRotation,
				"dumpsys battery set level 65 && dumpsys battery unplug && dumpsys battery set status 3 && dumpsys battery set present 1",
				"push /opt/holtdroid/frida-server /data/local/tmp/frida-server",
				"pkill -x frida-server; chmod 755 /data/local/tmp/frida-server && /data/local/tmp/frida-server -D </dev/null >/dev/null 2>&1",
				"pidof frida-server",
				"pidof frida-server",
			)
			if !slices.Equal(adb.calls, want) {
				t.Fatalf("calls\n%s\nwant\n%s", strings.Join(adb.calls, "\n"), strings.Join(want, "\n"))
			}
		})
	}
}

func TestPrepareWaitsForTun(t *testing.T) {
	tests := []struct {
		name    string
		noTun   int
		timeout time.Duration
		wantErr bool
	}{
		{"late", 2, time.Minute, false},
		{"never", 1000, 100 * time.Millisecond, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := DefaultConfig()
			cfg.VPN = true
			cfg.TunTimeout = tt.timeout
			adb := &fakeADB{noTun: tt.noTun}
			err := New(cfg, adb, slog.New(slog.DiscardHandler)).prepare(context.Background())
			if tt.wantErr {
				if err == nil || !strings.Contains(err.Error(), "tun holtdroid0 not ready after 100ms") {
					t.Fatalf("err = %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			routes := 0
			for _, c := range adb.calls {
				if c == Routes(cfg.Bypass) {
					routes++
				}
			}
			if routes != 3 {
				t.Fatalf("route scripts run %d times, want 3", routes)
			}
		})
	}
}

func TestRoutes(t *testing.T) {
	got := Routes([]string{"10.0.0.0/8", "fc00::/7"})
	want := "ip link show holtdroid0 >/dev/null && " +
		"ip route replace default dev holtdroid0 table 2022 && " +
		"ip route replace unreachable default metric 1000 table 2022 && " +
		"ip route replace throw 10.0.0.0/8 table 2022 && " +
		"{ ip rule list pref 8999 | grep -q . || ip rule add to 198.18.0.0/30 lookup 2022 pref 8999; } && " +
		"{ ip rule list pref 9000 | grep -q . || ip rule add not uidrange 0-0 lookup 2022 pref 9000; }"
	if got != want {
		t.Fatalf("routes\n%s\nwant\n%s", got, want)
	}
}
