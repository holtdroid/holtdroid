package agent

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"time"
)

// adbServer speaks the smart-socket protocol of a host adb server (the one
// `adb` clients reach on port 5037) for one device.
type adbServer struct {
	addr   string
	serial string
}

func (s adbServer) dial(ctx context.Context) (net.Conn, error) {
	var dialer net.Dialer
	c, err := dialer.DialContext(ctx, "tcp", s.addr)
	if err != nil {
		return nil, err
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = c.SetDeadline(deadline)
	}
	return c, nil
}

func (s adbServer) request(c net.Conn, req string) error {
	if _, err := fmt.Fprintf(c, "%04x%s", len(req), req); err != nil {
		return err
	}
	var status [4]byte
	if _, err := io.ReadFull(c, status[:]); err != nil {
		return err
	}
	switch string(status[:]) {
	case "OKAY":
		return nil
	case "FAIL":
		msg, err := readHex(c)
		if err != nil {
			return err
		}
		return errors.New(msg)
	}
	return fmt.Errorf("adb server: unexpected reply %q", status)
}

func readHex(r io.Reader) (string, error) {
	var size [4]byte
	if _, err := io.ReadFull(r, size[:]); err != nil {
		return "", err
	}
	n, err := strconv.ParseUint(string(size[:]), 16, 16)
	if err != nil {
		return "", fmt.Errorf("adb server: bad length %q", size)
	}
	b := make([]byte, n)
	_, err = io.ReadFull(r, b)
	return string(b), err
}

// Open connects service on the device; the connection then carries the
// service's bytes.
func (s adbServer) Open(ctx context.Context, service string) (net.Conn, error) {
	c, err := s.dial(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.request(c, "host:transport:"+s.serial); err != nil {
		c.Close()
		return nil, fmt.Errorf("adb: %s: %w", s.serial, err)
	}
	if err := s.request(c, service); err != nil {
		c.Close()
		return nil, err
	}
	_ = c.SetDeadline(time.Time{})
	return c, nil
}

func (s adbServer) Features(ctx context.Context) (string, error) {
	c, err := s.dial(ctx)
	if err != nil {
		return "", err
	}
	defer c.Close()
	if err := s.request(c, "host-serial:"+s.serial+":features"); err != nil {
		return "", fmt.Errorf("adb: %s: %w", s.serial, err)
	}
	return readHex(c)
}
