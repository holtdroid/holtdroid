package recording

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/jpeg"
	_ "image/png"

	"golang.org/x/image/draw"
)

const maxPacket = 32 << 20

// Tap parses the bytes of a scrcpy video socket as they pass: the device
// name (64 bytes), the codec meta (codec id, width, height) and packets of
// a 12-byte header and their payload. A stream it can't follow is ignored
// from then on.
type Tap struct {
	OnPacket func(Packet)
	Codec    string

	buf    []byte
	meta   bool
	broken bool
}

func (t *Tap) Write(p []byte) (int, error) {
	if t.broken {
		return len(p), nil
	}
	t.buf = append(t.buf, p...)
	off := 0
	for {
		rest := t.buf[off:]
		if !t.meta {
			if len(rest) < 64+12 {
				break
			}
			t.Codec = string(bytes.TrimRight(rest[64:68], "\x00"))
			t.meta = true
			off += 64 + 12
			continue
		}
		if len(rest) < 12 {
			break
		}
		size := int(binary.BigEndian.Uint32(rest[8:]))
		if size > maxPacket {
			t.broken, t.buf = true, nil
			return len(p), nil
		}
		if len(rest) < 12+size {
			break
		}
		flags := binary.BigEndian.Uint64(rest)
		if t.OnPacket != nil && t.Codec == "h264" {
			t.OnPacket(Packet{
				Config: flags&(1<<63) != 0,
				Key:    flags&(1<<62) != 0,
				PTS:    int64(flags & (1<<62 - 1)),
				Data:   bytes.Clone(rest[12 : 12+size]),
			})
		}
		off += 12 + size
	}
	if off > 0 {
		t.buf = append(t.buf[:0], t.buf[off:]...)
	}
	return len(p), nil
}

// Thumbnail scales a screenshot (PNG or JPEG) to at most width pixels wide
// as a JPEG.
func Thumbnail(screenshot []byte, width int) ([]byte, error) {
	src, _, err := image.Decode(bytes.NewReader(screenshot))
	if err != nil {
		return nil, err
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w > width {
		w, h = width, max(1, h*width/w)
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)
	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 75}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
