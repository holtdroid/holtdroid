package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/audit"
	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/db"
	"github.com/holtdroid/holtdroid/internal/provider/fake"
	"github.com/holtdroid/holtdroid/internal/source"
	"github.com/holtdroid/holtdroid/internal/storage"
)

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

type harness struct {
	t        *testing.T
	srv      *Server
	handler  http.Handler
	internal http.Handler
	provider *fake.Provider
	clock    *clock
	apks     string
	cfg      Config
	audit    *bytes.Buffer
}

func testAudit(t *testing.T, now func() time.Time) (*audit.Logger, *bytes.Buffer) {
	t.Helper()
	buf := &bytes.Buffer{}
	cfg := audit.Config{Store: audit.StoreConfig{Enabled: true, MaxEvents: 1000}}
	l, err := audit.New(context.Background(), cfg, "api", "test", nil, audit.WithStdout(buf), audit.WithClock(now))
	if err != nil {
		t.Fatal(err)
	}
	return l, buf
}

func newHarness(t *testing.T, slots int, opts ...func(*fake.Config)) *harness {
	t.Helper()
	return newHarnessWith(t, slots, nil, opts...)
}

func newHarnessWith(t *testing.T, slots int, configure func(*Config), opts ...func(*fake.Config)) *harness {
	t.Helper()
	apks := t.TempDir()
	copyFile(t, "../apk/testdata/helloworld.apk", filepath.Join(apks, "hello.apk"))
	if err := os.WriteFile(filepath.Join(apks, "broken.apk"), []byte("nope"), 0o600); err != nil {
		t.Fatal(err)
	}

	clk := &clock{t: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)}
	agents := httptest.NewServer(http.NotFoundHandler())
	t.Cleanup(agents.Close)
	fc := fake.Config{Slots: slots, StepDelay: time.Hour, PublicURL: agents.URL}
	for _, opt := range opts {
		opt(&fc)
	}
	p := fake.New(fc, fake.WithClock(clk.Now))
	agents.Config.Handler = p.AgentHandler()

	cfg := DefaultConfig()
	cfg.DevTools.Frontend = ""
	cfg.Storage.Filesystem.Dir = t.TempDir()
	cfg.Auth.Mode = auth.ModeHeader
	cfg.Auth.AdminGroups = []string{"admins"}
	cfg.Sources = []source.Config{{Name: "local", Type: "filesystem", Filesystem: storage.FilesystemConfig{Dir: apks}}}
	internal := httptest.NewServer(http.NotFoundHandler())
	t.Cleanup(internal.Close)
	cfg.InternalURL = internal.URL
	if configure != nil {
		configure(&cfg)
	}
	aud, buf := testAudit(t, clk.Now)
	srv, err := New(context.Background(), cfg, WithClock(clk.Now), WithProvider("fake", p), WithAudit(aud), WithTempDir(t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	internal.Config.Handler = srv.InternalHandler()
	return &harness{t: t, srv: srv, handler: srv.Handler(), internal: srv.InternalHandler(), provider: p, clock: clk, apks: apks, cfg: cfg, audit: buf}
}

func copyFile(t *testing.T, from, to string) {
	t.Helper()
	raw, err := os.ReadFile(from)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(to, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func (h *harness) do(method, path, user, groups string, body any) *httptest.ResponseRecorder {
	h.t.Helper()
	var reader io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	}
	r := httptest.NewRequest(method, path, reader)
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	if user != "" {
		r.Header.Set("Remote-User", user)
		r.Header.Set("Remote-Groups", groups)
	}
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, r)
	return rec
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return v
}

func (h *harness) create(user string) SessionView {
	h.t.Helper()
	rec := h.do(http.MethodPost, "/api/v1/sessions", user, "", map[string]string{
		"source": "local", "artifactId": encodeID("hello.apk"), "provider": "fake", "location": "pl",
	})
	if rec.Code != http.StatusCreated {
		h.t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	return decode[SessionView](h.t, rec)
}

func (h *harness) ref(v SessionView) string {
	h.t.Helper()
	sess, err := h.provider.Get(context.Background(), v.ID)
	if err != nil {
		h.t.Fatal(err)
	}
	return sess.ArtifactRef
}

func (h *harness) events(id string) []string {
	h.t.Helper()
	rows, err := h.srv.db.ListSessionEvents(context.Background(), db.ListSessionEventsParams{Provider: "fake", SessionID: id})
	if err != nil {
		h.t.Fatal(err)
	}
	var out []string
	for _, r := range rows {
		out = append(out, strings.Join([]string{r.Action, r.Result, r.Actor, r.Artifact, r.Reason}, "|"))
	}
	return out
}

func TestRequiresAuth(t *testing.T) {
	h := newHarness(t, 1)
	if rec := h.do(http.MethodGet, "/api/v1/sessions", "", "", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("code = %d", rec.Code)
	}
	if rec := h.do(http.MethodGet, "/healthz", "", "", nil); rec.Code != http.StatusOK {
		t.Fatalf("healthz code = %d", rec.Code)
	}
}

func TestCreateSession(t *testing.T) {
	h := newHarness(t, 2)
	v := h.create("otter")

	if v.Owner != "otter" || v.Package != "com.example.helloworld" || v.Label != "HelloWorld" || v.Location != "pl" {
		t.Fatalf("unexpected view %+v", v)
	}
	if v.Source != "local" || v.ArtifactID != encodeID("hello.apk") {
		t.Fatalf("artifact ref %q/%q", v.Source, v.ArtifactID)
	}
	if want := h.clock.Now().Add(30 * time.Minute); !v.IdleDeadline.Equal(want) {
		t.Fatalf("idle deadline %v, want %v", v.IdleDeadline, want)
	}

	sess, err := h.provider.Get(context.Background(), v.ID)
	if err != nil {
		t.Fatal(err)
	}
	src, id, rev := splitRef(sess.ArtifactRef)
	if src != "local" || id != "hello.apk" || rev == "" {
		t.Fatalf("artifact ref %q", sess.ArtifactRef)
	}

	list := decode[ArtifactList](t, h.do(http.MethodGet, "/api/v1/artifacts", "otter", "", nil))
	if len(list.Items) != 2 {
		t.Fatalf("artifacts = %d", len(list.Items))
	}
	for _, it := range list.Items {
		if it.ID == encodeID("hello.apk") && (it.App == nil || it.App.Package != "com.example.helloworld" || it.Revision != rev) {
			t.Fatalf("hello.apk metadata missing: %+v", it)
		}
	}

	rec := httptest.NewRecorder()
	h.internal.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/internal/artifacts/"+cacheKey(src, id, rev), nil))
	if rec.Code != http.StatusOK || rec.Body.Len() == 0 {
		t.Fatalf("internal artifact: %d", rec.Code)
	}
	if v.IconURL != "" {
		if rec := h.do(http.MethodGet, v.IconURL, "otter", "", nil); rec.Code != http.StatusOK {
			t.Fatalf("icon: %d", rec.Code)
		}
	}
}

func TestCreateSessionErrors(t *testing.T) {
	h := newHarness(t, 1)
	tests := []struct {
		name string
		body map[string]string
		code int
	}{
		{"unknown provider", map[string]string{"source": "local", "artifactId": encodeID("hello.apk"), "provider": "nope"}, http.StatusNotFound},
		{"unknown source", map[string]string{"source": "nope", "artifactId": encodeID("hello.apk"), "provider": "fake"}, http.StatusNotFound},
		{"unknown artifact", map[string]string{"source": "local", "artifactId": encodeID("missing.apk"), "provider": "fake"}, http.StatusNotFound},
		{"unknown location", map[string]string{"source": "local", "artifactId": encodeID("hello.apk"), "provider": "fake", "location": "mars"}, http.StatusUnprocessableEntity},
		{"not an apk", map[string]string{"source": "local", "artifactId": encodeID("broken.apk"), "provider": "fake"}, http.StatusUnprocessableEntity},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if rec := h.do(http.MethodPost, "/api/v1/sessions", "otter", "", tt.body); rec.Code != tt.code {
				t.Fatalf("code = %d, want %d: %s", rec.Code, tt.code, rec.Body.String())
			}
		})
	}

	h.create("otter")
	rec := h.do(http.MethodPost, "/api/v1/sessions", "otter", "", map[string]string{"source": "local", "artifactId": encodeID("hello.apk"), "provider": "fake"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("no capacity: code = %d", rec.Code)
	}
}

func TestLaunchTarget(t *testing.T) {
	h := newHarness(t, 2)
	h.srv.providers["spare"] = fake.New(fake.Config{Slots: 1, StepDelay: time.Hour, PublicURL: "http://agents", NoDirect: true})
	h.srv.provOrder = append(h.srv.provOrder, "spare")
	hello := encodeID("hello.apk")

	steps := []struct {
		name     string
		body     map[string]string
		code     int
		provider string
		slot     string
	}{
		{"a device of the provider", map[string]string{"provider": "fake", "slot": "fake-2"}, http.StatusCreated, "fake", "fake-2"},
		{"a busy device", map[string]string{"provider": "fake", "slot": "fake-2"}, http.StatusConflict, "", ""},
		{"an unknown device", map[string]string{"provider": "fake", "slot": "nope"}, http.StatusUnprocessableEntity, "", ""},
		{"a device without a provider", map[string]string{"slot": "fake-1"}, http.StatusUnprocessableEntity, "", ""},
		{"any provider, in order", map[string]string{}, http.StatusCreated, "fake", "fake-1"},
		{"a location the free provider lacks", map[string]string{"location": "direct"}, http.StatusConflict, "", ""},
		{"an unknown location", map[string]string{"location": "nowhere"}, http.StatusUnprocessableEntity, "", ""},
		{"any provider, the next one", map[string]string{"location": "pl"}, http.StatusCreated, "spare", "fake-1"},
		{"every device busy", map[string]string{}, http.StatusConflict, "", ""},
	}
	for _, st := range steps {
		st.body["source"], st.body["artifactId"] = "local", hello
		rec := h.do(http.MethodPost, "/api/v1/sessions", "otter", "", st.body)
		if rec.Code != st.code {
			t.Fatalf("%s: code = %d %s", st.name, rec.Code, rec.Body.String())
		}
		if st.code != http.StatusCreated {
			continue
		}
		if v := decode[SessionView](t, rec); v.Provider != st.provider || v.Slot != st.slot {
			t.Fatalf("%s: got %s/%s", st.name, v.Provider, v.Slot)
		}
	}
}

func TestLaunchQueue(t *testing.T) {
	h := newHarness(t, 1)
	h.srv.queue.poll = time.Millisecond
	first := h.create("otter")

	launch := func(ctx context.Context, user string) <-chan *httptest.ResponseRecorder {
		done := make(chan *httptest.ResponseRecorder, 1)
		go func() {
			raw, _ := json.Marshal(map[string]any{"source": "local", "artifactId": encodeID("hello.apk"), "provider": "fake", "queue": true})
			r := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/sessions", bytes.NewReader(raw))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Remote-User", user)
			rec := httptest.NewRecorder()
			h.handler.ServeHTTP(rec, r)
			done <- rec
		}()
		return done
	}
	waitLine := func(n int) {
		t.Helper()
		for range 1000 {
			h.srv.queue.mu.Lock()
			got := len(h.srv.queue.lines["fake"])
			h.srv.queue.mu.Unlock()
			if got == n {
				return
			}
			time.Sleep(time.Millisecond)
		}
		t.Fatalf("queue never reached %d", n)
	}

	beaver := launch(context.Background(), "beaver")
	waitLine(1)
	ctx, cancel := context.WithCancel(context.Background())
	stoat := launch(ctx, "stoat")
	waitLine(2)
	cancel()
	<-stoat
	waitLine(1)

	rec := h.do(http.MethodPost, "/api/v1/sessions", "mole", "", map[string]string{"source": "local", "artifactId": encodeID("hello.apk"), "provider": "fake"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("launch past the queue: code = %d", rec.Code)
	}
	select {
	case rec := <-beaver:
		t.Fatalf("queued launch returned before a slot freed: %d %s", rec.Code, rec.Body.String())
	default:
	}

	if rec := h.do(http.MethodDelete, "/api/v1/sessions/fake/"+first.ID, "otter", "", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("stop: %d", rec.Code)
	}
	rec = <-beaver
	if rec.Code != http.StatusCreated {
		t.Fatalf("queued launch: %d %s", rec.Code, rec.Body.String())
	}
	if v := decode[SessionView](t, rec); v.Owner != "beaver" {
		t.Fatalf("owner = %q", v.Owner)
	}
	waitLine(0)
}

func TestDefaultLocation(t *testing.T) {
	h := newHarness(t, 2, func(c *fake.Config) { c.NoDirect, c.DefaultLocation = true, "de" })
	providers := decode[[]ProviderView](t, h.do(http.MethodGet, "/api/v1/providers", "otter", "", nil))
	caps := providers[0].Capabilities
	if caps.DefaultLocation != "de" || slices.ContainsFunc(caps.Locations, func(l contract.Location) bool { return l.ID == "direct" }) {
		t.Fatalf("capabilities %+v", caps)
	}
	body := map[string]string{"source": "local", "artifactId": encodeID("hello.apk"), "provider": "fake"}
	rec := h.do(http.MethodPost, "/api/v1/sessions", "otter", "", body)
	if v := decode[SessionView](t, rec); rec.Code != http.StatusCreated || v.Location != "de" {
		t.Fatalf("create without a location: %d %s", rec.Code, rec.Body.String())
	}
	body["location"] = "direct"
	if rec := h.do(http.MethodPost, "/api/v1/sessions", "otter", "", body); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("direct while disabled: %d %s", rec.Code, rec.Body.String())
	}
}

