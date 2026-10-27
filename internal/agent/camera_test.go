package agent

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/holtdroid/holtdroid/internal/contract"
)

type halDevice struct {
	micDevice
	hal bool
}

func (d *halDevice) Shell(_ context.Context, cmd string) (string, error) {
	if d.hal && cmd == "ls "+cameraHAL {
		return cameraHAL + "\n", nil
	}
	return "", errors.New("no such file")
}

// fakeVideo writes 16×16 I420 frames of one letter, B for the test card, K
// for black and F otherwise, the way a real-time ffmpeg would.
func fakeVideo(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "ffmpeg")
	script := `#!/bin/sh
case "$*" in *smptehdbars*) c=B;; *color=c=black*) c=K;; *) c=F;; esac
while true; do printf "%384s" | tr ' ' "$c" || exit; sleep 0.02; done
`
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func freeAddr(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close()
	return addr
}

func newTestCamera(t *testing.T, hal bool) (*Camera, string) {
	t.Helper()
	c := NewCamera(&halDevice{hal: hal}, fakeVideo(t), "font.ttf", filepath.Join(t.TempDir(), "camera"), slog.New(slog.DiscardHandler))
	addr := freeAddr(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		c.Run(ctx, addr)
		close(done)
	}()
	t.Cleanup(func() {
		cancel()
		<-done
	})
	if hal {
		deadline := time.Now().Add(5 * time.Second)
		for !c.State().Available {
			if time.Now().After(deadline) {
				t.Fatal("the feed never started")
			}
			time.Sleep(time.Millisecond)
		}
	}
	return c, addr
}

func readFrame(t *testing.T, conn net.Conn, want byte) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	frame := make([]byte, 384)
	for {
		_ = conn.SetReadDeadline(deadline)
		if _, err := io.ReadFull(conn, frame); err != nil {
			t.Fatalf("waiting for a %c frame: %v", want, err)
		}
		if bytes.Count(frame, []byte{frame[0]}) != len(frame) {
			t.Fatalf("a torn frame %q", frame)
		}
		if frame[0] == want {
			return
		}
	}
}

func TestCameraArgs(t *testing.T) {
	for _, tc := range []struct {
		src   contract.CameraSource
		image bool
		want  string
	}{
		{contract.CameraBars, false, "-re -f lavfi -i smptehdbars=size=720x1280:rate=30 -an -vf drawtext=fontfile=f.ttf:text='%{localtime}'"},
		{contract.CameraBlack, false, "-i color=c=black:size=720x1280:rate=30 -an -vf scale=720:1280"},
		{contract.CameraFile, false, "-re -stream_loop -1 -i /m/a.mp4 -an"},
		{contract.CameraFile, true, "-re -loop 1 -framerate 30 -i /m/a.mp4 -an"},
		{contract.CameraBrowser, false, "-f image2pipe -framerate 30 -c:v mjpeg -i pipe:0"},
	} {
		got := strings.Join(cameraArgs(tc.src, "/m/a.mp4", tc.image, "f.ttf", 1280, 720, 30), " ")
		if !strings.Contains(got, tc.want) || !strings.Contains(got, "crop=720:1280,setsar=1,fps=30,transpose=2,format=yuv420p") ||
			!strings.HasSuffix(got, "-f rawvideo -pix_fmt yuv420p pipe:1") {
			t.Errorf("%s: %s", tc.src, got)
		}
	}
}

func TestFrameWriter(t *testing.T) {
	var out bytes.Buffer
	f := &frameWriter{w: &out, size: 4}
	for _, p := range []string{"ab", "cdef", "g", "hij"} {
		if _, err := f.Write([]byte(p)); err != nil {
			t.Fatal(err)
		}
	}
	if out.String() != "abcdefgh" || string(f.buf) != "ij" {
		t.Fatalf("out %q, left %q", out.String(), f.buf)
	}
}

func TestCameraFeed(t *testing.T) {
	c, addr := newTestCamera(t, true)
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := io.WriteString(conn, "16 16 30\n"); err != nil {
		t.Fatal(err)
	}
	readFrame(t, conn, 'B')
	if s := c.State(); !s.InUse || s.Source != contract.CameraBars {
		t.Fatalf("state %+v", s)
	}

	if _, err := c.Set(t.Context(), contract.SetCamera{Source: contract.CameraBlack}); err != nil {
		t.Fatal(err)
	}
	readFrame(t, conn, 'K')

	files := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("png")) }))
	t.Cleanup(files.Close)
	s, err := c.Set(t.Context(), contract.SetCamera{Source: contract.CameraFile, MediaID: "m1", File: "QR", FileURL: files.URL, Image: true})
	if err != nil || s.MediaID != "m1" || s.File != "QR" {
		t.Fatalf("file: %+v %v", s, err)
	}
	readFrame(t, conn, 'F')

	conn.Close()
	deadline := time.Now().Add(5 * time.Second)
	for c.State().InUse {
		if time.Now().After(deadline) {
			t.Fatal("still in use after the HAL left")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestCameraBrowser(t *testing.T) {
	c, _ := newTestCamera(t, true)
	srv := httptest.NewServer(http.HandlerFunc(c.ServeBrowser))
	t.Cleanup(srv.Close)
	ws, _, err := websocket.Dial(t.Context(), "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := ws.Write(t.Context(), websocket.MessageBinary, []byte("jpeg")); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		c.mu.Lock()
		frame := string(c.frame)
		c.mu.Unlock()
		if frame == "jpeg" && c.State().Source == contract.CameraBrowser {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("frame %q, state %+v", frame, c.State())
		}
		time.Sleep(5 * time.Millisecond)
	}

	if _, err := c.Set(t.Context(), contract.SetCamera{Source: contract.CameraBlack}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ws.Read(t.Context()); websocket.CloseStatus(err) != websocket.StatusNormalClosure {
		t.Fatalf("the browser wasn't let go: %v", err)
	}
	if s := c.State(); s.Source != contract.CameraBlack {
		t.Fatalf("state %+v", s)
	}
}

func TestCameraWithoutHAL(t *testing.T) {
	c, _ := newTestCamera(t, false)
	time.Sleep(50 * time.Millisecond)
	if s := c.State(); s.Available {
		t.Fatalf("state %+v", s)
	}
	if _, err := c.Set(t.Context(), contract.SetCamera{Source: contract.CameraBlack}); !errors.Is(err, errNoCamera) {
		t.Fatalf("err = %v", err)
	}
}
