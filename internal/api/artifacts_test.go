package api

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kriakiku/holtdroid/internal/apk"
	"github.com/kriakiku/holtdroid/internal/source"
)

func (h *harness) upload(user, groups, name string, content []byte, fields map[string]string) *httptest.ResponseRecorder {
	h.t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", name)
	if err != nil {
		h.t.Fatal(err)
	}
	_, _ = part.Write(content)
	for k, v := range fields {
		_ = w.WriteField(k, v)
	}
	_ = w.Close()
	r := httptest.NewRequest(http.MethodPost, uploadPath, &buf)
	r.Header.Set("Content-Type", w.FormDataContentType())
	r.Header.Set("Remote-User", user)
	r.Header.Set("Remote-Groups", groups)
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, r)
	return rec
}

func (h *harness) list(user, groups string) map[string]ArtifactView {
	h.t.Helper()
	rec := h.do(http.MethodGet, "/api/v1/artifacts", user, groups, nil)
	if rec.Code != http.StatusOK {
		h.t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
	}
	out := map[string]ArtifactView{}
	for _, it := range decode[ArtifactList](h.t, rec).Items {
		key, err := decodeID(it.ID)
		if err != nil {
			h.t.Fatal(err)
		}
		out[key] = it
	}
	return out
}

func artifactPathFor(v ArtifactView) string {
	return "/api/v1/artifacts/" + v.Source + "/" + v.ID
}

func TestUploads(t *testing.T) {
	h := newHarness(t, 2)
	apk, err := os.ReadFile("../apk/testdata/helloworld.apk")
	if err != nil {
		t.Fatal(err)
	}

	rec := h.upload("otter", "", "../My Build (1).apk", apk, map[string]string{"visibility": "private", "changelog": "  fixed it  "})
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	up := decode[ArtifactView](t, rec)
	key, _ := decodeID(up.ID)
	if up.Source != "local" || !strings.HasPrefix(key, "uploads/") || up.FileName != "My_Build__1_.apk" {
		t.Fatalf("uploaded %+v", up)
	}
	if !up.CanManage || up.Meta.Owner != "otter" || up.Meta.Visibility != source.Private || up.Meta.Changelog != "fixed it" || up.Meta.Origin != "upload" {
		t.Fatalf("uploaded meta %+v", up)
	}
	if up.App == nil || up.App.Package != "com.example.helloworld" {
		t.Fatalf("upload must be parsed and cached right away: %+v", up.App)
	}
	if _, err := os.Stat(filepath.Join(h.apks, filepath.FromSlash(key)+source.MetaSuffix)); err != nil {
		t.Fatalf("sidecar not written: %v", err)
	}

	if _, ok := h.list("beaver", "")[key]; ok {
		t.Fatal("private upload visible to a stranger")
	}
	if got, ok := h.list("root", "admins")[key]; !ok || !got.CanManage {
		t.Fatalf("admin must see and manage private uploads: %+v", got)
	}
	if got := h.list("otter", "")[key]; !got.CanManage {
		t.Fatalf("owner view %+v", got)
	}
	if rec := h.do(http.MethodGet, artifactPathFor(up), "beaver", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger getting a private upload: %d", rec.Code)
	}
	if rec := h.do(http.MethodGet, artifactPathFor(up), "otter", "", nil); rec.Code != http.StatusOK || decode[ArtifactView](t, rec).ID != up.ID {
		t.Fatalf("owner get: %d %s", rec.Code, rec.Body.String())
	}
	if rec := h.do(http.MethodGet, "/api/v1/artifacts/local/"+encodeID("missing.apk"), "otter", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("missing artifact: %d", rec.Code)
	}
	launch := map[string]string{"source": "local", "artifactId": up.ID, "provider": "fake"}
	if rec := h.do(http.MethodPost, "/api/v1/sessions", "beaver", "", launch); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger launching a private upload: %d", rec.Code)
	}
	if rec := h.do(http.MethodPatch, artifactPathFor(up), "beaver", "", map[string]string{"visibility": "public"}); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger patching a private upload: %d", rec.Code)
	}

	rec = h.do(http.MethodPatch, artifactPathFor(up), "otter", "", map[string]string{"visibility": "public"})
	if rec.Code != http.StatusOK || decode[ArtifactView](t, rec).Meta.Visibility != source.Public {
		t.Fatalf("owner patch: %d %s", rec.Code, rec.Body.String())
	}
	got, ok := h.list("beaver", "")[key]
	if !ok || got.CanManage || got.Meta.Changelog != "fixed it" {
		t.Fatalf("public upload as seen by a stranger: %+v", got)
	}
	if rec := h.do(http.MethodPost, "/api/v1/sessions", "beaver", "", launch); rec.Code != http.StatusCreated {
		t.Fatalf("launching a public upload: %d %s", rec.Code, rec.Body.String())
	}
	if rec := h.do(http.MethodDelete, artifactPathFor(up), "beaver", "", nil); rec.Code != http.StatusForbidden {
		t.Fatalf("stranger delete: %d", rec.Code)
	}
	if rec := h.do(http.MethodDelete, "/api/v1/artifacts/local/"+encodeID("hello.apk"), "beaver", "", nil); rec.Code != http.StatusForbidden {
		t.Fatalf("deleting an ownerless artifact as a user: %d", rec.Code)
	}
	if rec := h.do(http.MethodDelete, artifactPathFor(up), "otter", "", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("owner delete: %d %s", rec.Code, rec.Body.String())
	}
	if _, ok := h.list("root", "admins")[key]; ok {
		t.Fatal("deleted upload still listed")
	}
	if _, err := os.Stat(filepath.Join(h.apks, "uploads")); err != nil {
		t.Fatalf("uploads dir: %v", err)
	}

	if rec := h.upload("otter", "", "fake.apk", []byte("not an apk"), nil); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid APK: %d", rec.Code)
	}
	if rec := h.upload("otter", "", "x.apk", apk, map[string]string{"visibility": "secret"}); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("bad visibility: %d", rec.Code)
	}
}

