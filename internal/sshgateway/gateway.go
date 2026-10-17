// Package sshgateway is the SSH entry point to sessions: it routes by user
// name, authenticates against keys pushed by the api, and only carries ADB
// and published-port tunnels to the session's agent. It never runs commands.
package sshgateway

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/hashicorp/yamux"
	"golang.org/x/crypto/ssh"

	"github.com/kriakiku/holtdroid/internal/audit"
	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/secrets"
)

type Config struct {
	Listen                  string
	HTTPListen              string
	HostKey                 secrets.Ref
	APIURL                  string
	PortalURL               string
	KeyRequests             bool
	KeyRequestTimeout       time.Duration
	AllowADB                bool
	AllowReverse            bool
	ClientIsolation         bool
	ReversePorts            string
	KeyTTL                  time.Duration
	MaxTunnelsPerConnection int
	ActivityInterval        time.Duration
	RefreshInterval         time.Duration
}

func DefaultConfig() Config {
	return Config{
		Listen:                  ":2222",
		HTTPListen:              ":8080",
		APIURL:                  "http://localhost:8081",
		KeyRequests:             true,
		KeyRequestTimeout:       5 * time.Minute,
		AllowADB:                true,
		AllowReverse:            true,
		ClientIsolation:         true,
		ReversePorts:            "1-65535",
		KeyTTL:                  24 * time.Hour,
		MaxTunnelsPerConnection: 32,
		ActivityInterval:        30 * time.Second,
		RefreshInterval:         5 * time.Second,
	}
}

func (c Config) Validate() error {
	var errs []error
	if c.APIURL == "" {
		errs = append(errs, errors.New("apiURL is required"))
	}
	if _, err := parsePorts(c.ReversePorts); err != nil {
		errs = append(errs, fmt.Errorf("reversePorts: %w", err))
	}
	if c.KeyTTL <= 0 || c.ActivityInterval <= 0 || c.KeyRequestTimeout <= 0 || c.RefreshInterval <= 0 {
		errs = append(errs, errors.New("keyTTL, keyRequestTimeout, activityInterval and refreshInterval must be positive"))
	}
	if c.MaxTunnelsPerConnection < 1 {
		errs = append(errs, errors.New("maxTunnelsPerConnection must be at least 1"))
	}
	return errors.Join(errs...)
}

// HostKey reads the PEM private key ref points to. Without one it makes a
// throwaway key, so clients see a new host key after every restart.
func HostKey(ctx context.Context, reg *secrets.Registry, ref secrets.Ref, log *slog.Logger) (ssh.Signer, error) {
	if ref.IsZero() {
		log.Warn("no hostKey configured, using a temporary one")
		_, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return nil, err
		}
		return ssh.NewSignerFromKey(key)
	}
	pem, err := reg.Resolve(ctx, ref)
	if err != nil {
		return nil, fmt.Errorf("hostKey: %w", err)
	}
	signer, err := ssh.ParsePrivateKey([]byte(pem))
	if err != nil {
		return nil, errors.New("hostKey: not a PEM private key without a passphrase")
	}
	return signer, nil
}

type Gateway struct {
	cfg      Config
	hostKey  ssh.Signer
	keys     *Keys
	sessions contract.SSHSessions
	ports    portSet
	audit    *audit.Logger
	log      *slog.Logger
}

type rejection struct {
	reason  error
	message string
}

var (
	errUnknownKey   = errors.New("unknown key")
	errNoSession    = errors.New("no such session")
	errNotConfirmed = errors.New("key was not added in time")
)

const (
	unknownKeyMessage = "This key is not registered. Add it on the portal's SSH keys page and keep the portal open\r\n" +
		"for a moment: keys are sent to the gateway while it is open and expire after a while.\r\n"
	notFoundMessage    = "Not found.\r\n"
	unavailableMessage = "Temporarily unavailable, try again later.\r\n"
)

var notFound = &rejection{errNoSession, notFoundMessage}

