// Package conns follows the device's connections as the VPN sidecar
// reports them: events from sing-box's API service, or snapshots of the
// clash API's open connections where there is no such service.
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

type tracked struct {
	c    contract.Connection
	sent time.Time
}

type Tracker struct {
	log *slog.Logger
	now func() time.Time

	mu     sync.Mutex
	open   map[string]*tracked
	closed []contract.Connection
	seen   map[string]bool
	edges  map[edgeKey]string
	subs   map[chan contract.Connection]struct{}
}

type edgeKey struct{ host, outbound string }

func New(log *slog.Logger) *Tracker {
	return &Tracker{
		log: log, now: time.Now,
		open: map[string]*tracked{}, seen: map[string]bool{}, edges: map[edgeKey]string{},
		subs: map[chan contract.Connection]struct{}{},
	}
}

// Open adds a connection; one already known is left as it is.
func (t *Tracker) Open(c contract.Connection) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.openLocked(c)
}

func (t *Tracker) openLocked(c contract.Connection) {
	if _, ok := t.open[c.ID]; ok || t.seen[c.ID] {
		return
	}
	c.Edge = cmp.Or(c.Edge, t.edges[edgeKey{c.Host, c.Outbound}])
	t.open[c.ID] = &tracked{c: c, sent: t.now()}
	t.publish(c)
}

// Traffic sets an open connection's bytes so far; a line goes out at most
// every updateEvery.
func (t *Tracker) Traffic(id string, upload, download int64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	tr, ok := t.open[id]
	if !ok || tr.c.Upload == upload && tr.c.Download == download {
		return
	}
	tr.c.Upload, tr.c.Download = upload, download
	if now := t.now(); now.Sub(tr.sent) >= updateEvery {
		tr.sent = now
		t.publish(tr.c)
	}
}

// Close ends a connection at end. final, when known, carries its last
// bytes, and adds a connection that closed before it was ever seen open.
func (t *Tracker) Close(id string, end time.Time, final *contract.Connection) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.closeLocked(id, end, final)
}

func (t *Tracker) closeLocked(id string, end time.Time, final *contract.Connection) {
	c := final
	if tr, ok := t.open[id]; ok {
		delete(t.open, id)
		if c == nil {
			c = &tr.c
		}
	}
	if c == nil || t.seen[id] {
		return
	}
	done := *c
	done.End = end
	done.Edge = cmp.Or(done.Edge, t.edges[edgeKey{done.Host, done.Outbound}])
	t.seen[id] = true
	t.closed = append(t.closed, done)
	if len(t.closed) > backlog {
		for _, old := range t.closed[:len(t.closed)-backlog] {
			delete(t.seen, old.ID)
		}
		t.closed = slices.Delete(t.closed, 0, len(t.closed)-backlog)
	}
	t.publish(done)
}

// SetEdge records the CDN site that answers host through outbound, and
// sends the open connections to it again with it.
func (t *Tracker) SetEdge(host, outbound, edge string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.edges[edgeKey{host, outbound}] = edge
	for _, tr := range t.openList() {
		if tr.Host == host && tr.Outbound == outbound && tr.Edge != edge {
			o := t.open[tr.ID]
			o.c.Edge, o.sent = edge, t.now()
			t.publish(o.c)
		}
	}
}

// Sync compares a snapshot of the open connections with what is known:
// new ones open, missing ones close now.
func (t *Tracker) Sync(snap []contract.Connection) {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.now()
	present := make(map[string]bool, len(snap))
	for _, c := range snap {
		present[c.ID] = true
		if _, ok := t.open[c.ID]; !ok {
			t.openLocked(c)
			continue
		}
		tr := t.open[c.ID]
		if tr.c.Upload != c.Upload || tr.c.Download != c.Download {
			tr.c.Upload, tr.c.Download = c.Upload, c.Download
			if now.Sub(tr.sent) >= updateEvery {
				tr.sent = now
				t.publish(tr.c)
			}
		}
	}
	for id := range t.open {
		if !present[id] {
			t.closeLocked(id, now, nil)
		}
	}
}

func (t *Tracker) publish(c contract.Connection) {
	for ch := range t.subs {
		select {
		case ch <- c:
		default:
		}
	}
}

func (t *Tracker) openList() []contract.Connection {
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
	first := append(slices.Clone(t.closed), t.openList()...)
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
	for _, c := range t.openList() {
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

// Poll follows snapshots from src every period until ctx ends, for a
// sidecar with only the clash API.
func (t *Tracker) Poll(ctx context.Context, src func(context.Context) ([]contract.Connection, error), every time.Duration) {
	tick := time.NewTicker(every)
	defer tick.Stop()
	failing := false
	for {
		snap, err := src(ctx)
		if err == nil {
			t.Sync(snap)
		} else if !failing && ctx.Err() == nil {
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
