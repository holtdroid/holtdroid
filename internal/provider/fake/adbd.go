package fake

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"net"
	"strings"
	"sync"

	"github.com/holtdroid/holtdroid/internal/adbproto"
)

const (
	adbdMaxPayload = 256 << 10
	adbdBanner     = "device::ro.product.name=sdk_gphone64_x86_64;ro.product.model=Fake Pixel 9;ro.product.device=emu64xa;features=shell_v2,cmd,fixed_push_mkdir"
)

// serveADB speaks the daemon side of the adb protocol on c, enough for the
// portal's ADB tools: shell (v1 and v2, with a pty), exec and sync.
func (d *device) serveADB(c net.Conn) {
	defer c.Close()
	p, err := adbproto.Read(c)
	if err != nil || p.Command != adbproto.CNXN {
		return
	}
	ac := &adbConn{d: d, conn: c, next: 1, streams: map[uint32]*adbStream{}}
	if ac.send(adbproto.Packet{Command: adbproto.CNXN, Arg0: adbproto.Version, Arg1: adbdMaxPayload, Payload: []byte(adbdBanner)}) != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stop := context.AfterFunc(ctx, func() { c.Close() })
	defer stop()
	go func() {
		select {
		case <-d.done:
			cancel()
		case <-ctx.Done():
		}
	}()
	for {
		p, err := adbproto.Read(c)
		if err != nil {
			break
		}
		switch p.Command {
		case adbproto.OPEN:
			ac.open(ctx, p)
		case adbproto.OKAY:
			if s := ac.stream(p.Arg1); s != nil {
				select {
				case s.ack <- struct{}{}:
				default:
				}
			}
		case adbproto.WRTE:
			if s := ac.stream(p.Arg1); s != nil {
				go s.deliver(p.Payload)
			}
		case adbproto.CLSE:
			if s := ac.stream(p.Arg1); s != nil {
				s.closeRemote()
			}
		}
	}
	ac.mu.Lock()
	streams := make([]*adbStream, 0, len(ac.streams))
	for _, s := range ac.streams {
		streams = append(streams, s)
	}
	ac.mu.Unlock()
	for _, s := range streams {
		s.closeRemote()
	}
}

type adbConn struct {
	d       *device
	conn    net.Conn
	wmu     sync.Mutex
	mu      sync.Mutex
	next    uint32
	streams map[uint32]*adbStream
}

func (ac *adbConn) send(p adbproto.Packet) error {
	ac.wmu.Lock()
	defer ac.wmu.Unlock()
	return adbproto.Write(ac.conn, p, 0)
}

func (ac *adbConn) stream(id uint32) *adbStream {
	ac.mu.Lock()
	defer ac.mu.Unlock()
	return ac.streams[id]
}

func (ac *adbConn) open(ctx context.Context, p adbproto.Packet) {
	handler := ac.d.adbService(p.Service())
	if handler == nil {
		_ = ac.send(adbproto.Packet{Command: adbproto.CLSE, Arg1: p.Arg0})
		return
	}
	pr, pw := io.Pipe()
	ctx, cancel := context.WithCancel(ctx)
	ac.mu.Lock()
	s := &adbStream{c: ac, local: ac.next, remote: p.Arg0, pr: pr, pw: pw, ack: make(chan struct{}, 1), ctx: ctx, cancel: cancel}
	ac.next++
	ac.streams[s.local] = s
	ac.mu.Unlock()
	if ac.send(adbproto.Packet{Command: adbproto.OKAY, Arg0: s.local, Arg1: s.remote}) != nil {
		return
	}
	go func() {
		handler(s)
		s.close()
	}()
}

// adbStream is one service connection; Write waits for the host's OKAY
// after every packet, as adbd does without delayed acks.
type adbStream struct {
	c             *adbConn
	local, remote uint32
	pr            *io.PipeReader
	pw            *io.PipeWriter
	ack           chan struct{}
	ctx           context.Context
	cancel        context.CancelFunc
	once          sync.Once
}

func (s *adbStream) Read(b []byte) (int, error) { return s.pr.Read(b) }