func TestTemporaryUploads(t *testing.T) {
	apk, err := os.ReadFile("../apk/testdata/helloworld.apk")
	if err != nil {
		t.Fatal(err)
	}
	h := newHarness(t, 2)
	ctx := context.Background()
	week := 7 * 24 * time.Hour

	temp := decode[ArtifactView](t, h.upload("otter", "", "temp.apk", apk, nil))
	kept := decode[ArtifactView](t, h.upload("otter", "", "kept.apk", apk, map[string]string{"temporary": "false"}))
	if !temp.Meta.Temporary || !temp.ExpiresAt.Equal(h.clock.Now().Add(week)) {
		t.Fatalf("uploads are temporary by default: %+v", temp)
	}
	if kept.Meta.Temporary || !kept.ExpiresAt.IsZero() {
		t.Fatalf("permanent upload: %+v", kept)
	}
	if info := decode[UploadsInfo](t, h.do(http.MethodGet, uploadPath, "otter", "", nil)); info.TemporaryTTL != int64(week/time.Second) {
		t.Fatalf("uploads info %+v", info)
	}

	h.clock.Advance(6 * 24 * time.Hour)
	launch := map[string]string{"source": "local", "artifactId": temp.ID, "provider": "fake"}
	if rec := h.do(http.MethodPost, "/api/v1/sessions", "beaver", "", launch); rec.Code != http.StatusCreated {
		t.Fatalf("launch: %d %s", rec.Code, rec.Body.String())
	}
	h.clock.Advance(6 * 24 * time.Hour)
	h.srv.refreshSource(ctx, "local")
	tempKey, _ := decodeID(temp.ID)
	keptKey, _ := decodeID(kept.ID)
	got, ok := h.list("otter", "")[tempKey]
	if !ok || !got.ExpiresAt.Equal(h.clock.Now().Add(week-6*24*time.Hour)) {
		t.Fatalf("a launch must restart the countdown: %+v", got)
	}

	rec := h.do(http.MethodPatch, artifactPathFor(kept), "otter", "", map[string]bool{"temporary": true})
	if rec.Code != http.StatusOK || !decode[ArtifactView](t, rec).ExpiresAt.Equal(h.clock.Now().Add(week)) {
		t.Fatalf("making it temporary: %d %s", rec.Code, rec.Body.String())
	}
	if rec := h.do(http.MethodPatch, artifactPathFor(kept), "otter", "", map[string]bool{"temporary": false}); rec.Code != http.StatusOK || decode[ArtifactView](t, rec).Meta.Temporary {
		t.Fatalf("making it permanent: %d %s", rec.Code, rec.Body.String())
	}

	h.clock.Advance(2 * 24 * time.Hour)
	h.srv.refreshSource(ctx, "local")
	list := h.list("otter", "")
	if _, ok := list[tempKey]; ok {
		t.Fatal("expired temporary upload still listed")
	}
	if _, ok := list[keptKey]; !ok {
		t.Fatal("permanent upload deleted")
	}
	if _, err := os.Stat(filepath.Join(h.apks, tempKey+source.MetaSuffix)); !os.IsNotExist(err) {
		t.Fatalf("sidecar of the expired upload: %v", err)
	}
}

