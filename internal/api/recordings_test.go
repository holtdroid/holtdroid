package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/provider/fake"
)

func newRecordingHarness(t *testing.T, configure func(*RecordingsConfig)) *harness {
	t.Helper()
	return newHarnessWith(t, 4, func(c *Config) {
		c.Recordings.Enabled = true
		c.PublicURL = "https://android.example.com"
		c.Recordings.MinDuration = 0
		if configure != nil {
			configure(&c.Recordings)
		}
	}, func(c *fake.Config) { c.StepDelay = time.Millisecond })
}

func (h *harness) recordings(user string) RecordingList {
	h.t.Helper()
	rec := h.do(http.MethodGet, "/api/v1/recordings", user, "", nil)
	if rec.Code != http.StatusOK {
		h.t.Fatalf("list recordings: %d %s", rec.Code, rec.Body.String())
	}
	return decode[RecordingList](h.t, rec)
}

// record launches a session, lets it record for a moment and stops it.
func (h *harness) record(user string, body map[string]any) RecordingView {
	h.t.Helper()
	req := map[string]any{"source": "local", "artifactId": encodeID("hello.apk"), "provider": "fake"}
	maps.Copy(req, body)
	rec := h.do(http.MethodPost, "/api/v1/sessions", user, "", req)
	if rec.Code != http.StatusCreated {
		h.t.Fatalf("launch: %d %s", rec.Code, rec.Body.String())
	}
	v := decode[SessionView](h.t, rec)
	h.waitReady(v.ID)
	time.Sleep(1500 * time.Millisecond)
	h.stop(user, v.ID)
	for _, r := range h.recordings(user).Items {
		if r.Session == v.ID {
			return r
		}
	}
	return RecordingView{}
}

func TestRecordingOfASession(t *testing.T) {
	h := newRecordingHarness(t, nil)
	r := h.record("alice", nil)
	if r.State != string(contract.RecordingDone) || r.Duration <= 0 || r.Size <= 0 || r.ThumbnailURL == "" || r.ExpiresAt == nil {
		t.Fatalf("recording: %+v", r)
	}
	if got := h.recordings("bob").Items; len(got) != 0 {
		t.Fatalf("bob sees %d recordings", len(got))
	}

	rec := h.do(http.MethodGet, "/api/v1/recordings/"+r.ID, "alice", "", nil)
	d := decode[RecordingDetail](t, rec)
	if d.Manifest == nil || len(d.Manifest.Epochs) == 0 || len(d.Manifest.Epochs[0].Segments) == 0 || d.Manifest.State != contract.RecordingDone {
		t.Fatalf("detail: %d %s", rec.Code, rec.Body.String())
	}
	seg := d.Manifest.Epochs[0].Segments[0].File
	if rec := h.do(http.MethodGet, r.FilesURL+seg, "alice", "", nil); rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "video/mp4" {
		t.Fatalf("segment: %d %v", rec.Code, rec.Header())
	}
	if rec := h.do(http.MethodGet, r.FilesURL+d.Manifest.Events[0].File, "alice", "", nil); rec.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("events: %d %v", rec.Code, rec.Header())
	}
	events := decode[RecordingEvents](t, h.do(http.MethodGet, "/api/v1/recordings/"+r.ID+"/events", "alice", "", nil)).Items
	if len(events) == 0 || events[0].Type != contract.EventInfo || events[0].Info.Package == "" {
		t.Fatalf("events: %+v", events)
	}
	devtools := decode[RecordingDevTools](t, h.do(http.MethodGet, "/api/v1/recordings/"+r.ID+"/devtools", "alice", "", nil)).Items
	if len(devtools) == 0 || devtools[0].Type != contract.DevToolsPageEntry || devtools[0].Page.URL == "" {
		t.Fatalf("devtools: %+v", devtools)
	}
	if rec := h.do(http.MethodGet, r.FilesURL+"manifest.json", "bob", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("bob reads alice's files: %d", rec.Code)
	}
	if rec := h.do(http.MethodGet, r.LogcatURL, "alice", "", nil); rec.Code != http.StatusOK || !strings.Contains(rec.Header().Get("Content-Disposition"), "logcat.txt") {
		t.Fatalf("logcat: %d %v", rec.Code, rec.Header())
	}

	if r.Keep || r.ExpiresAt == nil {
		t.Fatalf("a fresh recording is kept: %+v", r)
	}
	shared := decode[RecordingView](t, h.do(http.MethodPost, "/api/v1/recordings/"+r.ID+"/share", "alice", "", nil))
	if !shared.Keep || shared.ExpiresAt != nil {
		t.Fatalf("sharing should keep the recording: %+v", shared)
	}
	if shared.Share == nil || shared.Share.URL != "https://android.example.com/r/"+shared.Share.Token {
		t.Fatalf("share: %+v", shared.Share)
	}
	again := decode[RecordingView](t, h.do(http.MethodPost, "/api/v1/recordings/"+r.ID+"/share", "alice", "", nil))
	if again.Share.Token != shared.Share.Token {
		t.Fatal("sharing again made a new link")
	}
	rec = h.do(http.MethodGet, "/api/v1/shared/"+shared.Share.Token, "", "", nil)
	sd := decode[RecordingDetail](t, rec)
	if rec.Code != http.StatusOK || !sd.Shared || sd.Recording.Owner != "alice" || sd.Recording.Share != nil || sd.Manifest == nil {
		t.Fatalf("shared: %d %s", rec.Code, rec.Body.String())
	}
	if rec := h.do(http.MethodGet, sd.Recording.FilesURL+seg, "", "", nil); rec.Code != http.StatusOK {
		t.Fatalf("shared segment: %d", rec.Code)
	}
	if items := decode[RecordingDevTools](t, h.do(http.MethodGet, "/api/v1/shared/"+shared.Share.Token+"/devtools", "", "", nil)).Items; len(items) == 0 {
		t.Fatal("no devtools lines through the share link")
	}
	if un := decode[RecordingView](t, h.do(http.MethodDelete, "/api/v1/recordings/"+r.ID+"/share", "alice", "", nil)); !un.Keep {
		t.Fatal("turning sharing off dropped the keep")
	}
	if rec := h.do(http.MethodGet, "/api/v1/shared/"+shared.Share.Token, "", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("unshared link still opens: %d", rec.Code)
	}

	if rec := h.do(http.MethodDelete, "/api/v1/recordings/"+r.ID, "alice", "", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	if l := h.recordings("alice"); len(l.Items) != 0 || l.Used != 0 {
		t.Fatalf("after delete: %+v", l)
	}
}