func New(cfg Config, hostKey ssh.Signer, keys *Keys, sessions contract.SSHSessions, aud *audit.Logger, log *slog.Logger) (*Gateway, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	ports, _ := parsePorts(cfg.ReversePorts)
	return &Gateway{cfg: cfg, hostKey: hostKey, keys: keys, sessions: sessions, ports: ports, audit: aud, log: log}, nil
}

// login is the authentication state of one connection.
type login struct {
	g         *Gateway
	nc        net.Conn
	pre       ssh.ServerPreAuthConn
	slug      string
	sess      *contract.SSHSession
	sessErr   *rejection
	known     *bool
	rejected  *rejection
	proven    ssh.PublicKey
	explained bool
}

// session resolves the slug once per connection. Anything that isn't a
// ready session is "not found", with nothing that names the software, so
// neither slugs nor the gateway itself can be probed.
func (l *login) session(slug string) (contract.SSHSession, *rejection) {
	if l.sess == nil && l.sessErr == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		sess, err := l.g.sessions.SSHSession(ctx, slug)
		switch {
		case errors.Is(err, contract.ErrNotFound):
			l.sessErr = notFound
		case err != nil:
			l.g.log.Warn("resolve session", "slug", slug, "err", err)
			return contract.SSHSession{}, &rejection{err, unavailableMessage}
		case sess.State != contract.StateReady || sess.TunnelURL == "":
			l.sessErr = notFound
		default:
			l.sess = &sess
		}
	}
	if l.sessErr != nil {
		return contract.SSHSession{}, l.sessErr
	}
	return *l.sess, nil
}

// authorizeHandle lets a user in as their own handle. Like a slug, a handle
// nobody is known by is "not found" before any key is looked at.
func (l *login) authorizeHandle(handle string, key ssh.PublicKey) (*ssh.Permissions, *rejection) {
	id, ok := l.g.keys.Lookup(ssh.FingerprintSHA256(key))
	if ok {
		if id.Handle != handle {
			return nil, notFound
		}
		return &ssh.Permissions{Extensions: map[string]string{"user": id.User, "handle": handle}}, nil
	}
	if l.known == nil {
		known := l.g.keys.HandleKnown(handle)
		if !known {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			sessions, err := l.g.sessions.SSHUserSessions(ctx, handle)
			cancel()
			if err != nil {
				l.g.log.Warn("resolve handle", "handle", handle, "err", err)
				return nil, &rejection{err, unavailableMessage}
			}
			known = len(sessions) > 0
		}
		l.known = &known
	}
	if !*l.known {
		return nil, notFound
	}
	return nil, &rejection{errUnknownKey, unknownKeyMessage}
}

// authorize checks the session first and only then the key, maps the key to
// the user who registered it and checks they may use the session. Forbidden
// sessions fail like missing ones.
func (l *login) authorize(slug string, key ssh.PublicKey) (*ssh.Permissions, *rejection) {
	if isHandle(slug) {
		return l.authorizeHandle(slug, key)
	}
	sess, r := l.session(slug)
	if r != nil {
		return nil, r
	}
	id, ok := l.g.keys.Lookup(ssh.FingerprintSHA256(key))
	if !ok {
		return nil, &rejection{errUnknownKey, unknownKeyMessage}
	}
	if l.g.cfg.ClientIsolation && sess.Owner != id.User && !id.Admin {
		return nil, notFound
	}
	return &ssh.Permissions{Extensions: map[string]string{
		"user": id.User, "tunnel": sess.TunnelURL, "provider": sess.Provider, "id": sess.ID,
	}}, nil
}

func (g *Gateway) serverConfig(l *login) *ssh.ServerConfig {
	cfg := &ssh.ServerConfig{
		PublicKeyCallback:           l.publicKey,
		VerifiedPublicKeyCallback:   l.verified,
		KeyboardInteractiveCallback: l.explain,
		PreAuthConnCallback:         func(c ssh.ServerPreAuthConn) { l.pre = c },
		ServerVersion:               serverVersion,
		MaxAuthTries:                10,
	}
	cfg.AddHostKey(g.hostKey)
	return cfg
}

