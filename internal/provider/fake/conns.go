package fake

import (
	"context"
	"fmt"
	"hash/fnv"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/recording"
)

// fakeConns are the connections the app opens to the names it looks up:
// one kept open per name, and a new one each time to api.example.com, as
// an app that doesn't reuse its connections would.
type fakeConns struct {
	mu   sync.Mutex
	next int
	open []contract.Connection
}

func fakeAddress(name string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(name))
	return fmt.Sprintf("203.0.113.%d", byte(h.Sum32()>>8))
}

func (f *fakeConns) touch(name, location string, now time.Time) {
	if strings.HasSuffix(name, ".invalid") {
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.open = slices.DeleteFunc(f.open, func(c contract.Connection) bool {
		return c.Host == name && name == "api.example.com" || now.Sub(c.Start) > 40*time.Second
	})
	for i := range f.open {
		f.open[i].Upload += 800
		f.open[i].Download += 12_000
	}
	if slices.ContainsFunc(f.open, func(c contract.Connection) bool { return c.Host == name }) {
		return
	}
	f.next++
	f.open = append(f.open, contract.Connection{
		ID: fmt.Sprintf("fake-%d", f.next), Start: now, Network: "tcp", Host: name,
		Address: fakeAddress(name), Port: 443, Outbound: location, Upload: 600, Download: 4000,
	})
}

func (f *fakeConns) snapshot(context.Context) ([]contract.Connection, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.open), nil
}

func (d *device) Connections(context.Context) contract.ConnectionsState {
	return contract.ConnectionsState{Available: true}
}

func (d *device) WatchConnections(ctx context.Context, send func(contract.Connection) error) error {
	return d.conns.Watch(ctx, send)
}

func (d *device) recordConnections(ctx context.Context, rec *recording.Recorder) {
	ch, stop := d.conns.Subscribe()
	defer stop()
	for {
		select {
		case <-ctx.Done():
			return
		case c := <-ch:
			rec.Event(contract.RecordingEvent{Type: contract.EventConn, Conn: &c})
		}
	}
}