func TestOwnership(t *testing.T) {
	h := newHarness(t, 2)
	v := h.create("otter")
	ref := h.ref(v)
	path := "/api/v1/sessions/fake/" + v.ID

	if rec := h.do(http.MethodDelete, path, "beaver", "users", nil); rec.Code != http.StatusForbidden {
		t.Fatalf("stranger delete: %d", rec.Code)
	}
	if rec := h.do(http.MethodPost, path+"/extend", "beaver", "users", nil); rec.Code != http.StatusForbidden {
		t.Fatalf("stranger extend: %d", rec.Code)
	}
	if rec := h.do(http.MethodPost, path+"/extend", "otter", "", nil); rec.Code != http.StatusOK {
		t.Fatalf("owner extend: %d", rec.Code)
	}
	if rec := h.do(http.MethodDelete, path, "root", "admins", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("admin delete: %d", rec.Code)
	}
	if rec := h.do(http.MethodGet, path, "otter", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("get after delete: %d", rec.Code)
	}
	denied := "|only the owner or an admin can do this"
	want := []string{
		"session.launch|ok|otter|" + ref + "|",
		"session.stop|denied|beaver|" + denied,
		"session.extend|denied|beaver|" + denied,
		"session.extend|ok|otter|" + ref + "|",
		"session.stop|ok|root|" + ref + "|",
	}
	if got := h.events(v.ID); !slices.Equal(got, want) {
		t.Fatalf("events = %q, want %q", got, want)
	}
}

