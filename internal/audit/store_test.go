package audit

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/secrets"
)

func actions(events []Stored) []Action {
	out := make([]Action, 0, len(events))
	for _, e := range events {
		out = append(out, e.Action)
	}
	return out
}

func TestStoreRetention(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name  string
		cfg   StoreConfig
		later time.Duration
		want  []Action
	}{
		{"count", StoreConfig{MaxEvents: 2}, 0, []Action{SignOut, SessionStop}},
		{"age", StoreConfig{MaxEvents: 10, MaxAge: 90 * time.Minute}, 0, []Action{SignOut, SessionStop}},
		{"no age limit", StoreConfig{MaxEvents: 10}, 1000 * time.Hour, []Action{SignOut, SessionStop, SessionLaunch}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clock := now
			s, err := OpenStore(tt.cfg, func() time.Time { return clock })
			if err != nil {
				t.Fatal(err)
			}
			for i, a := range []Action{SessionLaunch, SessionStop, SignOut} {
				s.Write(context.Background(), Event{Time: now.Add(time.Duration(i) * time.Hour), Action: a})
			}
			clock = clock.Add(2*time.Hour + tt.later)
			got, more := s.Query(Query{})
			if more || !slices.Equal(actions(got), tt.want) {
				t.Fatalf("got %v (more %v), want %v", actions(got), more, tt.want)
			}
		})
	}
}

func TestStoreFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit", "events.jsonl")
	now := func() time.Time { return time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC) }
	cfg := StoreConfig{MaxEvents: 100, Path: path}

	s, err := OpenStore(cfg, now)
	if err != nil {
		t.Fatal(err)
	}
	for i := range 250 {
		s.Write(context.Background(), Event{Time: now(), Action: SessionLaunch, Actor: string(rune('a' + i%26))})
	}
	s.Write(context.Background(), Event{Time: now(), Action: SignOut})
	if err := s.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	if lines := bytes.Count(raw, []byte("\n")); lines > 200 {
		t.Fatalf("file not compacted: %d lines", lines)
	}

	f, _ := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o600)
	_, _ = f.WriteString("not json\n{\"action\":\"ssh.conn")
	f.Close()

	s, err = OpenStore(cfg, now)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close(context.Background())
	got, _ := s.Query(Query{})
	if len(got) != 100 || got[0].Action != SignOut || got[0].ID <= got[1].ID {
		t.Fatalf("reloaded %d events, newest %+v", len(got), got[0])
	}
	if st := s.Stats(); st.Events != 100 || !st.Persistent || len(st.Actors) != 26 {
		t.Fatalf("stats %+v", st)
	}
	raw, _ = os.ReadFile(path)
	if lines := bytes.Count(raw, []byte("\n")); lines != 100 {
		t.Fatalf("file has %d lines after reload", lines)
	}
}

func TestStoreQuery(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	s, _ := OpenStore(StoreConfig{MaxEvents: 100}, func() time.Time { return now })
	for _, ev := range []Event{
		{Action: SessionLaunch, Actor: "otter", Service: "api", Result: OK, Session: "s1"},
		{Action: SSHTunnel, Actor: "otter", Service: "ssh-gateway", Result: Denied, Details: map[string]string{"port": "5037"}},
		{Action: SessionStop, Actor: "beaver", Service: "api", Result: Failed, Session: "s1", Reason: "Provider down"},
	} {
		ev.Time = now
		s.Write(context.Background(), ev)
	}
	tests := []struct {
		name string
		q    Query
		want []Action
	}{
		{"all", Query{}, []Action{SessionStop, SSHTunnel, SessionLaunch}},
		{"category", Query{Actions: []string{"ssh"}}, []Action{SSHTunnel}},
		{"category is not a prefix", Query{Actions: []string{"sess"}}, []Action{}},
		{"result", Query{Results: []Result{OK, Failed}}, []Action{SessionStop, SessionLaunch}},
		{"actor and service", Query{Actor: "otter", Services: []string{"api"}}, []Action{SessionLaunch}},
		{"session", Query{Session: "s1"}, []Action{SessionStop, SessionLaunch}},
		{"text in details", Query{Text: "5037"}, []Action{SSHTunnel}},
		{"text ignores case", Query{Text: "provider DOWN"}, []Action{SessionStop}},
		{"before", Query{Before: 3}, []Action{SSHTunnel, SessionLaunch}},
		{"since", Query{Since: now.Add(time.Second)}, []Action{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, _ := s.Query(tt.q)
			if !slices.Equal(actions(got), tt.want) {
				t.Fatalf("got %v, want %v", actions(got), tt.want)
			}
		})
	}
	page, more := s.Query(Query{Limit: 2})
	if len(page) != 2 || !more {
		t.Fatalf("limit: %d events, more %v", len(page), more)
	}
}

func TestLoggerStoreAndForward(t *testing.T) {
	var (
		mu  sync.Mutex
		got []Event
	)
	cfg := DefaultConfig()
	cfg.Stdout = false
	cfg.Webhook.FlushInterval = time.Hour
	l, err := New(context.Background(), cfg, "ssh-gateway", "", secrets.NewRegistry(),
		WithForward(context.Background(), cfg.Webhook, func(_ context.Context, batch []Event) error {
			mu.Lock()
			defer mu.Unlock()
			got = append(got, batch...)
			return nil
		}))
	if err != nil {
		t.Fatal(err)
	}
	l.Emit(context.Background(), Event{Action: SSHConnect, Actor: "otter"})
	if events, _ := l.Store().Query(Query{}); len(events) != 1 || events[0].Service != "ssh-gateway" || events[0].Schema != Schema {
		t.Fatalf("stored %+v", events)
	}
	if err := l.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 1 || got[0].Action != SSHConnect || got[0].Result != OK {
		t.Fatalf("forwarded %+v", got)
	}
	if (*Logger)(nil).Store() != nil {
		t.Fatal("nil logger has a store")
	}
}
