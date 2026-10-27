package conns

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func TestTracker(t *testing.T) {
	var snap []contract.Connection
	var fail error
	tr := New(func(context.Context) ([]contract.Connection, error) { return snap, fail }, slog.New(slog.DiscardHandler))
	now := time.Date(2026, 10, 27, 10, 0, 0, 0, time.UTC)
	tr.now = func() time.Time { return now }
	ch, stop := tr.Subscribe()
	defer stop()
	ctx := context.Background()
	next := func() (contract.Connection, bool) {
		select {
		case c := <-ch:
			return c, true
		default:
			return contract.Connection{}, false
		}
	}

	a := contract.Connection{ID: "a", Start: now, Host: "api.example.com", Upload: 1}
	b := contract.Connection{ID: "b", Start: now, Host: "cdn.example.com"}
	snap = []contract.Connection{a, b}
	if err := tr.Poll(ctx); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"a", "b"} {
		if c, ok := next(); !ok || c.ID != id {
			t.Fatalf("opened %+v %v, want %s", c, ok, id)
		}
	}

	now = now.Add(5 * time.Second)
	a.Upload = 2
	snap = []contract.Connection{a, b}
	_ = tr.Poll(ctx)
	if c, ok := next(); ok {
		t.Fatalf("an update within 10 s: %+v", c)
	}
	now = now.Add(5 * time.Second)
	_ = tr.Poll(ctx)
	if c, ok := next(); !ok || c.ID != "a" || c.Upload != 2 || !c.End.IsZero() {
		t.Fatalf("update %+v %v", c, ok)
	}

	fail = errors.New("sidecar restarting")
	if err := tr.Poll(ctx); err == nil {
		t.Fatal("no error")
	}
	if c, ok := next(); ok {
		t.Fatalf("a failed snapshot closed %+v", c)
	}
	fail = nil

	now = now.Add(time.Second)
	snap = []contract.Connection{b}
	_ = tr.Poll(ctx)
	if c, ok := next(); !ok || c.ID != "a" || !c.End.Equal(now) || c.Upload != 2 {
		t.Fatalf("closed %+v %v", c, ok)
	}

	var replay []contract.Connection
	wctx, cancel := context.WithCancel(ctx)
	_ = tr.Watch(wctx, func(c contract.Connection) error {
		replay = append(replay, c)
		if len(replay) == 2 {
			cancel()
		}
		return nil
	})
	if len(replay) != 2 || replay[0].ID != "a" || replay[0].End.IsZero() || replay[1].ID != "b" {
		t.Fatalf("replay %+v", replay)
	}

	late, stopLate := tr.Subscribe()
	defer stopLate()
	if c := <-late; c.ID != "b" {
		t.Fatalf("a recording starting now got %+v", c)
	}
}
