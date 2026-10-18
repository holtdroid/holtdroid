package agent

import (
	"context"
	"errors"
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

	mu       sync.Mutex
	nextID   int
	adb      map[int]contract.ADBTunnel
	reverse  map[int]*contract.ReverseTunnel
	sessions map[int]*yamux.Session
	subs     map[chan struct{}]struct{}
	probers  int
	prober   bool
	backoff  map[int]probeBackoff

	probeEvery time.Duration
	probeWait  time.Duration
}

func NewTunnels(dev TunnelDevice, log *slog.Logger) *Tunnels {
	ctx, stop := context.WithCancel(context.Background())
	return &Tunnels{
		dev: dev, log: log, now: time.Now, ctx: ctx, stop: stop,
		adb: map[int]contract.ADBTunnel{}, reverse: map[int]*contract.ReverseTunnel{}, sessions: map[int]*yamux.Session{},
		subs: map[chan struct{}]struct{}{}, backoff: map[int]probeBackoff{}, probeEvery: 5 * time.Second, probeWait: 2 * time.Second,
	}
}

func (t *Tunnels) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+contract.TunnelADBPath, t.ServeADB(contract.ADBClientSSH))
	mux.HandleFunc("GET /tunnel/reverse/{port}", t.serveReverse)
	return mux
}

// Close drops every open tunnel.
func (t *Tunnels) Close() { t.stop() }

func (t *Tunnels) accept(w http.ResponseWriter, r *http.Request) (net.Conn, func(), error) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return nil, nil, err
	}
	ws.SetReadLimit(contract.TunnelReadLimit)
	stop := context.AfterFunc(t.ctx, func() { _ = ws.CloseNow() })
	return websocket.NetConn(r.Context(), ws, websocket.MessageBinary), func() { stop() }, nil
}

// ServeADB relays one adb connection from client, refusing services that
// would cut the device off (filterADB).
func (t *Tunnels) ServeADB(client string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { t.serveADB(w, r, client) }
}

func (t *Tunnels) serveADB(w http.ResponseWriter, r *http.Request, client string) {
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
	t.adb[id] = contract.ADBTunnel{User: user, Client: client, Since: t.now().UTC()}
	t.mu.Unlock()
	t.notify()
	t.log.Info("adb tunnel opened", "user", user, "client", client)
	defer func() {
		t.mu.Lock()
		delete(t.adb, id)
		t.mu.Unlock()
		t.notify()
		t.log.Info("adb tunnel closed", "user", user, "client", client)
	}()

	filterADB(conn, dev)
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
	t.reverse[port] = &contract.ReverseTunnel{Port: port, User: user, Since: t.now().UTC(), State: contract.PortUnknown}
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		delete(t.reverse, port)
		delete(t.sessions, port)
		delete(t.backoff, port)
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
	t.mu.Lock()
	t.sessions[port] = sess
	t.mu.Unlock()
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
	contract.Splice(&answered{Stream: stream, up: func() { t.up(port) }}, conn, nil)
}

// answered marks the port up once the publisher's side sends anything back.
type answered struct {
	*yamux.Stream
	once sync.Once
	up   func()
}

func (a *answered) CloseWrite() error { return a.Close() }

func (a *answered) Read(p []byte) (int, error) {
	n, err := a.Stream.Read(p)
	if n > 0 {
		a.once.Do(a.up)
	}
	return n, err
}

func (t *Tunnels) setState(port int, state contract.PortState) {
	t.mu.Lock()
	rt, ok := t.reverse[port]
	changed := ok && rt.State != state
	if changed {
		rt.State = state
	}
	t.mu.Unlock()
	if changed {
		t.notify()
	}
}

func (t *Tunnels) up(port int) {
	t.mu.Lock()
	delete(t.backoff, port)
	t.mu.Unlock()
	t.setState(port, contract.PortUp)
}

// probeBackoff spaces out probes of a port that is down: every refused probe
// prints "connect_to … failed" in the publisher's terminal.
type probeBackoff struct {
	next  time.Time
	delay time.Duration
}

const maxProbeBackoff = 12

// probe opens a stream the way a device connection would. The gateway closes
// it at once when the publisher's ssh can't reach its local port; a server
// that is there keeps it open, waiting for a request, or answers.
func (t *Tunnels) probe(port int, sess *yamux.Session) {
	stream, err := sess.OpenStream()
	if err != nil {
		return
	}
	defer stream.Close()
	_ = stream.SetReadDeadline(time.Now().Add(t.probeWait))
	n, err := stream.Read(make([]byte, 1))
	var ne net.Error
	if n > 0 || errors.As(err, &ne) && ne.Timeout() {
		t.up(port)
		return
	}
	t.mu.Lock()
	b := t.backoff[port]
	b.delay = min(max(2*b.delay, t.probeEvery), maxProbeBackoff*t.probeEvery)
	b.next = time.Now().Add(b.delay)
	t.backoff[port] = b
	t.mu.Unlock()
	t.setState(port, contract.PortDown)
}

// probing checks every published port while someone watches with probe on.
func (t *Tunnels) probing() {
	tick := time.NewTicker(t.probeEvery)
	defer tick.Stop()
	for {
		t.mu.Lock()
		if t.probers == 0 {
			t.prober = false
			t.mu.Unlock()
			return
		}
		now := time.Now()
		sessions := make(map[int]*yamux.Session, len(t.sessions))
		for port, sess := range t.sessions {
			if now.After(t.backoff[port].next) {
				sessions[port] = sess
			}
		}
		t.mu.Unlock()
		var wg sync.WaitGroup
		for port, sess := range sessions {
			wg.Go(func() { t.probe(port, sess) })
		}
		wg.Wait()
		select {
		case <-t.ctx.Done():
			t.mu.Lock()
			t.prober = false
			t.mu.Unlock()
			return
		case <-tick.C:
		}
	}
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

func (t *Tunnels) Watch(ctx context.Context, probe bool, send func(contract.Tunnels) error) error {
	ch := make(chan struct{}, 1)
	t.mu.Lock()
	t.subs[ch] = struct{}{}
	if probe {
		t.probers++
		if !t.prober {
			t.prober = true
			go t.probing()
		}
	}
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		delete(t.subs, ch)
		if probe {
			t.probers--
		}
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

// adbTunnels reaches adbd over TCP, or the device through the host's adb
// server and ADBProxy, and publishes ports with adb reverse.
type adbTunnels struct {
	adb   Device
	addr  string
	proxy *ADBProxy
}

func newADBTunnels(cfg Config, dev Device, log *slog.Logger) adbTunnels {
	t := adbTunnels{adb: dev, addr: cfg.ADBAddr}
	if cfg.ADBAddr == "" && cfg.ADBServer != "" {
		t.proxy = NewADBProxy(cfg.ADBServer, cfg.Serial, cfg.ADBShell, log)
	}
	return t
}

func (d adbTunnels) DialADB(ctx context.Context) (net.Conn, error) {
	if d.proxy != nil {
		return d.proxy.Dial(ctx)
	}
	if d.addr == "" {
		return nil, errors.New("this device has no ADB tunnels")
	}
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
