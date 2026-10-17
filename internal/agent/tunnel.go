package agent

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/hashicorp/yamux"

	"github.com/kriakiku/holtdroid/internal/contract"
)

// TunnelDevice is the device side of SSH tunnels. Connections made on the
// device to localhost:port arrive on the listener Reverse returns; closing it
// unpublishes the port.
type TunnelDevice interface {
	DialADB(ctx context.Context) (net.Conn, error)
	Reverse(ctx context.Context, port int) (net.Listener, error)
}

// Tunnels serves the tunnel endpoints the ssh-gateway opens on the agent's
// second port and keeps track of what is open for the UI.
type Tunnels struct {
	dev  TunnelDevice
	log  *slog.Logger
	now  func() time.Time
	ctx  context.Context
	stop context.CancelFunc

	mu      sync.Mutex
	nextID  int
	adb     map[int]contract.ADBTunnel
	reverse map[int]*contract.ReverseTunnel
	subs    map[chan struct{}]struct{}
}

func NewTunnels(dev TunnelDevice, log *slog.Logger) *Tunnels {
	ctx, stop := context.WithCancel(context.Background())
	return &Tunnels{
		dev: dev, log: log, now: time.Now, ctx: ctx, stop: stop,
		adb: map[int]contract.ADBTunnel{}, reverse: map[int]*contract.ReverseTunnel{}, subs: map[chan struct{}]struct{}{},
	}
}

func (t *Tunnels) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+contract.TunnelADBPath, t.serveADB)
	mux.HandleFunc("GET /tunnel/reverse/{port}", t.serveReverse)
	return mux
}

// Close drops every open tunnel.
func (t *Tunnels) Close() { t.stop() }

func (t *Tunnels) accept(w http.ResponseWriter, r *http.Request) (net.Conn, func(), error) {
	ws, err := websocket.Accept(w, r, nil)
	if err != nil {
		return nil, nil, err
	}
	ws.SetReadLimit(contract.TunnelReadLimit)
	stop := context.AfterFunc(t.ctx, func() { _ = ws.CloseNow() })
	return websocket.NetConn(r.Context(), ws, websocket.MessageBinary), func() { stop() }, nil
}

func (t *Tunnels) serveADB(w http.ResponseWriter, r *http.Request) {
	dev, err := t.dev.DialADB(r.Context())
	if err != nil {
		http.Error(w, "adb: "+err.Error(), http.StatusBadGateway)
		return
	}
	conn, done, err := t.accept(w, r)
	if err != nil {
		dev.Close()
		return
	}
	defer done()
	user := r.Header.Get(contract.TunnelUserHeader)

	t.mu.Lock()
	id := t.nextID
	t.nextID++
	t.adb[id] = contract.ADBTunnel{User: user, Since: t.now().UTC()}
	t.mu.Unlock()
	t.notify()
	t.log.Info("adb tunnel opened", "user", user)
	defer func() {
		t.mu.Lock()
		delete(t.adb, id)
		t.mu.Unlock()
		t.notify()
		t.log.Info("adb tunnel closed", "user", user)
	}()

	contract.Splice(conn, dev, nil)
}

func (t *Tunnels) serveReverse(w http.ResponseWriter, r *http.Request) {
	port, err := strconv.Atoi(r.PathValue("port"))
	if err != nil || port < 1 || port > 65535 {
		http.Error(w, "port must be 1-65535", http.StatusBadRequest)
		return
	}
	user := r.Header.Get(contract.TunnelUserHeader)

	t.mu.Lock()
	if held, busy := t.reverse[port]; busy {
		t.mu.Unlock()
		http.Error(w, fmt.Sprintf("port %d is already published by %s", port, held.User), http.StatusConflict)
		return
	}
	t.reverse[port] = &contract.ReverseTunnel{Port: port, User: user, Since: t.now().UTC()}
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		delete(t.reverse, port)
		t.mu.Unlock()
		t.notify()
	}()

	ln, err := t.dev.Reverse(r.Context(), port)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer ln.Close()
	conn, done, err := t.accept(w, r)
	if err != nil {
		return
	}
	defer done()
	sess, err := yamux.Client(conn, contract.YamuxConfig())
	if err != nil {
		conn.Close()
		return
	}
	defer sess.Close()
	go func() {
		<-sess.CloseChan()
		ln.Close()
	}()
	t.notify()
	t.log.Info("port published", "port", port, "user", user)
	defer t.log.Info("port unpublished", "port", port, "user", user)

	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		go t.forward(port, sess, conn)
	}
}

func (t *Tunnels) forward(port int, sess *yamux.Session, conn net.Conn) {
	stream, err := sess.OpenStream()
	if err != nil {
		conn.Close()
		return
	}
	t.connections(port, 1)
	defer t.connections(port, -1)
	contract.Splice(stream, conn, nil)
}

func (t *Tunnels) connections(port, delta int) {
	t.mu.Lock()
	if rt, ok := t.reverse[port]; ok {
		rt.Connections += delta
	}
	t.mu.Unlock()
	t.notify()
}

func (t *Tunnels) Snapshot() contract.Tunnels {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := contract.Tunnels{ADB: make([]contract.ADBTunnel, 0, len(t.adb)), Reverse: make([]contract.ReverseTunnel, 0, len(t.reverse))}
	for _, a := range t.adb {
		out.ADB = append(out.ADB, a)
	}
	for _, rt := range t.reverse {
		out.Reverse = append(out.Reverse, *rt)
	}
	slices.SortFunc(out.ADB, func(a, b contract.ADBTunnel) int { return a.Since.Compare(b.Since) })
	slices.SortFunc(out.Reverse, func(a, b contract.ReverseTunnel) int { return a.Port - b.Port })
	return out
}

func (t *Tunnels) Watch(ctx context.Context, send func(contract.Tunnels) error) error {
	ch := make(chan struct{}, 1)
	t.mu.Lock()
	t.subs[ch] = struct{}{}
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		delete(t.subs, ch)
		t.mu.Unlock()
	}()
	var last string
	for {
		snap := t.Snapshot()
		if key := fmt.Sprint(snap); key != last {
			if err := send(snap); err != nil {
				return err
			}
			last = key
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ch:
		}
	}
}

func (t *Tunnels) notify() {
	t.mu.Lock()
	defer t.mu.Unlock()
	for ch := range t.subs {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// adbTunnels reaches adbd over TCP and publishes ports with adb reverse.
type adbTunnels struct {
	adb  Device
	addr string
}

func (d adbTunnels) DialADB(ctx context.Context) (net.Conn, error) {
	var dialer net.Dialer
	return dialer.DialContext(ctx, "tcp", d.addr)
}

func (d adbTunnels) Reverse(ctx context.Context, port int) (net.Listener, error) {
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	local := ln.Addr().(*net.TCPAddr).Port
	if err := d.adb.Reverse(ctx, port, local); err != nil {
		ln.Close()
		return nil, fmt.Errorf("publish port %d on the device: %s", port, strings.TrimSpace(err.Error()))
	}
	return &reverseListener{Listener: ln, remove: func() {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		_ = d.adb.RemoveReverse(ctx, port)
	}}, nil
}

type reverseListener struct {
	net.Listener
	once   sync.Once
	remove func()
}

func (l *reverseListener) Close() error {
	l.once.Do(l.remove)
	return l.Listener.Close()
}
