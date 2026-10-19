package fake

import (
	"context"
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
	contract.StateRestoring,
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
	screen    contract.Screen
	settings  contract.DeviceState
	subs      map[chan struct{}]struct{}
	done      chan struct{}
	offers    func(location string) bool
	appData   *contract.AppDataRestore
	files     map[string][]byte
	restored  int
	fs        *fakeFS
	log       fakeLog
	adb       adbState
}

func newDevice(s contract.Session, step time.Duration, offers func(string) bool, appData *contract.AppDataRestore) *device {
	d := &device{s: s, settings: defaultSettings(), screen: contract.Screen{On: true}, subs: map[chan struct{}]struct{}{}, done: make(chan struct{}), offers: offers, appData: appData}
	d.ports = &fakePorts{adbd: d.serveADB}
	d.tunnels = agent.NewTunnels(d.ports, slog.Default().With("component", "fake-agent", "session", s.ID))
	d.handler = d.buildHandler()
	go d.run(step)
	go d.generateLogs()
	return d
}

func (d *device) run(step time.Duration) {
	for _, state := range progression {
		if state == contract.StateRestoring && d.appData == nil {
			continue
		}
		select {
		case <-d.done:
			return
		case <-time.After(step):
		}
		d.update(func() { d.s.State = state })
		if state == contract.StateRestoring {
			if err := d.restore(context.Background(), *d.appData); err != nil {
				d.update(func() { d.s.State, d.s.Reason = contract.StateFailed, "restore app data: "+err.Error() })
				return
			}
		}
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
