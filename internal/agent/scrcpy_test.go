package agent

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/holtdroid/holtdroid/internal/contract"
)

// fakeScrcpy imitates adb forward plus a scrcpy server: until the server
// runs, connections are accepted and closed at once, like adb does. The
// sockets a run gets follow its options.
type fakeScrcpy struct {
	ln net.Listener

	mu       sync.Mutex
	running  bool
	roles    []string
	conns    int
	pushes   []string
	cmds     []string
	removed  []int
	control  bytes.Buffer
	forwards []string
	clip     string
	clipConn net.Conn
	opus     bool
}

func newFakeScrcpy(t *testing.T) *fakeScrcpy {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	f := &fakeScrcpy{ln: ln}
	go f.accept()
	return f
}

func (f *fakeScrcpy) accept() {
	for {
		c, err := f.ln.Accept()
		if err != nil {
			return
		}
		f.mu.Lock()
		role := ""
		if f.running && f.conns < len(f.roles) {
			role = f.roles[f.conns]
			f.conns++
		}
		first := f.conns == 1
		f.mu.Unlock()
		if role == "" {
			c.Close()
			continue
		}
		if first {
			_, _ = c.Write([]byte{0})
		}
		go f.serve(c, role)
	}
}

func (f *fakeScrcpy) serve(c net.Conn, role string) {
	defer c.Close()
	switch role {
	case "video":
		_, _ = c.Write([]byte("video-bytes"))
		_, _ = io.Copy(io.Discard, c)
	case "audio":
		if !f.opusStream() {
			_, _ = c.Write([]byte("opus-bytes"))
			_, _ = io.Copy(io.Discard, c)
			return
		}
		_, _ = c.Write(append([]byte("opus"), audioPacket(configFlag, "CF")...))
		for i := uint64(1); ; i++ {
			if _, err := c.Write(audioPacket(i, "abc")); err != nil {
				return
			}
			time.Sleep(5 * time.Millisecond)
		}
	case "control":
		buf := make([]byte, 64)
		for {
			k, err := c.Read(buf)
			f.mu.Lock()
			f.control.Write(buf[:k])
			f.mu.Unlock()
			if err != nil {
				return
			}
		}
	case "clipboard":
		f.mu.Lock()
		f.clipConn = c
		f.mu.Unlock()
		head := make([]byte, 14)
		for {
			if _, err := io.ReadFull(c, head); err != nil || head[0] != 9 {
				return
			}
			text := make([]byte, binary.BigEndian.Uint32(head[10:]))
			if _, err := io.ReadFull(c, text); err != nil {
				return
			}
			f.mu.Lock()
			f.clip = string(text)
			f.mu.Unlock()
			_, _ = c.Write(append([]byte{1}, head[1:9]...))
		}
	}
}

// pushClip sends a clipboard device message, as autosync does.
func (f *fakeScrcpy) pushClip(text string) error {
	f.mu.Lock()
	c := f.clipConn
	f.mu.Unlock()
	if c == nil {
		return errors.New("no clipboard connection")
	}
	msg := make([]byte, 5+len(text))
	binary.BigEndian.PutUint32(msg[1:], uint32(len(text)))
	copy(msg[5:], text)
	_, err := c.Write(msg)
	return err
}

func (f *fakeScrcpy) Push(_ context.Context, _, remote string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.pushes = append(f.pushes, remote)
	return nil
}

func (f *fakeScrcpy) ForwardTo(_ context.Context, remote string) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.forwards = append(f.forwards, remote)
	return f.ln.Addr().(*net.TCPAddr).Port, nil
}

func (f *fakeScrcpy) RemoveForward(_ context.Context, port int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.removed = append(f.removed, port)
	return nil
}

func (f *fakeScrcpy) Shell(_ context.Context, cmd string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cmds = append(f.cmds, cmd)
	if strings.Contains(cmd, "list_encoders=true") {
		return "[server] INFO: List of video encoders:\n" +
			"    --video-codec=h264 --video-encoder=c2.android.avc.encoder         (sw)\n" +
			"    --video-codec=h265 --video-encoder=c2.android.hevc.encoder        (sw)\n" +
			"[server] INFO: List of audio encoders:\n" +
			"    --audio-codec=opus --audio-encoder=c2.android.opus.encoder        (sw)\n", nil
	}
	return "", nil
}

func (f *fakeScrcpy) Run(ctx context.Context, cmd string) error {
	var roles []string
	switch {
	case strings.Contains(cmd, "audio=true"):
		roles = []string{"audio"}
	case strings.Contains(cmd, "clipboard_autosync=true"):
		roles = []string{"clipboard"}
	default:
		roles = []string{"video", "control"}
	}
	time.Sleep(300 * time.Millisecond)
	f.mu.Lock()
	f.running, f.roles, f.conns = true, roles, 0
	f.cmds = append(f.cmds, cmd)
	f.mu.Unlock()
	<-ctx.Done()
	f.mu.Lock()
	f.running = false
	f.mu.Unlock()
	return nil
}

