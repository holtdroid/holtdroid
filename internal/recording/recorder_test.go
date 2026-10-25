package recording

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bluenviron/mediacommon/v2/pkg/formats/fmp4"

	"github.com/holtdroid/holtdroid/internal/contract"
)

type bucket struct {
	mu     sync.Mutex
	files  map[string][]byte
	puts   []string
	status int
}

func (b *bucket) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.status != 0 {
		w.WriteHeader(b.status)
		return
	}
	data, _ := io.ReadAll(r.Body)
	name := strings.TrimPrefix(r.URL.Path, "/rec/")
	b.files[name] = data
	b.puts = append(b.puts, name)
}

func (b *bucket) get(t *testing.T, name string) []byte {
	t.Helper()
	b.mu.Lock()
	defer b.mu.Unlock()
	data, ok := b.files[name]
	if !ok {
		t.Fatalf("%s was not uploaded; have %v", name, b.puts)
	}
	return data
}

func gunzip(t *testing.T, data []byte) string {
	t.Helper()
	zr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	out, err := io.ReadAll(zr)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) add(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

// screenPackets splits the fake device's H.264 loop like scrcpy does: SPS
// and PPS in a config packet, then one packet per picture.
func screenPackets(t *testing.T) []Packet {
	t.Helper()
	stream, err := os.ReadFile("../provider/fake/testdata/screen.h264")
	if err != nil {
		t.Fatal(err)
	}
	var packets []Packet
	var config []byte
	for part := range bytes.SplitSeq(stream, []byte{0, 0, 1}) {
		part = bytes.TrimRight(part, "\x00")
		if len(part) == 0 {
			continue
		}
		nal := append([]byte{0, 0, 0, 1}, part...)
		switch typ := part[0] & 0x1f; typ {
		case 7, 8:
			config = append(config, nal...)
		case 1, 5:
			if config != nil {
				packets = append(packets, Packet{Config: true, Data: config})
				config = nil
			}
			packets = append(packets, Packet{Key: typ == 5, Data: nal})
		}
	}
	return packets
}

func start(t *testing.T, b *bucket, c *clock) *Recorder {
	t.Helper()
	srv := httptest.NewServer(b)
	t.Cleanup(srv.Close)
	cfg := DefaultConfig()
	cfg.Flush = time.Hour
	return Start(contract.RecordingTarget{ID: "x", URL: srv.URL + "/rec"}, cfg, slog.New(slog.DiscardHandler), WithClock(c.now))
}

func TestRecorder(t *testing.T) {
	b := &bucket{files: map[string][]byte{}}
	c := &clock{t: time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)}
	r := start(t, b, c)

	r.Event(contract.RecordingEvent{Type: contract.EventInfo, Info: &contract.RecordingInfoData{Model: "Pixel"}})
	var pts int64
	packets := screenPackets(t)
	for loop := range 3 {
		for _, p := range packets {
			if !p.Config {
				pts += 100_000
				c.add(100 * time.Millisecond)
			}
			p.PTS = pts
			r.Video(p)
		}
		if loop == 1 {
			r.Logcat("10-25 12:00:05.000  100  100 I Tag: hello")
			r.Break()
			pts = 0
		}
	}
	c.add(200 * time.Millisecond)
	state := r.Stop(context.Background())
	if state.Active || state.Error != "" {
		t.Fatalf("state after stop: %+v", state)
	}

	var m contract.RecordingManifest
	if err := json.Unmarshal(b.get(t, "manifest.json"), &m); err != nil {
		t.Fatal(err)
	}
	if m.State != contract.RecordingDone || len(m.Epochs) != 2 {
		t.Fatalf("manifest: state %s, %d epochs", m.State, len(m.Epochs))
	}
	if m.Epochs[0].Codec[:5] != "avc1." || m.Epochs[0].Width != 360 || m.Epochs[0].Height != 640 {
		t.Fatalf("epoch: %+v", m.Epochs[0])
	}
	var total int64
	for _, e := range m.Epochs {
		var init fmp4.Init
		if err := init.Unmarshal(bytes.NewReader(b.get(t, e.Init))); err != nil {
			t.Fatalf("%s: %v", e.Init, err)
		}
		for i, s := range e.Segments {
			var parts fmp4.Parts
			if err := parts.Unmarshal(b.get(t, s.File)); err != nil {
				t.Fatalf("%s: %v", s.File, err)
			}
			if parts[0].Tracks[0].Samples[0].IsNonSyncSample {
				t.Fatalf("%s doesn't start with a key frame", s.File)
			}
			if i > 0 && s.Start != e.Segments[i-1].Start+e.Segments[i-1].Duration {
				t.Fatalf("segment %s starts at %d, after %+v", s.File, s.Start, e.Segments[i-1])
			}
			total += s.Duration
		}
	}
	if want := m.Duration; total < want-1000 || total > want {
		t.Fatalf("segments last %d ms of %d", total, want)
	}
	if len(m.Logcat) != 1 || !strings.HasPrefix(gunzip(t, b.get(t, m.Logcat[0].File)), Clock(m.Logcat[0].Start)+"  10-25 12:00:05.000") {
		t.Fatalf("logcat: %+v", m.Logcat)
	}
	var ev contract.RecordingEvent
	if err := json.Unmarshal([]byte(strings.TrimSpace(gunzip(t, b.get(t, m.Events[0].File)))), &ev); err != nil || ev.Info.Model != "Pixel" {
		t.Fatalf("event: %+v %v", ev, err)
	}
	if b.puts[len(b.puts)-1] != "manifest.json" {
		t.Fatalf("the manifest wasn't uploaded last: %v", b.puts)
	}
}

func TestRecorderQuota(t *testing.T) {
	b := &bucket{files: map[string][]byte{}, status: http.StatusInsufficientStorage}
	c := &clock{t: time.Now()}
	stopped := make(chan contract.RecordingState, 1)
	srv := httptest.NewServer(b)
	defer srv.Close()
	r := Start(contract.RecordingTarget{ID: "x", URL: srv.URL + "/rec"}, DefaultConfig(), slog.New(slog.DiscardHandler),
		WithClock(c.now), OnStop(func(s contract.RecordingState) { stopped <- s }))
	r.Logcat("line")
	r.Thumbnail([]byte("jpeg"))
	select {
	case s := <-stopped:
		if s.Active || s.Error != ErrQuota.Error() {
			t.Fatalf("state: %+v", s)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the recording didn't stop")
	}
}

func TestTap(t *testing.T) {
	var got []Packet
	tap := &Tap{OnPacket: func(p Packet) { got = append(got, p) }}
	stream := make([]byte, 64+12)
	copy(stream[64:], "h264")
	for _, p := range []Packet{{Config: true, Data: []byte("cfg")}, {Key: true, PTS: 5, Data: []byte("key")}, {PTS: 9, Data: []byte("p")}} {
		h := make([]byte, 12)
		flags := uint64(p.PTS)
		if p.Config {
			flags = 1 << 63
		}
		if p.Key {
			flags |= 1 << 62
		}
		binary.BigEndian.PutUint64(h, flags)
		binary.BigEndian.PutUint32(h[8:], uint32(len(p.Data)))
		stream = append(stream, h...)
		stream = append(stream, p.Data...)
	}
	for i := range stream {
		_, _ = tap.Write(stream[i : i+1])
	}
	if len(got) != 3 || !got[0].Config || !got[1].Key || got[1].PTS != 5 || string(got[2].Data) != "p" || got[2].PTS != 9 {
		t.Fatalf("packets: %+v", got)
	}
}
