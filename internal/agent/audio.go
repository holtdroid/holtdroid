package agent

import (
	"context"
	"encoding/binary"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/holtdroid/holtdroid/internal/recording"
)

// audioHub keeps one audio capture running for the whole session and fans
// it out to every /display/audio viewer. While scrcpy captures the output,
// Android doesn't play it on the device, so a phone stays silent in the room
// even when nobody listens.
type audioHub struct {
	s *Scrcpy

	mu     sync.Mutex
	header []byte
	subs   map[chan []byte]struct{}
}

func newAudioHub(s *Scrcpy) *audioHub {
	return &audioHub{s: s, subs: map[chan []byte]struct{}{}}
}

const configFlag = uint64(1) << 63

// run captures until ctx ends, starting the capture again when it stops.
func (h *audioHub) run(ctx context.Context) {
	for ctx.Err() == nil {
		if err := h.capture(ctx); err != nil && ctx.Err() == nil {
			h.s.log.Warn("audio capture", "err", err)
		}
		h.s.sound.keptBroke()
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

func (h *audioHub) capture(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	conns, err := h.s.start(ctx, h.s.audioOpts(ctx, ""), 1)
	if err != nil {
		return err
	}
	stream := conns[0]
	defer stream.Close()
	go func() {
		<-ctx.Done()
		stream.Close()
	}()
	codec := make([]byte, 4)
	if _, err := io.ReadFull(stream, codec); err != nil {
		return err
	}
	for {
		head := make([]byte, 12)
		if _, err := io.ReadFull(stream, head); err != nil {
			return err
		}
		packet := make([]byte, 12+int(binary.BigEndian.Uint32(head[8:])))
		copy(packet, head)
		if _, err := io.ReadFull(stream, packet[12:]); err != nil {
			return err
		}
		if c := strings.TrimRight(string(codec), "\x00"); recording.AudioCodec(c) {
			h.s.sound.kept(keptPacket(c, head, packet[12:]))
		}
		if binary.BigEndian.Uint64(head)&configFlag != 0 {
			h.mu.Lock()
			h.header = append(append([]byte{}, codec...), packet...)
			h.mu.Unlock()
			continue
		}
		h.publish(packet)
	}
}

func (h *audioHub) publish(packet []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- packet:
		default:
		}
	}
}

func (h *audioHub) subscribe() (chan []byte, []byte, func()) {
	ch := make(chan []byte, 64)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	header := h.header
	h.mu.Unlock()
	return ch, header, func() {
		h.mu.Lock()
		delete(h.subs, ch)
		h.mu.Unlock()
	}
}

func (h *audioHub) serve(w http.ResponseWriter, r *http.Request) {
	ws, ctx, cancel, ok := accept(w, r)
	if !ok {
		return
	}
	defer cancel()
	defer func() { _ = ws.CloseNow() }()
	go func() {
		defer cancel()
		for {
			if _, _, err := ws.Read(ctx); err != nil {
				return
			}
		}
	}()
	ch, header, unsubscribe := h.subscribe()
	defer unsubscribe()
	for header == nil {
		select {
		case <-ctx.Done():
			return
		case <-ch:
		case <-time.After(15 * time.Second):
			_ = ws.Close(websocket.StatusTryAgainLater, "audio is not available yet")
			return
		}
		h.mu.Lock()
		header = h.header
		h.mu.Unlock()
	}
	if err := ws.Write(ctx, websocket.MessageBinary, header); err != nil {
		return
	}
	for {
		select {
		case <-ctx.Done():
			return
		case packet := <-ch:
			if err := ws.Write(ctx, websocket.MessageBinary, packet); err != nil {
				return
			}
		}
	}
}
