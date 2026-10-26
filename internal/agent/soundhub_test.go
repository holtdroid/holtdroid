package agent

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/recording"
)

type uploads struct {
	mu    sync.Mutex
	files map[string][]byte
}

func newUploads(t *testing.T) (*uploads, contract.RecordingTarget) {
	t.Helper()
	u := &uploads{files: map[string][]byte{}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		u.mu.Lock()
		u.files[strings.TrimPrefix(r.URL.Path, "/rec/")] = b
		u.mu.Unlock()
	}))
	t.Cleanup(srv.Close)
	return u, contract.RecordingTarget{ID: "x", URL: srv.URL + "/rec"}
}

func (u *uploads) manifest(t *testing.T) contract.RecordingManifest {
	t.Helper()
	u.mu.Lock()
	defer u.mu.Unlock()
	var m contract.RecordingManifest
	if err := json.Unmarshal(u.files["manifest.json"], &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func opusDevice(t *testing.T) *fakeScrcpy {
	dev := newFakeScrcpy(t)
	dev.opus = true
	return dev
}

func audioRuns(dev *fakeScrcpy) int {
	dev.mu.Lock()
	defer dev.mu.Unlock()
	n := 0
	for _, c := range dev.cmds {
		if strings.Contains(c, "audio=true") {
			n++
		}
	}
	return n
}

func TestRecordingCapturesSoundByItself(t *testing.T) {
	dev := opusDevice(t)
	s := NewScrcpy(DefaultScrcpyConfig(), dev, slog.New(slog.DiscardHandler))
	got, target := newUploads(t)
	rec := recording.Start(target, recording.DefaultConfig(), slog.New(slog.DiscardHandler))
	ctx := t.Context()

	s.sound.attach(ctx, rec)
	time.Sleep(1500 * time.Millisecond)
	rec.Stop(ctx)
	s.sound.detach(rec)

	m := got.manifest(t)
	if len(m.Audio) != 1 || len(m.Audio[0].Segments) == 0 || m.Audio[0].Channels != 2 {
		t.Fatalf("audio: %+v", m.Audio)
	}
	if n := audioRuns(dev); n != 1 {
		t.Fatalf("the recording ran %d captures", n)
	}
	if !strings.Contains(dev.lastCmd(), "audio_bit_rate=96000") {
		t.Errorf("the recording's own capture: %q", dev.lastCmd())
	}
}

func TestRecordingTakesTheViewersSound(t *testing.T) {
	dev := opusDevice(t)
	base := scrcpyServerWith(t, dev)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	got, target := newUploads(t)
	rec := recording.Start(target, recording.DefaultConfig(), slog.New(slog.DiscardHandler))

	c := dialWS(ctx, t, base.url+"/display/audio")
	if _, _, err := c.Read(ctx); err != nil {
		t.Fatal(err)
	}
	base.scrcpy.sound.attach(ctx, rec)
	for range 20 {
		if _, _, err := c.Read(ctx); err != nil {
			t.Fatal(err)
		}
	}
	_ = c.Close(websocket.StatusNormalClosure, "")
	rec.Stop(ctx)
	base.scrcpy.sound.detach(rec)

	m := got.manifest(t)
	if len(m.Audio) != 1 || len(m.Audio[0].Segments) == 0 {
		t.Fatalf("audio: %+v", m.Audio)
	}
	if n := audioRuns(dev); n != 1 {
		t.Fatalf("one capture was enough, but %d ran", n)
	}
}

func TestRecordingStopsAskingAfterADeviceWithoutSound(t *testing.T) {
	dev := newFakeScrcpy(t)
	dev.noSound = true
	s := NewScrcpy(DefaultScrcpyConfig(), dev, slog.New(slog.DiscardHandler))
	got, target := newUploads(t)
	rec := recording.Start(target, recording.DefaultConfig(), slog.New(slog.DiscardHandler))
	ctx := t.Context()

	s.sound.attach(ctx, rec)
	waitFor(t, func() bool {
		s.sound.mu.Lock()
		defer s.sound.mu.Unlock()
		return s.sound.unsupported
	})
	time.Sleep(600 * time.Millisecond)
	rec.Stop(ctx)
	s.sound.detach(rec)

	if m := got.manifest(t); len(m.Audio) != 0 {
		t.Fatalf("sound from a device without any: %+v", m.Audio)
	}
	if n := audioRuns(dev); n != 1 {
		t.Fatalf("the capture was tried %d times", n)
	}
}
