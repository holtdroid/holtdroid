// Package connect is the client a developer runs on their computer: it
// enrolls the computer with a portal, keeps its SSH certificate fresh,
// publishes chosen local ports on all of the user's devices and forwards
// each device's ADB to a local port.
package connect

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/ssh"

	"github.com/kriakiku/holtdroid/internal/contract/control"
	"github.com/kriakiku/holtdroid/internal/sshkey"
)

type Options struct {
	Portal string
	// Insecure skips TLS verification towards the portal, for portals with
	// a self-signed certificate. It is saved and stays on for the portal.
	Insecure bool
	Code     string
	Publish  []int
	// Mode replaces the saved publish mode when set.
	Mode       control.PublishMode
	ADBConnect bool
	Version    string
	Log        *slog.Logger
	// OnChange gets the client's state after every change. It is called
	// from the client's goroutines and must return quickly.
	OnChange func(Snapshot)
}

const firstADBPort = 15555

type Client struct {
	opts   Options
	store  *store
	signer ssh.Signer
	adb    string
	log    *slog.Logger
	kick   chan struct{}
	http   *http.Client

	mu        sync.Mutex
	st        state
	creds     control.Credentials
	hostname  string
	status    string
	connected bool
	banner    string
	sessions  []control.Session
	listening []control.LocalPort
	active    []int
	refused   map[int]string
	gateway   *control.Gateway

	ssh    atomic.Pointer[ssh.Client]
	devs   devices
	adbMu  sync.Mutex
	adbFwd map[string]*adbForward
}

type adbForward struct {
	port      int
	ln        net.Listener
	connected bool
}

// New loads (or makes) the computer's key and saved state for opts.Portal.
func New(opts Options) (*Client, error) {
	root, err := Dir()
	if err != nil {
		return nil, err
	}
	s, err := storeFor(root, opts.Portal)
	if err != nil {
		return nil, err
	}
	signer, err := s.key()
	if err != nil {
		return nil, fmt.Errorf("computer key: %w", err)
	}
	st, err := s.load()
	if err != nil {
		return nil, fmt.Errorf("saved state: %w", err)
	}
	st.Portal = opts.Portal
	if opts.Publish != nil {
		st.Published = opts.Publish
	}
	if opts.Mode != "" {
		st.Mode = opts.Mode
	}
	if st.Mode == "" {
		st.Mode = control.PublishManual
	}
	st.Insecure = st.Insecure || opts.Insecure
	if opts.Log == nil {
		opts.Log = slog.New(slog.DiscardHandler)
	}
	cl := &Client{
		opts: opts, store: s, signer: signer, log: opts.Log, st: st, kick: make(chan struct{}, 1), http: HTTPClient(st.Insecure),
		status: "starting", refused: map[int]string{}, adbFwd: map[string]*adbForward{},
	}
	if opts.ADBConnect {
		cl.adb, _ = exec.LookPath("adb")
	}
	return cl, nil
}

// Run enrolls with Options.Code, or uses the saved enrollment, and keeps
// the computer connected until ctx ends or the portal stops accepting it.
func Run(ctx context.Context, opts Options) error {
	cl, err := New(opts)
	if err != nil {
		return err
	}
	return cl.Run(ctx)
}

func (cl *Client) Run(ctx context.Context) error {
	var err error
	switch {
	case cl.opts.Code != "":
		cl.setStatus("enrolling", false)
		err = cl.enroll(ctx)
	case cl.st.RefreshToken == "":
		return errors.New("this computer is not enrolled with " + cl.opts.Portal + ": run the command from the portal's Computers page")
	default:
		cl.setStatus("signing in", false)
		err = cl.refresh(ctx)
	}
	if err != nil {
		return err
	}

	ctx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	defer cl.closeADB()
	defer cl.closeDevices()
	go cl.keepFresh(ctx, cancel)
	go cl.watchPorts(ctx)

	backoff := time.Second
	for {
		start := time.Now()
		cl.setStatus("connecting", false)
		err := cl.link(ctx)
		if ctx.Err() != nil {
			if cause := context.Cause(ctx); cause != nil && !errors.Is(cause, context.Canceled) {
				return cause
			}
			return nil
		}
		if errors.Is(err, errEnrollment) {
			return err
		}
		if time.Since(start) > time.Minute {
			backoff = time.Second
		}
		cl.setStatus(fmt.Sprintf("reconnecting in %s: %v", backoff, err), false)
		cl.log.Warn("disconnected, reconnecting", "in", backoff.String(), "err", err)
		select {
		case <-ctx.Done():
			continue
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, 30*time.Second)
	}
}

