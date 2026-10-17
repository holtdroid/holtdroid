package fake

import (
	"context"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/kriakiku/holtdroid/internal/contract"
)

func TestScreenPackets(t *testing.T) {
	if len(screenPackets) < 10 || !screenPackets[0].config || !screenPackets[1].key {
		t.Fatalf("%d packets, first %+v", len(screenPackets), screenPackets[0])
	}
	for i, p := range screenPackets[1:] {
		if p.config {
			t.Fatalf("packet %d: config after the first", i+1)
		}
	}
}

func TestServeScreen(t *testing.T) {
	d := &device{subs: map[chan struct{}]struct{}{}}
	srv := httptest.NewServer(http.HandlerFunc(d.serveScreen))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	base := "ws" + strings.TrimPrefix(srv.URL, "http")

	h265, _, err := websocket.Dial(ctx, base+"?codec=h265", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := h265.Read(ctx); websocket.CloseStatus(err) != contract.DisplayUnsupportedCodec {
		t.Fatalf("h265: %v", err)
	}

	c, _, err := websocket.Dial(ctx, base+"?codec=h264&maxSize=800", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = c.CloseNow() }()

	_, meta, err := c.Read(ctx)
	if err != nil || len(meta) != 76 || string(meta[64:68]) != "h264" || binary.BigEndian.Uint32(meta[68:]) != screenWidth {
		t.Fatalf("meta %q, %v", meta, err)
	}
	if err := c.Write(ctx, websocket.MessageBinary, []byte{0, 1, 0, 0, 0, 187, 0, 0, 0, 0, 0, 0, 0, 0}); err != nil {
		t.Fatal(err)
	}
	for i, want := range []uint64{1 << 63, 1<<62 | 100_000} {
		_, msg, err := c.Read(ctx)
		if err != nil {
			t.Fatalf("packet %d: %v", i, err)
		}
		if got := binary.BigEndian.Uint64(msg); got != want || int(binary.BigEndian.Uint32(msg[8:])) != len(msg)-12 {
			t.Fatalf("packet %d header %x", i, msg[:12])
		}
	}
	waitClosed := time.Now().Add(2 * time.Second)
	for {
		d.mu.Lock()
		closed := d.appClosed
		d.mu.Unlock()
		if closed {
			break
		}
		if time.Now().After(waitClosed) {
			t.Fatal("the recents key did not close the app")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestServeAudio(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(serveAudio))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = c.CloseNow() }()
	if _, msg, err := c.Read(ctx); err != nil || string(msg) != "\x00\x00\x00\x00" {
		t.Fatalf("audio meta %q, %v", msg, err)
	}
}
