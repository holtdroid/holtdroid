package api

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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
