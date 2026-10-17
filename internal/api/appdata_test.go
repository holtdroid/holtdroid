package api

import (
	"archive/tar"
	"bytes"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/klauspost/compress/zstd"

	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/provider/fake"
)

func newAppDataHarness(t *testing.T, configure func(*AppDataConfig)) *harness {
	t.Helper()
	return newHarnessWith(t, 4, func(c *Config) {
		c.AppData.Enabled = true
		c.AppData.Cache = true
		if configure != nil {
			configure(&c.AppData)
		}
	}, func(c *fake.Config) { c.StepDelay = time.Millisecond })
}

func (h *harness) launch(user string, appData *AppDataChoice) *SessionView {
	h.t.Helper()
	body := map[string]any{"source": "local", "artifactId": encodeID("hello.apk"), "provider": "fake"}
	if appData != nil {
		body["appData"] = appData
	}
	rec := h.do(http.MethodPost, "/api/v1/sessions", user, "", body)
	if rec.Code != http.StatusCreated {
		return nil
	}
	v := decode[SessionView](h.t, rec)
	h.waitReady(v.ID)
	return &v
}

func (h *harness) stop(user, id string) {
	h.t.Helper()
	if rec := h.do(http.MethodDelete, "/api/v1/sessions/fake/"+id, user, "", nil); rec.Code != http.StatusNoContent {
		h.t.Fatalf("stop: %d %s", rec.Code, rec.Body.String())
	}
}

func (h *harness) appData(user string) AppDataList {
	h.t.Helper()
	rec := h.do(http.MethodGet, "/api/v1/app-data", user, "", nil)
	if rec.Code != http.StatusOK {
		h.t.Fatalf("list app data: %d %s", rec.Code, rec.Body.String())
	}
	return decode[AppDataList](h.t, rec)
}

func archiveNames(t *testing.T, raw []byte) []string {
	t.Helper()
	zr, err := zstd.NewReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	var names []string
	tr := tar.NewReader(zr)
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return names
		}
		if err != nil {
			t.Fatal(err)
		}
		names = append(names, h.Name)
	}
}

func TestAppDataSavedOnStopAndRestored(t *testing.T) {
	h := newAppDataHarness(t, nil)
	first := h.launch("otter", nil)
	h.stop("otter", first.ID)

	list := h.appData("otter")
	if !list.Enabled || !list.Cache || !list.Export || list.Keep != 6 || list.MaxAge != int64(7*24*time.Hour/time.Second) {
		t.Fatalf("rules %+v", list)
	}
	if len(list.Items) != 1 {
		t.Fatalf("items %+v", list.Items)
	}
	snap := list.Items[0]
	if snap.Package != "com.example.helloworld" || snap.Label != "HelloWorld" || !snap.Cache || snap.Size == 0 || snap.Compressed == 0 {
		t.Fatalf("snapshot %+v", snap)
	}
	if snap.ExpiresAt == nil || !snap.ExpiresAt.Equal(h.clock.Now().Add(7*24*time.Hour)) {
		t.Fatalf("expires %v", snap.ExpiresAt)
	}

	h.clock.Advance(time.Hour)
	second := h.launch("otter", &AppDataChoice{ID: snap.ID})
	if n, _ := h.provider.Restored(second.ID); n != 2 {
		t.Fatalf("restored %d files without the cache, want 2", n)
	}
	if got := h.appData("otter").Items[0]; !got.LastUsedAt.Equal(h.clock.Now()) {
		t.Fatalf("last used %v, want %v", got.LastUsedAt, h.clock.Now())
	}
	third := h.launch("otter", &AppDataChoice{ID: snap.ID, Cache: true})
	if n, _ := h.provider.Restored(third.ID); n != 3 {
		t.Fatalf("restored %d files with the cache, want 3", n)
	}
	if !slicesContain(h.events(third.ID), "session.launch|ok|otter") {
		t.Fatalf("events %v", h.events(third.ID))
	}

	rec := h.do(http.MethodGet, "/api/v1/app-data/com.example.helloworld/"+snap.ID+"/download", "otter", "", nil)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/zstd" ||
		!strings.Contains(rec.Header().Get("Content-Disposition"), "com.example.helloworld-"+snap.ID+".tar.zst") {
		t.Fatalf("download: %d %v", rec.Code, rec.Header())
	}
	names := archiveNames(t, rec.Body.Bytes())
	if len(names) != 3 || !strings.HasPrefix(names[0], "data/data/com.example.helloworld/") {
		t.Fatalf("archive %v", names)
	}
}

func slicesContain(events []string, prefix string) bool {
	for _, e := range events {
		if strings.HasPrefix(e, prefix) {
			return true
		}
	}
	return false
}

func TestAppDataIsPrivate(t *testing.T) {
	h := newAppDataHarness(t, nil)
	v := h.launch("otter", nil)
	h.stop("otter", v.ID)
	id := h.appData("otter").Items[0].ID
	path := "/api/v1/app-data/com.example.helloworld/" + id

	if items := h.appData("badger").Items; len(items) != 0 {
		t.Fatalf("badger sees %+v", items)
	}
	if rec := h.do(http.MethodGet, path+"/download", "badger", "admins", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("download by another user: %d", rec.Code)
	}
	if rec := h.do(http.MethodDelete, path, "badger", "admins", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("delete by another user: %d", rec.Code)
	}
	if h.launch("badger", &AppDataChoice{ID: id}) != nil {
		t.Fatal("badger launched with otter's app data")
	}
	for _, key := range []string{"x/../../etc/passwd.tar.zst", userDir("otter") + "/com.example.helloworld/" + id + ".json"} {
		rec := httptest.NewRecorder()
		h.internal.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/internal/app-data/"+key, nil))
		if rec.Code == http.StatusOK {
			t.Fatalf("internal endpoint served %s", key)
		}
	}
	rec := httptest.NewRecorder()
	h.internal.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/internal/app-data/"+userDir("otter")+"/com.example.helloworld/"+id+".tar.zst", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("internal endpoint: %d", rec.Code)
	}

	if rec := h.do(http.MethodDelete, path, "otter", "", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	if items := h.appData("otter").Items; len(items) != 0 {
		t.Fatalf("left after delete: %+v", items)
	}
}