func (cl *Client) enroll(ctx context.Context) error {
	host, _ := os.Hostname()
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	creds, err := post[control.Credentials](ctx, cl.http, cl.opts.Portal, "/api/v1/connect/enroll", control.Enroll{
		Code: cl.opts.Code, PublicKey: sshkey.Authorized(cl.signer.PublicKey()), Hostname: host, OS: runtime.GOOS, Arch: runtime.GOARCH,
	})
	if err != nil {
		return fmt.Errorf("enroll: %w", err)
	}
	cl.log.Info("computer enrolled", "user", creds.User, "computer", creds.Computer)
	return cl.update(creds)
}

func (cl *Client) refresh(ctx context.Context) error {
	cl.mu.Lock()
	token := cl.st.RefreshToken
	cl.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	creds, err := post[control.Credentials](ctx, cl.http, cl.opts.Portal, "/api/v1/connect/refresh", control.Refresh{
		RefreshToken: token, PublicKey: sshkey.Authorized(cl.signer.PublicKey()),
	})
	if err != nil {
		return fmt.Errorf("refresh: %w", err)
	}
	return cl.update(creds)
}

func (cl *Client) update(creds control.Credentials) error {
	hostname := ""
	if pub, _, _, _, err := ssh.ParseAuthorizedKey([]byte(creds.Certificate)); err == nil {
		if cert, ok := pub.(*ssh.Certificate); ok {
			hostname = cert.Extensions[control.CertHostname]
		}
	}
	cl.mu.Lock()
	cl.creds = creds
	cl.hostname = hostname
	cl.st.RefreshToken, cl.st.ExpiresAt = creds.RefreshToken, creds.RefreshExpiresAt
	st := cl.st
	cl.mu.Unlock()
	cl.changed()
	return cl.store.save(st)
}

func (cl *Client) current() control.Credentials {
	cl.mu.Lock()
	defer cl.mu.Unlock()
	return cl.creds
}

func (cl *Client) setStatus(status string, connected bool) {
	cl.mu.Lock()
	cl.status, cl.connected = status, connected
	cl.mu.Unlock()
	cl.changed()
}

// SetPublished replaces the ports to publish on the user's devices, saves
// them and applies them to the current connection.
func (cl *Client) SetPublished(ports []int) error {
	ports = slices.Clone(ports)
	slices.Sort(ports)
	ports = slices.Compact(ports)
	cl.mu.Lock()
	cl.st.Published = ports
	st := cl.st
	cl.mu.Unlock()
	err := cl.store.save(st)
	cl.poke()
	cl.changed()
	return err
}

// SetMode switches how the client picks the ports it publishes and saves it.
func (cl *Client) SetMode(mode control.PublishMode) error {
	switch mode {
	case control.PublishManual, control.PublishDev, control.PublishAll:
	default:
		return fmt.Errorf("unknown publish mode %q", mode)
	}
	cl.mu.Lock()
	cl.st.Mode = mode
	st := cl.st
	cl.mu.Unlock()
	cl.log.Info("publish mode", "mode", mode)
	err := cl.store.save(st)
	cl.poke()
	cl.changed()
	return err
}

// TogglePublished publishes port, or stops publishing it.
func (cl *Client) TogglePublished(port int) error {
	cl.mu.Lock()
	ports := slices.Clone(cl.st.Published)
	auto := slices.Contains(autoPublished(cl.st.Mode, cl.listening), port)
	cl.mu.Unlock()
	if auto {
		return fmt.Errorf("%d is published automatically; switch to manual to pick ports one by one", port)
	}
	if i := slices.Index(ports, port); i >= 0 {
		ports = slices.Delete(ports, i, i+1)
	} else {
		ports = append(ports, port)
	}
	return cl.SetPublished(ports)
}

func (cl *Client) poke() {
	select {
	case cl.kick <- struct{}{}:
	default:
	}
}

// keepFresh renews the certificate well before it expires, which also
// rotates the refresh token. The connection itself outlives the certificate;
// a fresh one is only needed to reconnect.
func (cl *Client) keepFresh(ctx context.Context, cancel context.CancelCauseFunc) {
	for {
		left := time.Until(cl.current().CertificateExpiresAt)
		select {
		case <-ctx.Done():
			return
		case <-time.After(max(left/2, 10*time.Second)):
		}
		err := cl.refresh(ctx)
		switch {
		case errors.Is(err, errEnrollment):
			cancel(err)
			return
		case err != nil && ctx.Err() == nil:
			cl.log.Warn("could not renew the certificate, retrying", "err", err)
		}
	}
}