func TestReaper(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, 3)

	idle := h.create("otter")
	ref := h.ref(idle)
	busy := h.create("otter")

	h.clock.Advance(20 * time.Minute)
	if rec := h.do(http.MethodPost, "/api/v1/sessions/fake/"+busy.ID+"/heartbeat", "otter", "", map[string]bool{"active": true}); rec.Code != http.StatusNoContent {
		t.Fatalf("heartbeat: %d", rec.Code)
	}
	if rec := h.do(http.MethodPost, "/api/v1/sessions/fake/"+idle.ID+"/heartbeat", "otter", "", map[string]bool{"active": false}); rec.Code != http.StatusNoContent {
		t.Fatalf("passive heartbeat: %d", rec.Code)
	}

	h.clock.Advance(11 * time.Minute)
	h.srv.Reap(ctx)
	if _, err := h.provider.Get(ctx, idle.ID); err == nil {
		t.Fatal("idle session survived")
	}
	if _, err := h.provider.Get(ctx, busy.ID); err != nil {
		t.Fatalf("active session reaped: %v", err)
	}
	want := []string{"session.launch|ok|otter|" + ref + "|", "session.reap|ok||" + ref + "|idle timeout"}
	if got := h.events(idle.ID); !slices.Equal(got, want) {
		t.Fatalf("events = %q, want %q", got, want)
	}

	h.srv.Flush(ctx)
	sess, _ := h.provider.Get(ctx, busy.ID)
	if want := h.clock.Now().Add(-11 * time.Minute); !sess.LastActivity.Equal(want) {
		t.Fatalf("flushed activity %v, want %v", sess.LastActivity, want)
	}

	for range 17 {
		h.clock.Advance(29 * time.Minute)
		h.srv.activity.Mark(sessionKey{"fake", busy.ID})
		h.srv.Reap(ctx)
	}
	if _, err := h.provider.Get(ctx, busy.ID); err == nil {
		t.Fatal("session outlived max TTL")
	}
}

