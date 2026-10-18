package phone

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
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
