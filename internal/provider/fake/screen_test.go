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
	srv := httptest.NewServer(http.HandlerFunc(serveScreen))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = c.CloseNow() }()

	_, meta, err := c.Read(ctx)
	if err != nil || len(meta) != 76 || string(meta[64:68]) != "h264" || binary.BigEndian.Uint32(meta[68:]) != screenWidth {
		t.Fatalf("meta %q, %v", meta, err)
	}
	if err := c.Write(ctx, websocket.MessageBinary, []byte{2, 0}); err != nil {
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
}