func TestProxy(t *testing.T) {
	h := newHarness(t, 1)
	v := h.create("otter")
	base := "/s/fake/" + v.ID

	rec := h.do(http.MethodGet, base+"/v1/network", "beaver", "", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("proxy get: %d %s", rec.Code, rec.Body.String())
	}
	if n := decode[contract.Network](t, rec); n.Location != "pl" {
		t.Fatalf("network %+v", n)
	}

	h.clock.Advance(10 * time.Minute)
	rec = h.do(http.MethodPost, base+"/v1/clipboard", "otter", "", contract.Clipboard{Text: "hello"})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("proxy post: %d", rec.Code)
	}
	if last, _ := h.srv.activity.Get(sessionKey{"fake", v.ID}); !last.Equal(h.clock.Now()) {
		t.Fatalf("activity not marked by proxied action: %v", last)
	}
	if got := decode[contract.Clipboard](t, h.do(http.MethodGet, base+"/v1/clipboard", "otter", "", nil)); got.Text != "hello" {
		t.Fatalf("clipboard %q", got.Text)
	}

	if rec := h.do(http.MethodGet, "/s/fake/missing/v1/network", "otter", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("missing session: %d", rec.Code)
	}
	if rec := h.do(http.MethodGet, base+"/v1/network", "", "", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated proxy: %d", rec.Code)
	}
}

func TestOpenAPI(t *testing.T) {
	doc := OpenAPI()
	for _, path := range []string{"/api/v1/sessions", "/api/v1/artifacts", "/api/v1/events", "/api/v1/sessions/{provider}/{id}/heartbeat"} {
		if doc.Paths[path] == nil {
			t.Errorf("missing %s", path)
		}
	}
}

func TestMain(m *testing.M) {
	slog.SetDefault(slog.New(slog.DiscardHandler))
	os.Exit(m.Run())
}

