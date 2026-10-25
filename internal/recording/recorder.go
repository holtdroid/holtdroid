// Package recording records a session on the agent's side: the screen as
// fragmented MP4 segments taken from a scrcpy H.264 stream, the device's
// state as JSON lines and logcat as text, all uploaded to the api as they
// are written (decision #96).
package recording

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

type Config struct {
	// Segment is the shortest video segment; one ends at the first key frame
	// after it.
	Segment time.Duration
	// MaxSegment and MaxSegmentSize end a segment without a key frame.
	MaxSegment     time.Duration
	MaxSegmentSize int
	// Flush is how often events and logcat are uploaded with the manifest.
	Flush time.Duration
	// MaxBacklog stops the recording when this many bytes wait for upload.
	MaxBacklog int
	// MaxLogcat caps the logcat kept per flush; the rest is dropped with a
	// note.
	MaxLogcat int
}

func DefaultConfig() Config {
	return Config{
		Segment: 2 * time.Second, MaxSegment: 20 * time.Second, MaxSegmentSize: 16 << 20,
		Flush: 10 * time.Second, MaxBacklog: 256 << 20, MaxLogcat: 8 << 20,
	}
}

// Packet is one scrcpy video packet: a config packet (SPS and PPS) or a
// picture, in Annex B, with its presentation time in microseconds.
type Packet struct {
	Config bool
	Key    bool
	PTS    int64
	Data   []byte
}

var ErrStopped = errors.New("the recording has stopped")

// Recorder writes one recording. Its methods are safe for concurrent use;
// after Stop they do nothing.
type Recorder struct {
	cfg    Config
	now    func() time.Time
	log    *slog.Logger
	up     *uploader
	start  time.Time
	onStop func(contract.RecordingState)

	mu       sync.Mutex
	stopped  bool
	err      error
	manifest contract.RecordingManifest
	dirty    bool
	video    video
	events   chunk
	logcat   chunk
	moved    map[int]int64
	quit     chan struct{}
	loopDone chan struct{}
}

type Option func(*Recorder)

func WithClock(now func() time.Time) Option { return func(r *Recorder) { r.now = now } }

func WithHTTPClient(hc *http.Client) Option { return func(r *Recorder) { r.up.hc = hc } }

// OnStop is called once the recording has stopped, by Stop or on its own.
func OnStop(f func(contract.RecordingState)) Option { return func(r *Recorder) { r.onStop = f } }

func Start(target contract.RecordingTarget, cfg Config, log *slog.Logger, opts ...Option) *Recorder {
	r := &Recorder{
		cfg:      cfg,
		now:      time.Now,
		log:      log.With("recording", target.ID),
		moved:    map[int]int64{},
		quit:     make(chan struct{}),
		loopDone: make(chan struct{}),
	}
	r.up = newUploader(target.URL, cfg.MaxBacklog, r.log)
	for _, o := range opts {
		o(r)
	}
	r.start = r.now()
	r.video.epoch = -1
	r.manifest = contract.RecordingManifest{
		State: contract.RecordingActive, StartedAt: r.start.UTC(), UpdatedAt: r.start.UTC(),
		Epochs: []contract.RecordingEpoch{}, Events: []contract.RecordingChunk{}, Logcat: []contract.RecordingChunk{},
	}
	r.dirty = true
	go r.up.run(r.fail)
	go r.loop()
	return r
}

func (r *Recorder) elapsed() int64 { return r.now().Sub(r.start).Milliseconds() }

func (r *Recorder) State() contract.RecordingState {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.stateLocked()
}

func (r *Recorder) stateLocked() contract.RecordingState {
	s := contract.RecordingState{
		Active:    !r.stopped,
		StartedAt: r.start.UTC(),
		Duration:  r.manifest.Duration,
		Size:      r.manifest.Size,
	}
	if !r.stopped {
		s.Duration = r.elapsed()
	}
	if r.err != nil {
		s.Error = r.err.Error()
	}
	return s
}

func (r *Recorder) loop() {
	defer close(r.loopDone)
	t := time.NewTicker(r.cfg.Flush)
	defer t.Stop()
	for {
		select {
		case <-r.quit:
			return
		case <-t.C:
			r.mu.Lock()
			if !r.stopped {
				r.flushChunks()
				r.uploadManifest()
			}
			r.mu.Unlock()
		}
	}
}

// Event adds a line to the events at the current recording time.
func (r *Recorder) Event(ev contract.RecordingEvent) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stopped {
		return
	}
	r.eventLocked(ev)
}

func (r *Recorder) eventLocked(ev contract.RecordingEvent) {
	ev.T = r.elapsed()
	line, err := json.Marshal(ev)
	if err != nil {
		return
	}
	r.events.write(ev.T, append(line, '\n'), 0)
}

