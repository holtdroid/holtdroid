package audit

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

type StoreConfig struct {
	Enabled   bool
	MaxEvents int
	MaxAge    time.Duration
	Path      string
}

// Stored is an event kept by the Store. IDs grow with every event and start
// over when the process restarts.
type Stored struct {
	ID uint64 `json:"id"`
	Event
}

// Store keeps the most recent events in memory for the admin audit page,
// optionally mirrored to a JSON lines file that is reloaded on start and
// rewritten once it holds twice as many lines as events kept.
type Store struct {
	mu     sync.Mutex
	cfg    StoreConfig
	now    func() time.Time
	events []Stored
	next   uint64
	file   *os.File
	lines  int
}

func OpenStore(cfg StoreConfig, now func() time.Time) (*Store, error) {
	s := &Store{cfg: cfg, now: now, next: 1}
	if cfg.Path == "" {
		return s, nil
	}
	if err := os.MkdirAll(filepath.Dir(cfg.Path), 0o750); err != nil {
		return nil, fmt.Errorf("audit.store.path: %w", err)
	}
	if err := s.load(); err != nil {
		return nil, fmt.Errorf("audit.store.path: %w", err)
	}
	s.prune()
	if err := s.compact(); err != nil {
		return nil, fmt.Errorf("audit.store.path: %w", err)
	}
	return s, nil
}

func (s *Store) load() error {
	f, err := os.Open(s.cfg.Path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64<<10), 1<<20)
	for sc.Scan() {
		var ev Event
		if json.Unmarshal(sc.Bytes(), &ev) != nil || ev.Action == "" {
			continue
		}
		s.events = append(s.events, Stored{ID: s.next, Event: ev})
		s.next++
	}
	return sc.Err()
}

func (s *Store) compact() error {
	tmp, err := os.CreateTemp(filepath.Dir(s.cfg.Path), ".audit-*.jsonl")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	w := bufio.NewWriter(tmp)
	enc := json.NewEncoder(w)
	for _, e := range s.events {
		if err := enc.Encode(e.Event); err != nil {
			tmp.Close()
			return err
		}
	}
	if err := errors.Join(w.Flush(), tmp.Sync(), tmp.Close()); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), s.cfg.Path); err != nil {
		return err
	}
	if s.file != nil {
		s.file.Close()
	}
	s.file, err = os.OpenFile(s.cfg.Path, os.O_WRONLY|os.O_APPEND, 0o600)
	s.lines = len(s.events)
	return err
}

func (s *Store) prune() {
	drop := max(0, len(s.events)-s.cfg.MaxEvents)
	if s.cfg.MaxAge > 0 {
		cutoff := s.now().Add(-s.cfg.MaxAge)
		for drop < len(s.events) && s.events[drop].Time.Before(cutoff) {
			drop++
		}
	}
	if drop > 0 {
		s.events = s.events[drop:]
	}
}

func (s *Store) Write(_ context.Context, ev Event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, Stored{ID: s.next, Event: ev})
	s.next++
	s.prune()
	if s.file == nil {
		return
	}
	line, err := json.Marshal(ev)
	if err == nil {
		_, err = s.file.Write(append(line, '\n'))
		s.lines++
	}
	if err == nil && s.lines >= 2*max(len(s.events), s.cfg.MaxEvents/2, 100) {
		err = s.compact()
	}
	if err != nil {
		dropped.WithLabelValues("store").Inc()
		slog.Warn("audit store could not write its file", "err", err)
	}
}

func (s *Store) Close(context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.file == nil {
		return nil
	}
	err := s.file.Close()
	s.file = nil
	return err
}

type Query struct {
	Actions  []string
	Results  []Result
	Services []string
	Actor    string
	Session  string
	Text     string
	Since    time.Time
	Until    time.Time
	Before   uint64
	Limit    int
}

// matchAction accepts an exact action or its category ("session" for
// "session.launch").
func matchAction(a Action, filters []string) bool {
	if len(filters) == 0 {
		return true
	}
	for _, f := range filters {
		if string(a) == f || strings.HasPrefix(string(a), f+".") {
			return true
		}
	}
	return false
}

func (e Stored) contains(text string) bool {
	for _, f := range []string{
		string(e.Action), e.Service, e.Actor, e.Provider, e.Session, e.Artifact,
		e.ClientIP, e.ForwardedFor, e.UserAgent, e.Reason,
	} {
		if strings.Contains(strings.ToLower(f), text) {
			return true
		}
	}
	for k, v := range e.Details {
		if strings.Contains(strings.ToLower(k), text) || strings.Contains(strings.ToLower(v), text) {
			return true
		}
	}
	return false
}

func (q Query) match(e Stored) bool {
	return matchAction(e.Action, q.Actions) &&
		(len(q.Results) == 0 || slices.Contains(q.Results, e.Result)) &&
		(len(q.Services) == 0 || slices.Contains(q.Services, e.Service)) &&
		(q.Actor == "" || e.Actor == q.Actor) &&
		(q.Session == "" || e.Session == q.Session) &&
		(q.Since.IsZero() || !e.Time.Before(q.Since)) &&
		(q.Until.IsZero() || e.Time.Before(q.Until)) &&
		(q.Text == "" || e.contains(strings.ToLower(q.Text)))
}

// Query returns matching events newest first: at most q.Limit of them
// (all with 0), and whether older matches remain.
func (s *Store) Query(q Query) ([]Stored, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prune()
	var out []Stored
	for _, e := range slices.Backward(s.events) {
		if q.Before > 0 && e.ID >= q.Before || !q.match(e) {
			continue
		}
		if q.Limit > 0 && len(out) == q.Limit {
			return out, true
		}
		out = append(out, e)
	}
	return out, false
}

type StoreStats struct {
	Events     int
	Oldest     time.Time
	MaxEvents  int
	MaxAge     time.Duration
	Persistent bool
	Actors     []string
}

func (s *Store) Stats() StoreStats {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prune()
	st := StoreStats{Events: len(s.events), MaxEvents: s.cfg.MaxEvents, MaxAge: s.cfg.MaxAge, Persistent: s.cfg.Path != ""}
	if len(s.events) > 0 {
		st.Oldest = s.events[0].Time
	}
	seen := map[string]bool{}
	for _, e := range s.events {
		if e.Actor != "" && !seen[e.Actor] {
			seen[e.Actor] = true
			st.Actors = append(st.Actors, e.Actor)
		}
	}
	slices.Sort(st.Actors)
	return st
}
