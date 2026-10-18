package sshgateway

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"

	"github.com/kriakiku/holtdroid/internal/adbproto"
	"github.com/kriakiku/holtdroid/internal/audit"
	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/contract/control"
	"github.com/kriakiku/holtdroid/internal/provider/fake"
)

type stubSessions struct {
	p        *fake.Provider
	activity atomic.Int32
	active   sync.Map

	mu sync.Mutex
	ca ssh.Signer
}

func (s *stubSessions) SSHAuthority(context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return strings.TrimSpace(string(ssh.MarshalAuthorizedKey(s.ca.PublicKey()))), nil
}

func (s *stubSessions) SSHActivity(ctx context.Context, slug string) error {
	id, ok := strings.CutPrefix(slug, "fake-")
	if !ok {
		return contract.ErrNotFound
	}
	if _, err := s.p.Get(ctx, id); err != nil {
		return err
	}
	s.activity.Add(1)
	s.active.Store(slug, true)
	return nil
}

func (s *stubSessions) SSHUserSessions(ctx context.Context, handle string) ([]contract.SSHSession, error) {
	all, err := s.p.List(ctx)
	if err != nil {
		return nil, err
	}
	var out []contract.SSHSession
	for _, sess := range all {
		if contract.HandlePrefix+sess.Owner == handle {
			out = append(out, contract.SSHSession{Provider: "fake", ID: sess.ID, Owner: sess.Owner, State: sess.State, TunnelURL: sess.TunnelURL})
		}
	}
	return out, nil
}

func (s *stubSessions) RecordAudit(context.Context, []audit.Event) error { return nil }

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

type harness struct {
	t        *testing.T
	addr     string
	provider *fake.Provider
	sessions *stubSessions
	gateway  *Gateway
	ca       ssh.Signer
	clock    *clock
	audit    *lockedBuffer
}