func TestUploadLimits(t *testing.T) {
	apk, err := os.ReadFile("../apk/testdata/helloworld.apk")
	if err != nil {
		t.Fatal(err)
	}

	h := newHarness(t, 1)
	h.srv.cfg.Uploads.MaxSize = 1024
	if rec := h.upload("otter", "", "big.apk", apk, nil); rec.Code < 400 {
		t.Fatalf("oversized upload: %d", rec.Code)
	}

	h.srv.cfg.Uploads.Enabled = false
	if rec := h.upload("otter", "", "x.apk", apk, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("disabled uploads: %d", rec.Code)
	}
	info := decode[UploadsInfo](t, h.do(http.MethodGet, uploadPath, "otter", "", nil))
	if info.Enabled || info.Source != "" {
		t.Fatalf("uploads info %+v", info)
	}
}

func TestSourceChanges(t *testing.T) {
	h := newHarness(t, 1)
	ctx := context.Background()
	before := h.list("otter", "")["hello.apk"]
	rev := h.srv.library.revision(h.srv.srcOrder)

	sidecar := `{"title":"Hello","changelog":"first build","link":"https://slack.example.com/m/1","tags":{"branch":"main"}}`
	if err := os.WriteFile(filepath.Join(h.apks, "hello.apk"+source.MetaSuffix), []byte(sidecar), 0o600); err != nil {
		t.Fatal(err)
	}
	h.srv.refreshSource(ctx, "local")
	if h.srv.library.revision(h.srv.srcOrder) == rev {
		t.Fatal("a new sidecar must change the library revision")
	}
	withMeta := h.list("otter", "")["hello.apk"]
	if withMeta.Meta.Title != "Hello" || withMeta.Meta.Tags["branch"] != "main" || withMeta.Revision != before.Revision {
		t.Fatalf("sidecar not applied or revision changed: %+v", withMeta)
	}

	h.create("otter")
	path := filepath.Join(h.apks, "hello.apk")
	later := time.Now().Add(time.Hour)
	if err := os.Chtimes(path, later, later); err != nil {
		t.Fatal(err)
	}
	replaced := h.list("otter", "")["hello.apk"]
	if replaced.Revision == before.Revision {
		t.Fatal("replacing a file must change its revision")
	}
	if _, ok := h.srv.cache.Lookup(ctx, "local", "hello.apk", replaced.Revision); ok {
		t.Fatal("the new revision must not reuse the old cache entry")
	}
	if _, ok := h.srv.cache.Lookup(ctx, "local", "hello.apk", before.Revision); !ok {
		t.Fatal("running sessions keep the revision they were started with")
	}
}

