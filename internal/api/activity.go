package api

import (
	"sync"
	"time"
)

type sessionKey struct {
	Provider string
	ID       string
}

// activity keeps last-activity timestamps in memory; the reaper periodically
// flushes dirty ones to providers so a restart loses at most one interval.
type activity struct {
	mu    sync.Mutex
	last  map[sessionKey]time.Time
	dirty map[sessionKey]bool
	now   func() time.Time
}

func newActivity(now func() time.Time) *activity {
	return &activity{last: map[sessionKey]time.Time{}, dirty: map[sessionKey]bool{}, now: now}
}

func (a *activity) Mark(k sessionKey) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.last[k] = a.now().UTC()
	a.dirty[k] = true
}

func (a *activity) Get(k sessionKey) (time.Time, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	t, ok := a.last[k]
	return t, ok
}

func (a *activity) TakeDirty() map[sessionKey]time.Time {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make(map[sessionKey]time.Time, len(a.dirty))
	for k := range a.dirty {
		out[k] = a.last[k]
	}
	clear(a.dirty)
	return out
}

func (a *activity) Restore(k sessionKey) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.last[k]; ok {
		a.dirty[k] = true
	}
}

func (a *activity) Retain(alive map[sessionKey]bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for k := range a.last {
		if !alive[k] {
			delete(a.last, k)
			delete(a.dirty, k)
		}
	}
}