func (s *adbStream) Write(b []byte) (int, error) {
	n := 0
	for len(b) > 0 {
		chunk := min(len(b), adbdMaxPayload)
		if err := s.c.send(adbproto.Packet{Command: adbproto.WRTE, Arg0: s.local, Arg1: s.remote, Payload: bytes.Clone(b[:chunk])}); err != nil {
			return n, err
		}
		select {
		case <-s.ack:
		case <-s.ctx.Done():
			return n, io.ErrClosedPipe
		}
		n += chunk
		b = b[chunk:]
	}
	return n, nil
}

func (s *adbStream) deliver(data []byte) {
	if _, err := s.pw.Write(data); err == nil {
		_ = s.c.send(adbproto.Packet{Command: adbproto.OKAY, Arg0: s.local, Arg1: s.remote})
	}
}

func (s *adbStream) closeRemote() {
	s.once.Do(func() {
		s.cancel()
		s.pw.Close()
		s.c.mu.Lock()
		delete(s.c.streams, s.local)
		s.c.mu.Unlock()
	})
}

func (s *adbStream) close() {
	if s.ctx.Err() == nil {
		_ = s.c.send(adbproto.Packet{Command: adbproto.CLSE, Arg0: s.local, Arg1: s.remote})
	}
	s.closeRemote()
}

func (d *device) adbService(service string) func(*adbStream) {
	name, cmd, _ := strings.Cut(service, ":")
	switch {
	case service == "sync:":
		return d.serveSync
	case name == "exec":
		return func(s *adbStream) { d.runShell(s.ctx, cmd, s, s, s) }
	case name == "shell" && cmd == "":
		return func(s *adbStream) { d.interactive(s.ctx, s, s) }
	case name == "shell":
		return func(s *adbStream) { d.runShell(s.ctx, cmd, s, s, s) }
	case strings.HasPrefix(name, "shell,v2"):
		pty := strings.Contains(name, ",pty")
		return func(s *adbStream) { d.serveShellV2(s, cmd, pty) }
	}
	return nil
}

const (
	shellStdin = iota
	shellStdout
	shellStderr
	shellExit
	shellCloseStdin
)

type shellV2Writer struct {
	mu *sync.Mutex
	w  io.Writer
	id byte
}

func (w shellV2Writer) Write(b []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := writeShellPacket(w.w, w.id, b); err != nil {
		return 0, err
	}
	return len(b), nil
}

func writeShellPacket(w io.Writer, id byte, data []byte) error {
	buf := make([]byte, 5+len(data))
	buf[0] = id
	binary.LittleEndian.PutUint32(buf[1:], uint32(len(data)))
	copy(buf[5:], data)
	_, err := w.Write(buf)
	return err
}

func (d *device) serveShellV2(s *adbStream, cmd string, pty bool) {
	stdin, feed := io.Pipe()
	go func() {
		defer feed.Close()
		var h [5]byte
		for {
			if _, err := io.ReadFull(s, h[:]); err != nil {
				return
			}
			data := make([]byte, binary.LittleEndian.Uint32(h[1:]))
			if _, err := io.ReadFull(s, data); err != nil {
				return
			}
			switch h[0] {
			case shellStdin:
				if _, err := feed.Write(data); err != nil {
					return
				}
			case shellCloseStdin:
				feed.Close()
			}
		}
	}()
	var mu sync.Mutex
	stdout := shellV2Writer{&mu, s, shellStdout}
	stderr := shellV2Writer{&mu, s, shellStderr}
	var code int
	switch {
	case pty && cmd == "":
		code = d.interactive(s.ctx, stdin, stdout)
	case pty:
		code = d.runShell(s.ctx, cmd, stdin, crlf{stdout}, crlf{stdout})
	default:
		code = d.runShell(s.ctx, cmd, stdin, stdout, stderr)
	}
	mu.Lock()
	_ = writeShellPacket(s, shellExit, []byte{byte(code)})
	mu.Unlock()
}

// crlf translates newlines the way a terminal's line discipline does.
type crlf struct{ w io.Writer }

func (c crlf) Write(b []byte) (int, error) {
	if _, err := c.w.Write(bytes.ReplaceAll(b, []byte("\n"), []byte("\r\n"))); err != nil {
		return 0, err
	}
	return len(b), nil
}