func TestRecordingRetention(t *testing.T) {
	h := newRecordingHarness(t, nil)
	kept := h.record("alice", nil)
	gone := h.record("alice", nil)
	if rec := h.do(http.MethodPut, "/api/v1/recordings/"+kept.ID+"/keep", "alice", "", map[string]bool{"keep": true}); rec.Code != http.StatusOK || decode[RecordingView](t, rec).ExpiresAt != nil {
		t.Fatalf("keep: %d %s", rec.Code, rec.Body.String())
	}
	h.clock.Advance(8 * 24 * time.Hour)
	h.srv.sweepRecordings(t.Context())
	items := h.recordings("alice").Items
	if len(items) != 1 || items[0].ID != kept.ID || !items[0].Keep || gone.ID == kept.ID {
		t.Fatalf("after retention: %+v", items)
	}
}

func TestRecordingQuota(t *testing.T) {
	h := newRecordingHarness(t, func(c *RecordingsConfig) { c.Quota = 1 })
	first := h.record("alice", nil)
	second := h.record("alice", nil)
	items := h.recordings("alice").Items
	if len(items) != 1 || items[0].ID != second.ID || first.ID == "" {
		t.Fatalf("the oldest recording should make room: %+v", items)
	}
	h.do(http.MethodPut, "/api/v1/recordings/"+second.ID+"/keep", "alice", "", map[string]bool{"keep": true})
	if third := h.record("alice", nil); third.ID != "" {
		t.Fatalf("a kept recording over the quota still let one start: %+v", third)
	}
}

