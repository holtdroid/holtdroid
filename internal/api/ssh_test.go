package api

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
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
	stores   []*sshgateway.Keys
	requests []map[string]contract.KeyRequest
	down     map[string]bool
}

type gatewayStub struct {
	*sshgateway.Keys
	requests map[string]contract.KeyRequest
}

func (g gatewayStub) KeyRequest(_ context.Context, code string) (contract.KeyRequest, error) {
	r, ok := g.requests[code]
	if !ok {
		return r, contract.ErrNotFound
	}
	return r, nil
}

func newSSHHarness(t *testing.T, enabled bool, replicas int) *sshHarness {
	t.Helper()
	h := &sshHarness{down: map[string]bool{}}
	backends := map[string]string{}
	var ips []string
	for i := range replicas {
		store := sshgateway.NewKeys(time.Hour, nil)
		requests := map[string]contract.KeyRequest{}
		mux := http.NewServeMux()
		contract.RegisterSSHGateway(contract.NewAPI(mux, "gateway"), gatewayStub{store, requests})
		gw := httptest.NewServer(mux)
		t.Cleanup(gw.Close)
		ip := "10.0.0." + string(rune('1'+i))
		ips = append(ips, ip)
		backends[ip+":8080"] = gw.Listener.Addr().String()
		h.stores = append(h.stores, store)
		h.requests = append(h.requests, requests)
	}

	cfg := DefaultConfig()
	cfg.PublicURL = "https://android.example.com"
	cfg.Storage.Filesystem.Dir = t.TempDir()
	cfg.Sources[0].Filesystem.Dir = t.TempDir()
	cfg.Auth.Mode = auth.ModeHeader
	cfg.SSH.Enabled = enabled
	cfg.SSH.GatewayURL = "http://gateway-headless:8080"
	aud, buf := testAudit(t, time.Now)
	srv, err := New(context.Background(), cfg, WithAudit(aud), WithResolver(func(_ context.Context, host string) ([]string, error) {
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
	h.harness = &harness{t: t, srv: srv, handler: srv.Handler(), audit: buf}
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
	want := SSHInfo{Enabled: true, Host: "android.example.com", Port: 2222, AllowADB: true, AllowReverse: true, ClientIsolation: true, MaxTunnels: 32, KeyRequests: true, Handle: h.srv.sshHandle("alice")}
	if info != want || !regexp.MustCompile(`^user-[a-z2-7]{16}$`).MatchString(info.Handle) || info.Handle == h.srv.sshHandle("bob") {
		t.Fatalf("info = %+v", info)
	}

	rec := h.do(http.MethodPut, "/api/v1/ssh/keys", "alice", "dev", keyList{Keys: []SSHKeyInput{{Name: "laptop", PublicKey: a}, {Name: "ci", PublicKey: b}}})
	if rec.Code != http.StatusOK || decode[SSHKeysSynced](t, rec).Replicas != 2 {
		t.Fatalf("put = %d %s", rec.Code, rec.Body)
	}
	for i, store := range h.stores {
		for _, fp := range []string{aFP, bFP} {
			if id, ok := store.Lookup(fp); !ok || id.User != "alice" || id.Handle != info.Handle || len(id.Groups) != 1 {
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

	var got []string
	for line := range strings.Lines(h.audit.String()) {
		var ev struct {
			Action, Result, Actor string
			Details               map[string]string
		}
		_ = json.Unmarshal([]byte(line), &ev)
		got = append(got, strings.Join([]string{ev.Action, ev.Result, ev.Actor, ev.Details["keys"], ev.Details["fingerprints"], ev.Details["replicas"]}, "|"))
	}
	wantAudit := []string{
		"ssh.keys|ok|alice|2|" + aFP + "," + bFP + "|2",
		"ssh.keys|failed|bob|1|" + bFP + "|0",
		"ssh.keys|ok|alice|1|" + aFP + "|1",
		"ssh.keys|failed|alice|0||0",
	}
	if !slices.Equal(got, wantAudit) {
		t.Fatalf("audit %q, want %q", got, wantAudit)
	}
}

func TestSSHKeyRequest(t *testing.T) {
	h := newSSHHarness(t, true, 2)
	key, fp := sshKey(t)
	want := contract.KeyRequest{PublicKey: key, Fingerprint: fp, Session: "fake-1", ClientIP: "192.0.2.1", ExpiresAt: time.Date(2026, 1, 1, 0, 5, 0, 0, time.UTC)}
	h.requests[1]["abcdefghijklmnop"] = want

	rec := h.do(http.MethodGet, "/api/v1/ssh/key-requests/abcdefghijklmnop", "alice", "", nil)
	if got := decode[SSHKeyRequest](t, rec); rec.Code != http.StatusOK || got != SSHKeyRequest(want) {
		t.Fatalf("get = %d %s", rec.Code, rec.Body)
	}
	if rec := h.do(http.MethodGet, "/api/v1/ssh/key-requests/zzzzzzzzzzzzzzzz", "alice", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown code = %d", rec.Code)
	}
	if rec := h.do(http.MethodGet, "/api/v1/ssh/key-requests/NOPE", "alice", "", nil); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("malformed code = %d", rec.Code)
	}

	h.down["10.0.0.1:8080"] = true
	if rec := h.do(http.MethodGet, "/api/v1/ssh/key-requests/abcdefghijklmnop", "alice", "", nil); rec.Code != http.StatusOK {
		t.Fatalf("one replica down = %d", rec.Code)
	}
	if rec := h.do(http.MethodGet, "/api/v1/ssh/key-requests/zzzzzzzzzzzzzzzz", "alice", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown code with one replica down = %d", rec.Code)
	}
	h.down["10.0.0.2:8080"] = true
	if rec := h.do(http.MethodGet, "/api/v1/ssh/key-requests/abcdefghijklmnop", "alice", "", nil); rec.Code != http.StatusBadGateway {
		t.Fatalf("all down = %d", rec.Code)
	}

	off := newSSHHarness(t, false, 1)
	if rec := off.do(http.MethodGet, "/api/v1/ssh/key-requests/abcdefghijklmnop", "alice", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("ssh disabled = %d", rec.Code)
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

	h.create("badger")
	mine, err := c.SSHUserSessions(ctx, h.srv.sshHandle("otter"))
	if err != nil || len(mine) != 1 || mine[0].ID != v.ID || mine[0].Owner != "otter" {
		t.Fatalf("otter's sessions %+v, %v", mine, err)
	}
	if none, err := c.SSHUserSessions(ctx, "user-nobody"); err != nil || len(none) != 0 {
		t.Fatalf("unknown handle %+v, %v", none, err)
	}
}

func TestSSHTunnels(t *testing.T) {
	ctx := context.Background()
	tunnels := httptest.NewServer(http.NotFoundHandler())
	t.Cleanup(tunnels.Close)
	h := newHarness(t, 3, func(c *fake.Config) {
		c.StepDelay = time.Millisecond
		c.TunnelURL = tunnels.URL
	})
	tunnels.Config.Handler = h.provider.TunnelHandler()
	h.srv.cfg.SSH.Enabled = true

	mine := h.create("otter")
	shared := h.create("badger")
	idle := h.create("otter")
	for _, v := range []SessionView{mine, shared, idle} {
		h.waitReady(v.ID)
	}
	open := func(v SessionView, port int, user string) {
		t.Helper()
		sess, err := h.provider.Get(ctx, v.ID)
		if err != nil {
			t.Fatal(err)
		}
		ys, err := contract.NewTunnelClient(sess.TunnelURL, nil).Reverse(ctx, port, user)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { ys.Close() })
	}
	open(mine, 3000, "otter")
	open(shared, 3001, "otter")
	open(shared, 4000, "badger")

	list := decode[SSHTunnelList](t, h.do(http.MethodGet, "/api/v1/ssh/tunnels", "otter", "", nil))
	got := map[string][]int{}
	for _, s := range list.Sessions {
		for _, r := range s.Reverse {
			got[s.ID] = append(got[s.ID], r.Port)
		}
	}
	want := map[string][]int{mine.ID: {3000}, shared.ID: {3001}}
	if len(list.Sessions) != 2 || !slices.Equal(got[mine.ID], want[mine.ID]) || !slices.Equal(got[shared.ID], want[shared.ID]) {
		t.Fatalf("otter's tunnels %+v", list)
	}
	if list := decode[SSHTunnelList](t, h.do(http.MethodGet, "/api/v1/ssh/tunnels", "carol", "", nil)); len(list.Sessions) != 0 {
		t.Fatalf("carol's tunnels %+v", list)
	}

	h.srv.cfg.SSH.Enabled = false
	if list := decode[SSHTunnelList](t, h.do(http.MethodGet, "/api/v1/ssh/tunnels", "otter", "", nil)); len(list.Sessions) != 0 {
		t.Fatalf("tunnels with ssh off %+v", list)
	}
}
