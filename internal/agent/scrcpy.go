package agent

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/coder/websocket"
)

type ScrcpyConfig struct {
	Server  string
	Version string
	BitRate int
	MaxFPS  int
}

func DefaultScrcpyConfig() ScrcpyConfig {
	return ScrcpyConfig{Server: "/opt/scrcpy/scrcpy-server", Version: "3.3.3", BitRate: 4_000_000, MaxFPS: 60}
}

// ScrcpyDevice is what the screen bridge needs from adb.
type ScrcpyDevice interface {
	Push(ctx context.Context, local, remote string) error
	ForwardTo(ctx context.Context, remote string) (int, error)
	RemoveForward(ctx context.Context, port int) error
	Run(ctx context.Context, cmd string) error
}

// Scrcpy streams the screen: every WebSocket on /display/scrcpy gets its own
// scrcpy server on the device. Device→browser messages carry the video
// socket's bytes (device and codec meta, then packets with frame meta);
// browser→device messages are control messages, written to the control
// socket as is.
type Scrcpy struct {
	cfg ScrcpyConfig
	dev ScrcpyDevice
	log *slog.Logger
}

func NewScrcpy(cfg ScrcpyConfig, dev ScrcpyDevice, log *slog.Logger) *Scrcpy {
	return &Scrcpy{cfg: cfg, dev: dev, log: log}
}

func (s *Scrcpy) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /display/scrcpy", s.serve)
}

func (s *Scrcpy) serve(w http.ResponseWriter, r *http.Request) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer func() { _ = ws.CloseNow() }()
	ws.SetReadLimit(1 << 20)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	video, control, err := s.start(ctx)
	if err != nil {
		s.log.Warn("scrcpy start", "err", err)
		_ = ws.Close(websocket.StatusTryAgainLater, "screen is not available yet")
		return
	}
	go func() {
		<-ctx.Done()
		video.Close()
		control.Close()
	}()
	go func() {
		_, _ = io.Copy(io.Discard, control)
		cancel()
	}()
	go func() {
		defer cancel()
		for {
			typ, data, err := ws.Read(ctx)
			if err != nil {
				return
			}
			if typ != websocket.MessageBinary {
				continue
			}
			if _, err := control.Write(data); err != nil {
				return
			}
		}
	}()
	buf := make([]byte, 256<<10)
	for {
		n, err := video.Read(buf)
		if n > 0 {
			if werr := ws.Write(ctx, websocket.MessageBinary, buf[:n]); werr != nil {
				return
			}
		}
		if err != nil {
			if ctx.Err() == nil {
				_ = ws.Close(websocket.StatusGoingAway, "screen stream ended")
			}
			return
		}
	}
}

// start runs a scrcpy server until ctx ends and connects its video and
// control sockets.
// The server deletes its jar when it exits, so every run pushes its own.
func (s *Scrcpy) start(ctx context.Context) (video, control net.Conn, err error) {
	scid := fmt.Sprintf("%08x", rand.Int32())
	jar := "/data/local/tmp/holtdroid-scrcpy-" + scid + ".jar"
	if err := s.dev.Push(ctx, s.cfg.Server, jar); err != nil {
		return nil, nil, fmt.Errorf("push scrcpy server: %w", err)
	}
	port, err := s.dev.ForwardTo(ctx, "localabstract:scrcpy_"+scid)
	if err != nil {
		return nil, nil, err
	}
	go func() {
		<-ctx.Done()
		_ = s.dev.RemoveForward(context.WithoutCancel(ctx), port)
	}()

	exited := make(chan error, 1)
	go func() { exited <- s.dev.Run(ctx, s.command(jar, scid)) }()

	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	deadline := time.Now().Add(15 * time.Second)
	for {
		video, err = dialScrcpy(ctx, addr)
		if err == nil {
			break
		}
		select {
		case err := <-exited:
			return nil, nil, fmt.Errorf("scrcpy server exited: %w", errors.Join(err, errors.New("no connection")))
		case <-ctx.Done():
			return nil, nil, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
		if time.Now().After(deadline) {
			return nil, nil, fmt.Errorf("scrcpy server did not accept a connection: %w", err)
		}
	}
	var d net.Dialer
	control, err = d.DialContext(ctx, "tcp", addr)
	if err != nil {
		video.Close()
		return nil, nil, err
	}
	return video, control, nil
}

// dialScrcpy connects the first socket. adb accepts a forwarded connection
// even before the server listens and then closes it, so the connection only
// counts once the server's dummy byte arrives.
func dialScrcpy(ctx context.Context, addr string) (net.Conn, error) {
	var d net.Dialer
	c, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := io.ReadFull(c, make([]byte, 1)); err != nil {
		c.Close()
		return nil, err
	}
	_ = c.SetReadDeadline(time.Time{})
	return c, nil
}

func (s *Scrcpy) command(jar, scid string) string {
	return fmt.Sprintf("CLASSPATH=%s app_process / com.genymobile.scrcpy.Server %s scid=%s log_level=warn "+
		"tunnel_forward=true audio=false control=true clipboard_autosync=false video_codec=h264 "+
		"video_bit_rate=%d max_fps=%d",
		jar, s.cfg.Version, scid, s.cfg.BitRate, s.cfg.MaxFPS)
}
