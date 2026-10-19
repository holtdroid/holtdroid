package phone

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeADB struct {
	mu     sync.Mutex
	states []string
	calls  []string
	reply  func(cmd string) string
}

func (f *fakeADB) WaitBoot(context.Context) error { return nil }

func (f *fakeADB) State(context.Context) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.states) == 0 {
		return "", errors.New("no devices")
	}
	s := f.states[0]
	f.states = f.states[1:]
	return s, nil
}

func (f *fakeADB) Shell(_ context.Context, cmd string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, cmd)
	if f.reply != nil {
		return f.reply(cmd), nil
	}
	return "", nil
}

func (f *fakeADB) Push(_ context.Context, local, remote string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, "push "+local+" "+remote)
	return nil
}

func (f *fakeADB) Install(_ context.Context, apk string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, "install "+apk)
	return nil
}

func (f *fakeADB) Reverse(_ context.Context, port, local int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, fmt.Sprintf("reverse %d %d", port, local))
	return nil
}

func (f *fakeADB) RemoveAll(context.Context) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, "remove-all")
	return nil
}

func TestRunEndsWhenThePhoneIsGone(t *testing.T) {
	adb := &fakeADB{states: []string{"device", "offline", "device"}}
	p := New(Config{BootTimeout: time.Second, Poll: time.Millisecond, Misses: 2}, adb, Session{Resume: true}, slog.New(slog.DiscardHandler))
	booted := false
	err := p.Run(context.Background(), func() { booted = true })
	if !booted || err == nil || err.Error() != "phone disconnected" {
		t.Fatalf("booted %v, err %v", booted, err)
	}
	if adb.calls[0] != wake {
		t.Fatalf("calls %q", adb.calls)
	}
}

func TestRunStartsFridaServerWithRoot(t *testing.T) {
	adb := &fakeADB{
		states: []string{"offline", "offline"},
		reply: func(cmd string) string {
			switch {
			case strings.Contains(cmd, "id -u"):
				return "0"
			case strings.Contains(cmd, "pidof frida-server"):
				return "123"
			}
			return ""
		},
	}
	p := New(Config{BootTimeout: time.Second, Poll: time.Millisecond, Misses: 2, FridaServer: "/opt/holtdroid/frida-server"},
		adb, Session{Package: "com.example.app", Resume: true, Root: true}, slog.New(slog.DiscardHandler))
	booted := false
	if err := p.Run(context.Background(), func() { booted = true }); !booted || err == nil {
		t.Fatalf("booted %v, err %v", booted, err)
	}
	pushed := slices.ContainsFunc(adb.calls, func(c string) bool { return strings.HasPrefix(c, "push ") && strings.Contains(c, fridaRemote) })
	started := slices.ContainsFunc(adb.calls, func(c string) bool { return strings.Contains(c, "su -c") && strings.Contains(c, fridaRemote+" -D") })
	if !pushed || !started {
		t.Fatalf("root boot incomplete (pushed %v started %v): %q", pushed, started, adb.calls)
	}
}

func TestHideRootDenylistsInstalledApp(t *testing.T) {
	adb := &fakeADB{reply: func(cmd string) string {
		if strings.HasPrefix(cmd, "pm path ") {
			return "yes"
		}
		return ""
	}}
	p := New(Config{}, adb, Session{Package: "com.example.app", Root: true}, slog.New(slog.DiscardHandler))
	p.hideRoot(context.Background())
	if !slices.ContainsFunc(adb.calls, func(c string) bool {
		return strings.Contains(c, "su -c") && strings.Contains(c, "denylist add com.example.app")
	}) {
		t.Fatalf("installed app not added to denylist: %q", adb.calls)
	}
	// an app that is not installed yet is left alone
	adb2 := &fakeADB{reply: func(string) string { return "no" }}
	New(Config{}, adb2, Session{Package: "com.example.app", Root: true}, slog.New(slog.DiscardHandler)).hideRoot(context.Background())
	if slices.ContainsFunc(adb2.calls, func(c string) bool { return strings.Contains(c, "denylist add") }) {
		t.Fatalf("denylisted an app that is not installed: %q", adb2.calls)
	}
}

func TestCleanRemovesRootAppFromDenylist(t *testing.T) {
	adb := &fakeADB{}
	_ = Clean(context.Background(), adb, Cleanup{Package: "com.example.app", Root: true, End: true})
	if !slices.ContainsFunc(adb.calls, func(c string) bool {
		return strings.Contains(c, "su -c") && strings.Contains(c, "denylist rm com.example.app")
	}) {
		t.Fatalf("denylist not cleaned: %q", adb.calls)
	}
}

func TestRootTunnelStart(t *testing.T) {
	adb := &fakeADB{reply: func(cmd string) string {
		switch {
		case strings.Contains(cmd, "-x "+singBoxRemote):
			return "no"
		case strings.Contains(cmd, "ip link show "+rootTunnelIf):
			return rootTunnelIf + ": <POINTOPOINT,UP>"
		}
		return ""
	}}
	rt := &RootTunnel{SingBox: "/opt/holtdroid/sing-box-android", Port: 29180, HostPort: 40000}
	if err := rt.start(context.Background(), adb); err != nil {
		t.Fatal(err)
	}
	pushBin := slices.ContainsFunc(adb.calls, func(c string) bool {
		return strings.Contains(c, "push /opt/holtdroid/sing-box-android "+singBoxRemote)
	})
	reversed := slices.Contains(adb.calls, fmt.Sprintf("reverse %d %d", 29180, 40000))
	started := slices.ContainsFunc(adb.calls, func(c string) bool {
		return strings.Contains(c, "su -Z "+magiskSELinux) && strings.Contains(c, "run -c "+singBoxConfig)
	})
	if !pushBin || !reversed || !started {
		t.Fatalf("root tunnel start incomplete (bin %v rev %v start %v): %q", pushBin, reversed, started, adb.calls)
	}
	if cfg := rt.config(); !strings.Contains(cfg, `"server_port": 29180`) || !strings.Contains(cfg, `"auto_route": false`) {
		t.Fatalf("bad sing-box config: %s", cfg)
	}
}

func TestLockdownCalls(t *testing.T) {
	adb := &fakeADB{}
	if err := lockdownCalls(context.Background(), adb); err != nil {
		t.Fatal(err)
	}
	c := strings.Join(adb.calls, " ")
	if !strings.Contains(c, "su -c") || !strings.Contains(c, "airplane-mode enable") ||
		!strings.Contains(c, "pm disable-user --user 0 com.samsung.android.emergency") ||
		!strings.Contains(c, "locksettings set-disabled true") {
		t.Fatalf("lockdown missing steps: %q", adb.calls)
	}
	un := unlockCalls(context.Background(), adb)
	if !strings.Contains(un, "pm enable com.samsung.android.emergency") || !strings.Contains(un, "locksettings set-disabled false") {
		t.Fatalf("unlock missing steps: %q", un)
	}
}
