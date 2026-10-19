package fake

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/binary"
	"io"
	"net/http"
	"time"

	"github.com/coder/websocket"

	"github.com/kriakiku/holtdroid/internal/contract"
)

//go:embed testdata/screen.h264
var screenH264 []byte

const (
	screenWidth  = 360
	screenHeight = 640
	screenFPS    = 10
)

type screenPacket struct {
	config, key bool
	data        []byte
}

var screenPackets = splitH264(screenH264)

// splitH264 turns an Annex B stream into scrcpy packets: SPS/PPS make the
// config packet, every picture its own packet.
func splitH264(stream []byte) []screenPacket {
	var nals [][]byte
	for part := range bytes.SplitSeq(stream, []byte{0, 0, 1}) {
		part = bytes.TrimRight(part, "\x00")
		if len(part) > 0 {
			nals = append(nals, append([]byte{0, 0, 0, 1}, part...))
		}
	}
	var packets []screenPacket
	var config, sent, pending []byte
	for _, nal := range nals {
		switch typ := nal[4] & 0x1f; typ {
		case 7, 8:
			config = append(config, nal...)
		case 1, 5:
			if config != nil && !bytes.Equal(config, sent) {
				packets = append(packets, screenPacket{config: true, data: config})
				sent = config
			}
			config = nil
			packets = append(packets, screenPacket{key: typ == 5, data: append(pending, nal...)})
			pending = nil
		default:
			pending = append(pending, nal...)
		}
	}
	return packets
}

// serveScreen speaks the agent's /display/scrcpy protocol with a looping
// H.264 recording instead of a device. Control messages are dropped except
// the recents key, which closes the app like the agent action does, and
// back-or-screen-on (a right-click), which wakes the screen.
func (d *device) serveScreen(w http.ResponseWriter, r *http.Request) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer func() { _ = ws.CloseNow() }()
	if codec := r.URL.Query().Get("codec"); codec != "" && codec != "h264" {
		_ = ws.Close(contract.DisplayUnsupportedCodec, "this device has no "+codec+" encoder")
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		defer cancel()
		for {
			_, msg, err := ws.Read(ctx)
			if err != nil {
				return
			}
			switch {
			case isRecentsKey(msg):
				d.update(func() { d.appClosed = true })
			case isWake(msg):
				d.update(func() { d.screen.On = true })
			}
		}
	}()

	meta := make([]byte, 64+12)
	copy(meta, "Holtdroid fake device")
	copy(meta[64:], "h264")
	binary.BigEndian.PutUint32(meta[68:], screenWidth)
	binary.BigEndian.PutUint32(meta[72:], screenHeight)
	if ws.Write(ctx, websocket.MessageBinary, meta) != nil {
		return
	}

	tick := time.NewTicker(time.Second / screenFPS)
	defer tick.Stop()
	var pts uint64
	for {
		for _, p := range screenPackets {
			if !p.config {
				select {
				case <-ctx.Done():
					return
				case <-tick.C:
				}
				pts += uint64(time.Second/time.Microsecond) / screenFPS
			}
			if writePacket(ctx, ws, p, pts) != nil {
				return
			}
		}
	}
}

// isRecentsKey matches an inject-keycode control message releasing
// KEYCODE_APP_SWITCH.
func isRecentsKey(msg []byte) bool {
	return len(msg) == 14 && msg[0] == 0 && msg[1] == 1 && binary.BigEndian.Uint32(msg[2:]) == 187
}

// isWake matches a back-or-screen-on control message.
func isWake(msg []byte) bool {
	return len(msg) == 2 && msg[0] == 4
}

// serveAudio answers /display/audio like a device that can't capture audio.
func serveAudio(w http.ResponseWriter, r *http.Request) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer func() { _ = ws.CloseNow() }()
	if ws.Write(r.Context(), websocket.MessageBinary, []byte{0, 0, 0, 0}) != nil {
		return
	}
	for {
		if _, _, err := ws.Read(r.Context()); err != nil {
			return
		}
	}
}

func writePacket(ctx context.Context, ws *websocket.Conn, p screenPacket, pts uint64) error {
	w, err := ws.Writer(ctx, websocket.MessageBinary)
	if err != nil {
		return err
	}
	header := make([]byte, 12)
	flags := pts
	if p.config {
		flags = 1 << 63
	}
	if p.key {
		flags |= 1 << 62
	}
	binary.BigEndian.PutUint64(header, flags)
	binary.BigEndian.PutUint32(header[8:], uint32(len(p.data)))
	if _, err := w.Write(header); err != nil {
		return err
	}
	if _, err := io.Copy(w, bytes.NewReader(p.data)); err != nil {
		return err
	}
	return w.Close()
}
