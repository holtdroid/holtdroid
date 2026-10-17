package api

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"

	"github.com/kriakiku/holtdroid/internal/auth"
	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/provider/fake"
	"github.com/kriakiku/holtdroid/internal/sshgateway"
)

type sshHarness struct {
	*harness
	stores []*sshgateway.Keys
	down   map[string]bool
}

func newSSHHarness(t *testing.T, enabled bool, replicas int) *sshHarness {
	t.Helper()
	h := &sshHarness{down: map[string]bool{}}
	backends := map[string]string{}
	var ips []string
	for i := range replicas {
		store := sshgateway.NewKeys(time.Hour, nil)
		mux := http.NewServeMux()
		contract.RegisterSSHGateway(contract.NewAPI(mux, "gateway"), store)
		gw := httptest.NewServer(mux)
		t.Cleanup(gw.Close)
		ip := "10.0.0." + string(rune('1'+i))
		ips = append(ips, ip)
		backends[ip+":8080"] = gw.Listener.Addr().String()
		h.stores = append(h.stores, store)
	}

	cfg := DefaultConfig()
	cfg.PublicURL = "https://android.example.com"
	cfg.Storage.Filesystem.Dir = t.TempDir()
	cfg.Sources[0].Filesystem.Dir = t.TempDir()
	cfg.Auth.Mode = auth.ModeHeader
	cfg.SSH.Enabled = enabled
	cfg.SSH.GatewayURL = "http://gateway-headless:8080"
	srv, err := New(context.Background(), cfg, WithResolver(func(_ context.Context, host string) ([]string, error) {
		if host != "gateway-headless" {
			t.Errorf("resolved %q", host)
		}
		return ips, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	srv.sshHTTP = &http.Client{Transport: &http.Transport{
		DisableKeepAlives: true,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			if h.down[addr] {
				return nil, &net.OpError{Op: "dial", Err: net.ErrClosed}
			}
			return (&net.Dialer{}).DialContext(ctx, network, backends[addr])
		},
	}}
	h.harness = &harness{t: t, srv: srv, handler: srv.Handler()}
	return h
}

func sshKey(t *testing.T) (string, string) {
	t.Helper()
	raw, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pub, err := ssh.NewPublicKey(raw)
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(ssh.MarshalAuthorizedKey(pub))) + " me@laptop", ssh.FingerprintSHA256(pub)
}

type keyList struct {
	Keys []SSHKeyInput `json:"keys"`
}

type problem struct {
	Status int `json:"status"`
	Errors []struct {
		Message  string `json:"message"`
		Location string `json:"location"`
	} `json:"errors"`
}

func TestSSHDisabled(t *testing.T) {
	h := newSSHHarness(t, false, 1)
	if info := decode[SSHInfo](t, h.do(http.MethodGet, "/api/v1/ssh", "alice", "", nil)); info.Enabled {
		t.Fatalf("info = %+v", info)
	}
	rec := h.do(http.MethodPut, "/api/v1/ssh/keys", "alice", "", keyList{Keys: []SSHKeyInput{}})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("put = %d", rec.Code)
	}
}