type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func newHarness(t *testing.T, mod func(*Config)) *harness {
	t.Helper()
	tunnels := httptest.NewServer(nil)
	t.Cleanup(tunnels.Close)
	p := fake.New(fake.Config{Slots: 4, StepDelay: time.Millisecond, PublicURL: "http://agents.invalid", TunnelURL: tunnels.URL})
	tunnels.Config.Handler = p.TunnelHandler()

	clk := &clock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	cfg := DefaultConfig()
	cfg.ActivityInterval = 50 * time.Millisecond
	if mod != nil {
		mod(&cfg)
	}
	_, hostKey, _ := ed25519.GenerateKey(rand.Reader)
	signer, err := ssh.NewSignerFromKey(hostKey)
	if err != nil {
		t.Fatal(err)
	}
	ca := newSigner(t)
	sessions := &stubSessions{p: p, ca: ca}
	buf := &lockedBuffer{}
	aud, err := audit.New(context.Background(), audit.Config{}, "ssh-gateway", "test", nil, audit.WithStdout(buf))
	if err != nil {
		t.Fatal(err)
	}
	g, err := New(cfg, signer, sessions, aud, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	g.now = clk.now
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go g.Serve(ctx, ln)
	return &harness{t: t, addr: ln.Addr().String(), provider: p, sessions: sessions, gateway: g, ca: ca, clock: clk, audit: buf}
}

func (h *harness) session(owner string) (slug, id string) {
	h.t.Helper()
	s, err := h.provider.Create(context.Background(), contract.CreateSession{ArtifactURL: "http://api/x", ArtifactRef: "src/x", Package: "com.x", Owner: owner})
	if err != nil {
		h.t.Fatal(err)
	}
	eventually(h.t, "the session to be ready", func() bool {
		got, _ := h.provider.Get(context.Background(), s.ID)
		return got.State == contract.StateReady
	})
	return "fake-" + s.ID, s.ID
}

type certOpts struct {
	user, handle, computer, hostname string
	admin                            bool
	ca                               ssh.Signer
	ttl                              time.Duration
}

// cert is what the api would issue to a connect client of user.
func (h *harness) cert(user string, mod func(*certOpts)) ssh.Signer {
	h.t.Helper()
	o := certOpts{user: user, handle: contract.HandlePrefix + user, computer: "c-" + user, hostname: user + "-laptop", ca: h.ca, ttl: 15 * time.Minute}
	if mod != nil {
		mod(&o)
	}
	key := newSigner(h.t)
	ext := map[string]string{"permit-port-forwarding": "", control.CertHostname: o.hostname}
	if o.user != "" {
		ext[control.CertUser] = o.user
	}
	if o.admin {
		ext[control.CertAdmin] = "true"
	}
	now := h.clock.now()
	cert := &ssh.Certificate{
		Key: key.PublicKey(), CertType: ssh.UserCert, KeyId: o.computer, ValidPrincipals: []string{o.handle},
		ValidAfter: uint64(now.Add(-time.Minute).Unix()), ValidBefore: uint64(now.Add(o.ttl).Unix()),
		Extensions: ext,
	}
	if err := cert.SignCert(rand.Reader, o.ca); err != nil {
		h.t.Fatal(err)
	}
	signer, err := ssh.NewCertSigner(cert, key)
	if err != nil {
		h.t.Fatal(err)
	}
	return signer
}

func (h *harness) dial(slug string, signer ssh.Signer) (*ssh.Client, error) {
	return ssh.Dial("tcp", h.addr, &ssh.ClientConfig{
		User:            slug,
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         5 * time.Second,
	})
}

func (h *harness) connect(slug string, signer ssh.Signer) *ssh.Client {
	h.t.Helper()
	c, err := h.dial(slug, signer)
	if err != nil {
		h.t.Fatal(err)
	}
	h.t.Cleanup(func() { c.Close() })
	return c
}

func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func newSigner(t *testing.T) ssh.Signer {
	t.Helper()
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	signer, err := ssh.NewSignerFromKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return signer
}

func TestFanout(t *testing.T) {
	h := newHarness(t, func(c *Config) {
		c.ReversePorts = "1024-65535"
		c.RefreshInterval = 20 * time.Millisecond
		c.ActivityInterval = 20 * time.Millisecond
	})
	otter := h.cert("otter", nil)
	_, first := h.session("otter")
	_, other := h.session("badger")

	var banner string
	c, err := ssh.Dial("tcp", h.addr, &ssh.ClientConfig{
		User: "user-otter", Auth: []ssh.AuthMethod{ssh.PublicKeys(otter)}, HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		BannerCallback: func(msg string) error { banner += msg; return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	if !strings.Contains(banner, "Signed in as otter on otter-laptop") || !strings.Contains(banner, "|_| |_|\\___/") ||
		string(c.ServerVersion()) != "SSH-2.0-OpenSSH_9.9" {
		t.Fatalf("banner %q", banner)
	}

	ln, err := c.Listen("tcp", "127.0.0.1:3000")
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				_, _ = io.Copy(conn, conn)
				conn.Close()
			}()
		}
	}()

	ctx := context.Background()
	reaches := func(id string) bool {
		conn, err := h.provider.DialDevice(ctx, id, 3000)
		if err != nil {
			return false
		}
		defer conn.Close()
		msg := "ping " + id
		if _, err := conn.Write([]byte(msg)); err != nil {
			return false
		}
		buf := make([]byte, len(msg))
		_, err = io.ReadFull(conn, buf)
		return err == nil && string(buf) == msg
	}
	eventually(t, "the port on the running session", func() bool { return reaches(first) })
	_, second := h.session("otter")
	eventually(t, "the port on a session started later", func() bool { return reaches(second) })
	if reaches(other) {
		t.Fatal("the port reached someone else's session")
	}
	eventually(t, "activity on both sessions", func() bool {
		_, a := h.sessions.active.Load("fake-" + first)
		_, b := h.sessions.active.Load("fake-" + second)
		return a && b
	})
	if _, ok := h.sessions.active.Load("fake-" + other); ok {
		t.Fatal("traffic counted for a session it never reached")
	}

	if err := h.provider.Delete(ctx, first); err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond)
	if !reaches(second) {
		t.Fatal("a session ending dropped the others")
	}
	if _, err := c.Dial("tcp", "fake-"+first+":5555"); err == nil {
		t.Fatal("ADB reached a session that ended")
	}

	ln.Close()
	eventually(t, "the port to be unpublished", func() bool {
		conn, err := h.provider.DialDevice(ctx, second, 3000)
		if err == nil {
			conn.Close()
		}
		return err != nil
	})
}

