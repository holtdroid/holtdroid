package phone

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeADB struct {
	mu     sync.Mutex
	states []string
	calls  []string
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
	return "", nil
}

func (f *fakeADB) RemoveAll(context.Context) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, "remove-all")
	return nil
}

func TestRunEndsWhenThePhoneIsGone(t *testing.T) {
	adb := &fakeADB{states: []string{"device", "offline", "device"}}
	p := New(Config{BootTimeout: time.Second, Poll: time.Millisecond, Misses: 2}, adb, slog.New(slog.DiscardHandler))
	booted := false
	err := p.Run(context.Background(), func() { booted = true })
	if !booted || err == nil || err.Error() != "phone disconnected" {
		t.Fatalf("booted %v, err %v", booted, err)
	}
	if adb.calls[0] != wake {
		t.Fatalf("calls %q", adb.calls)
	}
}

func TestReset(t *testing.T) {
	adb := &fakeADB{}
	if err := Reset(context.Background(), adb, "com.x"); err != nil {
		t.Fatal(err)
	}
	if len(adb.calls) != 2 || !strings.Contains(adb.calls[0], "pm uninstall com.x") || adb.calls[1] != "remove-all" {
		t.Fatalf("calls %q", adb.calls)
	}
	if err := Reset(context.Background(), adb, "com.x; reboot"); err == nil {
		t.Fatal("bad package name accepted")
	}
}