func (f *fakeScrcpy) lastCmd() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.cmds[len(f.cmds)-1]
}

func scrcpyServer(t *testing.T, dev *fakeScrcpy) string {
	t.Helper()
	mux := http.NewServeMux()
	NewScrcpy(DefaultScrcpyConfig(), dev, slog.New(slog.DiscardHandler)).Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

func dialWS(ctx context.Context, t *testing.T, u string) *websocket.Conn {
	t.Helper()
	c, _, err := websocket.Dial(ctx, u, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"https://android.example.com"}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.CloseNow() })
	return c
}

func TestScrcpyBridge(t *testing.T) {
	dev := newFakeScrcpy(t)
	base := scrcpyServer(t, dev)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	c := dialWS(ctx, t, base+"/display/scrcpy")
	typ, msg, err := c.Read(ctx)
	if err != nil || typ != websocket.MessageBinary || string(msg) != "video-bytes" {
		t.Fatalf("video %v %q, %v", typ, msg, err)
	}
	if err := c.Write(ctx, websocket.MessageBinary, []byte{2, 0, 1}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		dev.mu.Lock()
		defer dev.mu.Unlock()
		return bytes.Equal(dev.control.Bytes(), []byte{2, 0, 1})
	})
	_ = c.Close(websocket.StatusNormalClosure, "")

	waitFor(t, func() bool {
		dev.mu.Lock()
		defer dev.mu.Unlock()
		return len(dev.removed) == 1
	})
	dev.mu.Lock()
	defer dev.mu.Unlock()
	if len(dev.forwards) != 1 || !strings.HasPrefix(dev.forwards[0], "localabstract:scrcpy_") {
		t.Fatalf("forwards %v", dev.forwards)
	}
	scid := strings.TrimPrefix(dev.forwards[0], "localabstract:scrcpy_")
	jar := "/data/local/tmp/holtdroid-scrcpy-" + scid + ".jar"
	if len(dev.pushes) != 1 || dev.pushes[0] != jar {
		t.Fatalf("pushes %v", dev.pushes)
	}
	cmd := dev.cmds[0]
	for _, want := range []string{
		`u="su 2000"`, "CLASSPATH=" + jar + " ", "com.genymobile.scrcpy.Server 3.3.3", "scid=" + scid,
		"tunnel_forward=true", "audio=false", "control=true", "video_codec=h264", "video_bit_rate=4000000", "max_fps=60", "max_size=0",
	} {
		if !strings.Contains(cmd, want) {
			t.Errorf("command %q lacks %q", cmd, want)
		}
	}
	if strings.Contains(cmd, "send_device_meta=false") {
		t.Errorf("the video stream needs the device meta: %q", cmd)
	}
}

func TestScrcpyVideoOptions(t *testing.T) {
	s := NewScrcpy(DefaultScrcpyConfig(), nil, nil)
	for _, tc := range []struct {
		query string
		want  videoOptions
		err   bool
	}{
		{"", videoOptions{codec: "h264", maxFPS: 60, bitRate: 4_000_000}, false},
		{"codec=h265&maxSize=1280&maxFps=30&bitRate=2000000", videoOptions{codec: "h265", maxSize: 1280, maxFPS: 30, bitRate: 2_000_000}, false},
		{"codec=av1&maxSize=0", videoOptions{codec: "av1", maxFPS: 60, bitRate: 4_000_000}, false},
		{"codec=vp9", videoOptions{}, true},
		{"maxSize=100", videoOptions{}, true},
		{"maxFps=0", videoOptions{codec: "h264", bitRate: 4_000_000}, false},
		{"maxFps=500", videoOptions{}, true},
		{"bitRate=lots", videoOptions{}, true},
	} {
		q, _ := url.ParseQuery(tc.query)
		got, err := s.videoOptions(q)
		if (err != nil) != tc.err || !tc.err && got != tc.want {
			t.Errorf("%q: %+v, %v", tc.query, got, err)
		}
	}
}

func TestScrcpyCodecs(t *testing.T) {
	dev := newFakeScrcpy(t)
	base := scrcpyServer(t, dev)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	c := dialWS(ctx, t, base+"/display/scrcpy?codec=av1")
	if _, _, err := c.Read(ctx); websocket.CloseStatus(err) != contract.DisplayUnsupportedCodec {
		t.Fatalf("av1 without an encoder: %v", err)
	}

	c = dialWS(ctx, t, base+"/display/scrcpy?codec=h265&maxSize=1024&maxFps=30&bitRate=1000000")
	if _, msg, err := c.Read(ctx); err != nil || string(msg) != "video-bytes" {
		t.Fatalf("h265 %q, %v", msg, err)
	}
	cmd := dev.lastCmd()
	for _, want := range []string{"video_codec=h265", "max_size=1024", "max_fps=30", "video_bit_rate=1000000"} {
		if !strings.Contains(cmd, want) {
			t.Errorf("command %q lacks %q", cmd, want)
		}
	}
	dev.mu.Lock()
	lists := 0
	for _, cmd := range dev.cmds {
		if strings.Contains(cmd, "list_encoders=true") {
			lists++
		}
	}
	dev.mu.Unlock()
	if lists != 1 {
		t.Fatalf("encoders listed %d times", lists)
	}

	resp, err := http.Get("http" + strings.TrimPrefix(base, "ws") + "/display/scrcpy?codec=vp9")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown codec: %d", resp.StatusCode)
	}
}

