package agent

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/holtdroid/holtdroid/internal/contract"
)

// micDevice imitates adb forward plus the Mic helper, which takes one
// connection and keeps what it is sent.
type micDevice struct {
	ln net.Listener

	mu      sync.Mutex
	running bool
	got     bytes.Buffer
	cmds    []string
	pushes  []string
	removed int
}

func newMicDevice(t *testing.T) *micDevice {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	d := &micDevice{ln: ln}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			d.mu.Lock()
			running := d.running
			d.mu.Unlock()
			if !running {
				c.Close()
				continue
			}
			go func() {
				defer c.Close()
				_, _ = c.Write([]byte{0})
				buf := make([]byte, 4096)
				for {
					n, err := c.Read(buf)
					d.mu.Lock()
					d.got.Write(buf[:n])
					d.mu.Unlock()
					if err != nil {
						return
					}
				}
			}()
		}
	}()
	return d
}

func (d *micDevice) Push(_ context.Context, _, remote string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.pushes = append(d.pushes, remote)
	return nil
}

func (d *micDevice) ForwardTo(context.Context, string) (int, error) {
	return d.ln.Addr().(*net.TCPAddr).Port, nil
}

func (d *micDevice) RemoveForward(context.Context, int) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.removed++
	return nil
}

func (d *micDevice) Shell(context.Context, string) (string, error) { return "", nil }

func (d *micDevice) Run(ctx context.Context, cmd string) error {
	d.mu.Lock()
	d.running = true
	d.cmds = append(d.cmds, cmd)
	d.mu.Unlock()
	<-ctx.Done()
	d.mu.Lock()
	d.running = false
	d.mu.Unlock()
	return nil
}

func (d *micDevice) received() string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.got.String()
}

func (d *micDevice) waitFor(t *testing.T, want string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !strings.Contains(d.received(), want) {
		if time.Now().After(deadline) {
			t.Fatalf("the helper got %q, want %q", d.received(), want)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// fakeFFmpeg writes its arguments and stays up like a real-time source.
func fakeFFmpeg(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "ffmpeg")
	if err := os.WriteFile(path, []byte("#!/bin/sh\necho \"$@\"\nexec sleep 30\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func newTestMicrophone(t *testing.T, dev *micDevice, available bool) *Microphone {
	t.Helper()
	m := NewMicrophone(dev, "tools.dex", fakeFFmpeg(t), filepath.Join(t.TempDir(), "media"), available, slog.New(slog.DiscardHandler))
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		m.Run(ctx)
		close(done)
	}()
	t.Cleanup(func() {
		cancel()
		<-done
	})
	for {
		m.mu.Lock()
		up := m.ctx != nil
		m.mu.Unlock()
		if up {
			return m
		}
		time.Sleep(time.Millisecond)
	}
}

func TestMicArgs(t *testing.T) {
	for _, tc := range []struct {
		source contract.MicrophoneSource
		want   string
	}{
		{contract.MicTone, "-re -f lavfi -i sine=frequency=1000:sample_rate=48000 -af pan=stereo|c0=c0|c1=c0 -vn"},
		{contract.MicBeeps, `-i aevalsrc=0.5*sin(2*PI*1000*t)*lt(mod(t\,1)\,0.1):s=48000`},
		{contract.MicNoise, "-i anoisesrc=color=pink:amplitude=0.25:sample_rate=48000"},
		{contract.MicFile, "-re -stream_loop -1 -i /tmp/a b.mp3 -vn"},
	} {
		got := strings.Join(micArgs(tc.source, "/tmp/a b.mp3", tc.source != contract.MicFile), " ")
		if !strings.Contains(got, tc.want) || !strings.HasSuffix(got, "-ac 2 -ar 48000 -f s16le pipe:1") {
			t.Errorf("%s: %s", tc.source, got)
		}
	}
}

func TestMicrophoneSources(t *testing.T) {
	dev := newMicDevice(t)
	m := newTestMicrophone(t, dev, true)
	ctx := context.Background()

	s, err := m.Set(ctx, contract.SetMicrophone{Source: contract.MicTone})
	if err != nil || s.Source != contract.MicTone || !s.Available {
		t.Fatalf("tone: %+v %v", s, err)
	}
	dev.waitFor(t, "sine=frequency=1000")
	if !slices.Contains(dev.pushes, micDexRemote) || !strings.HasPrefix(dev.cmds[0], "CLASSPATH="+micDexRemote+" app_process / Mic holtdroid_mic_") {
		t.Fatalf("pushes %v, cmds %v", dev.pushes, dev.cmds)
	}

	if _, err := m.Set(ctx, contract.SetMicrophone{Source: contract.MicNoise}); err != nil {
		t.Fatal(err)
	}
	dev.waitFor(t, "anoisesrc")
	if len(dev.pushes) != 1 {
		t.Fatalf("the helper was pushed %d times", len(dev.pushes))
	}

	files := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("mp3")) }))
	t.Cleanup(files.Close)
	if _, err := m.Set(ctx, contract.SetMicrophone{Source: contract.MicFile, MediaID: "../x", FileURL: files.URL}); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("bad media id: %v", err)
	}
	s, err = m.Set(ctx, contract.SetMicrophone{Source: contract.MicFile, MediaID: "m1", File: "Song", FileURL: files.URL})
	if err != nil || s.MediaID != "m1" || s.File != "Song" {
		t.Fatalf("file: %+v %v", s, err)
	}
	path := filepath.Join(m.dir, "m1")
	dev.waitFor(t, "-i "+path)
	if raw, _ := os.ReadFile(path); string(raw) != "mp3" {
		t.Fatalf("downloaded %q", raw)
	}

	if s, err = m.Set(ctx, contract.SetMicrophone{Source: contract.MicOff}); err != nil || s.Source != contract.MicOff {
		t.Fatalf("off: %+v %v", s, err)
	}
	dev.mu.Lock()
	removed := dev.removed
	dev.mu.Unlock()
	if removed != 3 {
		t.Fatalf("%d forwards removed, want 3", removed)
	}
}

