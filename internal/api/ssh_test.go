package api

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"

	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/contract/control"
	"github.com/holtdroid/holtdroid/internal/provider/fake"
)

type sshHarness struct {
	*harness
	gateways []*gatewayStub
	down     map[string]bool
	clock    *clock
}

type gatewayStub struct {
	mu        sync.Mutex
	computers map[string][]control.Computer
	published map[string][]int
}

func (g *gatewayStub) HostKeys(context.Context) ([]string, error) {
	return []string{"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHcJ6Zh5W7Ua0Ihd2W9mKt0yqTq0fXGkS9zG4Yb7pZ2w"}, nil
}

func (g *gatewayStub) Computers(_ context.Context, user string) ([]control.Computer, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.computers[user], nil
}

func (g *gatewayStub) SetPublished(_ context.Context, user, computer string, ports []int) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, c := range g.computers[user] {
		if c.ID == computer {
			g.published[computer] = ports
			return nil
		}
	}
	return contract.ErrNotFound
}

func newSSHHarness(t *testing.T, enabled bool, replicas int) *sshHarness {
	t.Helper()
	h := &sshHarness{down: map[string]bool{}, clock: &clock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}}
	backends := map[string]string{}
	var ips []string
	for i := range replicas {
		stub := &gatewayStub{computers: map[string][]control.Computer{}, published: map[string][]int{}}
		mux := http.NewServeMux()
		contract.RegisterSSHGateway(contract.NewAPI(mux, "gateway"), stub)
		gw := httptest.NewServer(mux)
		t.Cleanup(gw.Close)
		ip := "10.0.0." + string(rune('1'+i))
		ips = append(ips, ip)
		backends[ip+":8080"] = gw.Listener.Addr().String()
		h.gateways = append(h.gateways, stub)
	}

	cfg := DefaultConfig()
	cfg.PublicURL = "https://android.example.com"
	cfg.Storage.Filesystem.Dir = t.TempDir()
	cfg.Sources[0].Filesystem.Dir = t.TempDir()
	cfg.Auth.Mode = auth.ModeHeader
	cfg.Auth.AdminGroups = []string{"admins"}
	cfg.SSH.Enabled = enabled
	cfg.SSH.GatewayURL = "http://gateway-headless:8080"
	cfg.SSH.ClientDir = t.TempDir()
	aud, buf := testAudit(t, h.clock.Now)
	srv, err := New(context.Background(), cfg, WithAudit(aud), WithClock(h.clock.Now), WithResolver(func(_ context.Context, host string) ([]string, error) {
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
	h.harness = &harness{t: t, srv: srv, handler: srv.Handler(), internal: srv.InternalHandler(), audit: buf, cfg: cfg}
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

type problem struct {
	Status int    `json:"status"`
	Detail string `json:"detail"`
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
	for _, path := range []string{"/api/v1/connect/codes", "/api/v1/connect/enroll"} {
		if rec := h.do(http.MethodPost, path, "alice", "", control.Enroll{Code: "x", PublicKey: "x"}); rec.Code != http.StatusNotFound {
			t.Fatalf("%s = %d", path, rec.Code)
		}
	}
	if rec := h.do(http.MethodGet, "/tunnel.sh", "", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("tunnel.sh = %d", rec.Code)
	}
	if list := decode[ComputerList](t, h.do(http.MethodGet, "/api/v1/ssh/computers", "alice", "", nil)); len(list.Computers) != 0 {
		t.Fatalf("computers = %+v", list)
	}
}

func (h *sshHarness) code(user, groups string) string {
	h.t.Helper()
	rec := h.do(http.MethodPost, "/api/v1/connect/codes", user, groups, nil)
	if rec.Code != http.StatusOK {
		h.t.Fatalf("code = %d %s", rec.Code, rec.Body)
	}
	return decode[ConnectCode](h.t, rec).Code
}

func TestConnectEnrollAndRefresh(t *testing.T) {
	h := newSSHHarness(t, true, 2)
	key, fp := sshKey(t)
	other, _ := sshKey(t)

	info := decode[SSHInfo](t, h.do(http.MethodGet, "/api/v1/ssh", "alice", "", nil))
	want := SSHInfo{Enabled: true, Host: "android.example.com", Port: 2222, AllowADB: true, AllowReverse: true, MaxTunnels: 32, Handle: h.srv.sshHandle("alice")}
	if info != want || !regexp.MustCompile(`^user-[a-z2-7]{16}$`).MatchString(info.Handle) {
		t.Fatalf("info = %+v", info)
	}

	if rec := h.do(http.MethodPost, "/api/v1/connect/codes", "", "", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("code without sign-in = %d", rec.Code)
	}
	code := h.code("alice", "admins")
	enroll := control.Enroll{Code: code, PublicKey: key, Hostname: "alice's\tmac\n" + strings.Repeat("x", 80), OS: "darwin", Arch: "arm64"}
	rec := h.do(http.MethodPost, "/api/v1/connect/enroll", "", "", enroll)
	if rec.Code != http.StatusOK {
		t.Fatalf("enroll = %d %s", rec.Code, rec.Body)
	}
	creds := decode[control.Credentials](t, rec)
	if creds.User != "alice" || creds.Handle != info.Handle || creds.Host != "android.example.com" || creds.Port != 2222 ||
		len(creds.HostKeys) != 1 || creds.Computer == "" || !creds.CertificateExpiresAt.Equal(h.clock.Now().Add(15*time.Minute)) {
		t.Fatalf("credentials = %+v", creds)
	}

	authority, err := h.srv.SSHAuthority(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	ca, _, _, _, _ := ssh.ParseAuthorizedKey([]byte(authority))
	pub, _, _, _, err := ssh.ParseAuthorizedKey([]byte(creds.Certificate))
	if err != nil {
		t.Fatal(err)
	}
	cert := pub.(*ssh.Certificate)
	checker := ssh.CertChecker{IsUserAuthority: func(k ssh.PublicKey) bool { return bytes.Equal(k.Marshal(), ca.Marshal()) }, Clock: h.clock.Now}
	if err := checker.CheckCert(info.Handle, cert); err != nil {
		t.Fatalf("certificate: %v", err)
	}
	if ssh.FingerprintSHA256(cert.Key) != fp || cert.KeyId != creds.Computer || cert.Extensions[control.CertUser] != "alice" ||
		cert.Extensions[control.CertAdmin] != "true" || cert.Extensions[control.CertHostname] != "alice'smac"+strings.Repeat("x", 54) {
		t.Fatalf("certificate %+v", cert)
	}
	if err := checker.CheckCert(h.srv.sshHandle("bob"), cert); err == nil {
		t.Fatal("certificate valid for another user's handle")
	}

	if rec := h.do(http.MethodPost, "/api/v1/connect/enroll", "", "", enroll); rec.Code != http.StatusUnauthorized ||
		!strings.Contains(decode[problem](t, rec).Detail, "already used") {
		t.Fatalf("second use = %d %s", rec.Code, rec.Body)
	}
	if rec := h.do(http.MethodPost, "/api/v1/connect/enroll", "", "", control.Enroll{Code: creds.RefreshToken, PublicKey: key}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("refresh token as a code = %d", rec.Code)
	}
	if rec := h.do(http.MethodPost, "/api/v1/connect/enroll", "", "", control.Enroll{Code: h.code("alice", ""), PublicKey: "ssh-ed25519 nope"}); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("bad key = %d", rec.Code)
	}
	late := h.code("alice", "")
	h.clock.Advance(11 * time.Minute)
	if rec := h.do(http.MethodPost, "/api/v1/connect/enroll", "", "", control.Enroll{Code: late, PublicKey: key}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("expired code = %d", rec.Code)
	}

	refresh := func(token, key string) *httptest.ResponseRecorder {
		return h.do(http.MethodPost, "/api/v1/connect/refresh", "", "", control.Refresh{RefreshToken: token, PublicKey: key})
	}
	rec = refresh(creds.RefreshToken, key)
	if rec.Code != http.StatusOK {
		t.Fatalf("refresh = %d %s", rec.Code, rec.Body)
	}
	next := decode[control.Credentials](t, rec)
	if next.RefreshToken == creds.RefreshToken || next.Computer != creds.Computer || !next.CertificateExpiresAt.After(creds.CertificateExpiresAt) {
		t.Fatalf("refreshed = %+v", next)
	}
	bearer := func(token string) int {
		r := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
		r.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		h.handler.ServeHTTP(rec, r)
		if rec.Code == http.StatusOK && decode[auth.Identity](t, rec).User != "alice" {
			t.Fatalf("bearer identity %s", rec.Body)
		}
		return rec.Code
	}
	if code := bearer(next.AccessToken); code != http.StatusOK {
		t.Fatalf("access token = %d", code)
	}
	for _, token := range []string{next.RefreshToken, code, "garbage"} {
		if code := bearer(token); code != http.StatusUnauthorized {
			t.Fatalf("%.20s… as a bearer token = %d", token, code)
		}
	}
	if rec := refresh(next.RefreshToken, other); rec.Code != http.StatusUnauthorized {
		t.Fatalf("refresh with another key = %d", rec.Code)
	}
	if rec := refresh(code, key); rec.Code != http.StatusUnauthorized {
		t.Fatalf("code as a refresh token = %d", rec.Code)
	}
	h.clock.Advance(31 * 24 * time.Hour)
	if rec := refresh(next.RefreshToken, key); rec.Code != http.StatusUnauthorized {
		t.Fatalf("expired refresh token = %d", rec.Code)
	}

	var got []string
	for line := range strings.Lines(h.audit.String()) {
		var ev struct {
			Action, Result, Actor string
			Details               map[string]string
		}
		_ = json.Unmarshal([]byte(line), &ev)
		if ev.Action == "ssh.enroll" {
			got = append(got, strings.Join([]string{ev.Result, ev.Actor, ev.Details["fingerprint"]}, "|"))
		}
	}
	wantAudit := []string{"ok|alice|" + fp, "denied|alice|", "denied||", "denied||"}
	if !slices.Equal(got, wantAudit) {
		t.Fatalf("audit %q, want %q", got, wantAudit)
	}
}

func TestComputers(t *testing.T) {
	h := newSSHHarness(t, true, 2)
	h.gateways[0].computers["alice"] = []control.Computer{{ID: "a1", Hostname: "mac"}}
	h.gateways[1].computers["alice"] = []control.Computer{{ID: "a2", Hostname: "linux"}}
	h.gateways[1].computers["bob"] = []control.Computer{{ID: "b1", Hostname: "pc"}}

	list := decode[ComputerList](t, h.do(http.MethodGet, "/api/v1/ssh/computers", "alice", "", nil))
	if len(list.Computers) != 2 || list.Computers[0].ID != "a1" || list.Computers[1].ID != "a2" {
		t.Fatalf("alice's computers %+v", list)
	}

	put := func(user, id string, ports []int) *httptest.ResponseRecorder {
		return h.do(http.MethodPut, "/api/v1/ssh/computers/"+id+"/published", user, "", map[string][]int{"ports": ports})
	}
	if rec := put("alice", "a2", []int{3000, 8080}); rec.Code != http.StatusNoContent || !slices.Equal(h.gateways[1].published["a2"], []int{3000, 8080}) {
		t.Fatalf("publish = %d %s", rec.Code, rec.Body)
	}
	if rec := put("alice", "b1", []int{3000}); rec.Code != http.StatusNotFound {
		t.Fatalf("someone else's computer = %d", rec.Code)
	}
	if rec := put("alice", "a1", []int{0}); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("bad port = %d", rec.Code)
	}

	h.down["10.0.0.2:8080"] = true
	list = decode[ComputerList](t, h.do(http.MethodGet, "/api/v1/ssh/computers", "alice", "", nil))
	if len(list.Computers) != 1 || list.Computers[0].ID != "a1" {
		t.Fatalf("one replica down %+v", list)
	}
	if rec := put("alice", "a2", []int{3000}); rec.Code != http.StatusBadGateway {
		t.Fatalf("publish on a replica that is down = %d", rec.Code)
	}
	h.down["10.0.0.1:8080"] = true
	if rec := h.do(http.MethodGet, "/api/v1/ssh/computers", "alice", "", nil); rec.Code != http.StatusBadGateway {
		t.Fatalf("all down = %d", rec.Code)
	}
}

func TestTunnelScript(t *testing.T) {
	h := newSSHHarness(t, true, 1)
	build := []byte("#!/bin/sh\necho client\n")
	for _, name := range []string{"holtdroid-linux-amd64", "holtdroid-darwin-arm64", "holtdroid-plan9-386", "notes.txt"} {
		if err := os.WriteFile(filepath.Join(h.cfg.SSH.ClientDir, name), build, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	sum := sha256.Sum256(build)

	rec := h.do(http.MethodGet, "/tunnel.sh", "", "", nil)
	script := rec.Body.String()
	if rec.Code != http.StatusOK || !strings.Contains(script, "portal='https://android.example.com'") ||
		!strings.Contains(script, "linux-amd64) sum="+hex.EncodeToString(sum[:])) || !strings.Contains(script, "darwin-arm64) sum=") ||
		strings.Contains(script, "plan9") {
		t.Fatalf("tunnel.sh = %d\n%s", rec.Code, script)
	}
	if out, err := exec.Command("sh", "-n", "-c", script).CombinedOutput(); err != nil {
		t.Fatalf("sh -n: %v %s", err, out)
	}
	if strings.Contains(script, "--insecure") {
		t.Fatal("insecure TLS without insecureTLS")
	}
	h.srv.cfg.SSH.InsecureTLS = true
	insecure := h.do(http.MethodGet, "/tunnel.sh", "", "", nil).Body.String()
	if !strings.Contains(insecure, "curl -k") || !strings.Contains(insecure, "set -- --insecure") {
		t.Fatalf("insecure script:\n%s", insecure)
	}
	if out, err := exec.Command("sh", "-n", "-c", insecure).CombinedOutput(); err != nil {
		t.Fatalf("sh -n: %v %s", err, out)
	}
	h.srv.cfg.SSH.InsecureTLS = false

	manifest := decode[control.Manifest](t, h.do(http.MethodGet, "/connect/manifest.json", "", "", nil))
	if len(manifest.Clients) != 2 || manifest.Clients[0].SHA256 != hex.EncodeToString(sum[:]) {
		t.Fatalf("manifest %+v", manifest)
	}

	rec = h.do(http.MethodGet, "/connect/holtdroid-linux-amd64", "", "", nil)
	if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), build) {
		t.Fatalf("client = %d", rec.Code)
	}
	for _, name := range []string{"notes.txt", "holtdroid-plan9-386", "..%2fsecret"} {
		if rec := h.do(http.MethodGet, "/connect/"+name, "", "", nil); rec.Code != http.StatusNotFound {
			t.Fatalf("%s = %d", name, rec.Code)
		}
	}
}

func TestInternalSSHSessions(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, 2, func(c *fake.Config) { c.TunnelURL = "http://tunnels" })
	v := h.create("otter")
	srv := httptest.NewServer(h.internal)
	t.Cleanup(srv.Close)
	c := contract.NewSSHSessionsClient(srv.URL, nil)

	if _, err := c.SSHAuthority(ctx); !errors.Is(err, contract.ErrNotFound) {
		t.Fatalf("authority with ssh off: %v", err)
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
	want := contract.SSHSession{
		Provider: "fake", ID: v.ID, Owner: "otter", State: contract.StateProvisioning, TunnelURL: "http://tunnels/agents/" + v.ID,
		Package: "com.example.helloworld", Label: "HelloWorld", VersionName: "1.0",
	}
	if err != nil || len(mine) != 1 || mine[0] != want {
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
