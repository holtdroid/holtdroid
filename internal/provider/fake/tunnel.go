package fake

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"sync"

	"github.com/kriakiku/holtdroid/internal/contract"
)

// TunnelHandler serves the fake agents' tunnel endpoints under
// /agents/{id}/tunnel/; it belongs on its own listener like a real agent's.
func (p *Provider) TunnelHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/agents/{id}/tunnel/", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		d, err := p.device(id)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		http.StripPrefix("/agents/"+id, d.tunnels.Handler()).ServeHTTP(w, r)
	})
	return mux
}

// DialDevice connects to localhost:port as an app on the fake device would,
// reaching whatever an SSH client published there.
func (p *Provider) DialDevice(ctx context.Context, id string, port int) (net.Conn, error) {
	d, err := p.device(id)
	if err != nil {
		return nil, err
	}
	return d.ports.dial(ctx, port)
}

func (d *device) WatchTunnels(ctx context.Context, send func(contract.Tunnels) error) error {
	return d.tunnels.Watch(ctx, send)
}

// fakePorts stands in for the device: adbd is the fake device's, published
// ports are loopback listeners on this host.
type fakePorts struct {
	adbd  func(net.Conn)
	mu    sync.Mutex
	ports map[int]net.Listener
}

func (f *fakePorts) DialADB(context.Context) (net.Conn, error) {
	client, server := net.Pipe()
	go f.adbd(server)
	return client, nil
}

func (f *fakePorts) Reverse(ctx context.Context, port int) (net.Listener, error) {
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.ports == nil {
		f.ports = map[int]net.Listener{}
	}
	f.ports[port] = ln
	return &fakeListener{Listener: ln, release: func() {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.ports[port] == ln {
			delete(f.ports, port)
		}
	}}, nil
}

func (f *fakePorts) dial(ctx context.Context, port int) (net.Conn, error) {
	f.mu.Lock()
	ln, ok := f.ports[port]
	f.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("connect to localhost:%d: connection refused", port)
	}
	var dialer net.Dialer
	return dialer.DialContext(ctx, "tcp", ln.Addr().String())
}

type fakeListener struct {
	net.Listener
	release func()
}

func (l *fakeListener) Close() error {
	l.release()
	return l.Listener.Close()
}
