package agent

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

const (
	scrcpyMessageMax = 1 << 18
	clipboardMax     = scrcpyMessageMax - 14
)

// Clipboard keeps a control-only scrcpy server running: clipboard_autosync
// reports every change of the device clipboard and set-clipboard messages
// change it.
type Clipboard struct {
	scrcpy *Scrcpy
	log    *slog.Logger

	mu   sync.Mutex
	conn net.Conn
	seq  uint64
	acks map[uint64]chan struct{}
}

func NewClipboard(scrcpy *Scrcpy, log *slog.Logger) *Clipboard {
	return &Clipboard{scrcpy: scrcpy, log: log, acks: map[uint64]chan struct{}{}}
}

// Run keeps the server connected until ctx ends and calls onChange with
// every clipboard text the device reports.
func (c *Clipboard) Run(ctx context.Context, onChange func(string)) {
	backoff := time.Second
	for {
		started := time.Now()
		err := c.connect(ctx, onChange)
		if ctx.Err() != nil {
			return
		}
		if time.Since(started) > time.Minute {
			backoff = time.Second
		}
		c.log.Warn("clipboard sync", "err", err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, 30*time.Second)
	}
}

func (c *Clipboard) connect(ctx context.Context, onChange func(string)) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	conns, err := c.scrcpy.start(ctx, "video=false audio=false control=true clipboard_autosync=true send_device_meta=false", 1)
	if err != nil {
		return err
	}
	conn := conns[0]
	defer conn.Close()
	go func() {
		<-ctx.Done()
		conn.Close()
	}()
	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		c.conn = nil
		c.mu.Unlock()
	}()
	return readDeviceMessages(bufio.NewReader(conn), onChange, c.ack)
}

func (c *Clipboard) ack(seq uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if ch, ok := c.acks[seq]; ok {
		close(ch)
		delete(c.acks, seq)
	}
}

// Set changes the device clipboard and waits until the server confirms it.
func (c *Clipboard) Set(ctx context.Context, text string) error {
	if len(text) > clipboardMax {
		return fmt.Errorf("%w: the text is longer than %d bytes", contract.ErrInvalid, clipboardMax)
	}
	msg := make([]byte, 14+len(text))
	msg[0] = 9
	binary.BigEndian.PutUint32(msg[10:], uint32(len(text)))
	copy(msg[14:], text)

	c.mu.Lock()
	if c.conn == nil {
		c.mu.Unlock()
		return errors.New("the device clipboard is not connected yet")
	}
	c.seq++
	seq := c.seq
	binary.BigEndian.PutUint64(msg[1:], seq)
	done := make(chan struct{})
	c.acks[seq] = done
	_, err := c.conn.Write(msg)
	c.mu.Unlock()
	defer c.ack(seq)
	if err != nil {
		return fmt.Errorf("set clipboard: %w", err)
	}
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(5 * time.Second):
		return errors.New("set clipboard: the device did not confirm")
	}
}

// setClipboard sets the clipboard as the shell user with SystemUI's
// SUPPRESS_CLIPBOARD_OVERLAY extra, so redroid's Android 13+ doesn't show its
// clipboard preview as it does for scrcpy's set-clipboard (decision #126).
func (c *Controls) setClipboard(ctx context.Context, text string) error {
	if len(text) > clipboardMax {
		return fmt.Errorf("%w: the text is longer than %d bytes", contract.ErrInvalid, clipboardMax)
	}
	f, err := os.CreateTemp("", "holtdroid-clip-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, err = f.WriteString(text)
	if err = errors.Join(err, f.Chmod(0o644), f.Close()); err != nil {
		return err
	}
	remote := "/data/local/tmp/" + filepath.Base(f.Name())
	if err := c.dev.Push(ctx, c.toolsDex, toolsRemote); err != nil {
		return err
	}
	if err := c.dev.Push(ctx, f.Name(), remote); err != nil {
		return err
	}
	if _, err := c.dev.Shell(ctx, `su 2000 sh -c "CLASSPATH=`+toolsRemote+` app_process / Clip `+remote+`"`); err != nil {
		_, _ = c.dev.Shell(ctx, "rm -f "+remote)
		return fmt.Errorf("set clipboard: %w", err)
	}
	return nil
}

// readDeviceMessages parses scrcpy device messages: clipboard text, clipboard
// acknowledgements and UHID output, which is skipped.
func readDeviceMessages(r io.Reader, onClip func(string), onAck func(uint64)) error {
	var head [4]byte
	for {
		if _, err := io.ReadFull(r, head[:1]); err != nil {
			return err
		}
		switch head[0] {
		case 0:
			if _, err := io.ReadFull(r, head[:4]); err != nil {
				return err
			}
			n := binary.BigEndian.Uint32(head[:4])
			if n > scrcpyMessageMax {
				return fmt.Errorf("clipboard message of %d bytes", n)
			}
			text := make([]byte, n)
			if _, err := io.ReadFull(r, text); err != nil {
				return err
			}
			onClip(string(text))
		case 1:
			var seq [8]byte
			if _, err := io.ReadFull(r, seq[:]); err != nil {
				return err
			}
			onAck(binary.BigEndian.Uint64(seq[:]))
		case 2:
			if _, err := io.ReadFull(r, head[:4]); err != nil {
				return err
			}
			if _, err := io.CopyN(io.Discard, r, int64(binary.BigEndian.Uint16(head[2:4]))); err != nil {
				return err
			}
		default:
			return fmt.Errorf("unknown scrcpy device message %d", head[0])
		}
	}
}