func TestRecordingOnDemand(t *testing.T) {
	h := newRecordingHarness(t, func(c *RecordingsConfig) { c.Mode = RecordAuto })
	rec := h.do(http.MethodPost, "/api/v1/sessions", "alice", "", map[string]any{
		"source": "local", "artifactId": encodeID("hello.apk"), "provider": "fake", "record": false,
	})
	v := decode[SessionView](t, rec)
	h.waitReady(v.ID)
	if items := h.recordings("alice").Items; len(items) != 0 {
		t.Fatalf("recorded without asking: %+v", items)
	}
	if rec := h.do(http.MethodPost, "/api/v1/sessions/fake/"+v.ID+"/recording", "bob", "", nil); rec.Code != http.StatusForbidden {
		t.Fatalf("bob started alice's recording: %d", rec.Code)
	}
	started := h.do(http.MethodPost, "/api/v1/sessions/fake/"+v.ID+"/recording", "alice", "", nil)
	if started.Code != http.StatusOK {
		t.Fatalf("start: %d %s", started.Code, started.Body.String())
	}
	if rec := h.do(http.MethodPost, "/api/v1/sessions/fake/"+v.ID+"/recording", "alice", "", nil); rec.Code != http.StatusLocked {
		t.Fatalf("second start: %d %s", rec.Code, rec.Body.String())
	}
	if rec := h.do(http.MethodPost, "/s/fake/"+v.ID+"/v1/device/actions/home", "alice", "", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("home: %d %s", rec.Code, rec.Body.String())
	}
	time.Sleep(time.Second)
	if rec := h.do(http.MethodDelete, "/api/v1/sessions/fake/"+v.ID+"/recording", "alice", "", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("stop: %d %s", rec.Code, rec.Body.String())
	}
	items := h.recordings("alice").Items
	if len(items) != 1 || items[0].ID != decode[RecordingView](t, started).ID || items[0].State != string(contract.RecordingDone) {
		t.Fatalf("recordings: %+v", items)
	}
	var pressed []string
	for _, e := range decode[RecordingEvents](t, h.do(http.MethodGet, "/api/v1/recordings/"+items[0].ID+"/events", "alice", "", nil)).Items {
		if e.Type == contract.EventKey {
			pressed = append(pressed, e.Key)
		}
	}
	if len(pressed) != 1 || pressed[0] != "home" {
		t.Fatalf("buttons in the recording: %v", pressed)
	}
	h.stop("alice", v.ID)
}

func TestRecordingUploadNeedsTheSecret(t *testing.T) {
	h := newRecordingHarness(t, nil)
	r := h.record("alice", nil)
	put := func(path string) int {
		req := httptest.NewRequest(http.MethodPut, path, bytes.NewReader([]byte("x")))
		w := httptest.NewRecorder()
		h.internal.ServeHTTP(w, req)
		return w.Code
	}
	user := userDir("alice")
	for _, path := range []string{
		"/internal/recordings/" + user + "/" + r.ID + "/wrong/thumb.jpg",
		"/internal/recordings/" + userDir("bob") + "/" + r.ID + "/wrong/thumb.jpg",
	} {
		if code := put(path); code != http.StatusNotFound {
			t.Fatalf("%s: %d", path, code)
		}
	}
	rec := h.do(http.MethodGet, r.ThumbnailURL, "alice", "", nil)
	if b, _ := io.ReadAll(rec.Body); rec.Code != http.StatusOK || bytes.Equal(b, []byte("x")) {
		t.Fatalf("thumbnail: %d", rec.Code)
	}
}

func TestRecordingAlwaysCannotBeStopped(t *testing.T) {
	h := newRecordingHarness(t, nil)
	if l := h.recordings("alice"); l.Mode != RecordAlways {
		t.Fatalf("the default mode: %q", l.Mode)
	}
	rec := h.do(http.MethodPost, "/api/v1/sessions", "alice", "", map[string]any{
		"source": "local", "artifactId": encodeID("hello.apk"), "provider": "fake", "record": false,
	})
	v := decode[SessionView](t, rec)
	h.waitReady(v.ID)
	time.Sleep(300 * time.Millisecond)
	items := h.recordings("alice").Items
	if len(items) != 1 || (items[0].State != string(contract.RecordingActive) && items[0].State != "pending") {
		t.Fatalf("the launch's \"record: false\" should be ignored: %+v", items)
	}
	if rec := h.do(http.MethodDelete, "/api/v1/sessions/fake/"+v.ID+"/recording", "alice", "", nil); rec.Code != http.StatusForbidden {
		t.Fatalf("stopping: %d %s", rec.Code, rec.Body.String())
	}
	if rec := h.do(http.MethodPost, "/api/v1/sessions/fake/"+v.ID+"/recording", "alice", "", nil); rec.Code != http.StatusLocked {
		t.Fatalf("starting a second one: %d", rec.Code)
	}
	h.stop("alice", v.ID)
	if got := h.recordings("alice").Items; len(got) != 1 || got[0].State != string(contract.RecordingDone) {
		t.Fatalf("after the session: %+v", got)
	}
}

