package db

import (
	"context"
	"testing"
	"time"
)

func TestOpen(t *testing.T) {
	for _, tc := range []struct {
		typ     string
		wantErr bool
	}{
		{typ: "memory"},
		{typ: ""},
		{typ: "sqlite", wantErr: true},
		{typ: "postgres", wantErr: true},
	} {
		t.Run(tc.typ, func(t *testing.T) {
			d, err := Open(context.Background(), Config{Type: tc.typ})
			if tc.wantErr {
				if err == nil {
					_ = d.Close()
					t.Fatal("expected an error")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			_ = d.Close()
		})
	}
}

func TestSessionEvents(t *testing.T) {
	ctx := context.Background()
	d, err := Open(ctx, DefaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })

	at := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	for i, kind := range []string{"created", "stopped"} {
		if err := d.AddSessionEvent(ctx, AddSessionEventParams{
			At: at.Add(time.Duration(i) * time.Minute), Provider: "fake", SessionID: "s1", Kind: kind, Actor: "otter", Artifact: "local/hello.apk",
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := d.AddSessionEvent(ctx, AddSessionEventParams{At: at, Provider: "fake", SessionID: "s2", Kind: "created"}); err != nil {
		t.Fatal(err)
	}

	events, err := d.ListSessionEvents(ctx, ListSessionEventsParams{Provider: "fake", SessionID: "s1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].Kind != "created" || events[1].Kind != "stopped" || !events[1].At.Equal(at.Add(time.Minute)) {
		t.Fatalf("events = %+v", events)
	}

	fresh, err := Open(ctx, DefaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = fresh.Close() })
	if events, _ := fresh.ListSessionEvents(ctx, ListSessionEventsParams{Provider: "fake", SessionID: "s1"}); len(events) != 0 {
		t.Fatalf("in-memory databases must not share data: %+v", events)
	}
}
