package sshgateway

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"

	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/provider/fake"
)

type stubSessions struct {
	p        *fake.Provider
	activity atomic.Int32
}

func (s *stubSessions) SSHSession(ctx context.Context, slug string) (contract.SSHSession, error) {
	id, ok := strings.CutPrefix(slug, "fake-")
	if !ok {
		return contract.SSHSession{}, contract.ErrNotFound
	}
	sess, err := s.p.Get(ctx, id)
	if err != nil {
		return contract.SSHSession{}, err
	}
	return contract.SSHSession{Provider: "fake", ID: sess.ID, Owner: sess.Owner, State: sess.State, TunnelURL: sess.TunnelURL}, nil
}

func (s *stubSessions) SSHActivity(ctx context.Context, slug string) error {
	if _, err := s.SSHSession(ctx, slug); err != nil {
		return err
	}
	s.activity.Add(1)
	return nil
}

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

type harness struct {
	t        *testing.T
	addr     string
	provider *fake.Provider
	sessions *stubSessions
	keys     *Keys
	clock    *clock
}

func newHarness(t *testing.T, mod func(*Config)) *harness {
	t.Helper()
	tunnels := httptest.NewServer(nil)
	t.Cleanup(tunnels.Close)
	p := fake.New(fake.Config{Slots: 4, StepDelay: time.Millisecond, PublicURL: "http://agents.invalid", TunnelURL: tunnels.URL})
	tunnels.Config.Handler = p.TunnelHandler()

	clk := &clock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	keys := NewKeys(time.Hour, clk.now)
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
	sessions := &stubSessions{p: p}
	g, err := New(cfg, signer, keys, sessions, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go g.Serve(ctx, ln)
	return &harness{t: t, addr: ln.Addr().String(), provider: p, sessions: sessions, keys: keys, clock: clk}
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

func (h *harness) register(user string, admin bool) ssh.Signer {
	h.t.Helper()
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	signer, err := ssh.NewSignerFromKey(key)
	if err != nil {
		h.t.Fatal(err)
	}
	line := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(signer.PublicKey())))
	if err := h.keys.SetUserKeys(context.Background(), user, contract.UserKeys{Admin: admin, Keys: []string{line}}); err != nil {
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

func roundTrip(t *testing.T, c io.ReadWriter, msg string) {
	t.Helper()
	if _, err := c.Write([]byte(msg)); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, len(msg))
	if _, err := io.ReadFull(c, buf); err != nil || string(buf) != msg {
		t.Fatalf("read %q, %v; want %q", buf, err, msg)
	}
}

func TestLogin(t *testing.T) {
	h := newHarness(t, func(c *Config) { c.ClientIsolation = true })
	otter := h.register("otter", false)
	admin := h.register("root", true)
	slug, _ := h.session("otter")
	badgerSlug, _ := h.session("badger")
	_, stranger, _ := ed25519.GenerateKey(rand.Reader)
	unknown, _ := ssh.NewSignerFromKey(stranger)

	tests := []struct {
		name   string
		slug   string
		signer ssh.Signer
		ok     bool
	}{
		{"owner", slug, otter, true},
		{"admin on someone else's session", badgerSlug, admin, true},
		{"isolated from someone else's session", badgerSlug, otter, false},
		{"unknown key", slug, unknown, false},
		{"unknown session", "fake-nope", otter, false},
		{"no provider prefix", "nope", otter, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, err := h.dial(tt.slug, tt.signer)
			if c != nil {
				c.Close()
			}
			if (err == nil) != tt.ok {
				t.Fatalf("err = %v, want ok=%v", err, tt.ok)
			}
		})
	}
}

func TestNoIsolationByDefault(t *testing.T) {
	h := newHarness(t, nil)
	otter := h.register("otter", false)
	slug, _ := h.session("badger")
	h.connect(slug, otter)
}

func TestKeyExpiry(t *testing.T) {
	h := newHarness(t, nil)
	otter := h.register("otter", false)
	slug, _ := h.session("otter")
	h.connect(slug, otter)
	h.clock.advance(time.Hour)
	if c, err := h.dial(slug, otter); err == nil {
		c.Close()
		t.Fatal("an expired key still logs in")
	}
}