func TestRecordingManualMode(t *testing.T) {
	h := newRecordingHarness(t, func(c *RecordingsConfig) { c.Mode = RecordManual })
	if items := func() []RecordingView {
		v := h.record("alice", nil)
		return []RecordingView{v}
	}(); items[0].ID != "" {
		t.Fatalf("recorded without being asked: %+v", items)
	}
	if got := h.record("alice", map[string]any{"record": true}); got.State != string(contract.RecordingDone) {
		t.Fatalf("asked to record: %+v", got)
	}
}

func TestRecordingMarkers(t *testing.T) {
	h := newRecordingHarness(t, nil)
	rec := h.do(http.MethodPost, "/api/v1/sessions", "alice", "", map[string]any{
		"source": "local", "artifactId": encodeID("hello.apk"), "provider": "fake",
	})
	v := decode[SessionView](t, rec)
	h.waitReady(v.ID)
	time.Sleep(700 * time.Millisecond)

	if rec := h.do(http.MethodPost, "/api/v1/sessions/fake/"+v.ID+"/recording/markers", "bob", "", map[string]any{}); rec.Code != http.StatusForbidden {
		t.Fatalf("bob marks alice's session: %d", rec.Code)
	}
	rec = h.do(http.MethodPost, "/api/v1/sessions/fake/"+v.ID+"/recording/markers", "alice", "", map[string]any{"label": "login screen", "icon": "bug"})
	added := decode[SessionMarker](t, rec)
	if rec.Code != http.StatusOK || added.Marker.T < 600 || added.Marker.ID == "" || added.Marker.Icon != "bug" || added.Marker.Label != "login screen" {
		t.Fatalf("marker: %d %s", rec.Code, rec.Body.String())
	}
	h.stop("alice", v.ID)

	detail := decode[RecordingDetail](t, h.do(http.MethodGet, "/api/v1/recordings/"+added.Recording, "alice", "", nil))
	if len(detail.Markers) != 1 || detail.Markers[0] != added.Marker {
		t.Fatalf("markers in the recording: %+v", detail.Markers)
	}

	put := h.do(http.MethodPut, "/api/v1/recordings/"+added.Recording+"/markers", "alice", "", map[string]any{"items": []map[string]any{
		{"t": 3000, "label": "later", "icon": "flag"},
		{"id": added.Marker.ID, "t": added.Marker.T, "label": "renamed", "icon": "pin"},
	}})
	got := decode[RecordingMarkers](t, put)
	if put.Code != http.StatusOK || len(got.Items) != 2 || got.Items[0].Label != "renamed" || got.Items[1].T != 3000 || got.Items[1].ID == "" {
		t.Fatalf("put: %d %s", put.Code, put.Body.String())
	}
	if rec := h.do(http.MethodPut, "/api/v1/recordings/"+added.Recording+"/markers", "bob", "", map[string]any{"items": []any{}}); rec.Code != http.StatusNotFound {
		t.Fatalf("bob edits alice's markers: %d", rec.Code)
	}
	if rec := h.do(http.MethodPut, "/api/v1/recordings/"+added.Recording+"/markers", "alice", "", map[string]any{"items": []map[string]any{{"t": 1, "icon": "skull"}}}); rec.Code < 400 {
		t.Fatalf("an unknown icon was taken: %d", rec.Code)
	}

	token := decode[RecordingView](t, h.do(http.MethodPost, "/api/v1/recordings/"+added.Recording+"/share", "alice", "", nil)).Share.Token
	if shared := decode[RecordingDetail](t, h.do(http.MethodGet, "/api/v1/shared/"+token, "", "", nil)); len(shared.Markers) != 2 {
		t.Fatalf("a share link should show the markers: %+v", shared.Markers)
	}
}

