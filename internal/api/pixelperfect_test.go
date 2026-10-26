package api

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/config"
	"github.com/holtdroid/holtdroid/internal/storage"
)

func testPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func (h *harness) uploadReference(user, name string, content []byte, fields map[string]string) *httptest.ResponseRecorder {
	h.t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, _ := w.CreateFormFile("file", name)
	_, _ = part.Write(content)
	for k, v := range fields {
		_ = w.WriteField(k, v)
	}
	_ = w.Close()
	r := httptest.NewRequest(http.MethodPost, referencesPath, &buf)
	r.Header.Set("Content-Type", w.FormDataContentType())
	r.Header.Set("Remote-User", user)
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, r)
	return rec
}

func (h *harness) references(user string) ReferenceList {
	h.t.Helper()
	rec := h.do(http.MethodGet, referencesPath, user, "", nil)
	if rec.Code != http.StatusOK {
		h.t.Fatalf("list references: %d %s", rec.Code, rec.Body.String())
	}
	return decode[ReferenceList](h.t, rec)
}

func TestReferences(t *testing.T) {
	h := newHarness(t, 1)
	img := testPNG(t, 360, 800)

	rec := h.uploadReference("alice", "Login screen.png", img, map[string]string{"package": "com.example"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	v := decode[ReferenceView](t, rec)
	if v.Name != "Login screen" || v.Width != 360 || v.Height != 800 || v.ContentType != "image/png" || v.Package != "com.example" ||
		v.Size != int64(len(img)) || v.Placement.Scale != 1 || v.ExpiresAt == nil {
		t.Fatalf("view: %+v", v)
	}

	l := h.references("alice")
	if !l.Enabled || len(l.Items) != 1 || l.Used != int64(len(img)) || l.Quota != 1<<30 {
		t.Fatalf("list: %+v", l)
	}
	if got := h.references("bob").Items; len(got) != 0 {
		t.Fatalf("bob sees %d references", len(got))
	}
	if rec := h.do(http.MethodGet, v.ImageURL, "bob", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("bob opens the image: %d", rec.Code)
	}
	rec = h.do(http.MethodGet, v.ImageURL, "alice", "", nil)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" || !bytes.Equal(rec.Body.Bytes(), img) {
		t.Fatalf("image: %d %v", rec.Code, rec.Header())
	}

	body := map[string]any{
		"name":      "  Login   v2 ",
		"placement": map[string]any{"x": 4, "y": -2, "scale": 1.5},
		"ignore":    []map[string]any{{"x": 0, "y": 0.1, "w": 1, "h": 0.4}},
	}
	rec = h.do(http.MethodPut, referencesPath+"/"+v.ID, "alice", "", body)
	u := decode[ReferenceView](t, rec)
	if u.Name != "Login v2" || u.Placement.X != 4 || u.Placement.Scale != 1.5 || len(u.Ignore) != 1 || u.Size != v.Size {
		t.Fatalf("update: %d %+v", rec.Code, u)
	}
	body["ignore"] = []map[string]any{{"x": 0.5, "y": 0, "w": 0.6, "h": 0.2}}
	if rec := h.do(http.MethodPut, referencesPath+"/"+v.ID, "alice", "", body); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("area outside the image: %d", rec.Code)
	}
	if rec := h.do(http.MethodPut, referencesPath+"/"+v.ID, "bob", "", body); rec.Code != http.StatusNotFound {
		t.Fatalf("bob updates: %d", rec.Code)
	}

	if rec := h.uploadReference("alice", "notes.txt", []byte("not an image"), nil); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("text upload: %d", rec.Code)
	}

	if rec := h.do(http.MethodDelete, referencesPath+"/"+v.ID, "alice", "", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	if l := h.references("alice"); len(l.Items) != 0 || l.Used != 0 {
		t.Fatalf("after delete: %+v", l)
	}
	if !bytes.Contains(h.audit.Bytes(), []byte(`"reference.upload"`)) || !bytes.Contains(h.audit.Bytes(), []byte(`"reference.delete"`)) {
		t.Fatalf("audit: %s", h.audit.String())
	}
}

func TestReferenceQuota(t *testing.T) {
	img := testPNG(t, 200, 200)
	h := newHarnessWith(t, 1, func(c *Config) { c.PixelPerfect.Quota = config.ByteSize(len(img)*2 + 10) })
	for range 2 {
		if rec := h.uploadReference("alice", "a.png", img, nil); rec.Code != http.StatusCreated {
			t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
		}
	}
	if rec := h.uploadReference("alice", "a.png", img, nil); rec.Code != http.StatusInsufficientStorage {
		t.Fatalf("over quota: %d %s", rec.Code, rec.Body.String())
	}
	if rec := h.uploadReference("bob", "a.png", img, nil); rec.Code != http.StatusCreated {
		t.Fatalf("bob's own quota: %d", rec.Code)
	}
}

// clockStore stamps objects with the test clock instead of the wall clock.
type clockStore struct {
	storage.Store
	now func() time.Time
	mu  sync.Mutex
	at  map[string]time.Time
}

func (c *clockStore) Put(ctx context.Context, key string, r io.Reader, size int64) error {
	c.mu.Lock()
	c.at[key] = c.now()
	c.mu.Unlock()
	return c.Store.Put(ctx, key, r, size)
}

func (c *clockStore) stamp(o storage.Object) storage.Object {
	c.mu.Lock()
	defer c.mu.Unlock()
	if t, ok := c.at[o.Key]; ok {
		o.Modified = t
	}
	return o
}

func (c *clockStore) Stat(ctx context.Context, key string) (storage.Object, error) {
	o, err := c.Store.Stat(ctx, key)
	return c.stamp(o), err
}

func (c *clockStore) List(ctx context.Context, prefix string) ([]storage.Object, error) {
	objs, err := c.Store.List(ctx, prefix)
	for i := range objs {
		objs[i] = c.stamp(objs[i])
	}
	return objs, err
}

func TestReferenceRetention(t *testing.T) {
	h := newHarness(t, 1)
	h.srv.references.store = &clockStore{Store: h.srv.references.store, now: h.clock.Now, at: map[string]time.Time{}}
	old := decode[ReferenceView](t, h.uploadReference("alice", "old.png", testPNG(t, 10, 10), nil))
	used := decode[ReferenceView](t, h.uploadReference("alice", "used.png", testPNG(t, 10, 10), nil))

	h.clock.Advance(20 * 24 * time.Hour)
	h.srv.sweepReferences(context.Background())
	if rec := h.do(http.MethodGet, old.ImageURL+"?preview", "alice", "", nil); rec.Code != http.StatusOK {
		t.Fatalf("preview: %d", rec.Code)
	}
	if n := len(h.references("alice").Items); n != 2 {
		t.Fatalf("after 20 days: %d references", n)
	}
	if rec := h.do(http.MethodGet, used.ImageURL, "alice", "", nil); rec.Code != http.StatusOK {
		t.Fatalf("open: %d", rec.Code)
	}

	h.clock.Advance(20 * 24 * time.Hour)
	h.srv.sweepReferences(context.Background())
	items := h.references("alice").Items
	if len(items) != 1 || items[0].ID != used.ID || items[0].ID == old.ID {
		t.Fatalf("after 40 days: %+v", items)
	}
	if want := h.clock.Now().Add(-20 * 24 * time.Hour).Add(30 * 24 * time.Hour); !items[0].ExpiresAt.Equal(want) {
		t.Fatalf("expires %v, want %v", items[0].ExpiresAt, want)
	}
}