// publicKey lets the first unknown key through to the signature, so the
// client proves it holds the key before it may be offered to the portal.
func (l *login) publicKey(meta ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
	l.slug = meta.User()
	perms, r := l.authorize(meta.User(), key)
	if r == nil {
		return perms, nil
	}
	if errors.Is(r.reason, errUnknownKey) && l.g.cfg.KeyRequests && l.proven == nil {
		return &ssh.Permissions{Extensions: map[string]string{"request": "true"}}, nil
	}
	l.reject(r)
	return nil, r.reason
}

// verified turns a signature by an unknown key into partial success: the
// client starts over with all its keys, so a registered one still logs in,
// and only once every key failed does explain offer the proven one.
func (l *login) verified(meta ssh.ConnMetadata, key ssh.PublicKey, perms *ssh.Permissions, _ string) (*ssh.Permissions, error) {
	if perms == nil {
		return nil, nil
	}
	if perms.Extensions["request"] == "" {
		l.welcome(meta, perms)
		return perms, nil
	}
	l.proven = key
	return nil, &ssh.PartialSuccessError{Next: ssh.ServerAuthCallbacks{
		PublicKeyCallback: l.publicKey, KeyboardInteractiveCallback: l.explain,
	}}
}

// reject remembers why a key was refused. Clients try every key they have,
// so the reason is only shown by explain, once all of them failed; a key the
// gateway knows says more than an unknown one.
func (l *login) reject(r *rejection) {
	if l.rejected == nil || errors.Is(l.rejected.reason, errUnknownKey) {
		l.rejected = r
	}
}

// explain runs as keyboard-interactive, which clients try after every
// public key failed, and prints the reason without asking anything.
func (l *login) explain(meta ssh.ConnMetadata, challenge ssh.KeyboardInteractiveChallenge) (*ssh.Permissions, error) {
	if l.explained {
		return nil, errors.New("public key required")
	}
	l.explained = true
	if l.proven != nil && (l.rejected == nil || errors.Is(l.rejected.reason, errUnknownKey)) {
		return l.request(meta, challenge)
	}
	r := l.rejected
	if r == nil {
		if _, r = l.session(meta.User()); r == nil {
			r = &rejection{errUnknownKey, unknownKeyMessage}
		}
	}
	say(challenge, r.message)
	return nil, errors.New("public key required")
}

func say(challenge ssh.KeyboardInteractiveChallenge, msg string) {
	_, _ = challenge("", strings.TrimRight(msg, "\r\n"), nil, nil)
}

// request prints a link to add the proven key in the portal and holds the
// connection until the key reaches this gateway.
func (l *login) request(meta ssh.ConnMetadata, challenge ssh.KeyboardInteractiveChallenge) (*ssh.Permissions, error) {
	g := l.g
	fp := ssh.FingerprintSHA256(l.proven)
	timeout := g.cfg.KeyRequestTimeout
	code, err := g.keys.addRequest(contract.KeyRequest{
		PublicKey:   strings.TrimSpace(string(ssh.MarshalAuthorizedKey(l.proven))),
		Fingerprint: fp,
		Session:     meta.User(),
		ClientIP:    hostOf(meta.RemoteAddr()),
		ExpiresAt:   time.Now().Add(timeout).UTC(),
	})
	if err != nil {
		l.rejected = &rejection{err, unknownKeyMessage}
		say(challenge, unknownKeyMessage)
		return nil, err
	}
	defer g.keys.dropRequest(code)
	_ = l.nc.SetDeadline(time.Now().Add(timeout + 30*time.Second))
	defer func() { _ = l.nc.SetDeadline(time.Now().Add(30 * time.Second)) }()
	keyRequestsTotal.WithLabelValues("created").Inc()
	g.log.Info("waiting for a key to be added", "fingerprint", fp, "session", meta.User(), "remote", meta.RemoteAddr().String())
	say(challenge, g.keyRequestMessage(code, fp, timeout))

	deadline := time.Now().Add(timeout)
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	for {
		if _, ok := g.keys.Lookup(fp); ok {
			break
		}
		if time.Now().After(deadline) {
			keyRequestsTotal.WithLabelValues("expired").Inc()
			l.rejected = &rejection{errNotConfirmed, "The key was not added in time. Run ssh again for a new link.\r\n"}
			say(challenge, l.rejected.message)
			return nil, errNotConfirmed
		}
		<-tick.C
	}
	keyRequestsTotal.WithLabelValues("added").Inc()
	l.sess, l.sessErr, l.known = nil, nil, nil
	perms, r := l.authorize(meta.User(), l.proven)
	if r != nil {
		l.rejected = r
		say(challenge, r.message)
		return nil, r.reason
	}
	l.welcome(meta, perms)
	return perms, nil
}

