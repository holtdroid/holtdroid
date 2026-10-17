// Package adbproto reads and writes packets of the adb transport protocol
// (the one adbd speaks over TCP), as documented in AOSP's protocol.txt.
package adbproto

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

const (
	CNXN uint32 = 0x4e584e43
	AUTH uint32 = 0x48545541
	OPEN uint32 = 0x4e45504f
	OKAY uint32 = 0x59414b4f
	CLSE uint32 = 0x45534c43
	WRTE uint32 = 0x45545257
	STLS uint32 = 0x534c5453
)

// Version skips payload checksums when both sides speak it.
const Version uint32 = 0x01000001

// MaxPayload is the largest payload adbd negotiates.
const MaxPayload = 1 << 20

const headerSize = 24

type Packet struct {
	Command uint32
	Arg0    uint32
	Arg1    uint32
	Payload []byte
}

// Service is the service name an OPEN packet asks for.
func (p Packet) Service() string {
	return string(bytes.TrimRight(p.Payload, "\x00"))
}

func Read(r io.Reader) (Packet, error) {
	var h [headerSize]byte
	if _, err := io.ReadFull(r, h[:]); err != nil {
		return Packet{}, err
	}
	le := binary.LittleEndian
	p := Packet{Command: le.Uint32(h[0:]), Arg0: le.Uint32(h[4:]), Arg1: le.Uint32(h[8:])}
	n := le.Uint32(h[12:])
	if le.Uint32(h[20:]) != p.Command^0xffffffff {
		return Packet{}, errors.New("adb: bad packet magic")
	}
	if n > MaxPayload {
		return Packet{}, fmt.Errorf("adb: payload of %d bytes", n)
	}
	if n > 0 {
		p.Payload = make([]byte, n)
		if _, err := io.ReadFull(r, p.Payload); err != nil {
			return Packet{}, err
		}
	}
	return p, nil
}

// Marshal encodes p with its checksum, which newer peers ignore.
func Marshal(p Packet) []byte {
	b := make([]byte, headerSize+len(p.Payload))
	le := binary.LittleEndian
	le.PutUint32(b[0:], p.Command)
	le.PutUint32(b[4:], p.Arg0)
	le.PutUint32(b[8:], p.Arg1)
	le.PutUint32(b[12:], uint32(len(p.Payload)))
	var sum uint32
	for _, c := range p.Payload {
		sum += uint32(c)
	}
	le.PutUint32(b[16:], sum)
	le.PutUint32(b[20:], p.Command^0xffffffff)
	copy(b[headerSize:], p.Payload)
	return b
}

// Write sends p in pieces of at most chunk bytes (all at once when chunk is
// 0), so message-based transports never carry more than that at a time.
func Write(w io.Writer, p Packet, chunk int) error {
	b := Marshal(p)
	if chunk <= 0 {
		chunk = len(b)
	}
	for len(b) > 0 {
		n := min(chunk, len(b))
		if _, err := w.Write(b[:n]); err != nil {
			return err
		}
		b = b[n:]
	}
	return nil
}

// Connect does the host side of the handshake with a daemon that needs no
// authentication and returns its banner.
func Connect(rw io.ReadWriter) (string, error) {
	if err := Write(rw, Packet{Command: CNXN, Arg0: Version, Arg1: MaxPayload, Payload: []byte("host::\x00")}, 0); err != nil {
		return "", err
	}
	p, err := Read(rw)
	if err != nil {
		return "", err
	}
	if p.Command != CNXN {
		return "", fmt.Errorf("adb: expected CNXN, got %#x", p.Command)
	}
	return p.Service(), nil
}
