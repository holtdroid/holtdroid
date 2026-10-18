package adbproto

import (
	"errors"
	"fmt"
	"io"
	"sync"
)

// Client is the host side of an adb transport: it opens services (shell,
// exec, …) on a daemon as streams over one connection. It speaks the
// classic flow control, one unacknowledged WRTE per stream and direction.
type Client struct {
	conn   io.ReadWriteCloser
	Banner string

	wmu sync.Mutex

	mu      sync.Mutex
	streams map[uint32]*Stream
	next    uint32
	err     error
	done    chan struct{}
}

var ErrClosed = errors.New("adb: connection closed")

// Dial does the handshake on conn and starts reading from it.
func Dial(conn io.ReadWriteCloser) (*Client, error) {
	banner, err := Connect(conn)
	if err != nil {
		conn.Close()
		return nil, err
	}
	c := &Client{conn: conn, Banner: banner, streams: map[uint32]*Stream{}, next: 1, done: make(chan struct{})}
	go c.read()
	return c, nil
}

func (c *Client) Close() error {
	c.fail(ErrClosed)
	return nil
}

// Done is closed once the connection is gone.
func (c *Client) Done() <-chan struct{} { return c.done }

func (c *Client) fail(err error) {
	c.mu.Lock()
	if c.err != nil {
		c.mu.Unlock()
		return
	}
	c.err = err
	streams := c.streams
	c.streams = map[uint32]*Stream{}
	c.mu.Unlock()
	c.conn.Close()
	close(c.done)
	for _, s := range streams {
		s.closed(err)
	}
}

func (c *Client) send(p Packet) error {
	c.wmu.Lock()
	defer c.wmu.Unlock()
	return Write(c.conn, p, 0)
}

func (c *Client) read() {
	for {
		p, err := Read(c.conn)
		if err != nil {
			c.fail(err)
			return
		}
		c.mu.Lock()
		s := c.streams[p.Arg1]
		c.mu.Unlock()
		if s == nil {
			if p.Command == WRTE {
				_ = c.send(Packet{Command: CLSE, Arg0: p.Arg1, Arg1: p.Arg0})
			}
			continue
		}
		switch p.Command {
		case OKAY:
			s.okay(p.Arg0)
		case WRTE:
			s.data(p.Payload)
		case CLSE:
			c.mu.Lock()
			delete(c.streams, s.local)
			c.mu.Unlock()
			s.closed(io.EOF)
		}
	}
}

// Open starts service, such as "shell:" or "exec:getprop", and returns its
// stream once the daemon accepted it.
func (c *Client) Open(service string) (*Stream, error) {
	c.mu.Lock()
	if c.err != nil {
		c.mu.Unlock()
		return nil, c.err
	}
	s := &Stream{c: c, local: c.next, opened: make(chan error, 1), acks: make(chan struct{}, 1), in: make(chan []byte, 1), eof: make(chan struct{})}
	c.next++
	c.streams[s.local] = s
	c.mu.Unlock()
	if err := c.send(Packet{Command: OPEN, Arg0: s.local, Payload: append([]byte(service), 0)}); err != nil {
		return nil, err
	}
	select {
	case err := <-s.opened:
		if err != nil {
			return nil, fmt.Errorf("adb: %s: %w", service, err)
		}
		return s, nil
	case <-c.done:
		return nil, c.err
	}
}

// Output runs an exec: command and returns everything it printed.
func (c *Client) Output(cmd string) (string, error) {
	s, err := c.Open("exec:" + cmd)
	if err != nil {
		return "", err
	}
	defer s.Close()
	b, err := io.ReadAll(s)
	return string(b), err
}

// Stream is one open service.
type Stream struct {
	c      *Client
	local  uint32
	remote uint32

	opened chan error
	acks   chan struct{}
	in     chan []byte
	eof    chan struct{}

	mu      sync.Mutex
	pending []byte
	err     error
	once    sync.Once
}

var errRefused = errors.New("refused by the device")

func (s *Stream) okay(remote uint32) {
	s.mu.Lock()
	first := s.remote == 0
	if first {
		s.remote = remote
	}
	s.mu.Unlock()
	if first {
		s.opened <- nil
		return
	}
	select {
	case s.acks <- struct{}{}:
	default:
	}
}

func (s *Stream) data(b []byte) {
	select {
	case s.in <- b:
	case <-s.eof:
	}
}

func (s *Stream) closed(err error) {
	s.once.Do(func() {
		s.mu.Lock()
		s.err = err
		opening := s.remote == 0
		s.mu.Unlock()
		if opening {
			if errors.Is(err, io.EOF) {
				err = errRefused
			}
			s.opened <- err
		}
		close(s.eof)
	})
}

// Read returns what the service printed. Each chunk is acknowledged once
// it has been read, so a slow reader slows the device down instead of
// filling memory.
func (s *Stream) Read(p []byte) (int, error) {
	for len(s.pending) == 0 {
		select {
		case b := <-s.in:
			s.pending = b
		case <-s.eof:
			select {
			case b := <-s.in:
				s.pending = b
			default:
				s.mu.Lock()
				defer s.mu.Unlock()
				return 0, s.err
			}
		}
		if len(s.pending) == 0 {
			_ = s.ack()
		}
	}
	n := copy(p, s.pending)
	s.pending = s.pending[n:]
	if len(s.pending) == 0 {
		_ = s.ack()
	}
	return n, nil
}

func (s *Stream) ack() error {
	return s.c.send(Packet{Command: OKAY, Arg0: s.local, Arg1: s.remote})
}

// Write sends p to the service, waiting for the daemon to take each piece.
func (s *Stream) Write(p []byte) (int, error) {
	written := 0
	for len(p) > 0 {
		n := min(len(p), MaxPayload)
		if err := s.c.send(Packet{Command: WRTE, Arg0: s.local, Arg1: s.remote, Payload: p[:n]}); err != nil {
			return written, err
		}
		select {
		case <-s.acks:
		case <-s.eof:
			return written, io.ErrClosedPipe
		}
		written += n
		p = p[n:]
	}
	return written, nil
}

func (s *Stream) Close() error {
	s.c.mu.Lock()
	delete(s.c.streams, s.local)
	s.c.mu.Unlock()
	s.closed(io.EOF)
	return s.c.send(Packet{Command: CLSE, Arg0: s.local, Arg1: s.remote})
}
