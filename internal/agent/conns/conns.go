// Package conns follows the device's connections through snapshots of the
// VPN sidecar's open ones, as the clash API lists them.
package conns

import (
	"cmp"
	"context"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

const (
	backlog      = 2000
	updateEvery  = 10 * time.Second
	subscriberCh = 1024
)

// Source returns the connections open now.
type Source func(ctx context.Context) ([]contract.Connection, error)

type tracked struct {
	c    contract.Connection
	sent time.Time
	up   int64
	down int64
}

type Tracker struct {
	src Source
	log *slog.Logger
	now func() time.Time

	mu     sync.Mutex
	open   map[string]*tracked
	closed []contract.Connection
	subs   map[chan contract.Connection]struct{}
}

func New(src Source, log *slog.Logger) *Tracker {
	return &Tracker{src: src, log: log, now: time.Now, open: map[string]*tracked{}, subs: map[chan contract.Connection]struct{}{}}
}

func (t *Tracker) Run(ctx context.Context, every time.Duration) {
	tick := time.NewTicker(every)
	defer tick.Stop()
	failing := false
	for {
		err := t.Poll(ctx)
		if err != nil && !failing && ctx.Err() == nil {
			t.log.Warn("connections: read the sidecar's", "err", err)
		}
		failing = err != nil
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// Poll compares a snapshot with the last one. A failed snapshot keeps the
// open connections as they were, since the sidecar may only be restarting.
func (t *Tracker) Poll(ctx context.Context) error {
	snap, err := t.src(ctx)
	if err != nil {
		return err
	}
	now := t.now()
	t.mu.Lock()
	defer t.mu.Unlock()
	seen := make(map[string]bool, len(snap))
	for _, c := range snap {
		seen[c.ID] = true
		tr, ok := t.open[c.ID]
		if !ok {
			t.open[c.ID] = &tracked{c: c, sent: now, up: c.Upload, down: c.Download}
			t.publish(c)
			continue
		}
		tr.c.Upload, tr.c.Download = c.Upload, c.Download
		if (c.Upload != tr.up || c.Download != tr.down) && now.Sub(tr.sent) >= updateEvery {
			tr.sent, tr.up, tr.down = now, c.Upload, c.Download
			t.publish(tr.c)
		}
	}
	for id, tr := range t.open {
		if seen[id] {
			continue
		}
		delete(t.open, id)
		tr.c.End = now
		t.closed = append(t.closed, tr.c)
		if len(t.closed) > backlog {
			t.closed = slices.Delete(t.closed, 0, len(t.closed)-backlog)
		}
		t.publish(tr.c)
	}
	return nil
}

func (t *Tracker) publish(c contract.Connection) {
	for ch := range t.subs {
		select {
		case ch <- c:
		default:
		}
	}
}

func (t *Tracker) openLocked() []contract.Connection {
	out := make([]contract.Connection, 0, len(t.open))
	for _, tr := range t.open {
		out = append(out, tr.c)
	}
	slices.SortFunc(out, func(a, b contract.Connection) int {
		return cmp.Or(a.Start.Compare(b.Start), strings.Compare(a.ID, b.ID))
	})
	return out
}

// Watch sends the closed connections kept and the open ones, then every
// line.
func (t *Tracker) Watch(ctx context.Context, send func(contract.Connection) error) error {
	t.mu.Lock()
	first := append(slices.Clone(t.closed), t.openLocked()...)
	ch, cancel := t.subscribeLocked()
	t.mu.Unlock()
	defer cancel()
	for _, c := range first {
		if err := send(c); err != nil {
			return err
		}
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		case c := <-ch:
			if err := send(c); err != nil {
				return err
			}
		}
	}
}

// Subscribe follows new lines, for a recording; the open connections come
// first.
func (t *Tracker) Subscribe() (<-chan contract.Connection, func()) {
	t.mu.Lock()
	defer t.mu.Unlock()
	ch, cancel := t.subscribeLocked()
	for _, c := range t.openLocked() {
		select {
		case ch <- c:
		default:
		}
	}
	return ch, cancel
}

func (t *Tracker) subscribeLocked() (chan contract.Connection, func()) {
	ch := make(chan contract.Connection, subscriberCh)
	t.subs[ch] = struct{}{}
	return ch, func() {
		t.mu.Lock()
		delete(t.subs, ch)
		t.mu.Unlock()
	}
}