func isExit(err error, status int) bool {
	exit, ok := errors.AsType[*ssh.ExitError](err)
	return ok && exit.ExitStatus() == status
}

func TestParsePorts(t *testing.T) {
	tests := []struct {
		spec string
		in   []int
		out  []int
		err  bool
	}{
		{spec: "1-65535", in: []int{1, 80, 65535}},
		{spec: "1024-65535", in: []int{1024, 3000}, out: []int{80, 1023}},
		{spec: "80, 443, 3000-3010", in: []int{80, 443, 3005}, out: []int{81, 3011}},
		{spec: "", err: true},
		{spec: "0-10", err: true},
		{spec: "10-5", err: true},
		{spec: "http", err: true},
	}
	for _, tt := range tests {
		t.Run(tt.spec, func(t *testing.T) {
			set, err := parsePorts(tt.spec)
			if (err != nil) != tt.err {
				t.Fatalf("err = %v", err)
			}
			for _, p := range tt.in {
				if !set.contains(p) {
					t.Errorf("%d should be allowed", p)
				}
			}
			for _, p := range tt.out {
				if set.contains(p) {
					t.Errorf("%d should not be allowed", p)
				}
			}
		})
	}
}

type stallConn struct {
	net.Conn
	stalled atomic.Bool
	done    chan struct{}
}

func (c *stallConn) Read(p []byte) (int, error) {
	if c.stalled.Load() {
		<-c.done
		return 0, io.EOF
	}
	return c.Conn.Read(p)
}

func TestKeepalive(t *testing.T) {
	h := newHarness(t, func(c *Config) { c.KeepaliveInterval = 20 * time.Millisecond })
	otter := h.cert("otter", nil)
	h.session("otter")

	healthy := h.connect("user-otter", otter)
	nc, err := net.Dial("tcp", h.addr)
	if err != nil {
		t.Fatal(err)
	}
	conn := &stallConn{Conn: nc, done: make(chan struct{})}
	t.Cleanup(func() { close(conn.done); nc.Close() })
	sc, chans, reqs, err := ssh.NewClientConn(conn, h.addr, &ssh.ClientConfig{
		User:            "user-otter",
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(otter)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	})
	if err != nil {
		t.Fatal(err)
	}
	ssh.NewClient(sc, chans, reqs)
	conn.stalled.Store(true)

	eventually(t, "the stalled connection to be closed", func() bool {
		return strings.Count(h.audit.String(), `"ssh.disconnect"`) == 1
	})
	time.Sleep(100 * time.Millisecond)
	if _, _, err := healthy.SendRequest("ping", true, nil); err != nil {
		t.Fatalf("healthy connection closed: %v", err)
	}
}

func TestLogin(t *testing.T) {
	h := newHarness(t, nil)
	h.session("otter")
	slug, _ := h.session("badger")
	other := newSigner(t)

	tests := []struct {
		name   string
		user   string
		signer ssh.Signer
		ok     bool
	}{
		{"own handle", "user-otter", h.cert("otter", nil), true},
		{"admin", "user-otter", h.cert("otter", func(o *certOpts) { o.admin = true }), true},
		{"someone else's handle", "user-badger", h.cert("otter", nil), false},
		{"a session slug", slug, h.cert("badger", func(o *certOpts) { o.handle = slug }), false},
		{"plain key", "user-otter", newSigner(t), false},
		{"another CA", "user-otter", h.cert("otter", func(o *certOpts) { o.ca = other }), false},
		{"expired", "user-otter", h.cert("otter", func(o *certOpts) { o.ttl = -time.Second }), false},
		{"no user", "user-otter", h.cert("", func(o *certOpts) { o.handle = "user-otter" }), false},
		{"no computer", "user-otter", h.cert("otter", func(o *certOpts) { o.computer = "" }), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, err := h.dial(tt.user, tt.signer)
			if c != nil {
				c.Close()
			}
			if (err == nil) != tt.ok {
				t.Fatalf("err = %v, want ok=%v", err, tt.ok)
			}
		})
	}
}