func (g *Gateway) keyRequestMessage(code, fp string, timeout time.Duration) string {
	link := "/ssh?request=" + code
	if g.cfg.PortalURL != "" {
		link = strings.TrimRight(g.cfg.PortalURL, "/") + link
	} else {
		link = "the portal's " + link
	}
	return "This key is not registered yet. To add it to your account, open\r\n\r\n" +
		"    " + link + "\r\n\r\n" +
		"and check that the portal shows " + fp + ".\r\n" +
		"Waiting " + timeout.String() + " for it; the connection continues once the key is added.\r\n"
}

// Serve accepts SSH connections on ln until ctx ends.
func (g *Gateway) Serve(ctx context.Context, ln net.Listener) {
	stop := context.AfterFunc(ctx, func() { ln.Close() })
	defer stop()
	g.log.Info("ssh listening", "addr", ln.Addr().String())
	for {
		nc, err := ln.Accept()
		if err != nil {
			if ctx.Err() == nil {
				g.log.Error("ssh accept", "err", err)
			}
			return
		}
		go g.handle(ctx, nc)
	}
}

func (g *Gateway) handle(ctx context.Context, nc net.Conn) {
	_ = nc.SetDeadline(time.Now().Add(30 * time.Second))
	l := &login{g: g, nc: nc}
	sc, chans, reqs, err := ssh.NewServerConn(nc, g.serverConfig(l))
	remote := hostOf(nc.RemoteAddr())
	if err != nil {
		g.log.Debug("ssh handshake", "remote", nc.RemoteAddr().String(), "err", err)
		nc.Close()
		if l.rejected != nil {
			loginsTotal.WithLabelValues(string(audit.Denied)).Inc()
			g.audit.Emit(ctx, audit.Event{
				Action: audit.SSHConnect, Result: audit.Denied, Reason: l.rejected.reason.Error(), ClientIP: remote,
				Details: map[string]string{"slug": l.slug},
			})
		}
		return
	}
	_ = nc.SetDeadline(time.Time{})

	ctx, cancel := context.WithCancel(ctx)
	c := &conn{
		g:        g,
		sc:       sc,
		user:     sc.Permissions.Extensions["user"],
		slug:     sc.User(),
		tunnel:   contract.NewTunnelClient(sc.Permissions.Extensions["tunnel"], nil),
		cancel:   cancel,
		forward:  map[uint32]*forward{},
		provider: sc.Permissions.Extensions["provider"],
		id:       sc.Permissions.Extensions["id"],
		remote:   remote,
	}
	log := g.log.With("user", c.user, "session", c.slug, "remote", nc.RemoteAddr().String())
	c.log = log
	log.Info("ssh connected")
	loginsTotal.WithLabelValues(string(audit.OK)).Inc()
	connectionsGauge.Inc()
	c.emit(audit.SSHConnect, nil, nil)
	start := time.Now()
	stop := context.AfterFunc(ctx, func() { sc.Close() })
	defer func() {
		stop()
		cancel()
		sc.Close()
		c.closeForwards()
		connectionsGauge.Dec()
		c.emit(audit.SSHDisconnect, nil, map[string]string{
			"seconds": strconv.Itoa(int(time.Since(start).Seconds())), "bytes": strconv.FormatInt(c.total.Load(), 10),
		})
		log.Info("ssh disconnected")
	}()

	if handle := sc.Permissions.Extensions["handle"]; handle != "" {
		c.fan = newFanout(c, handle)
		go c.fan.run(ctx)
	} else {
		go c.watch(ctx)
	}
	go c.globalRequests(ctx, reqs)
	for nch := range chans {
		go c.channel(ctx, nch)
	}
}

