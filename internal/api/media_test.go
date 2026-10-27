package api

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func (h *harness) uploadMedia(user, name, contentType string, content []byte) *httptest.ResponseRecorder {
	h.t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	head := textproto.MIMEHeader{}
	head.Set("Content-Disposition", `form-data; name="file"; filename="`+name+`"`)
	head.Set("Content-Type", contentType)
	part, _ := w.CreatePart(head)
	_, _ = part.Write(content)
	_ = w.Close()
	r := httptest.NewRequest(http.MethodPost, mediaPath, &buf)
	r.Header.Set("Content-Type", w.FormDataContentType())
	r.Header.Set("Remote-User", user)
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, r)
	return rec
}

func (h *harness) media(user string) MediaList {
	h.t.Helper()
	rec := h.do(http.MethodGet, mediaPath, user, "", nil)
	if rec.Code != http.StatusOK {
		h.t.Fatalf("list media: %d %s", rec.Code, rec.Body.String())
	}
	return decode[MediaList](h.t, rec)
}

func TestMedia(t *testing.T) {
	h := newHarnessWith(t, 1, func(c *Config) { c.Media.Quota = 10 })

	rec := h.uploadMedia("alice", "Voice memo.m4a", "application/octet-stream", []byte("aaaaaa"))
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	v := decode[MediaView](t, rec)
	if v.Name != "Voice memo" || !strings.HasPrefix(v.ContentType, "audio/") || v.Kind != "audio" || v.Size != 6 {
		t.Fatalf("view: %+v", v)
	}
	if rec := h.uploadMedia("alice", "notes.txt", "text/plain", []byte("x")); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("text file: %d %s", rec.Code, rec.Body.String())
	}
	if rec := h.uploadMedia("alice", "clip.webm", "video/webm", []byte("vvvvvvv")); rec.Code != http.StatusInsufficientStorage {
		t.Fatalf("over quota: %d %s", rec.Code, rec.Body.String())
	}

	l := h.media("alice")
	if !l.Enabled || l.Quota != 10 || l.Used != 6 || len(l.Items) != 1 || l.Items[0].ID != v.ID {
		t.Fatalf("list: %+v", l)
	}
	if got := h.media("bob"); len(got.Items) != 0 || got.Used != 0 {
		t.Fatalf("bob sees %+v", got)
	}
	h.expect(http.StatusNotFound, http.MethodDelete, mediaPath+"/"+v.ID, "bob", "", nil)

	r := httptest.NewRequest(http.MethodGet, "/internal/media/"+userDir("alice")+"/"+v.ID, nil)
	got := httptest.NewRecorder()
	h.internal.ServeHTTP(got, r)
	if got.Code != http.StatusOK || got.Body.String() != "aaaaaa" {
		t.Fatalf("internal: %d %q", got.Code, got.Body.String())
	}

	h.expect(http.StatusNoContent, http.MethodDelete, mediaPath+"/"+v.ID, "alice", "", nil)
	if l := h.media("alice"); len(l.Items) != 0 || l.Used != 0 {
		t.Fatalf("after delete: %+v", l)
	}
	if !strings.Contains(h.audit.String(), `"media.upload"`) || !strings.Contains(h.audit.String(), `"media.delete"`) {
		t.Fatalf("audit: %s", h.audit.String())
	}
}

func TestSessionMicrophone(t *testing.T) {
	h := newHarness(t, 1)
	v := h.create("otter")
	base := "/s/fake/" + v.ID
	path := "/api/v1/sessions/fake/" + v.ID + "/microphone"

	h.expect(http.StatusForbidden, http.MethodPut, base+"/v1/microphone", "otter", "", contract.SetMicrophone{Source: contract.MicFile, FileURL: "http://evil/x", MediaID: "x"})
	h.expect(http.StatusForbidden, http.MethodPut, path, "beaver", "", SetSessionMicrophone{Source: contract.MicTone})

	m := decode[contract.Microphone](t, h.do(http.MethodPut, path, "otter", "", SetSessionMicrophone{Source: contract.MicTone}))
	if !m.Available || m.Source != contract.MicTone {
		t.Fatalf("tone: %+v", m)
	}

	media := decode[MediaView](t, h.uploadMedia("otter", "song.mp3", "audio/mpeg", []byte("id3")))
	h.expect(http.StatusNotFound, http.MethodPut, path, "otter", "", SetSessionMicrophone{Source: contract.MicFile, MediaID: "20260101T000000Z-000000000000000000000000"})
	m = decode[contract.Microphone](t, h.do(http.MethodPut, path, "otter", "", SetSessionMicrophone{Source: contract.MicFile, MediaID: media.ID}))
	if m.Source != contract.MicFile || m.MediaID != media.ID || m.File != "song" {
		t.Fatalf("file: %+v", m)
	}

	rec := h.do(http.MethodGet, base+"/v1/microphone", "otter", "", nil)
	if got := decode[contract.Microphone](t, rec); got.MediaID != media.ID {
		t.Fatalf("agent state: %+v", got)
	}
	if !strings.Contains(h.audit.String(), `"session.microphone"`) {
		t.Fatalf("audit: %s", h.audit.String())
	}
}

func TestSessionCamera(t *testing.T) {
	h := newHarness(t, 1)
	v := h.create("otter")
	base := "/s/fake/" + v.ID
	path := "/api/v1/sessions/fake/" + v.ID + "/camera"

	h.expect(http.StatusForbidden, http.MethodPut, base+"/v1/camera", "otter", "", contract.SetCamera{Source: contract.CameraFile, FileURL: "http://evil/x", MediaID: "x"})
	h.expect(http.StatusForbidden, http.MethodPut, path, "beaver", "", SetSessionCamera{Source: contract.CameraBlack})

	c := decode[contract.Camera](t, h.do(http.MethodGet, base+"/v1/camera", "otter", "", nil))
	if !c.Available || c.Source != contract.CameraBars {
		t.Fatalf("default: %+v", c)
	}
	c = decode[contract.Camera](t, h.do(http.MethodPut, path, "otter", "", SetSessionCamera{Source: contract.CameraBlack}))
	if c.Source != contract.CameraBlack {
		t.Fatalf("black: %+v", c)
	}

	qr := decode[MediaView](t, h.uploadMedia("otter", "login-qr.png", "image/png", []byte("png")))
	song := decode[MediaView](t, h.uploadMedia("otter", "song.mp3", "audio/mpeg", []byte("id3")))
	if qr.Kind != "image" || song.Kind != "audio" {
		t.Fatalf("kinds %q %q", qr.Kind, song.Kind)
	}
	h.expect(http.StatusUnprocessableEntity, http.MethodPut, path, "otter", "", SetSessionCamera{Source: contract.CameraFile, MediaID: song.ID})
	h.expect(http.StatusUnprocessableEntity, http.MethodPut, "/api/v1/sessions/fake/"+v.ID+"/microphone", "otter", "",
		SetSessionMicrophone{Source: contract.MicFile, MediaID: qr.ID})
	c = decode[contract.Camera](t, h.do(http.MethodPut, path, "otter", "", SetSessionCamera{Source: contract.CameraFile, MediaID: qr.ID}))
	if c.Source != contract.CameraFile || c.MediaID != qr.ID || c.File != "login-qr" {
		t.Fatalf("file: %+v", c)
	}
	if !strings.Contains(h.audit.String(), `"session.camera"`) {
		t.Fatalf("audit: %s", h.audit.String())
	}
}
