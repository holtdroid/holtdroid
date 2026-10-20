// Package sshgateway is the SSH entry point to sessions for connect clients:
// it accepts certificates signed by the api's CA, publishes the client's
// ports on all of the user's sessions and carries ADB to each of them. It
// never runs commands.
package sshgateway

import (
	"bytes"
	"context"
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

	"github.com/holtdroid/holtdroid/internal/audit"
	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/contract/control"
	"github.com/holtdroid/holtdroid/internal/secrets"
	"github.com/holtdroid/holtdroid/internal/sshkey"
)

type Config struct {
	Listen                  string
	HTTPListen              string
	HostKey                 secrets.Ref
	APIURL                  string
	AllowADB                bool
	AllowReverse            bool
	ReversePorts            string
	MaxTunnelsPerConnection int
	ActivityInterval        time.Duration
	RefreshInterval         time.Duration
	KeepaliveInterval       time.Duration
}

func DefaultConfig() Config {
	return Config{
		Listen:                  ":2222",
		HTTPListen:              ":8080",
		APIURL:                  "http://localhost:8081",
		AllowADB:                true,
		AllowReverse:            true,
		ReversePorts:            "1-65535",
		MaxTunnelsPerConnection: 32,
		ActivityInterval:        30 * time.Second,
		RefreshInterval:         5 * time.Second,
		KeepaliveInterval:       15 * time.Second,
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
	if c.ActivityInterval <= 0 || c.RefreshInterval <= 0 || c.KeepaliveInterval <= 0 {
		errs = append(errs, errors.New("activityInterval, refreshInterval and keepaliveInterval must be positive"))
	}
	if c.MaxTunnelsPerConnection < 1 {
		errs = append(errs, errors.New("maxTunnelsPerConnection must be at least 1"))
	}
	return errors.Join(errs...)
}

// HostKey reads the PEM private key ref points to. Without one it makes a
// throwaway key, so clients must enroll again after every restart.
func HostKey(ctx context.Context, reg *secrets.Registry, ref secrets.Ref, log *slog.Logger) (ssh.Signer, error) {
	signer, _, temporary, err := sshkey.LoadPrivate(ctx, reg, ref)
	if err != nil {
		return nil, fmt.Errorf("hostKey: %w", err)
	}
	if temporary {
		log.Warn("no hostKey configured, using a temporary one")
	}
	return signer, nil
}

type Gateway struct {
	cfg       Config
	hostKey   ssh.Signer
	authority *authority
	sessions  contract.SSHSessions
	ports     portSet
	audit     *audit.Logger
	log       *slog.Logger
	now       func() time.Time

	mu    sync.Mutex
	conns map[*conn]struct{}
}

func New(cfg Config, hostKey ssh.Signer, sessions contract.SSHSessions, aud *audit.Logger, log *slog.Logger) (*Gateway, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	ports, _ := parsePorts(cfg.ReversePorts)
	return &Gateway{
		cfg: cfg, hostKey: hostKey, authority: &authority{sessions: sessions, log: log}, sessions: sessions, ports: ports,
		audit: aud, log: log, now: time.Now, conns: map[*conn]struct{}{},
	}, nil
}

func (g *Gateway) HostKeys(context.Context) ([]string, error) {
	return []string{sshkey.Authorized(g.hostKey.PublicKey())}, nil
}

// authority is the api's CA key, fetched again when a certificate names a
// different one, which happens after the api changed it.
type authority struct {
	sessions contract.SSHSessions
	log      *slog.Logger

	mu      sync.Mutex
	key     []byte
	fetched time.Time
}

const authorityRefetch = 10 * time.Second

func (a *authority) is(key ssh.PublicKey) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if bytes.Equal(a.key, key.Marshal()) {
		return true
	}
	if time.Since(a.fetched) < authorityRefetch {
		return false
	}
	a.fetched = time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	line, err := a.sessions.SSHAuthority(ctx)
	if err != nil {
		a.log.Warn("fetch the certificate authority", "err", err)
		return false
	}
	ca, _, _, _, err := ssh.ParseAuthorizedKey([]byte(line))
	if err != nil {
		a.log.Warn("parse the certificate authority", "err", err)
		return false
	}
	a.key = ca.Marshal()
	return bytes.Equal(a.key, key.Marshal())
}

var errNotCertificate = errors.New("only certificates from the portal are accepted")

// login is the authentication state of one connection.
type login struct {
	g        *Gateway
	pre      ssh.ServerPreAuthConn
	rejected error
}

func (g *Gateway) serverConfig(l *login) *ssh.ServerConfig {
	cfg := &ssh.ServerConfig{
		PublicKeyCallback:         l.publicKey,
		VerifiedPublicKeyCallback: l.verified,
		PreAuthConnCallback:       func(c ssh.ServerPreAuthConn) { l.pre = c },
		ServerVersion:             serverVersion,
		MaxAuthTries:              10,
	}
	cfg.AddHostKey(g.hostKey)
	return cfg
}

