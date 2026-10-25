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
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/holtdroid/holtdroid/internal/contract"
)

// KeepAudio captures the device's audio for the whole session instead of
// per viewer, so the device never plays it out loud (phones).
type ScrcpyConfig struct {
	Server    string
	Version   string
	BitRate   int
	MaxFPS    int
	KeepAudio bool
}

func DefaultScrcpyConfig() ScrcpyConfig {
	return ScrcpyConfig{Server: "/opt/scrcpy/scrcpy-server", Version: "3.3.3", BitRate: 4_000_000, MaxFPS: 60}
}

var videoCodecs = []string{"h264", "h265", "av1"}

// ScrcpyDevice is what the screen bridge needs from adb.
type ScrcpyDevice interface {
	Push(ctx context.Context, local, remote string) error
	ForwardTo(ctx context.Context, remote string) (int, error)
	RemoveForward(ctx context.Context, port int) error
	Run(ctx context.Context, cmd string) error
	Shell(ctx context.Context, cmd string) (string, error)
}

// Scrcpy runs scrcpy servers on the device. Every WebSocket on
// /display/scrcpy gets its own server: device→browser messages carry the
// video socket's bytes (device and codec meta, then packets with frame
// meta); browser→device messages are control messages, written to the
// control socket as is. /display/audio does the same with an audio-only
// server.
type Scrcpy struct {
	cfg ScrcpyConfig
	dev ScrcpyDevice
	log *slog.Logger

	audio    *audioHub
	mu       sync.Mutex
	encoders []string
}

func NewScrcpy(cfg ScrcpyConfig, dev ScrcpyDevice, log *slog.Logger) *Scrcpy {
	s := &Scrcpy{cfg: cfg, dev: dev, log: log}
	if cfg.KeepAudio {
		s.audio = newAudioHub(s)
	}
	return s
}

func (s *Scrcpy) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /display/scrcpy", s.serveVideo)
	if s.audio != nil {
		mux.HandleFunc("GET /display/audio", s.audio.serve)
	} else {
		mux.HandleFunc("GET /display/audio", s.serveAudio)
	}
}

// Run keeps the session's audio capture going when KeepAudio is set.
func (s *Scrcpy) Run(ctx context.Context) {
	if s.audio != nil {
		s.audio.run(ctx)
	}
}

type videoOptions struct {
	codec   string
	maxSize int
	maxFPS  int
	bitRate int
}

func (s *Scrcpy) videoOptions(q url.Values) (videoOptions, error) {
	o := videoOptions{codec: "h264", maxFPS: s.cfg.MaxFPS, bitRate: s.cfg.BitRate}
	if c := q.Get("codec"); c != "" {
		if !slices.Contains(videoCodecs, c) {
			return o, fmt.Errorf("unknown codec %q", c)
		}
		o.codec = c
	}
	for _, p := range []struct {
		name     string
		dst      *int
		min, max int
		zero     bool
	}{
		{"maxSize", &o.maxSize, 240, 4096, true},
		{"maxFps", &o.maxFPS, 1, 60, false},
		{"bitRate", &o.bitRate, 100_000, 50_000_000, false},
	} {
		v := q.Get(p.name)
		if v == "" {
			continue
		}
		n, err := strconv.Atoi(v)
		if err != nil || (n < p.min || n > p.max) && (n != 0 || !p.zero) {
			return o, fmt.Errorf("%s must be between %d and %d", p.name, p.min, p.max)
		}
		*p.dst = n
	}
	return o, nil
}

func (s *Scrcpy) serveVideo(w http.ResponseWriter, r *http.Request) {
	o, err := s.videoOptions(r.URL.Query())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	ws, ctx, cancel, ok := accept(w, r)
	if !ok {
		return
	}
	defer cancel()
	defer func() { _ = ws.CloseNow() }()
	if o.codec != "h264" {
		if found, err := s.supports(ctx, o.codec); err == nil && !found {
			_ = ws.Close(contract.DisplayUnsupportedCodec, "this device has no "+o.codec+" encoder")
			return
		}
	}
	conns, err := s.start(ctx, fmt.Sprintf("audio=false control=true clipboard_autosync=false "+
		"video_codec=%s video_bit_rate=%d max_fps=%d max_size=%d", o.codec, o.bitRate, o.maxFPS, o.maxSize), 2)
	if err != nil {
		s.log.Warn("scrcpy start", "err", err)
		_ = ws.Close(websocket.StatusTryAgainLater, "screen is not available yet")
		return
	}
	bridge(ctx, cancel, ws, conns[0], conns[1])
}

func (s *Scrcpy) serveAudio(w http.ResponseWriter, r *http.Request) {
	ws, ctx, cancel, ok := accept(w, r)
	if !ok {
		return
	}
	defer cancel()
	defer func() { _ = ws.CloseNow() }()
	conns, err := s.start(ctx, "video=false audio=true control=false audio_codec=opus send_device_meta=false", 1)
	if err != nil {
		s.log.Warn("scrcpy audio start", "err", err)
		_ = ws.Close(websocket.StatusTryAgainLater, "audio is not available yet")
		return
	}
	bridge(ctx, cancel, ws, conns[0], nil)
}