func TestRecordingColoredLogcat(t *testing.T) {
	h := newRecordingHarness(t, nil)
	r := h.record("alice", nil)
	plain := h.do(http.MethodGet, r.LogcatURL, "alice", "", nil)
	colored := h.do(http.MethodGet, r.LogcatLogURL, "alice", "", nil)
	if plain.Code != http.StatusOK || colored.Code != http.StatusOK {
		t.Fatalf("logcat: %d %d", plain.Code, colored.Code)
	}
	if strings.Contains(plain.Body.String(), "\x1b[") || !strings.Contains(colored.Body.String(), "\x1b[") {
		t.Fatal("only the .log should carry colours")
	}
	if !strings.HasSuffix(colored.Header().Get("Content-Disposition"), "logcat.log\"") {
		t.Fatalf("name: %v", colored.Header())
	}
}

func TestColorLogLine(t *testing.T) {
	line := "00:01:02.345  10-25 12:00:05.000  1234  1240 E chromium: Uncaught TypeError"
	got := colorLogLine(line)
	for _, want := range []string{"\x1b[31mUncaught TypeError", "\x1b[1;31mE\x1b[0m", "\x1b[90m00:01:02.345", "1234 1240"} {
		if !strings.Contains(got, want) {
			t.Errorf("%q is missing from %q", want, got)
		}
	}
	if got := colorLogLine("-- 3 lines dropped --"); got != "\x1b[90m-- 3 lines dropped --\x1b[0m" {
		t.Errorf("an odd line: %q", got)
	}
}

func TestRecordingExport(t *testing.T) {
	h := newRecordingHarness(t, nil)
	r := h.record("alice", nil)
	h.do(http.MethodPut, "/api/v1/recordings/"+r.ID+"/markers", "alice", "", map[string]any{"items": []map[string]any{{"t": 1500, "label": "here", "icon": "bug"}}})
	if r.ExportURL != "/api/v1/recordings/"+r.ID+"/export" {
		t.Fatalf("export url: %q", r.ExportURL)
	}

	rec := h.do(http.MethodGet, r.ExportURL, "alice", "", nil)
	if rec.Code != http.StatusOK || !strings.HasSuffix(rec.Header().Get("Content-Disposition"), ".holtdroid\"") {
		t.Fatalf("export: %d %v", rec.Code, rec.Header())
	}
	zr, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]*zip.File{}
	for _, f := range zr.File {
		if f.Method != zip.Store {
			t.Errorf("%s is compressed", f.Name)
		}
		files[f.Name] = f
	}
	for _, want := range []string{"holtdroid.json", "manifest.json", "init-0.mp4", "seg-1.m4s", "thumb.jpg", "icon.png"} {
		if files[want] == nil {
			t.Fatalf("%s is missing from %d files", want, len(files))
		}
	}
	rc, _ := files["holtdroid.json"].Open()
	var meta bundleMeta
	if err := json.NewDecoder(rc).Decode(&meta); err != nil {
		t.Fatal(err)
	}
	rc.Close()
	v := meta.Recording
	if meta.Format != "holtdroid-recording" || meta.Version != 1 || v.ID != r.ID || v.Package != "com.example.helloworld" ||
		len(meta.Markers) != 1 || meta.Markers[0].Label != "here" {
		t.Fatalf("meta: %+v", meta)
	}
	if v.FilesURL != "" || v.Share != nil || v.Session != "" || v.Provider != "" || v.IconURL != "" {
		t.Fatalf("the archive points back at the server: %+v", v)
	}
	mf, _ := files["manifest.json"].Open()
	got, _ := io.ReadAll(mf)
	mf.Close()
	if want := h.do(http.MethodGet, r.FilesURL+"manifest.json", "alice", "", nil).Body.Bytes(); !bytes.Equal(got, want) {
		t.Fatal("the manifest in the archive differs from the server's")
	}

	if rec := h.do(http.MethodGet, r.ExportURL, "bob", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("bob exports alice's recording: %d", rec.Code)
	}
	token := decode[RecordingView](t, h.do(http.MethodPost, "/api/v1/recordings/"+r.ID+"/share", "alice", "", nil)).Share.Token
	if rec := h.do(http.MethodGet, "/api/v1/shared/"+token+"/export", "", "", nil); rec.Code != http.StatusOK || rec.Body.Len() == 0 {
		t.Fatalf("export through a share link: %d", rec.Code)
	}
}