func TestUploadName(t *testing.T) {
	tests := map[string]string{
		"app.apk":                         "app.apk",
		"../../etc/passwd":                "passwd.apk",
		`C:\Users\me\b.APK`:               "b.APK",
		".hidden.apk":                     "hidden.apk",
		"":                                "app.apk",
		"сборка 2.apk":                    "_______2.apk",
		strings.Repeat("a", 300) + ".apk": strings.Repeat("a", 96) + ".apk",
	}
	for in, want := range tests {
		if got := uploadName(in); got != want {
			t.Errorf("uploadName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestIconSidecar(t *testing.T) {
	red := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	for x := range 32 {
		for y := range 32 {
			red.Set(x, y, color.NRGBA{R: 255, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, red); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name    string
		sidecar []byte
		wantRed bool
	}{
		{"valid sidecar wins", buf.Bytes(), true},
		{"garbage sidecar falls back to the apk icon", []byte("<script>alert(1)</script>"), false},
		{"no sidecar", nil, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newHarness(t, 1)
			if tt.sidecar != nil {
				if err := os.WriteFile(filepath.Join(h.apks, "hello.apk"+source.IconSuffix), tt.sidecar, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			a, err := h.srv.sources["local"].Get(context.Background(), "hello.apk")
			if err != nil {
				t.Fatal(err)
			}
			entry, err := h.srv.cache.Ensure(context.Background(), "local", a)
			if err != nil || !entry.HasIcon {
				t.Fatalf("entry %+v, %v", entry, err)
			}
			rec := h.do(http.MethodGet, iconURL(entry), "otter", "", nil)
			if rec.Code != http.StatusOK || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatalf("icon: %d %v", rec.Code, rec.Header())
			}
			img, err := png.Decode(rec.Body)
			if err != nil {
				t.Fatalf("served icon is not a png: %v", err)
			}
			r, g, b, _ := img.At(apk.IconSize/2, apk.IconSize/2).RGBA()
			if isRed := r>>8 == 255 && g == 0 && b == 0; isRed != tt.wantRed {
				t.Fatalf("centre pixel %d,%d,%d, want red=%v", r>>8, g>>8, b>>8, tt.wantRed)
			}
		})
	}
}

func TestCacheReparsesOldParserEntries(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, 1)
	cache := h.srv.cache
	a, err := h.srv.sources["local"].Get(ctx, "hello.apk")
	if err != nil {
		t.Fatal(err)
	}
	entry, err := cache.Ensure(ctx, "local", a)
	if err != nil || entry.Parser != apk.ParserVersion {
		t.Fatalf("entry %+v, %v", entry, err)
	}

	stale := entry
	stale.Parser = apk.ParserVersion - 1
	stale.HasIcon = false
	raw, err := json.Marshal(stale)
	if err != nil {
		t.Fatal(err)
	}
	if err := cache.store.Put(ctx, path.Join(entry.Key, metaObject), bytes.NewReader(raw), int64(len(raw))); err != nil {
		t.Fatal(err)
	}
	restarted := NewCache(cache.store, cache.maxSize, cache.open, cache.openIcon)
	if _, ok := restarted.LookupKey(ctx, entry.Key); ok {
		t.Fatal("an entry from an older parser is still a hit")
	}
	again, err := restarted.Ensure(ctx, "local", a)
	if err != nil || again.Key != entry.Key || !again.HasIcon || again.Parser != apk.ParserVersion {
		t.Fatalf("reparsed %+v, %v", again, err)
	}
}

func TestDownloads(t *testing.T) {
	want, err := os.ReadFile("../apk/testdata/helloworld.apk")
	if err != nil {
		t.Fatal(err)
	}
	download := "/api/v1/artifacts/local/" + encodeID("hello.apk") + "/download"
	tests := []struct {
		name      string
		adminOnly bool
		user      string
		groups    string
		allowed   bool
	}{
		{"everyone by default", false, "otter", "", true},
		{"admin only, user", true, "otter", "", false},
		{"admin only, admin", true, "root", "admins", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newHarnessWith(t, 1, func(c *Config) { c.Downloads.AdminOnly = tt.adminOnly })
			if got := h.list(tt.user, tt.groups)["hello.apk"].CanDownload; got != tt.allowed {
				t.Fatalf("canDownload = %v", got)
			}
			rec := h.do(http.MethodGet, download, tt.user, tt.groups, nil)
			if !tt.allowed {
				if rec.Code != http.StatusForbidden {
					t.Fatalf("download: %d", rec.Code)
				}
				return
			}
			if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), want) {
				t.Fatalf("download: %d, %d bytes", rec.Code, rec.Body.Len())
			}
			if cd := rec.Header().Get("Content-Disposition"); cd != "attachment; filename=hello.apk" {
				t.Fatalf("Content-Disposition %q", cd)
			}
		})
	}

	h := newHarness(t, 1)
	up := decode[ArtifactView](t, h.upload("otter", "", "secret.apk", want, map[string]string{"visibility": "private"}))
	if rec := h.do(http.MethodGet, artifactPathFor(up)+"/download", "beaver", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger downloading a private upload: %d", rec.Code)
	}
}