func accept(w http.ResponseWriter, r *http.Request) (*websocket.Conn, context.Context, context.CancelFunc, bool) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return nil, nil, nil, false
	}
	ws.SetReadLimit(1 << 20)
	ctx, cancel := context.WithCancel(r.Context())
	return ws, ctx, cancel, true
}

// bridge copies stream to the WebSocket and the WebSocket's binary messages
// to control; without a control socket they are dropped.
func bridge(ctx context.Context, cancel context.CancelFunc, ws *websocket.Conn, stream, control net.Conn) {
	go func() {
		<-ctx.Done()
		stream.Close()
		if control != nil {
			control.Close()
		}
	}()
	if control != nil {
		go func() {
			_, _ = io.Copy(io.Discard, control)
			cancel()
		}()
	}
	go func() {
		defer cancel()
		for {
			typ, data, err := ws.Read(ctx)
			if err != nil {
				return
			}
			if typ != websocket.MessageBinary || control == nil {
				continue
			}
			if _, err := control.Write(data); err != nil {
				return
			}
		}
	}()
	buf := make([]byte, 256<<10)
	for {
		n, err := stream.Read(buf)
		if n > 0 {
			if werr := ws.Write(ctx, websocket.MessageBinary, buf[:n]); werr != nil {
				return
			}
		}
		if err != nil {
			if ctx.Err() == nil {
				_ = ws.Close(websocket.StatusGoingAway, "stream ended")
			}
			return
		}
	}
}

var encoderRe = regexp.MustCompile(`--video-codec=(\w+)`)

// supports reports whether the device has an encoder for codec. The list is
// read once from the server.
func (s *Scrcpy) supports(ctx context.Context, codec string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.encoders == nil {
		jar := "/data/local/tmp/holtdroid-scrcpy-list.jar"
		if err := s.dev.Push(ctx, s.cfg.Server, jar); err != nil {
			return false, err
		}
		out, err := s.dev.Shell(ctx, s.command(jar, "log_level=info list_encoders=true")+"; rm -f "+jar)
		if err != nil {
			return false, err
		}
		encoders := []string{}
		for _, m := range encoderRe.FindAllStringSubmatch(out, -1) {
			encoders = append(encoders, m[1])
		}
		s.encoders = encoders
	}
	return slices.Contains(s.encoders, codec), nil
}

// start runs a scrcpy server with opts until ctx ends and connects its
// sockets, in scrcpy's order: video, audio, control.
// The server deletes its jar when it exits, so every run pushes its own.
func (s *Scrcpy) start(ctx context.Context, opts string, sockets int) ([]net.Conn, error) {
	scid := fmt.Sprintf("%08x", rand.Int32())
	jar := "/data/local/tmp/holtdroid-scrcpy-" + scid + ".jar"
	if err := s.dev.Push(ctx, s.cfg.Server, jar); err != nil {
		return nil, fmt.Errorf("push scrcpy server: %w", err)
	}
	port, err := s.dev.ForwardTo(ctx, "localabstract:scrcpy_"+scid)
	if err != nil {
		return nil, err
	}
	go func() {
		<-ctx.Done()
		_ = s.dev.RemoveForward(context.WithoutCancel(ctx), port)
	}()

	exited := make(chan error, 1)
	cmd := s.command(jar, "scid="+scid+" log_level=warn tunnel_forward=true "+opts)
	go func() { exited <- s.dev.Run(ctx, cmd) }()

	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	deadline := time.Now().Add(15 * time.Second)
	var first net.Conn
	for {
		first, err = dialScrcpy(ctx, addr)
		if err == nil {
			break
		}
		select {
		case err := <-exited:
			return nil, fmt.Errorf("scrcpy server exited: %w", errors.Join(err, errors.New("no connection")))
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("scrcpy server did not accept a connection: %w", err)
		}
	}
	conns := []net.Conn{first}
	var d net.Dialer
	for len(conns) < sockets {
		c, err := d.DialContext(ctx, "tcp", addr)
		if err != nil {
			for _, c := range conns {
				c.Close()
			}
			return nil, err
		}
		conns = append(conns, c)
	}
	return conns, nil
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

// command starts the server as the shell user even when adbd runs as root:
// the clipboard service rejects root calling as com.android.shell and clears
// the clipboard instead.
func (s *Scrcpy) command(jar, opts string) string {
	return fmt.Sprintf(`u=; [ "$(id -u)" = 0 ] && u="su 2000"; $u sh -c 'CLASSPATH=%s app_process / com.genymobile.scrcpy.Server %s %s'`,
		jar, s.cfg.Version, opts)
}