func TestRecordingShorterThanTheMinimumIsDropped(t *testing.T) {
	h := newRecordingHarness(t, func(c *RecordingsConfig) { c.MinDuration = 2 * time.Second })
	if l := h.recordings("alice"); l.MinDuration != 2 {
		t.Fatalf("minDuration in the list: %d", l.MinDuration)
	}

	if short := h.record("alice", nil); short.ID != "" {
		t.Fatalf("a 1.5 s recording was kept: %+v", short)
	}
	if items := h.recordings("alice").Items; len(items) != 0 {
		t.Fatalf("after a short one: %+v", items)
	}

	launch := func() SessionView {
		rec := h.do(http.MethodPost, "/api/v1/sessions", "alice", "", map[string]any{
			"source": "local", "artifactId": encodeID("hello.apk"), "provider": "fake",
		})
		v := decode[SessionView](t, rec)
		h.waitReady(v.ID)
		return v
	}

	long := launch()
	time.Sleep(2500 * time.Millisecond)
	h.stop("alice", long.ID)
	if items := h.recordings("alice").Items; len(items) != 1 || items[0].State != string(contract.RecordingDone) {
		t.Fatalf("a long enough recording: %+v", items)
	}

	marked := launch()
	time.Sleep(400 * time.Millisecond)
	if rec := h.do(http.MethodPost, "/api/v1/sessions/fake/"+marked.ID+"/recording/markers", "alice", "", map[string]any{"label": "bug"}); rec.Code != http.StatusOK {
		t.Fatalf("marker: %d %s", rec.Code, rec.Body.String())
	}
	h.stop("alice", marked.ID)
	if items := h.recordings("alice").Items; len(items) != 2 {
		t.Fatalf("a short recording with a marker should stay: %+v", items)
	}
}

func TestRenameRecording(t *testing.T) {
	h := newRecordingHarness(t, nil)
	r := h.record("alice", nil)
	if r.Title != "" || r.Label == "" {
		t.Fatalf("a fresh recording: %+v", r)
	}
	put := func(user, name string) *httptest.ResponseRecorder {
		return h.do(http.MethodPut, "/api/v1/recordings/"+r.ID+"/name", user, "", map[string]string{"name": name})
	}

	rec := put("alice", "  Checkout   crash \n on Pixel ")
	if got := decode[RecordingView](t, rec); rec.Code != http.StatusOK || got.Title != "Checkout crash on Pixel" || got.Label != r.Label {
		t.Fatalf("rename: %d %s", rec.Code, rec.Body.String())
	}
	if items := h.recordings("alice").Items; len(items) != 1 || items[0].Title != "Checkout crash on Pixel" {
		t.Fatalf("in the list: %+v", items)
	}
	if rec := put("bob", "mine"); rec.Code != http.StatusNotFound {
		t.Fatalf("bob renames alice's recording: %d", rec.Code)
	}
	if rec := put("alice", strings.Repeat("x", 121)); rec.Code < 400 {
		t.Fatalf("a too long name was taken: %d", rec.Code)
	}

	token := decode[RecordingView](t, h.do(http.MethodPost, "/api/v1/recordings/"+r.ID+"/share", "alice", "", nil)).Share.Token
	if shared := decode[RecordingDetail](t, h.do(http.MethodGet, "/api/v1/shared/"+token, "", "", nil)); shared.Recording.Title != "Checkout crash on Pixel" {
		t.Fatalf("a share link shows %q", shared.Recording.Title)
	}
	archive := h.do(http.MethodGet, r.ExportURL, "alice", "", nil).Body.Bytes()
	zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range zr.File {
		if f.Name != "holtdroid.json" {
			continue
		}
		rc, _ := f.Open()
		var meta bundleMeta
		_ = json.NewDecoder(rc).Decode(&meta)
		rc.Close()
		if meta.Recording.Title != "Checkout crash on Pixel" {
			t.Fatalf("the archive has %q", meta.Recording.Title)
		}
	}

	if got := decode[RecordingView](t, put("alice", "   ")); got.Title != "" {
		t.Fatalf("an empty name should go back to the app's: %+v", got)
	}
}