func TestAppDataRetention(t *testing.T) {
	h := newAppDataHarness(t, func(c *AppDataConfig) { c.Keep = 2 })
	for range 3 {
		v := h.launch("otter", nil)
		h.stop("otter", v.ID)
		h.clock.Advance(time.Minute)
	}
	items := h.appData("otter").Items
	if len(items) != 2 || !items[0].CreatedAt.After(items[1].CreatedAt) {
		t.Fatalf("kept %+v", items)
	}

	h.launch("otter", &AppDataChoice{ID: items[1].ID})
	h.clock.Advance(7*24*time.Hour - time.Minute)
	left := h.appData("otter").Items
	if len(left) != 1 || left[0].ID != items[1].ID {
		t.Fatalf("after expiry of the unused one: %+v", left)
	}
	h.clock.Advance(time.Hour)
	h.srv.sweepAppData(t.Context())
	objs, err := h.srv.appData.store.List(t.Context(), appDataPrefix)
	if err != nil || len(objs) != 0 {
		t.Fatalf("store after sweep: %v %v", objs, err)
	}
}

func TestAppDataReaped(t *testing.T) {
	h := newAppDataHarness(t, nil)
	v := h.launch("otter", nil)
	h.clock.Advance(h.cfg.Sessions.IdleTimeout + time.Minute)
	h.srv.Reap(t.Context())
	if _, err := h.provider.Get(t.Context(), v.ID); err == nil {
		t.Fatal("session not reaped")
	}
	if items := h.appData("otter").Items; len(items) != 1 {
		t.Fatalf("items %+v", items)
	}
	if !slicesContain(h.events(v.ID), "appdata.save|ok|") {
		t.Fatalf("events %v", h.events(v.ID))
	}
}

func TestAppDataSaveNow(t *testing.T) {
	h := newAppDataHarness(t, nil)
	v := h.launch("otter", nil)
	for _, p := range []string{"/v1/app-data/export", "/v1//app-data/./export", "/v1/app-data%2Fexport"} {
		if rec := h.do(http.MethodPost, "/s/fake/"+v.ID+p, "badger", "", contract.AppDataExport{}); rec.Code != http.StatusForbidden && rec.Code/100 != 3 {
			t.Fatalf("export of another user's session through the proxy (%s): %d", p, rec.Code)
		}
	}
	path := "/api/v1/sessions/fake/" + v.ID + "/app-data"
	if rec := h.do(http.MethodPost, path, "badger", "", nil); rec.Code != http.StatusForbidden {
		t.Fatalf("save by another user: %d", rec.Code)
	}
	rec := h.do(http.MethodPost, path, "otter", "", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body.String())
	}
	if got := decode[AppDataView](t, rec); got.Package != "com.example.helloworld" {
		t.Fatalf("view %+v", got)
	}
	if _, err := h.provider.Get(t.Context(), v.ID); err != nil {
		t.Fatalf("session gone after saving: %v", err)
	}
}

func TestAppDataLimits(t *testing.T) {
	h := newAppDataHarness(t, func(c *AppDataConfig) {
		c.MaxCacheSize = 1 << 10
		c.Export = false
	})
	v := h.launch("otter", nil)
	h.stop("otter", v.ID)
	list := h.appData("otter")
	if list.Export || len(list.Items) != 1 || list.Items[0].Cache {
		t.Fatalf("list %+v", list)
	}
	rec := h.do(http.MethodGet, "/api/v1/app-data/com.example.helloworld/"+list.Items[0].ID+"/download", "otter", "", nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("download with export off: %d", rec.Code)
	}

	h = newAppDataHarness(t, func(c *AppDataConfig) { c.MaxSize = 16 })
	v = h.launch("otter", nil)
	h.stop("otter", v.ID)
	if items := h.appData("otter").Items; len(items) != 0 {
		t.Fatalf("saved over maxSize: %+v", items)
	}
}

func TestAppDataSurvivesCacheEviction(t *testing.T) {
	h := newAppDataHarness(t, nil)
	v := h.launch("otter", nil)
	h.stop("otter", v.ID)
	h.srv.cache.maxSize = 1
	h.srv.cache.evict(t.Context())
	if items := h.appData("otter").Items; len(items) != 1 {
		t.Fatalf("app data evicted with the APK cache: %+v", items)
	}
}

func TestAppDataDisabled(t *testing.T) {
	h := newHarness(t, 1)
	if list := h.appData("otter"); list.Enabled || len(list.Items) != 0 {
		t.Fatalf("list %+v", list)
	}
	rec := h.do(http.MethodPost, "/api/v1/sessions", "otter", "", map[string]any{
		"source": "local", "artifactId": encodeID("hello.apk"), "provider": "fake",
		"appData": AppDataChoice{ID: "20260101T120000Z-000000000000000000000000"},
	})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("launch with app data while disabled: %d %s", rec.Code, rec.Body.String())
	}
}