func TestScrcpyAudio(t *testing.T) {
	dev := newFakeScrcpy(t)
	base := scrcpyServer(t, dev)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	c := dialWS(ctx, t, base+"/display/audio")
	if _, msg, err := c.Read(ctx); err != nil || string(msg) != "opus-bytes" {
		t.Fatalf("audio %q, %v", msg, err)
	}
	cmd := dev.lastCmd()
	for _, want := range []string{"video=false", "audio=true", "control=false", "audio_codec=opus", "send_device_meta=false"} {
		if !strings.Contains(cmd, want) {
			t.Errorf("command %q lacks %q", cmd, want)
		}
	}
}

func (f *fakeScrcpy) opusStream() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.opus
}

func audioPacket(pts uint64, payload string) []byte {
	p := binary.BigEndian.AppendUint64(nil, pts)
	p = binary.BigEndian.AppendUint32(p, uint32(len(payload)))
	return append(p, payload...)
}

func TestScrcpyKeepAudio(t *testing.T) {
	dev := newFakeScrcpy(t)
	dev.opus = true
	cfg := DefaultScrcpyConfig()
	cfg.KeepAudio = true
	s := NewScrcpy(cfg, dev, slog.New(slog.DiscardHandler))
	mux := http.NewServeMux()
	s.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	go s.Run(ctx)

	waitFor(t, func() bool {
		dev.mu.Lock()
		defer dev.mu.Unlock()
		return len(dev.cmds) == 1
	})
	for range 2 {
		c := dialWS(ctx, t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/display/audio")
		_, header, err := c.Read(ctx)
		if err != nil || !bytes.Equal(header, append([]byte("opus"), audioPacket(configFlag, "CF")...)) {
			t.Fatalf("header %q, %v", header, err)
		}
		_, packet, err := c.Read(ctx)
		if err != nil || len(packet) != 15 || string(packet[12:]) != "abc" {
			t.Fatalf("packet %q, %v", packet, err)
		}
		_ = c.Close(websocket.StatusNormalClosure, "")
	}
	dev.mu.Lock()
	defer dev.mu.Unlock()
	if len(dev.cmds) != 1 {
		t.Fatalf("%d captures, want one for the whole session", len(dev.cmds))
	}
}

func TestClipboard(t *testing.T) {
	dev := newFakeScrcpy(t)
	clip := NewClipboard(NewScrcpy(DefaultScrcpyConfig(), dev, slog.New(slog.DiscardHandler)), slog.New(slog.DiscardHandler))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := clip.Set(ctx, "early"); err == nil {
		t.Fatal("set before the server is connected")
	}
	changes := make(chan string, 4)
	go clip.Run(ctx, func(text string) { changes <- text })
	waitFor(t, func() bool {
		clip.mu.Lock()
		defer clip.mu.Unlock()
		return clip.conn != nil
	})
	if cmd := dev.lastCmd(); !strings.Contains(cmd, "video=false audio=false control=true clipboard_autosync=true send_device_meta=false") {
		t.Fatalf("command %q", cmd)
	}

	if err := clip.Set(ctx, "привет"); err != nil {
		t.Fatal(err)
	}
	dev.mu.Lock()
	got := dev.clip
	dev.mu.Unlock()
	if got != "привет" {
		t.Fatalf("device clipboard %q", got)
	}

	if err := dev.pushClip("copied on the device"); err != nil {
		t.Fatal(err)
	}
	if text := <-changes; text != "copied on the device" {
		t.Fatalf("change %q", text)
	}

	if err := clip.Set(ctx, strings.Repeat("x", clipboardMax+1)); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("oversized text: %v", err)
	}
}

func TestReadDeviceMessages(t *testing.T) {
	var stream bytes.Buffer
	stream.Write([]byte{2, 0, 1, 0, 2, 0xaa, 0xbb})
	stream.Write([]byte{0, 0, 0, 0, 2, 'h', 'i'})
	stream.Write([]byte{1, 0, 0, 0, 0, 0, 0, 0, 7})
	stream.Write([]byte{9})
	var clips []string
	var acks []uint64
	err := readDeviceMessages(&stream, func(s string) { clips = append(clips, s) }, func(seq uint64) { acks = append(acks, seq) })
	if err == nil || !strings.Contains(err.Error(), "unknown scrcpy device message 9") {
		t.Fatalf("err %v", err)
	}
	if len(clips) != 1 || clips[0] != "hi" || len(acks) != 1 || acks[0] != 7 {
		t.Fatalf("clips %q, acks %v", clips, acks)
	}
}