// Logcat adds one logcat line, stamped with the recording time.
func (r *Recorder) Logcat(line string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stopped {
		return
	}
	t := r.elapsed()
	r.logcat.write(t, []byte(Clock(t)+"  "+line+"\n"), r.cfg.MaxLogcat)
}

// Clock formats milliseconds as HH:MM:SS.mmm.
func Clock(ms int64) string {
	return fmt.Sprintf("%02d:%02d:%02d.%03d", ms/3_600_000, ms/60_000%60, ms/1000%60, ms%1000)
}

func (r *Recorder) Thumbnail(jpeg []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stopped {
		return
	}
	r.put("thumb.jpg", jpeg)
	r.manifest.Thumbnail = "thumb.jpg"
	r.dirty = true
}

// Stop ends the recording, uploads what is left and waits for the uploads
// until ctx ends.
func (r *Recorder) Stop(ctx context.Context) contract.RecordingState {
	r.mu.Lock()
	if !r.stopped {
		r.finish(contract.RecordingDone, "")
	}
	r.mu.Unlock()
	r.up.wait(ctx)
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.stateLocked()
}

// fail stops the recording because an upload can't go on.
func (r *Recorder) fail(err error) {
	r.mu.Lock()
	if r.stopped {
		r.mu.Unlock()
		return
	}
	r.log.Warn("recording stopped", "err", err)
	r.err = err
	r.finish(contract.RecordingFailed, err.Error())
	r.mu.Unlock()
}

func (r *Recorder) finish(state contract.RecordingStatus, reason string) {
	r.closeSegment()
	r.flushChunks()
	r.manifest.State = state
	r.manifest.Reason = reason
	r.manifest.Duration = r.elapsed()
	r.dirty = true
	r.uploadManifest()
	r.stopped = true
	r.up.close()
	close(r.quit)
	if r.onStop != nil {
		s := r.stateLocked()
		go r.onStop(s)
	}
}

func (r *Recorder) put(name string, data []byte) {
	r.manifest.Size += int64(len(data))
	r.up.add(name, data)
}

func (r *Recorder) uploadManifest() {
	if !r.dirty {
		return
	}
	r.manifest.UpdatedAt = r.now().UTC()
	if r.manifest.State == contract.RecordingActive {
		r.manifest.Duration = r.elapsed()
	}
	data, err := json.Marshal(r.manifest)
	if err != nil {
		return
	}
	r.up.add("manifest.json", data)
	r.dirty = false
}

// chunk collects gzipped lines until the next flush.
type chunk struct {
	buf     bytes.Buffer
	zw      *gzip.Writer
	start   int64
	end     int64
	lines   int
	raw     int
	dropped int
	seq     int
}

func (c *chunk) write(t int64, line []byte, limit int) {
	if limit > 0 && c.raw+len(line) > limit {
		c.dropped++
		return
	}
	if c.zw == nil {
		c.buf.Reset()
		c.zw, _ = gzip.NewWriterLevel(&c.buf, gzip.BestSpeed)
		c.start = t
	}
	_, _ = c.zw.Write(line)
	c.end = t
	c.lines++
	c.raw += len(line)
}

func (c *chunk) take(t int64) (data []byte, meta contract.RecordingChunk, ok bool) {
	if c.dropped > 0 {
		note := fmt.Sprintf("%s  -- %d lines dropped: more than %d bytes in one upload --\n", Clock(t), c.dropped, c.raw)
		c.dropped = 0
		c.write(t, []byte(note), 0)
	}
	if c.zw == nil {
		return nil, meta, false
	}
	_ = c.zw.Close()
	c.zw = nil
	c.seq++
	data = bytes.Clone(c.buf.Bytes())
	meta = contract.RecordingChunk{Start: c.start, End: c.end, Size: int64(len(data)), Lines: c.lines}
	c.lines, c.raw = 0, 0
	return data, meta, true
}

func (r *Recorder) flushChunks() {
	t := r.elapsed()
	if data, meta, ok := r.events.take(t); ok {
		meta.File = fmt.Sprintf("events-%d.jsonl.gz", r.events.seq)
		meta.Lines = 0
		r.put(meta.File, data)
		r.manifest.Events = append(r.manifest.Events, meta)
		r.dirty = true
	}
	if data, meta, ok := r.logcat.take(t); ok {
		meta.File = fmt.Sprintf("logcat-%d.log.gz", r.logcat.seq)
		r.put(meta.File, data)
		r.manifest.Logcat = append(r.manifest.Logcat, meta)
		r.dirty = true
	}
}