func (cl *Client) dial(ctx context.Context) (*ssh.Client, error) {
	creds := cl.current()
	if time.Until(creds.CertificateExpiresAt) < time.Minute {
		if err := cl.refresh(ctx); err != nil {
			return nil, err
		}
		creds = cl.current()
	}
	pub, _, _, _, err := ssh.ParseAuthorizedKey([]byte(creds.Certificate))
	if err != nil {
		return nil, fmt.Errorf("certificate: %w", err)
	}
	cert, ok := pub.(*ssh.Certificate)
	if !ok {
		return nil, errors.New("the portal sent a key instead of a certificate")
	}
	certSigner, err := ssh.NewCertSigner(cert, cl.signer)
	if err != nil {
		return nil, err
	}
	var hostKeys [][]byte
	for _, line := range creds.HostKeys {
		if k, _, _, _, err := ssh.ParseAuthorizedKey([]byte(line)); err == nil {
			hostKeys = append(hostKeys, k.Marshal())
		}
	}
	host := creds.Host
	if host == "" {
		if u, err := url.Parse(cl.opts.Portal); err == nil {
			host = u.Hostname()
		}
	}
	cfg := &ssh.ClientConfig{
		User: creds.Handle,
		Auth: []ssh.AuthMethod{ssh.PublicKeys(certSigner)},
		HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
			if slices.ContainsFunc(hostKeys, func(k []byte) bool { return string(k) == string(key.Marshal()) }) {
				return nil
			}
			return errors.New("the gateway's host key is not the one the portal named")
		},
		BannerCallback: func(msg string) error {
			cl.mu.Lock()
			cl.banner = strings.ReplaceAll(msg, "\r\n", "\n")
			cl.mu.Unlock()
			cl.changed()
			return nil
		},
		Timeout: 15 * time.Second,
	}
	var d net.Dialer
	nc, err := d.DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(creds.Port)))
	if err != nil {
		return nil, err
	}
	c, chans, reqs, err := ssh.NewClientConn(nc, nc.RemoteAddr().String(), cfg)
	if err != nil {
		nc.Close()
		return nil, err
	}
	return ssh.NewClient(c, chans, reqs), nil
}

// link is one SSH connection to the gateway.
type link struct {
	cl        *Client
	c         *ssh.Client
	w         io.Writer
	published map[int]net.Listener
	sent      []byte
}

func (cl *Client) link(ctx context.Context) error {
	c, err := cl.dial(ctx)
	if err != nil {
		return err
	}
	defer c.Close()
	cl.ssh.Store(c)
	defer cl.ssh.CompareAndSwap(c, nil)

	sess, err := c.NewSession()
	if err != nil {
		return err
	}
	w, err := sess.StdinPipe()
	if err != nil {
		return err
	}
	r, err := sess.StdoutPipe()
	if err != nil {
		return err
	}
	if err := sess.RequestSubsystem(control.Subsystem); err != nil {
		return fmt.Errorf("control channel: %w", err)
	}
	l := &link{cl: cl, c: c, w: w, published: map[int]net.Listener{}}
	defer l.closePublished()
	if err := l.send(control.Message{Type: control.TypeHello, Hello: &control.Hello{
		Version: cl.opts.Version, OS: runtime.GOOS, Arch: runtime.GOARCH,
	}}); err != nil {
		return err
	}
	cl.setStatus("connected", true)

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	msgs := make(chan control.Message)
	done := make(chan error, 2)
	go func() { done <- readControl(ctx, r, msgs) }()
	go func() { done <- keepalive(ctx, c) }()

	l.report()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-done:
			return err
		case m := <-msgs:
			switch m.Type {
			case control.TypeGateway:
				if m.Gateway != nil {
					cl.mu.Lock()
					cl.gateway = m.Gateway
					sessions := cl.sessions
					cl.mu.Unlock()
					cl.syncADB(sessions)
					l.publish()
				}
			case control.TypeSessions:
				cl.mu.Lock()
				cl.sessions = m.Sessions
				cl.mu.Unlock()
				cl.syncADB(m.Sessions)
				cl.changed()
			case control.TypePublish:
				if err := cl.SetPublished(m.Publish); err != nil {
					cl.log.Warn("could not save published ports", "err", err)
				}
				continue
			}
		case <-cl.kick:
			l.publish()
		}
		l.report()
	}
}

