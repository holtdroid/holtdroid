package agent

import (
	"context"
	"io"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/recording"
)

// videoHub hands a recording the H.264 stream of the newest viewer, so the
// device encodes the screen once. Without such a viewer it runs a stream of
// its own at the recording's settings.
type videoHub struct {
	s   *Scrcpy
	ctx context.Context

	mu     sync.Mutex
	rec    *recording.Recorder
	feeds  []*videoFeed
	active *videoFeed
	own    context.CancelFunc
}

type videoFeed struct {
	hub    *videoHub
	tap    recording.Tap
	config []byte
}

func newVideoHub(s *Scrcpy) *videoHub {
	return &videoHub{s: s, ctx: context.Background()}
}

func (h *videoHub) feed() *videoFeed {
	f := &videoFeed{hub: h}
	f.tap.OnPacket = func(p recording.Packet) { h.packet(f, p) }
	return f
}

// open adds a viewer's stream; the recording switches to it right away, as
// it starts with its config packet and a key frame.
func (h *videoHub) open() *videoFeed {
	f := h.feed()
	h.mu.Lock()
	defer h.mu.Unlock()
	h.feeds = append(h.feeds, f)
	if h.rec != nil {
		h.activate(f)
	}
	return f
}

func (h *videoHub) close(f *videoFeed) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for i, x := range h.feeds {
		if x == f {
			h.feeds = append(h.feeds[:i], h.feeds[i+1:]...)
			break
		}
	}
	if h.active == f && h.rec != nil {
		h.pick()
	}
}

func (h *videoHub) attach(ctx context.Context, rec *recording.Recorder) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.ctx, h.rec = ctx, rec
	h.pick()
}

func (h *videoHub) detach(rec *recording.Recorder) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rec != rec {
		return
	}
	h.rec, h.active = nil, nil
	h.stopOwn()
}

func (h *videoHub) pick() {
	if n := len(h.feeds); n > 0 {
		h.activate(h.feeds[n-1])
		return
	}
	h.active = nil
	h.rec.Break()
	h.startOwn()
}

func (h *videoHub) activate(f *videoFeed) {
	h.stopOwn()
	h.active = f
	h.rec.Break()
	if f.config != nil {
		h.rec.Video(recording.Packet{Config: true, Data: f.config})
	}
}

func (h *videoHub) packet(f *videoFeed, p recording.Packet) {
	h.mu.Lock()
	if p.Config {
		f.config = p.Data
	}
	rec := h.rec
	if h.active != f {
		rec = nil
	}
	h.mu.Unlock()
	if rec != nil {
		rec.Video(p)
	}
}

func (h *videoHub) stopOwn() {
	if h.own != nil {
		h.own()
		h.own = nil
	}
}

// startOwn runs the recording's own stream until a viewer comes or the
// recording stops, starting it again when it breaks.
func (h *videoHub) startOwn() {
	ctx, cancel := context.WithCancel(h.ctx)
	h.own = cancel
	f := h.feed()
	h.active = f
	cfg := h.s.cfg.Record
	opts := videoOpts("h264", cfg.BitRate, cfg.MaxFPS, cfg.MaxSize) + " control=false"
	go func() {
		for ctx.Err() == nil {
			conns, err := h.s.start(ctx, opts, 1)
			if err == nil {
				go func() {
					<-ctx.Done()
					conns[0].Close()
				}()
				_, _ = io.Copy(&f.tap, conns[0])
				conns[0].Close()
			} else if ctx.Err() == nil {
				h.s.log.Warn("recording stream", "err", err)
			}
			h.mu.Lock()
			if h.active == f && h.rec != nil {
				h.rec.Break()
			}
			f.tap = recording.Tap{OnPacket: f.tap.OnPacket}
			h.mu.Unlock()
			select {
			case <-ctx.Done():
			case <-time.After(5 * time.Second):
			}
		}
	}()
}
