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
	"testing"
	"time"

	"github.com/kriakiku/holtdroid/internal/auth"
	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/db"
	"github.com/kriakiku/holtdroid/internal/provider/fake"
	"github.com/kriakiku/holtdroid/internal/source"
	"github.com/kriakiku/holtdroid/internal/storage"
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
}

func newHarness(t *testing.T, slots int) *harness {
	t.Helper()
	apks := t.TempDir()
	copyFile(t, "../apk/testdata/helloworld.apk", filepath.Join(apks, "hello.apk"))
	if err := os.WriteFile(filepath.Join(apks, "broken.apk"), []byte("nope"), 0o600); err != nil {
		t.Fatal(err)
	}

	clk := &clock{t: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)}
	agents := httptest.NewServer(http.NotFoundHandler())
	t.Cleanup(agents.Close)
	p := fake.New(fake.Config{Slots: slots, StepDelay: time.Hour, PublicURL: agents.URL}, fake.WithClock(clk.Now))
	agents.Config.Handler = p.AgentHandler()

	cfg := DefaultConfig()
	cfg.Storage.Filesystem.Dir = t.TempDir()
	cfg.Auth.Mode = auth.ModeHeader
	cfg.Auth.AdminGroups = []string{"admins"}
	cfg.Sources = []source.Config{{Name: "local", Type: "filesystem", Filesystem: storage.FilesystemConfig{Dir: apks}}}
	srv, err := New(context.Background(), cfg, WithClock(clk.Now), WithProvider("fake", p))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	return &harness{t: t, srv: srv, handler: srv.Handler(), internal: srv.InternalHandler(), provider: p, clock: clk, apks: apks, cfg: cfg}
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
		out = append(out, strings.Join([]string{r.Kind, r.Actor, r.Artifact, r.Reason}, "|"))
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
	want := []string{"created|otter|" + ref + "|", "stopped|root|" + ref + "|"}
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
	want := []string{"created|otter|" + ref + "|", "reaped||" + ref + "|idle timeout"}
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

	again, err := New(ctx, h.cfg, WithClock(h.clock.Now), WithProvider("fake", h.provider))
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