func (l *login) publicKey(meta ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
	cert, ok := key.(*ssh.Certificate)
	if !ok || !isHandle(meta.User()) {
		return nil, errNotCertificate
	}
	checker := ssh.CertChecker{IsUserAuthority: l.g.authority.is, Clock: l.g.now}
	if _, err := checker.Authenticate(meta, key); err != nil {
		if l.g.authority.is(cert.SignatureKey) {
			l.rejected = err
		}
		return nil, err
	}
	user := cert.Extensions[control.CertUser]
	if user == "" || cert.KeyId == "" {
		return nil, errors.New("certificate without a user or computer")
	}
	return &ssh.Permissions{Extensions: map[string]string{
		"user": user, "admin": cert.Extensions[control.CertAdmin], "computer": cert.KeyId,
		"hostname": cert.Extensions[control.CertHostname], "handle": meta.User(),
	}}, nil
}

// verified sends the banner once the key is proven, so only enrolled
// computers ever see the project's name.
func (l *login) verified(_ ssh.ConnMetadata, _ ssh.PublicKey, perms *ssh.Permissions, _ string) (*ssh.Permissions, error) {
	if l.pre != nil && perms != nil {
		var b strings.Builder
		b.WriteString("\r\n" + strings.ReplaceAll(logo, "\n", "\r\n") + "\r\n")
		fmt.Fprintf(&b, "  Signed in as %s on %s\r\n\r\n", perms.Extensions["user"], perms.Extensions["hostname"])
		_ = l.pre.SendAuthBanner(b.String())
	}
	return perms, nil
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
	l := &login{g: g}
	sc, chans, reqs, err := ssh.NewServerConn(nc, g.serverConfig(l))
	remote := hostOf(nc.RemoteAddr())
	if err != nil {
		g.log.Debug("ssh handshake", "remote", nc.RemoteAddr().String(), "err", err)
		nc.Close()
		if l.rejected != nil {
			loginsTotal.WithLabelValues(string(audit.Denied)).Inc()
			g.audit.Emit(ctx, audit.Event{Action: audit.SSHConnect, Result: audit.Denied, Reason: l.rejected.Error(), ClientIP: remote})
		}
		return
	}
	_ = nc.SetDeadline(time.Time{})

	ctx, cancel := context.WithCancel(ctx)
	ext := sc.Permissions.Extensions
	c := &conn{
		g:        g,
		sc:       sc,
		user:     ext["user"],
		admin:    ext["admin"] == "true",
		computer: ext["computer"],
		hostname: ext["hostname"],
		remote:   remote,
		since:    g.now().UTC(),
		cancel:   cancel,
	}
	c.log = g.log.With("user", c.user, "computer", c.computer, "hostname", c.hostname, "remote", nc.RemoteAddr().String())
	c.log.Info("ssh connected")
	loginsTotal.WithLabelValues(string(audit.OK)).Inc()
	connectionsGauge.Inc()
	c.emit(audit.SSHConnect, nil, nil)
	g.track(c, true)
	start := time.Now()
	stop := context.AfterFunc(ctx, func() { sc.Close() })
	defer func() {
		stop()
		cancel()
		sc.Close()
		g.track(c, false)
		c.fan.close()
		connectionsGauge.Dec()
		c.emit(audit.SSHDisconnect, nil, map[string]string{
			"seconds": strconv.Itoa(int(time.Since(start).Seconds())), "bytes": strconv.FormatInt(c.total.Load(), 10),
		})
		c.log.Info("ssh disconnected")
	}()

	c.fan = newFanout(c, ext["handle"])
	go c.fan.run(ctx)
	go c.keepalive(ctx)
	go c.globalRequests(reqs)
	for nch := range chans {
		go c.channel(ctx, nch)
	}
}

func (g *Gateway) track(c *conn, open bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if open {
		g.conns[c] = struct{}{}
	} else {
		delete(g.conns, c)
	}
}

type conn struct {
	g        *Gateway
	sc       *ssh.ServerConn
	user     string
	admin    bool
	computer string
	hostname string
	remote   string
	since    time.Time
	cancel   context.CancelFunc
	log      *slog.Logger
	total    atomic.Int64
	fan      *fanout
	client   clientInfo

	mu   sync.Mutex
	open int
}

func (c *conn) count(n int) {
	c.total.Add(int64(n))
	bytesTotal.Add(float64(n))
}

func (c *conn) emit(action audit.Action, err error, details map[string]string) {
	c.emitOn("", "", action, err, details)
}