func TestRestartKeepsState(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, 2)
	v := h.create("otter")

	again, err := New(ctx, h.cfg, WithClock(h.clock.Now), WithProvider("fake", h.provider), WithTempDir(t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = again.Close() })
	r := httptest.NewRequest(http.MethodGet, "/api/v1/sessions", nil)
	r.Header.Set("Remote-User", "otter")
	rec := httptest.NewRecorder()
	again.Handler().ServeHTTP(rec, r)
	list := decode[SessionsEvent](t, rec)
	if len(list.Items) != 1 || list.Items[0].ID != v.ID || list.Items[0].Label != "HelloWorld" {
		t.Fatalf("a fresh api must see sessions and cached metadata: %+v", list.Items)
	}
}

type countingProvider struct {
	*fake.Provider
	mu   sync.Mutex
	gets int
}

func (c *countingProvider) Get(ctx context.Context, id string) (contract.Session, error) {
	c.mu.Lock()
	c.gets++
	c.mu.Unlock()
	return c.Provider.Get(ctx, id)
}

func (c *countingProvider) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.gets
}

func TestProxyCachesAgentURL(t *testing.T) {
	h := newHarness(t, 1)
	v := h.create("otter")
	counter := &countingProvider{Provider: h.provider}
	h.srv.providers["fake"] = counter
	base := "/s/fake/" + v.ID

	var wg sync.WaitGroup
	for range 20 {
		wg.Go(func() {
			if rec := h.do(http.MethodGet, base+"/v1/network", "otter", "", nil); rec.Code != http.StatusOK {
				t.Errorf("proxy: %d", rec.Code)
			}
		})
	}
	wg.Wait()
	if n := counter.count(); n != 1 {
		t.Fatalf("%d provider lookups for 20 requests", n)
	}

	h.clock.Advance(6 * time.Second)
	h.do(http.MethodGet, base+"/v1/network", "otter", "", nil)
	if n := counter.count(); n != 2 {
		t.Fatalf("expired entry not refreshed: %d lookups", n)
	}

	if rec := h.do(http.MethodDelete, "/api/v1/sessions/fake/"+v.ID, "otter", "", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("stop: %d", rec.Code)
	}
	if rec := h.do(http.MethodGet, base+"/v1/network", "otter", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("proxy after stop: %d", rec.Code)
	}
}

func TestInstallArtifact(t *testing.T) {
	h := newHarness(t, 1, func(c *fake.Config) { c.StepDelay = time.Millisecond })
	copyFile(t, "../apk/testdata/helloworld.apk", filepath.Join(h.apks, "hello-v2.apk"))
	v := h.create("otter")
	path := "/api/v1/sessions/fake/" + v.ID + "/install"
	body := map[string]any{"source": "local", "artifactId": encodeID("hello-v2.apk"), "keepData": true}

	deadline := time.Now().Add(5 * time.Second)
	for {
		if s, _ := h.provider.Get(context.Background(), v.ID); s.State == contract.StateReady {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("fake session never got ready")
		}
		time.Sleep(time.Millisecond)
	}

	if rec := h.do(http.MethodPost, path, "beaver", "", body); rec.Code != http.StatusForbidden {
		t.Fatalf("someone else's session: %d", rec.Code)
	}
	if rec := h.do(http.MethodPost, path, "otter", "", map[string]any{"source": "local", "artifactId": encodeID("broken.apk")}); rec.Code < 400 {
		t.Fatalf("broken build: %d", rec.Code)
	}
	if rec := h.do(http.MethodPost, "/s/fake/"+v.ID+"/v1/install/", "otter", "", contract.Install{ArtifactURL: "http://evil/x.apk", ArtifactRef: "x"}); rec.Code != http.StatusForbidden {
		t.Fatalf("install through the agent proxy: %d", rec.Code)
	}

	rec := h.do(http.MethodPost, path, "otter", "", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("install: %d %s", rec.Code, rec.Body.String())
	}
	got := decode[SessionView](t, rec)
	if got.ArtifactID != encodeID("hello-v2.apk") || got.Label != "HelloWorld" || !strings.HasPrefix(h.ref(got), "local/hello-v2.apk@") {
		t.Fatalf("after install %+v, ref %s", got, h.ref(got))
	}
	if evs := h.events(v.ID); !slices.ContainsFunc(evs, func(e string) bool { return strings.HasPrefix(e, "session.install|ok|otter|local/hello-v2.apk@") }) {
		t.Fatalf("events %v", evs)
	}
}

type noWebView struct{ contract.Provider }

func (p noWebView) Capabilities(ctx context.Context) (contract.Capabilities, error) {
	c, err := p.Provider.Capabilities(ctx)
	c.WebView = false
	return c, err
}

type recordCreate struct {
	contract.Provider
	last *contract.CreateSession
}

func (p recordCreate) Create(ctx context.Context, req contract.CreateSession) (contract.Session, error) {
	*p.last = req
	return p.Provider.Create(ctx, req)
}

