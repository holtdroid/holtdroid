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
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bluenviron/mediacommon/v2/pkg/formats/fmp4"
	"github.com/bluenviron/mediacommon/v2/pkg/formats/mp4/codecs"

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

func TestRecorderCutsWithoutKeyFrames(t *testing.T) {
	b := &bucket{files: map[string][]byte{}}
	c := &clock{t: time.Now()}
	r := start(t, b, c)
	packets := screenPackets(t)
	r.Video(packets[0])
	var pts int64
	for i := range 500 {
		p := packets[1+i%(len(packets)-1)]
		p.Key = i == 0
		pts += 100_000
		c.add(100 * time.Millisecond)
		p.PTS = pts
		r.Video(p)
	}
	r.Stop(context.Background())
	var m contract.RecordingManifest
	if err := json.Unmarshal(b.get(t, "manifest.json"), &m); err != nil {
		t.Fatal(err)
	}
	segs := m.Epochs[0].Segments
	if len(segs) != 3 || !segs[0].Key || segs[1].Key || segs[2].Key {
		t.Fatalf("segments: %+v", segs)
	}
	for _, s := range segs {
		if s.Duration > 20_000 {
			t.Fatalf("segment %s lasts %d ms", s.File, s.Duration)
		}
	}
}

func touchMsg(action byte, pointer uint64, x, y uint32) []byte {
	m := make([]byte, 32)
	m[0], m[1] = 2, action
	binary.BigEndian.PutUint64(m[2:], pointer)
	binary.BigEndian.PutUint32(m[10:], x)
	binary.BigEndian.PutUint32(m[14:], y)
	binary.BigEndian.PutUint16(m[18:], 1080)
	binary.BigEndian.PutUint16(m[20:], 2400)
	return m
}

func keyMsg(action byte, code uint32) []byte {
	m := make([]byte, 14)
	m[1] = action
	binary.BigEndian.PutUint32(m[2:], code)
	return m
}

func TestParseControl(t *testing.T) {
	text := append([]byte{1}, make([]byte, 20)...)
	for _, c := range []struct {
		name string
		msg  []byte
		want contract.RecordingEvent
		ok   bool
	}{
		{"finger down", touchMsg(0, 1, 540, 1200), contract.RecordingEvent{Type: contract.EventTouch, Touch: &contract.RecordingTouch{Action: contract.TouchDown, Pointer: 1, X: 0.5, Y: 0.5}}, true},
		{"mouse move", touchMsg(2, 0xFFFFFFFFFFFFFFFF, 1080, 0), contract.RecordingEvent{Type: contract.EventTouch, Touch: &contract.RecordingTouch{Action: contract.TouchMove, X: 1}}, true},
		{"second finger up", touchMsg(6, 2, 0, 2400), contract.RecordingEvent{Type: contract.EventTouch, Touch: &contract.RecordingTouch{Action: contract.TouchUp, Pointer: 2, Y: 1}}, true},
		{"hover", touchMsg(7, 0, 1, 1), contract.RecordingEvent{}, false},
		{"back pressed", keyMsg(0, 4), contract.RecordingEvent{Type: contract.EventKey, Key: "back"}, true},
		{"back released", keyMsg(1, 4), contract.RecordingEvent{}, false},
		{"right click back", []byte{4, 0}, contract.RecordingEvent{Type: contract.EventKey, Key: "back"}, true},
		{"right click released", []byte{4, 1}, contract.RecordingEvent{}, false},
		{"a letter", keyMsg(0, 29), contract.RecordingEvent{}, false},
		{"typed text", text, contract.RecordingEvent{}, false},
		{"truncated", []byte{2, 0, 0}, contract.RecordingEvent{}, false},
	} {
		got, ok := ParseControl(c.msg)
		if ok != c.ok || !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: got %+v %v, want %+v %v", c.name, got, ok, c.want, c.ok)
		}
	}
}

