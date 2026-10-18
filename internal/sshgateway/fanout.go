package sshgateway

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/hashicorp/yamux"

	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/contract/control"
)

func isHandle(name string) bool { return strings.HasPrefix(name, contract.HandlePrefix) }

// retryAfter keeps a port that a device refused (usually because it is
// already published there) from being asked for again on every refresh.
const retryAfter = 30 * time.Second

// fanout publishes a connection's ports on every ready session of its user,
// following sessions as they start and end.
type fanout struct {
	c      *conn
	handle string
	kick   chan struct{}

	mu      sync.Mutex
	ports   map[uint32]*fanPort
	devices map[string]*device
	closed  bool
}

type fanPort struct {
	fr      forwardRequest
	release func()
}

type device struct {
	provider, id, slug string
	info               control.Session
	tunnel             *contract.TunnelClient
	bytes              atomic.Int64
	reported           time.Time
	open               map[uint32]*yamux.Session
	failed             map[uint32]time.Time
}

func newFanout(c *conn, handle string) *fanout {
	return &fanout{c: c, handle: handle, kick: make(chan struct{}, 1), ports: map[uint32]*fanPort{}, devices: map[string]*device{}}
}

func (f *fanout) add(fr forwardRequest) error {
	g := f.c.g
	switch {
	case !g.cfg.AllowReverse:
		return fmt.Errorf("publishing ports is disabled: %w", errDenied)
	case fr.Port == 0 || !g.ports.contains(int(fr.Port)):
		return fmt.Errorf("port %d: %w", fr.Port, errDenied)
	}
	f.mu.Lock()
	_, dup := f.ports[fr.Port]
	f.mu.Unlock()
	if dup {
		return fmt.Errorf("port %d is already published by this connection", fr.Port)
	}
	release, ok := f.c.reserve()
	if !ok {
		return errors.New("too many tunnels on one connection")
	}
	f.mu.Lock()
	f.ports[fr.Port] = &fanPort{fr: fr, release: release}
	f.mu.Unlock()
	f.c.log.Info("port published on all sessions", "port", fr.Port)
	f.refreshSoon()
	return nil
}

func (f *fanout) remove(port uint32) bool {
	f.mu.Lock()
	p, ok := f.ports[port]
	delete(f.ports, port)
	var closing []*yamux.Session
	for _, d := range f.devices {
		if s := d.open[port]; s != nil {
			closing = append(closing, s)
			delete(d.open, port)
		}
		delete(d.failed, port)
	}
	f.mu.Unlock()
	for _, s := range closing {
		s.Close()
	}
	if ok {
		p.release()
		f.c.log.Info("port unpublished", "port", port)
	}
	return ok
}

func (f *fanout) close() {
	f.mu.Lock()
	f.closed = true
	var closing []*yamux.Session
	for _, d := range f.devices {
		for _, s := range d.open {
			closing = append(closing, s)
		}
		d.open = map[uint32]*yamux.Session{}
	}
	f.mu.Unlock()
	for _, s := range closing {
		s.Close()
	}
}

func (f *fanout) refreshSoon() {
	select {
	case f.kick <- struct{}{}:
	default:
	}
}

func (f *fanout) run(ctx context.Context) {
	t := time.NewTicker(f.c.g.cfg.RefreshInterval)
	defer t.Stop()
	for {
		f.refresh(ctx)
		f.reportActivity(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		case <-f.kick:
		}
	}
}

type attach struct {
	d  *device
	fr forwardRequest
}