func TestRequiredSDK(t *testing.T) {
	h := newHarness(t, 3)
	apks := h.srv.cfg.Sources[0].Filesystem.Dir
	copyFile(t, "../apk/testdata/helloworld.apk", filepath.Join(apks, "chromium-158.apk"))
	if err := os.WriteFile(filepath.Join(apks, "chromium-158.apk.meta.json"), []byte(`{"tags":{"requiresSdk":"35"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	launch := func(android string) *httptest.ResponseRecorder {
		body := map[string]string{"source": "local", "artifactId": encodeID("chromium-158.apk")}
		if android != "" {
			body["android"] = android
		}
		return h.do(http.MethodPost, "/api/v1/sessions", "otter", "", body)
	}
	if rec := launch("13"); rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "needs Android API level 35, Android 13 is 33") {
		t.Fatalf("too old: %d %s", rec.Code, rec.Body.String())
	}
	for _, android := range []string{"15", "", "99"} {
		if rec := launch(android); rec.Code != http.StatusCreated {
			t.Fatalf("android %q: %d %s", android, rec.Code, rec.Body.String())
		}
	}
	list := decode[ArtifactList](t, h.do(http.MethodGet, "/api/v1/artifacts", "otter", "", nil))
	for _, a := range list.Items {
		want := 0
		switch a.FileName {
		case "chromium-158.apk":
			want = 35
		case "hello.apk":
			if a.App != nil {
				want = int(a.App.MinSDK)
			}
		default:
			continue
		}
		if a.MinSDK != want {
			t.Errorf("%s: minSdk %d, want %d", a.FileName, a.MinSDK, want)
		}
	}
}

func TestAppFrontend(t *testing.T) {
	h := newHarness(t, 3)
	var last contract.CreateSession
	h.srv.providers["fake"] = recordCreate{h.srv.providers["fake"], &last}
	apks := h.srv.cfg.Sources[0].Filesystem.Dir
	for name, meta := range map[string]string{
		"chromium-158.apk": `{"tags":{"frontend":"8d486529e60e7be71049111bc75420a018caf6f1"}}`,
		"odd.apk":          `{"tags":{"frontend":"not-a-commit"}}`,
	} {
		copyFile(t, "../apk/testdata/helloworld.apk", filepath.Join(apks, name))
		if err := os.WriteFile(filepath.Join(apks, name+".meta.json"), []byte(meta), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for name, want := range map[string]string{"chromium-158.apk": "8d486529e60e7be71049111bc75420a018caf6f1", "odd.apk": "", "hello.apk": ""} {
		rec := h.do(http.MethodPost, "/api/v1/sessions", "otter", "", map[string]string{"source": "local", "artifactId": encodeID(name)})
		if rec.Code != http.StatusCreated || last.Frontend != want {
			t.Fatalf("%s: %d %s, frontend %q", name, rec.Code, rec.Body.String(), last.Frontend)
		}
	}
}

func TestWebViewCatalog(t *testing.T) {
	dir, google := t.TempDir(), t.TempDir()
	writeIn := func(dir, name, body, meta string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		if meta != "" {
			if err := os.WriteFile(filepath.Join(dir, name+".meta.json"), []byte(meta), 0o600); err != nil {
				t.Fatal(err)
			}
		}
	}
	write := func(name, body, meta string) { writeIn(dir, name, body, meta) }
	write("chromium-157.apk", "webview 157", `{"title":"Chromium 157","tags":{"milestone":"157","version":"157.0.8000.0","minSdk":"29","channel":"beta"}}`)
	write("chromium-158.apk", "webview 158", `{"title":"Chromium 158","tags":{"milestone":"158","version":"158.0.8123.0","minSdk":"29","requiresSdk":"34","channel":"dev,canary","frontend":"7d74334854bbfcbaf1c955e86589d8b7cc9acc31"}}`)
	writeIn(google, "chromium-157.apk", "google webview 156", `{"title":"Google WebView 156","tags":{"package":"com.google.android.webview","milestone":"156","version":"156.0.8078.47","requiresSdk":"34","channel":"stable"}}`)
	write("stray.apk", "not a webview", "")

	h := newHarnessWith(t, 2, func(c *Config) {
		c.WebView.Storage = storage.Config{Type: "filesystem", Filesystem: storage.FilesystemConfig{Dir: dir}}
		c.WebView.Catalogs = []storage.Config{{Type: "filesystem", Filesystem: storage.FilesystemConfig{Dir: google}}}
	})
	h.srv.providers["phones"] = noWebView{fake.New(fake.Config{Slots: 1, StepDelay: time.Hour, PublicURL: "http://agents"})}
	h.srv.provOrder = append([]string{"phones"}, h.srv.provOrder...)

	rec := h.do(http.MethodGet, "/api/v1/webviews", "otter", "", nil)
	list := decode[[]WebViewView](t, rec)
	if rec.Code != http.StatusOK || len(list) != 3 || list[0].Milestone != 158 || list[0].Version != "158.0.8123.0" ||
		!slices.Equal(list[0].Channels, []string{"dev", "canary"}) || list[0].MinSDK != 34 || list[1].MinSDK != 29 || list[1].Title != "Chromium 157" ||
		list[0].Package != "com.android.webview" || list[2].Package != "com.google.android.webview" || list[2].Title != "Google WebView 156" {
		t.Fatalf("webviews %d %+v", rec.Code, list)
	}
	id := list[0].ID

	launch := func(body map[string]string) *httptest.ResponseRecorder {
		body["source"], body["artifactId"] = "local", encodeID("hello.apk")
		return h.do(http.MethodPost, "/api/v1/sessions", "otter", "", body)
	}
	if rec := launch(map[string]string{"provider": "phones", "webview": id}); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("a provider without the capability: %d %s", rec.Code, rec.Body.String())
	}
	if rec := launch(map[string]string{"webview": id, "android": "13"}); rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "needs Android API level 34") {
		t.Fatalf("a build too new for the Android version: %d %s", rec.Code, rec.Body.String())
	}
	if rec := launch(map[string]string{"webview": encodeID("nope.apk")}); rec.Code != http.StatusNotFound {
		t.Fatalf("an unknown build: %d %s", rec.Code, rec.Body.String())
	}
	rec = launch(map[string]string{"webview": id})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	v := decode[SessionView](t, rec)
	if v.Provider != "fake" || v.WebView != "158.0.8123.0" {
		t.Fatalf("session %+v", v)
	}
	if !strings.Contains(h.audit.String(), `"webview":"158.0.8123.0"`) {
		t.Fatalf("audit %s", h.audit.String())
	}
	if rec := launch(map[string]string{"provider": "phones"}); rec.Code != http.StatusCreated {
		t.Fatalf("built-in WebView on any provider: %d %s", rec.Code, rec.Body.String())
	}

	for path, want := range map[string]string{
		"/internal/webview/" + id:                      "webview 158",
		"/internal/webview/" + list[2].ID:              "google webview 156",
		"/internal/webview/" + encodeID("stray.apk"):   "",
		"/internal/webview/" + encodeID("1:stray.apk"): "",
	} {
		rec := httptest.NewRecorder()
		h.internal.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if (want == "" && rec.Code != http.StatusNotFound) || (want != "" && (rec.Code != http.StatusOK || rec.Body.String() != want)) {
			t.Fatalf("%s: %d %q", path, rec.Code, rec.Body.String())
		}
	}

	plain := newHarness(t, 1)
	if rec := plain.do(http.MethodGet, "/api/v1/webviews", "otter", "", nil); rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Fatalf("no catalog: %d %s", rec.Code, rec.Body.String())
	}
	rec = plain.do(http.MethodPost, "/api/v1/sessions", "otter", "", map[string]string{"source": "local", "artifactId": encodeID("hello.apk"), "webview": id})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("no catalog, a build asked for: %d %s", rec.Code, rec.Body.String())
	}
}

func TestValidFrontend(t *testing.T) {
	for in, want := range map[string]string{
		"7d74334854bbfcbaf1c955e86589d8b7cc9acc31": "7d74334854bbfcbaf1c955e86589d8b7cc9acc31",
		"7D74334854BBFCBAF1C955E86589D8B7CC9ACC31": "",
		"7d74334854bb": "",
		"":             "",
	} {
		if got := validFrontend(in); got != want {
			t.Errorf("validFrontend(%q) = %q", in, got)
		}
	}
}

func TestDevToolsFrontendServedByTheApi(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/serve_rev/@0123456789abcdef/inspector.html" {
			http.NotFound(w, r)
			return
		}
		_, _ = io.WriteString(w, "<!doctype html>frontend")
	}))
	t.Cleanup(upstream.Close)
	h := newHarnessWith(t, 1, func(c *Config) { c.DevTools.Frontend = upstream.URL + "/serve_rev" })
	v := h.create("otter")

	rec := h.do(http.MethodGet, "/s/fake/"+v.ID+"/devtools-frontend/@0123456789abcdef/inspector.html?wss=x", "otter", "", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "frontend") {
		t.Fatalf("frontend: %d %s", rec.Code, rec.Body.String())
	}
	if rec := h.do(http.MethodGet, "/s/fake/missing/devtools-frontend/@0123456789abcdef/inspector.html", "otter", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("missing session: %d", rec.Code)
	}
}

func TestDevToolsFrontendWarmedForTaggedBuilds(t *testing.T) {
	var inspector atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/inspector.html") {
			inspector.Add(1)
			_, _ = io.WriteString(w, "<!doctype html>")
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(upstream.Close)
	h := newHarnessWith(t, 1, func(c *Config) { c.DevTools.Frontend = upstream.URL + "/serve_rev" })
	meta := `{"tags":{"frontend":"0123456789abcdef0123456789abcdef01234567"}}`
	if err := os.WriteFile(filepath.Join(h.apks, "hello.apk.meta.json"), []byte(meta), 0o600); err != nil {
		t.Fatal(err)
	}
	h.srv.refreshSource(context.Background(), "local")
	deadline := time.Now().Add(5 * time.Second)
	for inspector.Load() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("the tagged build's frontend was not warmed")
		}
		time.Sleep(10 * time.Millisecond)
	}
	for {
		if _, err := h.srv.store.Stat(context.Background(), "devtools-frontend/@0123456789abcdef0123456789abcdef01234567.tar.gz"); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the crawled frontend was not archived in the api's storage")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestDevToolsFrontendsAdmin(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/inspector.html") {
			_, _ = io.WriteString(w, "<!doctype html>")
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(upstream.Close)
	h := newHarnessWith(t, 1, func(c *Config) { c.DevTools.Frontend = upstream.URL + "/serve_rev" })
	rev := "0123456789abcdef0123456789abcdef01234567"
	if rec := h.do(http.MethodGet, "/api/v1/admin/devtools-frontends", "otter", "", nil); rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin: %d", rec.Code)
	}
	if rec := h.do(http.MethodPost, "/api/v1/admin/devtools-frontends/"+rev+"/fetch", "root", "admins", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("fetch: %d %s", rec.Code, rec.Body.String())
	}
	deadline := time.Now().Add(5 * time.Second)
	var item DevToolsFrontendView
	for {
		rec := h.do(http.MethodGet, "/api/v1/admin/devtools-frontends", "root", "admins", nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
		}
		list := decode[DevToolsFrontendList](t, rec)
		if len(list.Items) == 1 && list.Items[0].Archived {
			item = list.Items[0]
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("never archived: %+v", list)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if item.Rev != rev || item.State != "ready" || item.Files != 1 || item.Size == 0 {
		t.Fatalf("item %+v", item)
	}
	if rec := h.do(http.MethodDelete, "/api/v1/admin/devtools-frontends/"+rev, "root", "admins", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	rec := h.do(http.MethodGet, "/api/v1/admin/devtools-frontends", "root", "admins", nil)
	if list := decode[DevToolsFrontendList](t, rec); len(list.Items) != 0 {
		t.Fatalf("after delete: %+v", list.Items)
	}
	if !strings.Contains(h.audit.String(), `"devtools.frontend.delete"`) {
		t.Fatal("delete was not audited")
	}
}

func TestNetworkRoutes(t *testing.T) {
	h := newHarness(t, 2, func(c *fake.Config) { c.StepDelay = time.Millisecond })
	ctx := t.Context()
	first := h.create("otter")
	deadline := time.Now().Add(10 * time.Second)
	for {
		sess, err := h.provider.Get(ctx, first.ID)
		if err != nil {
			t.Fatal(err)
		}
		if sess.State == contract.StateReady {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("session stuck in %s", sess.State)
		}
		time.Sleep(time.Millisecond)
	}
	measured := decode[contract.Network](t, h.do(http.MethodGet, "/s/fake/"+first.ID+"/v1/network", "otter", "", nil)).Route
	if measured == nil || measured.At.IsZero() {
		t.Fatalf("first session's route %+v", measured)
	}
	h.srv.collectRoutes(ctx)

	second := h.create("otter")
	got := decode[contract.Network](t, h.do(http.MethodGet, "/s/fake/"+second.ID+"/v1/network", "otter", "", nil)).Route
	if got == nil || !got.At.Equal(measured.At) || got.Edge != measured.Edge {
		t.Errorf("second session started from %+v, want %+v", got, measured)
	}
}

func TestNetworkBackends(t *testing.T) {
	h := newHarness(t, 1)
	path := "/api/v1/network-backends/com.example.shop"
	if nb := decode[NetworkBackends](t, h.do(http.MethodGet, path, "otter", "", nil)); nb.Persistent || len(nb.Backends) != 0 {
		t.Fatalf("in memory: %+v", nb)
	}
	if rec := h.do(http.MethodPut, path, "otter", "", map[string]any{"backends": []string{"api.example.com"}}); rec.Code != http.StatusConflict {
		t.Fatalf("put in memory: %d", rec.Code)
	}

	h.srv.cfg.Database.Type = "sqlite"
	rec := h.do(http.MethodPut, path, "otter", "", map[string]any{"backends": []string{"API.example.com", "*.example.com", "api.example.com"}})
	if rec.Code != http.StatusOK {
		t.Fatalf("put: %d %s", rec.Code, rec.Body.String())
	}
	if nb := decode[NetworkBackends](t, h.do(http.MethodGet, path, "otter", "", nil)); !nb.Persistent || strings.Join(nb.Backends, ",") != "api.example.com,*.example.com" {
		t.Errorf("saved %+v", nb)
	}
	if nb := decode[NetworkBackends](t, h.do(http.MethodGet, path, "beaver", "", nil)); len(nb.Backends) != 0 {
		t.Errorf("another user sees %+v", nb)
	}
	if rec := h.do(http.MethodPut, path, "otter", "", map[string]any{"backends": []string{"https://x"}}); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("invalid backend: %d", rec.Code)
	}
}