func TestSSHKeysSync(t *testing.T) {
	h := newSSHHarness(t, true, 2)
	a, aFP := sshKey(t)
	b, bFP := sshKey(t)

	info := decode[SSHInfo](t, h.do(http.MethodGet, "/api/v1/ssh", "alice", "", nil))
	want := SSHInfo{Enabled: true, Host: "android.example.com", Port: 2222, AllowADB: true, AllowReverse: true, MaxTunnels: 32}
	if info != want {
		t.Fatalf("info = %+v", info)
	}

	rec := h.do(http.MethodPut, "/api/v1/ssh/keys", "alice", "dev", keyList{Keys: []SSHKeyInput{{Name: "laptop", PublicKey: a}, {Name: "ci", PublicKey: b}}})
	if rec.Code != http.StatusOK || decode[SSHKeysSynced](t, rec).Replicas != 2 {
		t.Fatalf("put = %d %s", rec.Code, rec.Body)
	}
	for i, store := range h.stores {
		for _, fp := range []string{aFP, bFP} {
			if id, ok := store.Lookup(fp); !ok || id.User != "alice" || len(id.Groups) != 1 {
				t.Fatalf("replica %d lookup %s = %+v, %v", i, fp, id, ok)
			}
		}
	}

	rec = h.do(http.MethodPut, "/api/v1/ssh/keys", "bob", "", keyList{Keys: []SSHKeyInput{{PublicKey: b}}})
	if p := decode[problem](t, rec); rec.Code != http.StatusUnprocessableEntity || len(p.Errors) != 1 ||
		p.Errors[0].Location != "body.keys[0].publicKey" || !strings.Contains(p.Errors[0].Message, "another user") {
		t.Fatalf("claimed = %d %s", rec.Code, rec.Body)
	}

	h.down["10.0.0.2:8080"] = true
	rec = h.do(http.MethodPut, "/api/v1/ssh/keys", "alice", "", keyList{Keys: []SSHKeyInput{{PublicKey: a}}})
	if rec.Code != http.StatusOK || decode[SSHKeysSynced](t, rec).Replicas != 1 {
		t.Fatalf("partial = %d %s", rec.Code, rec.Body)
	}
	if _, ok := h.stores[0].Lookup(bFP); ok {
		t.Fatal("removed key still on the replica")
	}

	h.down["10.0.0.1:8080"] = true
	rec = h.do(http.MethodPut, "/api/v1/ssh/keys", "alice", "", keyList{Keys: []SSHKeyInput{}})
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("all down = %d %s", rec.Code, rec.Body)
	}
}

func TestSSHKeysValidation(t *testing.T) {
	h := newSSHHarness(t, true, 1)
	a, _ := sshKey(t)
	rec := h.do(http.MethodPut, "/api/v1/ssh/keys", "alice", "", keyList{Keys: []SSHKeyInput{
		{PublicKey: a},
		{PublicKey: "ssh-ed25519 not-base64"},
		{PublicKey: a},
		{PublicKey: "-----BEGIN OPENSSH PRIVATE KEY-----"},
	}})
	p := decode[problem](t, rec)
	if rec.Code != http.StatusUnprocessableEntity || len(p.Errors) != 3 {
		t.Fatalf("validation = %d %s", rec.Code, rec.Body)
	}
	for i, want := range []struct{ loc, msg string }{
		{"body.keys[1].publicKey", "not an OpenSSH public key"},
		{"body.keys[2].publicKey", "same key as keys[0]"},
		{"body.keys[3].publicKey", "private key"},
	} {
		if p.Errors[i].Location != want.loc || !strings.Contains(p.Errors[i].Message, want.msg) {
			t.Fatalf("error %d = %+v", i, p.Errors[i])
		}
	}
	if strings.Contains(rec.Body.String(), "BEGIN OPENSSH") {
		t.Fatal("response echoes the submitted key")
	}
}

func TestInternalSSHSessions(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, 2, func(c *fake.Config) { c.TunnelURL = "http://tunnels" })
	v := h.create("otter")
	srv := httptest.NewServer(h.internal)
	t.Cleanup(srv.Close)
	c := contract.NewSSHSessionsClient(srv.URL, nil)

	got, err := c.SSHSession(ctx, "fake-"+v.ID)
	want := contract.SSHSession{Provider: "fake", ID: v.ID, Owner: "otter", State: contract.StateProvisioning, TunnelURL: "http://tunnels/agents/" + v.ID}
	if err != nil || got != want {
		t.Fatalf("session %+v, %v; want %+v", got, err, want)
	}
	for _, slug := range []string{"fake-nope", "other-" + v.ID, "fake-", v.ID} {
		if _, err := c.SSHSession(ctx, slug); !errors.Is(err, contract.ErrNotFound) {
			t.Errorf("%s: %v", slug, err)
		}
	}

	h.clock.Advance(20 * time.Minute)
	if err := c.SSHActivity(ctx, "fake-"+v.ID); err != nil {
		t.Fatal(err)
	}
	h.clock.Advance(11 * time.Minute)
	h.srv.Reap(ctx)
	if _, err := h.provider.Get(ctx, v.ID); err != nil {
		t.Fatalf("session with tunnel traffic reaped: %v", err)
	}
	if err := c.SSHActivity(ctx, "fake-nope"); !errors.Is(err, contract.ErrNotFound) {
		t.Fatalf("activity for an unknown session: %v", err)
	}
}
