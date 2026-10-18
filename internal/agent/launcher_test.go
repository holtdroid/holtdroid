package agent

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

type pidShell struct {
	mu    sync.Mutex
	pids  string
	calls []string
	start string
}

func (s *pidShell) Shell(_ context.Context, cmd string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, cmd)
	switch {
	case strings.HasPrefix(cmd, "pidof "):
		return s.pids, nil
	case strings.HasPrefix(cmd, "monkey "):
		if s.start != "" {
			s.pids = s.start
		}
		return "Events injected: 1\n", nil
	case strings.HasPrefix(cmd, "am force-stop "):
		s.pids = ""
	}
	return "", nil
}

func (s *pidShell) set(pids string) {
	s.mu.Lock()
	s.pids = pids
	s.mu.Unlock()
}

func TestLauncher(t *testing.T) {
	ctx := t.Context()
	sh := &pidShell{start: "100\n"}
	l := NewLauncher(sh)
	l.interval = 10 * time.Millisecond
	launched := make(chan App, 1)
	if err := l.Watch(ctx, "com.x", func(a App) { launched <- a }); err != nil {
		t.Fatal(err)
	}
	app, err := l.Spawn(ctx, "com.x")
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Kill(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case <-app.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("app not done after kill")
	}
	select {
	case <-launched:
		t.Fatal("spawned app reported as launched from the device")
	default:
	}

	sh.set("200\n")
	select {
	case a := <-launched:
		if a.(*launchedApp).pid != 200 {
			t.Fatalf("launched pid %d", a.(*launchedApp).pid)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("device launch not seen")
	}
}

func TestLauncherRefuses(t *testing.T) {
	ctx := context.Background()
	if _, err := NewLauncher(&pidShell{}).Spawn(ctx, "com.x; reboot"); err == nil {
		t.Fatal("bad package name accepted")
	}
	l := NewLauncher(&pidShell{})
	l.timeout = 50 * time.Millisecond
	l.interval = 10 * time.Millisecond
	if _, err := l.Spawn(ctx, "com.x"); err == nil || !strings.Contains(err.Error(), "did not start") {
		t.Fatalf("spawn without a process: %v", err)
	}
}
