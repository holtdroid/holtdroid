package api

import (
	"bytes"
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
	if rec := h.do(http.MethodGet, r.FilesURL+"manifest.json", "bob", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("bob reads alice's files: %d", rec.Code)
	}
	if rec := h.do(http.MethodGet, r.LogcatURL, "alice", "", nil); rec.Code != http.StatusOK || !strings.Contains(rec.Header().Get("Content-Disposition"), "logcat.txt") {
		t.Fatalf("logcat: %d %v", rec.Code, rec.Header())
	}

	shared := decode[RecordingView](t, h.do(http.MethodPost, "/api/v1/recordings/"+r.ID+"/share", "alice", "", nil))
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
	h.do(http.MethodDelete, "/api/v1/recordings/"+r.ID+"/share", "alice", "", nil)
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
	h := newRecordingHarness(t, nil)
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
