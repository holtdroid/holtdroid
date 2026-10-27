package agent

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/recording"
)

const recordAudioBitRate = 96_000

// soundHub gives a recording the sound stream of the newest viewer who listens,
// so the device is captured once. Without one it captures for the recording
// alone, unless the device can't (Android 11, or no audio device): then it
// finds out once and leaves the recording silent. Phones capture for the
// whole session already and feed the recording from that.
type soundHub struct {
	s    *Scrcpy
	keep bool

	mu          sync.Mutex
	ctx         context.Context
	rec         *recording.Recorder
	feeds       []*soundFeed
	active      *soundFeed
	own         context.CancelFunc
	unsupported bool
	keptConfig  *recording.Packet
}

type soundFeed struct {
	tap    recording.Tap
	config *recording.Packet
}

func newSoundHub(s *Scrcpy, keep bool) *soundHub {
	return &soundHub{s: s, keep: keep, ctx: context.Background()}
}

func (h *soundHub) feed() *soundFeed {
	f := &soundFeed{}
	f.tap.Audio = true
	f.tap.OnPacket = func(p recording.Packet) { h.packet(f, p) }
	return f
}

// open adds the sound socket of a viewer; the recording takes it over.
func (h *soundHub) open() *soundFeed {
	f := h.feed()
	h.mu.Lock()
	defer h.mu.Unlock()
	h.feeds = append(h.feeds, f)
	if h.rec != nil {
		h.activate(f)
	}
	return f
}

func (h *soundHub) close(f *soundFeed) {
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

func (h *soundHub) attach(ctx context.Context, rec *recording.Recorder) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.ctx, h.rec = ctx, rec
	if h.keep {
		if h.keptConfig != nil {
			rec.Audio(*h.keptConfig)
		}
		return
	}
	h.pick()
}

func (h *soundHub) detach(rec *recording.Recorder) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rec != rec {
		return
	}
	h.rec, h.active = nil, nil
	h.stopOwn()
}

func (h *soundHub) pick() {
	if n := len(h.feeds); n > 0 {
		h.activate(h.feeds[n-1])
		return
	}
	h.active = nil
	h.rec.AudioBreak()
	if !h.unsupported {
		h.startOwn()
	}
}

func (h *soundHub) activate(f *soundFeed) {
	h.stopOwn()
	h.active = f
	h.rec.AudioBreak()
	if f.config != nil {
		h.rec.Audio(*f.config)
	}
}

func (h *soundHub) packet(f *soundFeed, p recording.Packet) {
	h.mu.Lock()
	if p.Config {
		f.config = &p
	}
	rec := h.rec
	if h.active != f {
		rec = nil
	}
	h.mu.Unlock()
	if rec != nil {
		rec.Audio(p)
	}
}

// kept receives the packets of the session-long capture phones keep running.
func (h *soundHub) kept(p recording.Packet) {
	h.mu.Lock()
	if p.Config {
		h.keptConfig = &p
	}
	rec := h.rec
	h.mu.Unlock()
	if rec != nil {
		rec.Audio(p)
	}
}

func (h *soundHub) keptBroke() {
	h.mu.Lock()
	rec := h.rec
	h.mu.Unlock()
	if rec != nil {
		rec.AudioBreak()
	}
}

func (h *soundHub) stopOwn() {
	if h.own != nil {
		h.own()
		h.own = nil
	}
}

// startOwn captures the sound for the recording alone until a viewer comes
// or the recording stops, starting again, ever more slowly, when it breaks.
func (h *soundHub) startOwn() {
	ctx, cancel := context.WithCancel(h.ctx)
	h.own = cancel
	f := h.feed()
	h.active = f
	go func() {
		opts := h.s.audioOpts(ctx, fmt.Sprintf("audio_bit_rate=%d", recordAudioBitRate))
		wait := 5 * time.Second
		for ctx.Err() == nil {
			conns, err := h.s.start(ctx, opts, 1)
			if err == nil {
				go func() {
					<-ctx.Done()
					conns[0].Close()
				}()
				_, _ = io.Copy(&f.tap, conns[0])
				conns[0].Close()
				if f.tap.Ready() && !recording.AudioCodec(f.tap.Codec) {
					h.mu.Lock()
					h.unsupported = true
					h.mu.Unlock()
					h.s.log.Info("this device can't capture sound, so its recordings have none")
					return
				}
				if f.tap.Ready() {
					wait = 5 * time.Second
				}
			} else if ctx.Err() == nil {
				h.s.log.Warn("recording sound", "err", err)
			}
			h.mu.Lock()
			if h.active == f && h.rec != nil {
				h.rec.AudioBreak()
			}
			f.tap = recording.Tap{Audio: true, OnPacket: f.tap.OnPacket}
			h.mu.Unlock()
			select {
			case <-ctx.Done():
			case <-time.After(wait):
			}
			wait = min(wait*2, time.Minute)
		}
	}()
}

// keptPacket turns a packet read by the audio hub into the recorder's kind.
func keptPacket(codec string, head, data []byte) recording.Packet {
	flags := binary.BigEndian.Uint64(head)
	return recording.Packet{
		Codec:  codec,
		Config: flags&configFlag != 0,
		PTS:    int64(flags & (1<<62 - 1)),
		Data:   data,
	}
}