func TestNoShell(t *testing.T) {
	h := newHarness(t, nil)
	otter := h.register("otter", false)
	slug, _ := h.session("otter")
	c := h.connect(slug, otter)

	t.Run("exec", func(t *testing.T) {
		s, err := c.NewSession()
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
		out, err := s.CombinedOutput("id")
		if !isExit(err, 1) {
			t.Fatalf("exec: %v", err)
		}
		if !strings.Contains(string(out), "no shell here") || strings.Contains(string(out), "uid=") {
			t.Fatalf("exec output %q", out)
		}
	})

	t.Run("sftp", func(t *testing.T) {
		ch, reqs, err := c.OpenChannel("session", nil)
		if err != nil {
			t.Fatal(err)
		}
		defer ch.Close()
		if _, err := ch.SendRequest("subsystem", true, ssh.Marshal(struct{ Name string }{"sftp"})); err != nil {
			t.Fatal(err)
		}
		status := -1
		for req := range reqs {
			if req.Type == "exit-status" && len(req.Payload) == 4 {
				status = int(binary.BigEndian.Uint32(req.Payload))
			}
		}
		if status != 1 {
			t.Fatalf("sftp subsystem exit status %d", status)
		}
	})

	t.Run("interactive shell waits for ctrl+c", func(t *testing.T) {
		s, err := c.NewSession()
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
		stdin, _ := s.StdinPipe()
		stdout, _ := s.StdoutPipe()
		if err := s.Shell(); err != nil {
			t.Fatal(err)
		}
		buf := make([]byte, 4096)
		n, _ := stdout.Read(buf)
		if !strings.Contains(string(buf[:n]), "session "+slug) {
			t.Fatalf("shell greeting %q", buf[:n])
		}
		_, _ = stdin.Write([]byte{3})
		if err := s.Wait(); err != nil {
			t.Fatalf("shell after ctrl+c: %v", err)
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

func isExit(err error, status int) bool {
	exit, ok := errors.AsType[*ssh.ExitError](err)
	return ok && exit.ExitStatus() == status
}

func TestADBTunnel(t *testing.T) {
	h := newHarness(t, nil)
	otter := h.register("otter", false)
	slug, _ := h.session("otter")
	c := h.connect(slug, otter)

	for _, target := range []string{"adb:5555", "localhost:5555"} {
		conn, err := c.Dial("tcp", target)
		if err != nil {
			t.Fatalf("%s: %v", target, err)
		}
		roundTrip(t, conn, "CNXN\x00\x00\x00\x01")
		conn.Close()
	}
	for _, target := range []string{"adb:22", "10.0.0.1:5555", "kubernetes.default:443", "holtdroid-api-internal:8081"} {
		if conn, err := c.Dial("tcp", target); err == nil {
			conn.Close()
			t.Fatalf("%s was reachable", target)
		}
	}
}

func TestADBDisabled(t *testing.T) {
	h := newHarness(t, func(c *Config) { c.AllowADB = false })
	otter := h.register("otter", false)
	slug, _ := h.session("otter")
	if conn, err := h.connect(slug, otter).Dial("tcp", "adb:5555"); err == nil {
		conn.Close()
		t.Fatal("adb reachable with allowADB off")
	}
}

func TestReverseTunnel(t *testing.T) {
	h := newHarness(t, func(c *Config) { c.ReversePorts = "1024-65535" })
	otter := h.register("otter", false)
	slug, id := h.session("otter")
	c := h.connect(slug, otter)

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
	onDevice, err := h.provider.DialDevice(ctx, id, 3000)
	if err != nil {
		t.Fatal(err)
	}
	roundTrip(t, onDevice, "GET / HTTP/1.1\r\nHost: localhost:3000\r\n\r\n")
	onDevice.Close()
	eventually(t, "tunnel traffic to count as activity", func() bool { return h.sessions.activity.Load() > 0 })

	if _, err := c.Listen("tcp", "127.0.0.1:80"); err == nil {
		t.Fatal("port outside reversePorts was published")
	}
	if _, err := c.Listen("tcp", "127.0.0.1:3000"); err == nil {
		t.Fatal("the same port was published twice")
	}

	ln.Close()
	eventually(t, "the port to be unpublished", func() bool {
		conn, err := h.provider.DialDevice(ctx, id, 3000)
		if err == nil {
			conn.Close()
		}
		return err != nil
	})
}

func TestReverseDisabled(t *testing.T) {
	h := newHarness(t, func(c *Config) { c.AllowReverse = false })
	otter := h.register("otter", false)
	slug, _ := h.session("otter")
	if _, err := h.connect(slug, otter).Listen("tcp", "127.0.0.1:3000"); err == nil {
		t.Fatal("published a port with allowReverse off")
	}
}

func TestTunnelLimit(t *testing.T) {
	h := newHarness(t, func(c *Config) { c.MaxTunnelsPerConnection = 2 })
	otter := h.register("otter", false)
	slug, _ := h.session("otter")
	c := h.connect(slug, otter)
	for _, port := range []string{"3000", "3001"} {
		if _, err := c.Listen("tcp", "127.0.0.1:"+port); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := c.Listen("tcp", "127.0.0.1:3002"); err == nil {
		t.Fatal("third tunnel accepted")
	}
	if conn, err := c.Dial("tcp", "adb:5555"); err == nil {
		conn.Close()
		t.Fatal("adb tunnel past the limit accepted")
	}
}

func TestSessionEndDropsConnection(t *testing.T) {
	h := newHarness(t, nil)
	otter := h.register("otter", false)
	slug, id := h.session("otter")
	c := h.connect(slug, otter)
	if _, err := c.Listen("tcp", "127.0.0.1:3000"); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- c.Wait() }()
	if err := h.provider.Delete(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the connection outlived its session")
	}
}

func TestADBOnlyConnectionEndsWithSession(t *testing.T) {
	h := newHarness(t, nil)
	otter := h.register("otter", false)
	slug, id := h.session("otter")
	c := h.connect(slug, otter)
	done := make(chan error, 1)
	go func() { done <- c.Wait() }()
	if err := h.provider.Delete(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("an idle connection outlived its session")
	}
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
