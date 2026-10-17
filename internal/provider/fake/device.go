package fake

import (
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/kriakiku/holtdroid/internal/agent"
	"github.com/kriakiku/holtdroid/internal/contract"
)

var progression = []contract.SessionState{
	contract.StateBooting,
	contract.StateInstalling,
	contract.StateInstrumenting,
	contract.StateReady,
}

type device struct {
	handler   http.Handler
	tunnels   *agent.Tunnels
	ports     *fakePorts
	mu        sync.Mutex
	s         contract.Session
	clip      string
	targetGen int
	appClosed bool
	settings  contract.DeviceState
	subs      map[chan struct{}]struct{}
	done      chan struct{}
	offers    func(location string) bool
}

func newDevice(s contract.Session, step time.Duration, offers func(string) bool) *device {
	d := &device{s: s, settings: defaultSettings(), subs: map[chan struct{}]struct{}{}, done: make(chan struct{}), offers: offers}
	d.handler = d.buildHandler()
	d.ports = &fakePorts{}
	d.tunnels = agent.NewTunnels(d.ports, slog.Default().With("component", "fake-agent", "session", s.ID))
	go d.run(step)
	return d
}

func (d *device) run(step time.Duration) {
	for _, state := range progression {
		select {
		case <-d.done:
			return
		case <-time.After(step):
		}
		d.update(func() { d.s.State = state })
	}
}

func (d *device) stop() {
	d.update(func() { d.s.State = contract.StateStopping })
	close(d.done)
	d.tunnels.Close()
}

func (d *device) session() contract.Session {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.s
}

func (d *device) touch(at time.Time) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if at.After(d.s.LastActivity) {
		d.s.LastActivity = at.UTC()
	}
}

func (d *device) update(fn func()) {
	d.mu.Lock()
	fn()
	subs := make([]chan struct{}, 0, len(d.subs))
	for ch := range d.subs {
		subs = append(subs, ch)
	}
	d.mu.Unlock()
	for _, ch := range subs {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (d *device) subscribe() (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	d.mu.Lock()
	d.subs[ch] = struct{}{}
	d.mu.Unlock()
	return ch, func() {
		d.mu.Lock()
		delete(d.subs, ch)
		d.mu.Unlock()
	}
}

func (d *device) snapshot() (contract.Session, string, int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.s, d.clip, d.targetGen
}