// refresh brings the devices in line with the user's ready sessions and opens
// every requested port that a device doesn't have yet.
func (f *fanout) refresh(ctx context.Context) {
	rctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	sessions, err := f.c.g.sessions.SSHUserSessions(rctx, f.handle)
	cancel()
	if err != nil {
		if ctx.Err() == nil {
			f.c.log.Warn("list sessions", "err", err)
		}
		return
	}

	ready := map[string]contract.SSHSession{}
	for _, s := range sessions {
		if s.State == contract.StateReady && s.TunnelURL != "" {
			ready[s.Provider+"-"+s.ID] = s
		}
	}

	now := time.Now()
	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		return
	}
	var closing []*yamux.Session
	for slug, d := range f.devices {
		if _, ok := ready[slug]; ok {
			continue
		}
		for _, s := range d.open {
			closing = append(closing, s)
		}
		delete(f.devices, slug)
		f.c.log.Info("session left", "session", slug)
	}
	for slug, s := range ready {
		if _, ok := f.devices[slug]; !ok {
			f.devices[slug] = &device{
				provider: s.Provider, id: s.ID, slug: slug, tunnel: contract.NewTunnelClient(s.TunnelURL, nil), reported: now,
				info: control.Session{Slug: slug, Provider: s.Provider, ID: s.ID, Package: s.Package, Label: s.Label, VersionName: s.VersionName},
				open: map[uint32]*yamux.Session{}, failed: map[uint32]time.Time{},
			}
			f.c.log.Info("session joined", "session", slug)
		}
	}
	var todo []attach
	for _, d := range f.devices {
		for port, p := range f.ports {
			if d.open[port] != nil {
				continue
			}
			if at, ok := d.failed[port]; ok && now.Sub(at) < retryAfter {
				continue
			}
			todo = append(todo, attach{d, p.fr})
		}
	}
	f.mu.Unlock()

	for _, s := range closing {
		s.Close()
	}
	f.c.sendSessions(f.sessions())
	for _, a := range todo {
		f.attach(ctx, a.d, a.fr)
	}
}

func (f *fanout) device(slug string) *device {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.devices[slug]
}

func (f *fanout) sessions() []control.Session {
	f.mu.Lock()
	list := make([]control.Session, 0, len(f.devices))
	for _, d := range f.devices {
		list = append(list, d.info)
	}
	f.mu.Unlock()
	slices.SortFunc(list, func(a, b control.Session) int { return strings.Compare(a.Slug, b.Slug) })
	return list
}

func (f *fanout) attach(ctx context.Context, d *device, fr forwardRequest) {
	dctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	sess, err := d.tunnel.Reverse(dctx, int(fr.Port), f.c.user)
	cancel()

	f.mu.Lock()
	_, wanted := f.ports[fr.Port]
	current := !f.closed && wanted && f.devices[d.slug] == d && d.open[fr.Port] == nil
	_, failedBefore := d.failed[fr.Port]
	switch {
	case err != nil && current:
		d.failed[fr.Port] = time.Now()
	case err == nil && current:
		d.open[fr.Port] = sess
		delete(d.failed, fr.Port)
	}
	f.mu.Unlock()

	if err != nil {
		if current && !failedBefore {
			f.c.tunnelOpenedOn(d.provider, d.id, "reverse", fr.Port, err)
			f.c.log.Info("port not published on a session", "session", d.slug, "port", fr.Port, "err", err)
		}
		return
	}
	if !current {
		sess.Close()
		return
	}
	f.c.tunnelOpenedOn(d.provider, d.id, "reverse", fr.Port, nil)
	tunnelsGauge.WithLabelValues("reverse").Inc()
	count := func(n int) {
		f.c.count(n)
		d.bytes.Add(int64(n))
	}
	go func() {
		defer tunnelsGauge.WithLabelValues("reverse").Dec()
		for {
			stream, err := sess.AcceptStream()
			if err != nil {
				break
			}
			go f.c.forwarded(fr, stream, count)
		}
		f.mu.Lock()
		if d.open[fr.Port] == sess {
			delete(d.open, fr.Port)
		}
		f.mu.Unlock()
	}()
}

// reportActivity counts traffic only for the session it went to, so one
// connection doesn't keep all of a user's devices from being reaped.
func (f *fanout) reportActivity(ctx context.Context) {
	now := time.Now()
	var active []string
	f.mu.Lock()
	for _, d := range f.devices {
		if now.Sub(d.reported) < f.c.g.cfg.ActivityInterval {
			continue
		}
		d.reported = now
		if d.bytes.Swap(0) > 0 {
			active = append(active, d.slug)
		}
	}
	f.mu.Unlock()
	for _, slug := range active {
		rctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		if err := f.c.g.sessions.SSHActivity(rctx, slug); err != nil && ctx.Err() == nil {
			f.c.log.Warn("session activity", "session", slug, "err", err)
		}
		cancel()
	}
}