type conn struct {
	g        *Gateway
	sc       *ssh.ServerConn
	user     string
	slug     string
	provider string
	id       string
	remote   string
	tunnel   *contract.TunnelClient
	cancel   context.CancelFunc
	log      *slog.Logger
	bytes    atomic.Int64
	total    atomic.Int64

	mu      sync.Mutex
	open    int
	forward map[uint32]*forward
	fan     *fanout
}

type forward struct {
	sess     *yamux.Session
	canceled atomic.Bool
}

func (c *conn) count(n int) {
	c.bytes.Add(int64(n))
	c.total.Add(int64(n))
	bytesTotal.Add(float64(n))
}

func (c *conn) emit(action audit.Action, err error, details map[string]string) {
	c.emitOn(c.provider, c.id, action, err, details)
}

func (c *conn) emitOn(provider, id string, action audit.Action, err error, details map[string]string) {
	ev := audit.Event{Action: action, Actor: c.user, Provider: provider, Session: id, ClientIP: c.remote, Details: details}
	switch {
	case err == nil:
	case errors.Is(err, errDenied):
		ev.Result, ev.Reason = audit.Denied, err.Error()
	default:
		ev.Result, ev.Reason = audit.Failed, err.Error()
	}
	c.g.audit.Emit(context.Background(), ev)
}

func (c *conn) tunnelOpened(kind string, port uint32, err error) {
	c.tunnelOpenedOn(c.provider, c.id, kind, port, err)
}

func (c *conn) tunnelOpenedOn(provider, id, kind string, port uint32, err error) {
	result := audit.OK
	switch {
	case errors.Is(err, errDenied):
		result = audit.Denied
	case err != nil:
		result = audit.Failed
	}
	tunnelsTotal.WithLabelValues(kind, string(result)).Inc()
	c.emitOn(provider, id, audit.SSHTunnel, err, map[string]string{"kind": kind, "port": strconv.FormatUint(uint64(port), 10)})
}

var errDenied = errors.New("not allowed")

func hostOf(addr net.Addr) string {
	host, _, err := net.SplitHostPort(addr.String())
	if err != nil {
		return addr.String()
	}
	return host
}

// reserve takes one of the connection's tunnel slots.
func (c *conn) reserve() (func(), bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.open >= c.g.cfg.MaxTunnelsPerConnection {
		return nil, false
	}
	c.open++
	return sync.OnceFunc(func() {
		c.mu.Lock()
		c.open--
		c.mu.Unlock()
	}), true
}

// watch reports traffic as session activity and drops the connection once
// the session is gone.
func (c *conn) watch(ctx context.Context) {
	t := time.NewTicker(c.g.cfg.ActivityInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		rctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		var err error
		if c.bytes.Swap(0) > 0 {
			err = c.g.sessions.SSHActivity(rctx, c.slug)
		} else {
			var s contract.SSHSession
			s, err = c.g.sessions.SSHSession(rctx, c.slug)
			if err == nil && s.State != contract.StateReady {
				err = contract.ErrNotFound
			}
		}
		cancel()
		if errors.Is(err, contract.ErrNotFound) {
			c.log.Info("session ended, closing the connection")
			c.cancel()
			return
		}
		if err != nil && ctx.Err() == nil {
			c.log.Warn("session check", "err", err)
		}
	}
}

type forwardRequest struct {
	Addr string
	Port uint32
}

type forwardedTCPIP struct {
	Addr     string
	Port     uint32
	OrigAddr string
	OrigPort uint32
}