func readControl(ctx context.Context, r io.Reader, msgs chan<- control.Message) error {
	dec := json.NewDecoder(r)
	for {
		var m control.Message
		if err := dec.Decode(&m); err != nil {
			return fmt.Errorf("control channel: %w", err)
		}
		select {
		case msgs <- m:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func keepalive(ctx context.Context, c *ssh.Client) error {
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
		}
		replied := make(chan error, 1)
		go func() {
			_, _, err := c.SendRequest("keepalive@openssh.com", true, nil)
			replied <- err
		}()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-replied:
			if err != nil {
				return err
			}
		case <-time.After(30 * time.Second):
			return errors.New("the gateway stopped answering")
		}
	}
}

// watchPorts keeps the list of loopback listeners current for the
// connection and the UI, whether or not the computer is connected.
func (cl *Client) watchPorts(ctx context.Context) {
	names := map[int32]string{}
	warned := false
	for i := 0; ; i++ {
		if i%20 == 0 {
			names = map[int32]string{}
		}
		list, err := listening(ctx, names)
		switch {
		case err != nil && !warned && ctx.Err() == nil:
			cl.log.Warn("could not list local ports", "err", err)
			warned = true
		case err == nil:
			cl.mu.Lock()
			same := i > 0 && slices.Equal(list, cl.listening)
			cl.listening = list
			cl.mu.Unlock()
			if !same {
				cl.poke()
				cl.changed()
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(3 * time.Second):
		}
	}
}

func (l *link) send(m control.Message) error {
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	_, err = l.w.Write(append(b, '\n'))
	return err
}

// publish asks the gateway for exactly the wanted ports, keeping what is
// already open.
func (l *link) publish() {
	cl := l.cl
	cl.mu.Lock()
	want := cl.wanted()
	if cl.gateway == nil || !cl.gateway.Publish {
		want = nil
	}
	before := cl.refused
	cl.mu.Unlock()
	refused := map[int]string{}
	for port, ln := range l.published {
		if !slices.Contains(want, port) {
			ln.Close()
			delete(l.published, port)
			cl.log.Info("port unpublished", "port", port)
		}
	}
	for _, port := range want {
		if _, ok := l.published[port]; ok {
			continue
		}
		ln, err := l.c.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
		if err != nil {
			refused[port] = err.Error()
			if before[port] != err.Error() {
				cl.log.Warn("the gateway refused a port", "port", port, "err", err)
			}
			continue
		}
		l.published[port] = ln
		cl.log.Info("port published", "port", port)
		go serveLocal(ln, port)
	}
	cl.mu.Lock()
	cl.active = sortedKeys(l.published)
	cl.refused = refused
	cl.mu.Unlock()
	cl.changed()
}

func (l *link) closePublished() {
	for _, ln := range l.published {
		ln.Close()
	}
	l.cl.mu.Lock()
	l.cl.active = nil
	l.cl.gateway = nil
	l.cl.mu.Unlock()
}

// serveLocal connects each connection a device opens to the same port on
// this computer's loopback.
func serveLocal(ln net.Listener, port int) {
	for {
		remote, err := ln.Accept()
		if err != nil {
			return
		}
		go func() {
			local, err := dialLocal(port)
			if err != nil {
				remote.Close()
				return
			}
			splice(remote, local)
		}()
	}
}

func dialLocal(port int) (net.Conn, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var d net.Dialer
	p := strconv.Itoa(port)
	c, err := d.DialContext(ctx, "tcp", net.JoinHostPort("127.0.0.1", p))
	if err != nil {
		var err6 error
		if c, err6 = d.DialContext(ctx, "tcp", net.JoinHostPort("::1", p)); err6 != nil {
			return nil, err
		}
	}
	return c, nil
}

func splice(a, b net.Conn) {
	var wg sync.WaitGroup
	half := func(dst, src net.Conn) {
		defer wg.Done()
		_, _ = io.Copy(dst, src)
		if cw, ok := dst.(interface{ CloseWrite() error }); ok {
			_ = cw.CloseWrite()
		} else {
			dst.Close()
		}
	}
	wg.Add(2)
	go half(a, b)
	go half(b, a)
	wg.Wait()
	a.Close()
	b.Close()
}

// report sends the computer's state to the gateway when it changed.
func (l *link) report() {
	cl := l.cl
	cl.mu.Lock()
	st := control.State{
		Listening: nonNil(cl.listening), Published: nonNil(slices.Clone(cl.active)),
		Mode: cl.st.Mode, Pinned: nonNil(slices.Clone(cl.st.Published)),
	}
	cl.mu.Unlock()
	for _, a := range cl.adbDevices() {
		st.ADB = append(st.ADB, control.ADBPort{Session: a.Session, Port: a.Port})
	}
	st.ADB = nonNil(st.ADB)
	b, _ := json.Marshal(st)
	if string(b) == string(l.sent) {
		return
	}
	l.sent = b
	if err := l.send(control.Message{Type: control.TypeState, State: &st}); err != nil {
		cl.log.Warn("could not send state", "err", err)
	}
}

func sortedKeys[V any](m map[int]V) []int {
	keys := make([]int, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}

func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

// syncADB keeps one local ADB port per running session. The listeners
// outlive reconnects, so adb stays connected through a dropped link.
func (cl *Client) syncADB(sessions []control.Session) {
	cl.mu.Lock()
	if cl.gateway == nil || !cl.gateway.ADB {
		sessions = nil
	}
	cl.mu.Unlock()
	cl.adbMu.Lock()
	defer cl.adbMu.Unlock()
	for slug, f := range cl.adbFwd {
		if !slices.ContainsFunc(sessions, func(s control.Session) bool { return s.Slug == slug }) {
			f.ln.Close()
			delete(cl.adbFwd, slug)
			go func() { _ = cl.adbCommand("disconnect", f.port) }()
		}
	}
	for _, s := range sessions {
		if _, ok := cl.adbFwd[s.Slug]; ok {
			continue
		}
		f, err := cl.listenADB(s.Slug)
		if err != nil {
			cl.log.Warn("no local port for ADB", "session", s.Slug, "err", err)
			continue
		}
		cl.adbFwd[s.Slug] = f
		go func() {
			if cl.adbCommand("connect", f.port) == nil {
				cl.adbMu.Lock()
				f.connected = true
				cl.adbMu.Unlock()
				cl.changed()
			}
		}()
	}
}

func (cl *Client) listenADB(slug string) (*adbForward, error) {
	used := map[int]bool{}
	for _, f := range cl.adbFwd {
		used[f.port] = true
	}
	var last error
	for port := firstADBPort; port < firstADBPort+200; port++ {
		if used[port] {
			continue
		}
		var lc net.ListenConfig
		ln, err := lc.Listen(context.Background(), "tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
		if err != nil {
			last = err
			continue
		}
		go cl.serveADB(ln, slug)
		return &adbForward{port: port, ln: ln}, nil
	}
	return nil, last
}

func (cl *Client) serveADB(ln net.Listener, slug string) {
	for {
		local, err := ln.Accept()
		if err != nil {
			return
		}
		go func() {
			c := cl.ssh.Load()
			if c == nil {
				local.Close()
				return
			}
			remote, err := c.Dial("tcp", net.JoinHostPort(slug, "5555"))
			if err != nil {
				cl.log.Warn("ADB tunnel", "session", slug, "err", err)
				local.Close()
				return
			}
			splice(local, remote)
		}()
	}
}

func (cl *Client) adbDevices() []ADBDevice {
	cl.adbMu.Lock()
	defer cl.adbMu.Unlock()
	out := make([]ADBDevice, 0, len(cl.adbFwd))
	for slug, f := range cl.adbFwd {
		out = append(out, ADBDevice{Session: slug, Port: f.port, Connected: f.connected})
	}
	slices.SortFunc(out, func(a, b ADBDevice) int { return a.Port - b.Port })
	return out
}

func (cl *Client) closeADB() {
	cl.adbMu.Lock()
	defer cl.adbMu.Unlock()
	for slug, f := range cl.adbFwd {
		f.ln.Close()
		_ = cl.adbCommand("disconnect", f.port)
		delete(cl.adbFwd, slug)
	}
}

// adbCommand runs adb connect/disconnect for a local port when adb is
// installed, so the device shows up in `adb devices` by itself.
func (cl *Client) adbCommand(verb string, port int) error {
	if cl.adb == "" {
		return errors.New("adb is not installed")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, cl.adb, verb, net.JoinHostPort("127.0.0.1", strconv.Itoa(port))).CombinedOutput()
	if err == nil && (strings.Contains(string(out), "failed") || strings.Contains(string(out), "cannot")) {
		err = errors.New(strings.TrimSpace(string(out)))
	}
	if err != nil {
		cl.log.Debug("adb "+verb, "port", port, "err", err, "output", strings.TrimSpace(string(out)))
	}
	return err
}