func TestAuthorityChange(t *testing.T) {
	h := newHarness(t, nil)
	h.connect("user-otter", h.cert("otter", nil)).Close()
	next := newSigner(t)
	h.sessions.mu.Lock()
	h.sessions.ca = next
	h.sessions.mu.Unlock()
	h.gateway.authority.mu.Lock()
	h.gateway.authority.fetched = time.Time{}
	h.gateway.authority.mu.Unlock()
	h.connect("user-otter", h.cert("otter", func(o *certOpts) { o.ca = next }))
	if c, err := h.dial("user-otter", h.cert("otter", nil)); err == nil {
		c.Close()
		t.Fatal("a certificate from the old CA still logs in")
	}
}

func TestNoShell(t *testing.T) {
	h := newHarness(t, nil)
	c := h.connect("user-otter", h.cert("otter", nil))

	t.Run("exec", func(t *testing.T) {
		s, err := c.NewSession()
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
		out, err := s.CombinedOutput("id")
		if !isExit(err, 1) || !strings.Contains(string(out), "no shell here") {
			t.Fatalf("exec: %v %q", err, out)
		}
	})

	t.Run("shell", func(t *testing.T) {
		s, err := c.NewSession()
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
		if err := s.Shell(); err != nil {
			t.Fatal(err)
		}
		if err := s.Wait(); !isExit(err, 1) {
			t.Fatalf("shell: %v", err)
		}
	})

	t.Run("sftp", func(t *testing.T) {
		s, err := c.NewSession()
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
		if err := s.RequestSubsystem("sftp"); err == nil {
			t.Fatal("sftp subsystem accepted")
		}
	})

	t.Run("agent forwarding", func(t *testing.T) {
		s, err := c.NewSession()
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
		if ok, err := s.SendRequest("auth-agent-req@openssh.com", true, nil); ok || err != nil {
			t.Fatalf("agent forwarding accepted: %v %v", ok, err)
		}
	})

	t.Run("other channel types", func(t *testing.T) {
		if _, _, err := c.OpenChannel("direct-streamlocal@openssh.com", nil); err == nil {
			t.Fatal("streamlocal channel accepted")
		}
	})
}

func TestADBTunnel(t *testing.T) {
	h := newHarness(t, func(c *Config) { c.RefreshInterval = 20 * time.Millisecond })
	slug, _ := h.session("otter")
	theirs, _ := h.session("badger")
	c := h.connect("user-otter", h.cert("otter", nil))

	var conn net.Conn
	eventually(t, "the session to be known", func() bool {
		var err error
		conn, err = c.Dial("tcp", slug+":5555")
		return err == nil
	})
	if banner, err := adbproto.Connect(conn); err != nil || !strings.HasPrefix(banner, "device::") {
		t.Fatalf("banner %q, %v", banner, err)
	}
	conn.Close()
	for _, target := range []string{theirs + ":5555", slug + ":22", "adb:5555", "localhost:5555", "10.0.0.1:5555", "kubernetes.default:443"} {
		if conn, err := c.Dial("tcp", target); err == nil {
			conn.Close()
			t.Fatalf("%s was reachable", target)
		}
	}
}

func TestADBDisabled(t *testing.T) {
	h := newHarness(t, func(c *Config) { c.AllowADB = false })
	slug, _ := h.session("otter")
	c := h.connect("user-otter", h.cert("otter", nil))
	if m := openControl(t, c).next(control.TypeGateway); m.Gateway == nil || m.Gateway.ADB || !m.Gateway.Publish {
		t.Fatalf("gateway %+v", m)
	}
	time.Sleep(50 * time.Millisecond)
	if conn, err := c.Dial("tcp", slug+":5555"); err == nil {
		conn.Close()
		t.Fatal("adb reachable with allowADB off")
	}
}