type directTCPIP struct {
	DestAddr string
	DestPort uint32
	OrigAddr string
	OrigPort uint32
}

func (c *conn) globalRequests(ctx context.Context, reqs <-chan *ssh.Request) {
	for req := range reqs {
		switch req.Type {
		case "tcpip-forward":
			var fr forwardRequest
			if err := ssh.Unmarshal(req.Payload, &fr); err != nil {
				_ = req.Reply(false, nil)
				continue
			}
			var err error
			if c.fan != nil {
				err = c.fan.add(fr)
			} else {
				err = c.startForward(ctx, fr)
				c.tunnelOpened("reverse", fr.Port, err)
			}
			if err != nil {
				c.log.Info("port not published", "port", fr.Port, "err", err)
			}
			_ = req.Reply(err == nil, nil)
		case "cancel-tcpip-forward":
			var fr forwardRequest
			if err := ssh.Unmarshal(req.Payload, &fr); err != nil {
				_ = req.Reply(false, nil)
				continue
			}
			if c.fan != nil {
				_ = req.Reply(c.fan.remove(fr.Port), nil)
			} else {
				_ = req.Reply(c.stopForward(fr.Port), nil)
			}
		default:
			if req.WantReply {
				_ = req.Reply(false, nil)
			}
		}
	}
}

func (c *conn) startForward(ctx context.Context, fr forwardRequest) error {
	switch {
	case !c.g.cfg.AllowReverse:
		return fmt.Errorf("publishing ports is disabled: %w", errDenied)
	case fr.Port == 0 || !c.g.ports.contains(int(fr.Port)):
		return fmt.Errorf("port %d: %w", fr.Port, errDenied)
	}
	c.mu.Lock()
	_, dup := c.forward[fr.Port]
	c.mu.Unlock()
	if dup {
		return fmt.Errorf("port %d is already published by this connection", fr.Port)
	}
	release, ok := c.reserve()
	if !ok {
		return errors.New("too many tunnels on one connection")
	}
	dctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	sess, err := c.tunnel.Reverse(dctx, int(fr.Port), c.user)
	cancel()
	if err != nil {
		release()
		return err
	}
	f := &forward{sess: sess}
	c.mu.Lock()
	c.forward[fr.Port] = f
	c.mu.Unlock()
	c.log.Info("port published", "port", fr.Port)
	tunnelsGauge.WithLabelValues("reverse").Inc()

	go func() {
		defer release()
		defer tunnelsGauge.WithLabelValues("reverse").Dec()
		for {
			stream, err := sess.AcceptStream()
			if err != nil {
				break
			}
			go c.forwarded(fr, stream, c.count)
		}
		c.mu.Lock()
		if c.forward[fr.Port] == f {
			delete(c.forward, fr.Port)
		}
		c.mu.Unlock()
		if !f.canceled.Load() && ctx.Err() == nil {
			c.log.Info("device side of a published port went away, closing the connection", "port", fr.Port)
			c.cancel()
		}
	}()
	return nil
}

func (c *conn) forwarded(fr forwardRequest, stream *yamux.Stream, count func(int)) {
	payload := ssh.Marshal(forwardedTCPIP{Addr: fr.Addr, Port: fr.Port, OrigAddr: "127.0.0.1", OrigPort: stream.StreamID()})
	ch, reqs, err := c.sc.OpenChannel("forwarded-tcpip", payload)
	if err != nil {
		stream.Close()
		return
	}
	go ssh.DiscardRequests(reqs)
	contract.Splice(ch, stream, count)
}

func (c *conn) stopForward(port uint32) bool {
	c.mu.Lock()
	f, ok := c.forward[port]
	delete(c.forward, port)
	c.mu.Unlock()
	if ok {
		f.canceled.Store(true)
		f.sess.Close()
		c.log.Info("port unpublished", "port", port)
	}
	return ok
}

