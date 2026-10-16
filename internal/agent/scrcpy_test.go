package agent

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// fakeScrcpy imitates adb forward plus a scrcpy server: until the server
// runs, connections are accepted and closed at once, like adb does.
type fakeScrcpy struct {
	ln net.Listener

	mu       sync.Mutex
	running  bool
	conns    int
	pushes   []string
	cmd      string
	removed  []int
	control  bytes.Buffer
	forwards []string
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
		running := f.running
		if running {
			f.conns++
		}
		n := f.conns
		f.mu.Unlock()
		switch {
		case !running:
			c.Close()
		case n == 1:
			go func() {
				_, _ = c.Write(append([]byte{0}, "video-bytes"...))
				_, _ = io.Copy(io.Discard, c)
				c.Close()
			}()
		default:
			go func() {
				buf := make([]byte, 64)
				for {
					k, err := c.Read(buf)
					f.mu.Lock()
					f.control.Write(buf[:k])
					f.mu.Unlock()
					if err != nil {
						c.Close()
						return
					}
				}
			}()
		}
	}
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

func (f *fakeScrcpy) Run(ctx context.Context, cmd string) error {
	time.Sleep(300 * time.Millisecond)
	f.mu.Lock()
	f.running, f.cmd = true, cmd
	f.mu.Unlock()
	<-ctx.Done()
	return nil
}

func TestScrcpyBridge(t *testing.T) {
	dev := newFakeScrcpy(t)
	mux := http.NewServeMux()
	NewScrcpy(DefaultScrcpyConfig(), dev, slog.New(slog.DiscardHandler)).Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/display/scrcpy",
		&websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"https://android.example.com"}}})
	if err != nil {
		t.Fatal(err)
	}
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
	if len(dev.pushes) != 1 || dev.pushes[0] != "/data/local/tmp/holtdroid-scrcpy-"+strings.TrimPrefix(dev.forwards[0], "localabstract:scrcpy_")+".jar" || len(dev.forwards) != 1 || !strings.HasPrefix(dev.forwards[0], "localabstract:scrcpy_") {
		t.Fatalf("pushes %v, forwards %v", dev.pushes, dev.forwards)
	}
	scid := strings.TrimPrefix(dev.forwards[0], "localabstract:scrcpy_")
	jar := "/data/local/tmp/holtdroid-scrcpy-" + scid + ".jar"
	for _, want := range []string{"CLASSPATH=" + jar + " ", "com.genymobile.scrcpy.Server 3.3.3", "scid=" + scid, "tunnel_forward=true", "audio=false", "video_codec=h264"} {
		if !strings.Contains(dev.cmd, want) {
			t.Errorf("command %q lacks %q", dev.cmd, want)
		}
	}
}