func TestMicrophoneUnavailable(t *testing.T) {
	m := newTestMicrophone(t, newMicDevice(t), false)
	if _, err := m.Set(context.Background(), contract.SetMicrophone{Source: contract.MicTone}); !errors.Is(err, errNoMicrophone) {
		t.Fatalf("err = %v", err)
	}
	if s := m.State(); s.Available || s.Source != contract.MicOff {
		t.Fatalf("state %+v", s)
	}
}

func TestMicrophoneBrowser(t *testing.T) {
	dev := newMicDevice(t)
	m := newTestMicrophone(t, dev, true)
	srv := httptest.NewServer(http.HandlerFunc(m.ServeBrowser))
	t.Cleanup(srv.Close)

	ctx := context.Background()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := ws.Write(ctx, websocket.MessageBinary, []byte{1, 2, 3}); err != nil {
		t.Fatal(err)
	}
	if err := ws.Write(ctx, websocket.MessageBinary, []byte{4}); err != nil {
		t.Fatal(err)
	}
	dev.waitFor(t, "\x01\x02\x01\x02\x03\x04\x03\x04")
	if s := m.State(); s.Source != contract.MicBrowser {
		t.Fatalf("state %+v", s)
	}
	_ = ws.Close(websocket.StatusNormalClosure, "")
	deadline := time.Now().Add(5 * time.Second)
	for m.State().Source != contract.MicOff {
		if time.Now().After(deadline) {
			t.Fatalf("still %+v after the browser left", m.State())
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestMicrophoneContract(t *testing.T) {
	h := newHarness(t, nil)
	h.waitState(contract.StateReady)
	client := contract.NewAgentClient(h.url, nil)
	m, err := client.Microphone(t.Context())
	if err != nil || !m.Available || m.Source != contract.MicOff {
		t.Fatalf("get: %+v %v", m, err)
	}
	if _, err := client.SetMicrophone(t.Context(), contract.SetMicrophone{Source: contract.MicFile}); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("file without a URL: %v", err)
	}
	if m, err = client.SetMicrophone(t.Context(), contract.SetMicrophone{Source: contract.MicOff}); err != nil || m.Source != contract.MicOff {
		t.Fatalf("off: %+v %v", m, err)
	}
}