func (c *conn) closeForwards() {
	if c.fan != nil {
		c.fan.close()
	}
	c.mu.Lock()
	forwards := c.forward
	c.forward = map[uint32]*forward{}
	c.mu.Unlock()
	for _, f := range forwards {
		f.canceled.Store(true)
		f.sess.Close()
	}
}

func (c *conn) channel(ctx context.Context, nch ssh.NewChannel) {
	switch nch.ChannelType() {
	case "session":
		ch, reqs, err := nch.Accept()
		if err != nil {
			return
		}
		c.session(ch, reqs)
	case "direct-tcpip":
		c.directTCPIP(ctx, nch)
	default:
		_ = nch.Reject(ssh.Prohibited, "only ADB and published-port tunnels are available")
	}
}

func (c *conn) directTCPIP(ctx context.Context, nch ssh.NewChannel) {
	var d directTCPIP
	if err := ssh.Unmarshal(nch.ExtraData(), &d); err != nil {
		_ = nch.Reject(ssh.ConnectionFailed, "malformed request")
		return
	}
	if c.fan != nil {
		c.tunnelOpened("adb", d.DestPort, fmt.Errorf("ADB on all sessions at once: %w", errDenied))
		_ = nch.Reject(ssh.Prohibited, "ADB needs a single session: connect with its id as the user name")
		return
	}
	if !c.g.cfg.AllowADB {
		c.tunnelOpened("adb", d.DestPort, fmt.Errorf("ADB access is disabled: %w", errDenied))
		_ = nch.Reject(ssh.Prohibited, "ADB access is disabled")
		return
	}
	if !isADB(d.DestAddr, d.DestPort) {
		c.tunnelOpened("adb", d.DestPort, fmt.Errorf("%s:%d: %w", d.DestAddr, d.DestPort, errDenied))
		_ = nch.Reject(ssh.Prohibited, "only adb:5555 can be reached through this gateway")
		return
	}
	release, ok := c.reserve()
	if !ok {
		c.tunnelOpened("adb", d.DestPort, errors.New("too many tunnels on one connection"))
		_ = nch.Reject(ssh.ResourceShortage, "too many tunnels on one connection")
		return
	}
	defer release()
	dctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	adb, err := c.tunnel.ADB(dctx, c.user)
	cancel()
	if err != nil {
		c.tunnelOpened("adb", d.DestPort, err)
		c.log.Warn("adb tunnel", "err", err)
		_ = nch.Reject(ssh.ConnectionFailed, "the device's ADB is not reachable")
		return
	}
	ch, reqs, err := nch.Accept()
	if err != nil {
		adb.Close()
		return
	}
	c.tunnelOpened("adb", d.DestPort, nil)
	tunnelsGauge.WithLabelValues("adb").Inc()
	defer tunnelsGauge.WithLabelValues("adb").Dec()
	go ssh.DiscardRequests(reqs)
	contract.Splice(ch, adb, c.count)
}

func isADB(host string, port uint32) bool {
	switch strings.ToLower(host) {
	case "adb", "localhost", "127.0.0.1", "::1":
		return port == 5555
	}
	return false
}

// session prints how to use the gateway instead of running anything. An
// interactive login stays open, holding the tunnels, until Ctrl+C or Ctrl+D.
func (c *conn) session(ch ssh.Channel, reqs <-chan *ssh.Request) {
	defer ch.Close()
	for req := range reqs {
		switch req.Type {
		case "pty-req", "window-change":
			_ = req.Reply(true, nil)
		case "shell":
			_ = req.Reply(true, nil)
			go ssh.DiscardRequests(reqs)
			_, _ = ch.Write([]byte(c.help() + "\r\nConnected; your tunnels stay open until you press Ctrl+C.\r\n"))
			waitForInterrupt(ch)
			_, _ = ch.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{0}))
			return
		case "exec", "subsystem":
			_ = req.Reply(true, nil)
			go ssh.DiscardRequests(reqs)
			_, _ = ch.Stderr().Write([]byte(c.help() + "\r\nCommands can't be run here; add -N to keep just the tunnels.\r\n"))
			_, _ = ch.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{1}))
			return
		default:
			if req.WantReply {
				_ = req.Reply(false, nil)
			}
		}
	}
}