func TestRecorderKeepsTouchesWithoutFlooding(t *testing.T) {
	b := &bucket{files: map[string][]byte{}}
	c := &clock{t: time.Now()}
	r := start(t, b, c)
	r.Control(touchMsg(0, 1, 100, 100))
	for i := range 30 {
		c.add(10 * time.Millisecond)
		r.Control(touchMsg(2, 1, uint32(100+i), 100))
	}
	r.Control(touchMsg(1, 1, 130, 100))
	r.Control(keyMsg(0, 3))
	r.Stop(context.Background())
	var m contract.RecordingManifest
	if err := json.Unmarshal(b.get(t, "manifest.json"), &m); err != nil {
		t.Fatal(err)
	}
	var moves, downs, ups, keys int
	for line := range strings.SplitSeq(strings.TrimSpace(gunzip(t, b.get(t, m.Events[0].File))), "\n") {
		var ev contract.RecordingEvent
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			t.Fatal(err)
		}
		switch {
		case ev.Key == "home":
			keys++
		case ev.Touch != nil && ev.Touch.Action == contract.TouchDown:
			downs++
		case ev.Touch != nil && ev.Touch.Action == contract.TouchMove:
			moves++
		case ev.Touch != nil && ev.Touch.Action == contract.TouchUp:
			ups++
		}
	}
	if downs != 1 || ups != 1 || keys != 1 || moves < 6 || moves > 9 {
		t.Fatalf("down %d move %d up %d key %d", downs, moves, ups, keys)
	}
}

func opusHead(channels byte) []byte {
	h := make([]byte, 19)
	copy(h, "OpusHead")
	h[8], h[9] = 1, channels
	return h
}

// feedAudio sends n 20 ms packets whose times start at from µs.
func feedAudio(r *Recorder, c *clock, from int64, n int) int64 {
	pts := from
	for range n {
		r.Audio(Packet{PTS: pts, Data: bytes.Repeat([]byte{byte(pts / 20_000)}, 120)})
		pts += 20_000
		c.add(20 * time.Millisecond)
	}
	return pts
}

func TestRecorderWritesAudio(t *testing.T) {
	b := &bucket{files: map[string][]byte{}}
	c := &clock{t: time.Now()}
	r := start(t, b, c)
	c.add(300 * time.Millisecond)

	r.Audio(Packet{Config: true, Data: opusHead(2)})
	feedAudio(r, c, 7_000_000, 1250)
	r.AudioBreak()
	c.add(2 * time.Second)
	r.Audio(Packet{Config: true, Data: opusHead(1)})
	feedAudio(r, c, 90_000, 100)
	r.Stop(context.Background())

	var m contract.RecordingManifest
	if err := json.Unmarshal(b.get(t, "manifest.json"), &m); err != nil {
		t.Fatal(err)
	}
	if len(m.Audio) != 2 || m.Audio[0].Codec != "opus" || m.Audio[0].Channels != 2 || m.Audio[0].Rate != 48000 || m.Audio[1].Channels != 1 {
		t.Fatalf("audio: %+v", m.Audio)
	}
	first := m.Audio[0].Segments
	if len(first) != 3 || first[0].Start != 300 {
		t.Fatalf("a 25 s run in 10 s segments starting at 300 ms: %+v", first)
	}
	for i, s := range first {
		if !s.Key || s.Size == 0 || (i < 2 && s.Duration != 10_000) {
			t.Fatalf("segment %d: %+v", i, s)
		}
		if i > 0 && s.Start != first[i-1].Start+first[i-1].Duration {
			t.Fatalf("segment %d leaves a gap: %+v after %+v", i, s, first[i-1])
		}
	}
	if second := m.Audio[1].Segments; len(second) != 1 || second[0].Start < first[2].Start+first[2].Duration+1500 {
		t.Fatalf("the second run starts after the break: %+v", second)
	}

	var init fmp4.Init
	if err := init.Unmarshal(bytes.NewReader(b.get(t, m.Audio[0].Init))); err != nil {
		t.Fatal(err)
	}
	if op, ok := init.Tracks[0].Codec.(*codecs.Opus); !ok || op.ChannelCount != 2 || init.Tracks[0].TimeScale != 48000 {
		t.Fatalf("init: %+v", init.Tracks[0])
	}
	var parts fmp4.Parts
	if err := parts.Unmarshal(b.get(t, first[0].File)); err != nil {
		t.Fatal(err)
	}
	var samples, ticks int
	for _, tr := range parts[0].Tracks {
		for _, s := range tr.Samples {
			samples++
			ticks += int(s.Duration)
		}
	}
	if samples != 500 || ticks != 500*960 {
		t.Fatalf("a segment holds %d packets of %d ticks", samples, ticks)
	}
}

func TestRecorderIgnoresSoundBeforeItsConfig(t *testing.T) {
	b := &bucket{files: map[string][]byte{}}
	c := &clock{t: time.Now()}
	r := start(t, b, c)
	feedAudio(r, c, 0, 20)
	r.Stop(context.Background())
	var m contract.RecordingManifest
	if err := json.Unmarshal(b.get(t, "manifest.json"), &m); err != nil {
		t.Fatal(err)
	}
	if len(m.Audio) != 0 {
		t.Fatalf("sound without a config: %+v", m.Audio)
	}
}