func TestReverseLimits(t *testing.T) {
	h := newHarness(t, func(c *Config) {
		c.ReversePorts = "1024-65535"
		c.MaxTunnelsPerConnection = 2
	})
	c := h.connect("user-otter", h.cert("otter", nil))
	if _, err := c.Listen("tcp", "127.0.0.1:80"); err == nil {
		t.Fatal("port outside reversePorts was published")
	}
	if _, err := c.Listen("tcp", "127.0.0.1:3000"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Listen("tcp", "127.0.0.1:3000"); err == nil {
		t.Fatal("the same port was published twice")
	}
	if _, err := c.Listen("tcp", "127.0.0.1:3001"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Listen("tcp", "127.0.0.1:3002"); err == nil {
		t.Fatal("third tunnel accepted")
	}

	off := newHarness(t, func(c *Config) { c.AllowReverse = false })
	if _, err := off.connect("user-otter", off.cert("otter", nil)).Listen("tcp", "127.0.0.1:3000"); err == nil {
		t.Fatal("published a port with allowReverse off")
	}
}

type controlClient struct {
	t   *testing.T
	w   io.Writer
	dec *json.Decoder
}

func openControl(t *testing.T, c *ssh.Client) *controlClient {
	t.Helper()
	s, err := c.NewSession()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	w, _ := s.StdinPipe()
	r, _ := s.StdoutPipe()
	if err := s.RequestSubsystem(control.Subsystem); err != nil {
		t.Fatal(err)
	}
	return &controlClient{t: t, w: w, dec: json.NewDecoder(r)}
}

func (cc *controlClient) send(m control.Message) {
	cc.t.Helper()
	b, _ := json.Marshal(m)
	if _, err := cc.w.Write(append(b, '\n')); err != nil {
		cc.t.Fatal(err)
	}
}

func (cc *controlClient) next(typ string) control.Message {
	cc.t.Helper()
	for {
		var m control.Message
		if err := cc.dec.Decode(&m); err != nil {
			cc.t.Fatal(err)
		}
		if m.Type == typ {
			return m
		}
	}
}

func slugs(list []control.Session) []string {
	out := []string{}
	for _, s := range list {
		out = append(out, s.Slug)
	}
	return out
}

func TestControl(t *testing.T) {
	h := newHarness(t, func(c *Config) { c.RefreshInterval = 20 * time.Millisecond })
	first, _ := h.session("otter")
	h.session("badger")
	c := h.connect("user-otter", h.cert("otter", nil))
	cc := openControl(t, c)
	if m := cc.next(control.TypeGateway); m.Gateway == nil || !m.Gateway.ADB || !m.Gateway.Publish {
		t.Fatalf("gateway %+v", m)
	}

	var got []string
	eventually(t, "the first session", func() bool {
		got = slugs(cc.next(control.TypeSessions).Sessions)
		return len(got) == 1
	})
	if got[0] != first {
		t.Fatalf("sessions %q", got)
	}
	second, _ := h.session("otter")
	eventually(t, "the second session", func() bool { return len(cc.next(control.TypeSessions).Sessions) == 2 })
	_ = second

	cc.send(control.Message{Type: control.TypeHello, Hello: &control.Hello{Version: "abc", OS: "darwin", Arch: "arm64"}})
	cc.send(control.Message{Type: control.TypeState, State: &control.State{
		Listening: []control.LocalPort{{Port: 3000, Process: "node"}}, Published: []int{3000}, ADB: []control.ADBPort{{Session: first, Port: 15555}},
	}})
	ctx := context.Background()
	var list []control.Computer
	eventually(t, "the computer's state", func() bool {
		list, _ = h.gateway.Computers(ctx, "otter")
		return len(list) == 1 && len(list[0].Published) == 1
	})
	want := control.Computer{
		ID: "c-otter", Hostname: "otter-laptop", OS: "darwin", Arch: "arm64", Version: "abc", ClientIP: "127.0.0.1", Since: list[0].Since,
		Listening: []control.LocalPort{{Port: 3000, Process: "node"}}, Published: []int{3000}, ADB: []control.ADBPort{{Session: first, Port: 15555}},
	}
	if b1, b2 := mustJSON(t, list[0]), mustJSON(t, want); b1 != b2 {
		t.Fatalf("computer %s, want %s", b1, b2)
	}
	if theirs, _ := h.gateway.Computers(ctx, "badger"); len(theirs) != 0 {
		t.Fatalf("badger's computers %+v", theirs)
	}

	if err := h.gateway.SetPublished(ctx, "otter", "c-otter", []int{8080}); err != nil {
		t.Fatal(err)
	}
	if m := cc.next(control.TypePublish); !slices.Equal(m.Publish, []int{8080}) {
		t.Fatalf("publish %+v", m)
	}
	if err := h.gateway.SetPublished(ctx, "otter", "c-otter", nil); err != nil {
		t.Fatal(err)
	}
	if m := cc.next(control.TypePublish); len(m.Publish) != 0 {
		t.Fatalf("publish nothing %+v", m)
	}
	for _, tt := range []struct{ user, computer string }{{"badger", "c-otter"}, {"otter", "nope"}} {
		if err := h.gateway.SetPublished(ctx, tt.user, tt.computer, []int{1}); !errors.Is(err, contract.ErrNotFound) {
			t.Fatalf("%s/%s: %v", tt.user, tt.computer, err)
		}
	}

	c.Close()
	eventually(t, "the computer to go away", func() bool {
		list, _ := h.gateway.Computers(ctx, "otter")
		return len(list) == 0
	})
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestAuditTrail(t *testing.T) {
	h := newHarness(t, func(c *Config) {
		c.ReversePorts = "1024-65535"
		c.RefreshInterval = 20 * time.Millisecond
	})
	slug, id := h.session("otter")
	if c, err := h.dial("user-otter", h.cert("otter", func(o *certOpts) { o.ttl = -time.Second })); err == nil {
		c.Close()
		t.Fatal("expired certificate logged in")
	}
	if c, err := h.dial("user-otter", newSigner(t)); err == nil {
		c.Close()
		t.Fatal("plain key logged in")
	}

	c, err := h.dial("user-otter", h.cert("otter", nil))
	if err != nil {
		t.Fatal(err)
	}
	var conn net.Conn
	eventually(t, "the session to be known", func() bool {
		conn, err = c.Dial("tcp", slug+":5555")
		return err == nil
	})
	if _, err := adbproto.Connect(conn); err != nil {
		t.Fatal(err)
	}
	conn.Close()
	ln, err := c.Listen("tcp", "127.0.0.1:3000")
	if err != nil {
		t.Fatal(err)
	}
	eventually(t, "the port on the device", func() bool { return strings.Contains(h.audit.String(), `"reverse"`) })
	ln.Close()
	c.Close()
	eventually(t, "the disconnect event", func() bool { return strings.Contains(h.audit.String(), "ssh.disconnect") })

	var got []string
	for line := range strings.Lines(h.audit.String()) {
		var ev struct {
			Action, Result, Actor, Provider, Session, ClientIP string
			Details                                            map[string]string
		}
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			t.Fatal(err)
		}
		got = append(got, strings.Join([]string{ev.Action, ev.Result, ev.Actor, ev.Provider + "/" + ev.Session, ev.ClientIP, ev.Details["kind"], ev.Details["port"], ev.Details["computer"]}, "|"))
	}
	want := []string{
		"ssh.connect|denied||/|127.0.0.1|||",
		"ssh.connect|ok|otter|/|127.0.0.1|||c-otter",
		"ssh.tunnel|ok|otter|fake/" + id + "|127.0.0.1|adb|5555|c-otter",
		"ssh.tunnel|ok|otter|fake/" + id + "|127.0.0.1|reverse|3000|c-otter",
		"ssh.disconnect|ok|otter|/|127.0.0.1|||c-otter",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("audit:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}