func waitForInterrupt(ch ssh.Channel) {
	buf := make([]byte, 64)
	for {
		n, err := ch.Read(buf)
		for _, b := range buf[:n] {
			if b == 3 || b == 4 {
				return
			}
		}
		if err != nil {
			return
		}
	}
}

func (c *conn) help() string {
	var b strings.Builder
	if c.fan != nil {
		b.WriteString("All your sessions. There is no shell here, only tunnels.\r\n\r\n")
		c.g.usageAll(&b)
		return b.String()
	}
	fmt.Fprintf(&b, "Session %s. There is no shell here, only tunnels.\r\n\r\n", c.slug)
	c.g.usage(&b)
	return b.String()
}

func (g *Gateway) usageAll(b *strings.Builder) {
	if g.cfg.AllowReverse {
		b.WriteString("  Ports    ssh -N -R 3000:localhost:3000 …   every device of yours reaches it as localhost:3000\r\n")
	}
	b.WriteString("  ADB      connect with a session id as the user name instead\r\n")
}

func (g *Gateway) usage(b *strings.Builder) {
	if g.cfg.AllowADB {
		b.WriteString("  ADB      ssh -N -L 5555:adb:5555 …   then   adb connect localhost:5555\r\n")
	}
	if g.cfg.AllowReverse {
		b.WriteString("  Ports    ssh -N -R 3000:localhost:3000 …   the device reaches it as localhost:3000\r\n")
	}
}

// serverVersion is OpenSSH's so the version string doesn't name the gateway.
const serverVersion = "SSH-2.0-OpenSSH_9.9"

const logo = ` _   _       _ _      _           _     _
| | | | ___ | | |_ __| |_ __ ___ (_) __| |
| |_| |/ _ \| | __/ _` + "`" + ` | '__/ _ \| |/ _` + "`" + ` |
|  _  | (_) | | || (_| | | | (_) | | (_| |
|_| |_|\___/|_|\__\__,_|_|  \___/|_|\__,_|
`

// welcome sends the banner once the key is verified, so only users who may
// use the session ever see the project's name.
func (l *login) welcome(meta ssh.ConnMetadata, perms *ssh.Permissions) {
	if l.pre == nil {
		return
	}
	var b strings.Builder
	b.WriteString("\r\n" + strings.ReplaceAll(logo, "\n", "\r\n") + "\r\n")
	if perms.Extensions["handle"] != "" {
		fmt.Fprintf(&b, "  Sessions all of yours, signed in as %s; new ones join as they start\r\n", perms.Extensions["user"])
		l.g.usageAll(&b)
	} else {
		fmt.Fprintf(&b, "  Session  %s, signed in as %s\r\n", meta.User(), perms.Extensions["user"])
		l.g.usage(&b)
	}
	b.WriteString("\r\n  Only tunnels, no shell. They stay open until you press Ctrl+C.\r\n\r\n")
	_ = l.pre.SendAuthBanner(b.String())
}

type portSet [][2]int

func parsePorts(spec string) (portSet, error) {
	var set portSet
	for part := range strings.SplitSeq(spec, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		lo, hi, isRange := strings.Cut(part, "-")
		if !isRange {
			hi = lo
		}
		from, err1 := strconv.Atoi(strings.TrimSpace(lo))
		to, err2 := strconv.Atoi(strings.TrimSpace(hi))
		if err1 != nil || err2 != nil || from < 1 || to > 65535 || from > to {
			return nil, fmt.Errorf("%q is not a port or a range like 1024-65535", part)
		}
		set = append(set, [2]int{from, to})
	}
	if len(set) == 0 {
		return nil, errors.New("no ports")
	}
	return set, nil
}

func (s portSet) contains(port int) bool {
	for _, r := range s {
		if port >= r[0] && port <= r[1] {
			return true
		}
	}
	return false
}