func (c *conn) emitOn(provider, id string, action audit.Action, err error, details map[string]string) {
	if details == nil {
		details = map[string]string{}
	}
	details["computer"], details["hostname"] = c.computer, c.hostname
	ev := audit.Event{Action: action, Actor: c.user, Admin: c.admin, Provider: provider, Session: id, ClientIP: c.remote, Details: details}
	switch {
	case err == nil:
	case errors.Is(err, errDenied):
		ev.Result, ev.Reason = audit.Denied, err.Error()
	default:
		ev.Result, ev.Reason = audit.Failed, err.Error()
	}
	c.g.audit.Emit(context.Background(), ev)
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

func (c *conn) keepalive(ctx context.Context) {
	every := c.g.cfg.KeepaliveInterval
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		replied := make(chan error, 1)
		go func() {
			_, _, err := c.sc.SendRequest("keepalive@openssh.com", true, nil)
			replied <- err
		}()
		select {
		case <-ctx.Done():
			return
		case err := <-replied:
			if err == nil {
				continue
			}
		case <-time.After(2 * every):
		}
		c.log.Info("client stopped answering keepalives, closing the connection")
		c.cancel()
		return
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

func (c *conn) globalRequests(reqs <-chan *ssh.Request) {
	for req := range reqs {
		switch req.Type {
		case "tcpip-forward":
			var fr forwardRequest
			if err := ssh.Unmarshal(req.Payload, &fr); err != nil {
				_ = req.Reply(false, nil)
				continue
			}
			err := c.fan.add(fr)
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
			_ = req.Reply(c.fan.remove(fr.Port), nil)
		default:
			if req.WantReply {
				_ = req.Reply(false, nil)
			}
		}
	}
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

func (c *conn) channel(ctx context.Context, nch ssh.NewChannel) {
	switch nch.ChannelType() {
	case "session":
		ch, reqs, err := nch.Accept()
		if err != nil {
			return
		}
		c.session(ctx, ch, reqs)
	case "direct-tcpip":
		c.directTCPIP(ctx, nch)
	default:
		_ = nch.Reject(ssh.Prohibited, "only ADB and published-port tunnels are available")
	}
}

// directTCPIP carries ADB to the session named by the destination host,
// "{provider}-{id}:5555".
func (c *conn) directTCPIP(ctx context.Context, nch ssh.NewChannel) {
	var d directTCPIP
	if err := ssh.Unmarshal(nch.ExtraData(), &d); err != nil {
		_ = nch.Reject(ssh.ConnectionFailed, "malformed request")
		return
	}
	dev := c.fan.device(d.DestAddr)
	if dev == nil || d.DestPort != 5555 {
		_ = nch.Reject(ssh.Prohibited, "only {session}:5555 of your ready sessions can be reached")
		return
	}
	if !c.g.cfg.AllowADB {
		c.tunnelOpenedOn(dev.provider, dev.id, "adb", d.DestPort, fmt.Errorf("ADB access is disabled: %w", errDenied))
		_ = nch.Reject(ssh.Prohibited, "ADB access is disabled")
		return
	}
	release, ok := c.reserve()
	if !ok {
		c.tunnelOpenedOn(dev.provider, dev.id, "adb", d.DestPort, errors.New("too many tunnels on one connection"))
		_ = nch.Reject(ssh.ResourceShortage, "too many tunnels on one connection")
		return
	}
	defer release()
	dctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	adb, err := dev.tunnel.ADB(dctx, c.user)
	cancel()
	if err != nil {
		c.tunnelOpenedOn(dev.provider, dev.id, "adb", d.DestPort, err)
		c.log.Warn("adb tunnel", "session", dev.slug, "err", err)
		_ = nch.Reject(ssh.ConnectionFailed, "the device's ADB is not reachable")
		return
	}
	ch, reqs, err := nch.Accept()
	if err != nil {
		adb.Close()
		return
	}
	c.tunnelOpenedOn(dev.provider, dev.id, "adb", d.DestPort, nil)
	tunnelsGauge.WithLabelValues("adb").Inc()
	defer tunnelsGauge.WithLabelValues("adb").Dec()
	go ssh.DiscardRequests(reqs)
	contract.Splice(ch, adb, func(n int) {
		c.count(n)
		dev.bytes.Add(int64(n))
	})
}

// session serves the control subsystem and refuses everything else.
func (c *conn) session(ctx context.Context, ch ssh.Channel, reqs <-chan *ssh.Request) {
	defer ch.Close()
	for req := range reqs {
		switch req.Type {
		case "subsystem":
			var name struct{ Name string }
			if ssh.Unmarshal(req.Payload, &name) == nil && name.Name == control.Subsystem {
				_ = req.Reply(true, nil)
				go ssh.DiscardRequests(reqs)
				c.serveControl(ctx, ch)
				return
			}
			_ = req.Reply(false, nil)
		case "shell", "exec":
			_ = req.Reply(true, nil)
			go ssh.DiscardRequests(reqs)
			_, _ = ch.Stderr().Write([]byte("There is no shell here. Run the holtdroid client from the portal's Computers page.\r\n"))
			_, _ = ch.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{1}))
			return
		default:
			if req.WantReply {
				_ = req.Reply(req.Type == "pty-req" || req.Type == "env", nil)
			}
		}
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