func TestTapReadsAnAudioSocket(t *testing.T) {
	var got []Packet
	tap := &Tap{Audio: true, OnPacket: func(p Packet) { got = append(got, p) }}
	stream := []byte("opus")
	for _, p := range []Packet{{Config: true, Data: opusHead(2)}, {PTS: 20_000, Data: []byte("frame")}} {
		h := make([]byte, 12)
		flags := uint64(p.PTS)
		if p.Config {
			flags = 1 << 63
		}
		binary.BigEndian.PutUint64(h, flags)
		binary.BigEndian.PutUint32(h[8:], uint32(len(p.Data)))
		stream = append(append(stream, h...), p.Data...)
	}
	for i := range stream {
		_, _ = tap.Write(stream[i : i+1])
	}
	if len(got) != 2 || !got[0].Config || got[1].PTS != 20_000 || string(got[1].Data) != "frame" {
		t.Fatalf("packets: %+v", got)
	}

	quiet := &Tap{Audio: true, OnPacket: func(Packet) { t.Fatal("a stream with no audio produced a packet") }}
	_, _ = quiet.Write([]byte{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0})
	if quiet.Codec != "" {
		t.Fatalf("codec of a disabled stream: %q", quiet.Codec)
	}
}

func TestRecorderWritesDevTools(t *testing.T) {
	b := &bucket{files: map[string][]byte{}}
	c := &clock{t: time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)}
	srv := httptest.NewServer(b)
	t.Cleanup(srv.Close)
	cfg := DefaultConfig()
	cfg.Flush, cfg.MaxDevTools = time.Hour, 400
	r := Start(contract.RecordingTarget{ID: "x", URL: srv.URL + "/rec"}, cfg, slog.New(slog.DiscardHandler), WithClock(c.now))

	c.add(3 * time.Second)
	r.DevTools(contract.DevToolsEntry{Type: contract.DevToolsPageEntry, Page: &contract.DevToolsPage{URL: "https://shop.example/"}})
	r.DevTools(contract.DevToolsEntry{T: 1200, Type: contract.DevToolsRequestEntry, Request: &contract.DevToolsRequest{ID: "1", Start: 1000, End: 1200, URL: "https://shop.example/a"}})
	for range 10 {
		r.DevTools(contract.DevToolsEntry{Type: contract.DevToolsConsoleEntry, Console: &contract.DevToolsConsole{Text: strings.Repeat("x", 60)}})
	}
	r.Stop(context.Background())

	var m contract.RecordingManifest
	if err := json.Unmarshal(b.get(t, "manifest.json"), &m); err != nil {
		t.Fatal(err)
	}
	if len(m.DevTools) != 1 || m.DevTools[0].File != "devtools-1.jsonl.gz" || m.DevTools[0].Start != 1200 || m.DevTools[0].End != 3000 {
		t.Fatalf("devtools chunks: %+v", m.DevTools)
	}
	var lines []contract.DevToolsEntry
	for line := range strings.Lines(gunzip(t, b.get(t, m.DevTools[0].File))) {
		var e contract.DevToolsEntry
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			t.Fatalf("%q: %v", line, err)
		}
		lines = append(lines, e)
	}
	last := lines[len(lines)-1]
	if lines[0].T != 3000 || lines[1].T != 1200 || last.Type != contract.DevToolsDroppedEntry || last.Dropped == 0 {
		t.Fatalf("lines: %+v", lines)
	}
}

func TestRecorderTellsOfFingersGoingDown(t *testing.T) {
	b := &bucket{files: map[string][]byte{}}
	srv := httptest.NewServer(b)
	t.Cleanup(srv.Close)
	c := &clock{t: time.Now()}
	downs := make(chan int64, 4)
	cfg := DefaultConfig()
	cfg.Flush = time.Hour
	r := Start(contract.RecordingTarget{ID: "x", URL: srv.URL + "/rec"}, cfg, slog.New(slog.DiscardHandler), WithClock(c.now),
		OnTouch(func(at int64) { downs <- at }))
	c.add(1200 * time.Millisecond)
	r.Control(touchMsg(0, 1, 100, 100))
	r.Control(touchMsg(2, 1, 110, 100))
	r.Control(touchMsg(1, 1, 120, 100))
	select {
	case at := <-downs:
		if at != 1200 {
			t.Fatalf("down at %d", at)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no touch-down")
	}
	select {
	case at := <-downs:
		t.Fatalf("a second call at %d for moves or ups", at)
	case <-time.After(50 * time.Millisecond):
	}
	r.Stop(context.Background())
}
