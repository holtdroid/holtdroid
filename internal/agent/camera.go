package agent

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/holtdroid/holtdroid/internal/contract"
)

const cameraHAL = "/vendor/bin/hw/android.hardware.camera.provider-holtdroid"

var errNoCamera = errors.New("the device has no Holtdroid camera")

// Camera feeds holtdroid-redroid's camera HAL. The HAL connects to the feed
// address only while an app has the camera open, asks for "<width> <height>
// <fps>" and reads I420 frames; nothing runs otherwise (decision #155). The
// address is an abstract Unix socket: the Pod's containers share it, and
// Android's firewall keeps the HAL's uid off TCP.
type Camera struct {
	dev    ScrcpyDevice
	ffmpeg string
	font   string
	dir    string
	hc     *http.Client
	log    *slog.Logger

	mu        sync.Mutex
	available bool
	state     contract.Camera
	path      string
	image     bool
	changed   chan struct{}
	conns     int
	frame     []byte
}

func NewCamera(dev ScrcpyDevice, ffmpeg, font, dir string, log *slog.Logger) *Camera {
	return &Camera{
		dev: dev, ffmpeg: ffmpeg, font: font, dir: dir, log: log,
		hc:      &http.Client{Timeout: 30 * time.Minute},
		state:   contract.Camera{Source: contract.CameraBars},
		changed: make(chan struct{}),
	}
}

// Run serves the feed at addr (@name for an abstract Unix socket, otherwise
// TCP) until ctx ends, once it finds the HAL on the device.
func (c *Camera) Run(ctx context.Context, addr string) {
	out, err := c.dev.Shell(ctx, "ls "+cameraHAL)
	if err != nil || !strings.Contains(out, cameraHAL) {
		return
	}
	network := "tcp"
	if strings.HasPrefix(addr, "@") {
		network = "unix"
	}
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, network, addr)
	if err != nil {
		c.log.Warn("camera feed", "err", err)
		return
	}
	go func() {
		<-ctx.Done()
		ln.Close()
	}()
	c.mu.Lock()
	c.available = true
	c.mu.Unlock()
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		go c.serve(ctx, conn)
	}
}

func (c *Camera) State() contract.Camera {
	c.mu.Lock()
	defer c.mu.Unlock()
	s := c.state
	s.Available, s.InUse = c.available, c.conns > 0
	return s
}

func (c *Camera) Set(ctx context.Context, in contract.SetCamera) (contract.Camera, error) {
	c.mu.Lock()
	available := c.available
	c.mu.Unlock()
	if !available {
		return contract.Camera{}, errNoCamera
	}
	next := contract.Camera{Source: in.Source}
	path := ""
	switch in.Source {
	case contract.CameraBars, contract.CameraBlack:
	case contract.CameraFile:
		if !micMediaID.MatchString(in.MediaID) || in.FileURL == "" {
			return contract.Camera{}, fmt.Errorf("%w: the file source needs a media id and a file URL", contract.ErrInvalid)
		}
		p, err := downloadMedia(ctx, c.hc, c.dir, in.MediaID, in.FileURL)
		if err != nil {
			return contract.Camera{}, err
		}
		path, next.MediaID, next.File = p, in.MediaID, in.File
	default:
		return contract.Camera{}, fmt.Errorf("%w: unknown camera source %q", contract.ErrInvalid, in.Source)
	}
	c.switchTo(next, path, in.Image)
	return c.State(), nil
}

func (c *Camera) switchTo(next contract.Camera, path string, image bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.state, c.path, c.image = next, path, image
	close(c.changed)
	c.changed = make(chan struct{})
}

// ServeBrowser shows the viewer's camera, JPEG frames over a WebSocket, for
// as long as it stays open.
func (c *Camera) ServeBrowser(w http.ResponseWriter, r *http.Request) {
	if !c.State().Available {
		http.Error(w, errNoCamera.Error(), http.StatusConflict)
		return
	}
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer func() { _ = ws.CloseNow() }()
	ws.SetReadLimit(4 << 20)
	c.switchTo(contract.Camera{Source: contract.CameraBrowser}, "", false)
	c.mu.Lock()
	mine := c.changed
	c.mu.Unlock()
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		select {
		case <-mine:
			_ = ws.Close(websocket.StatusNormalClosure, "another source took over")
		case <-ctx.Done():
		}
	}()
	for {
		typ, data, err := ws.Read(ctx)
		if err != nil {
			break
		}
		if typ != websocket.MessageBinary {
			continue
		}
		c.mu.Lock()
		c.frame = data
		c.mu.Unlock()
	}
	c.mu.Lock()
	still := c.changed == mine
	c.frame = nil
	c.mu.Unlock()
	if still {
		c.switchTo(contract.Camera{Source: contract.CameraBars}, "", false)
	}
}

func (c *Camera) serve(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	r := bufio.NewReader(conn)
	line, err := r.ReadString('\n')
	if err != nil {
		return
	}
	_ = conn.SetReadDeadline(time.Time{})
	var w, h, fps int
	if _, err := fmt.Sscanf(line, "%d %d %d", &w, &h, &fps); err != nil || w < 16 || h < 16 || w > 3840 || h > 2160 || w%2 != 0 || h%2 != 0 ||
		fps < 1 || fps > 60 {
		c.log.Warn("camera feed: bad request", "line", strings.TrimSpace(line))
		return
	}
	c.mu.Lock()
	c.conns++
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		c.conns--
		c.mu.Unlock()
	}()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		_, _ = io.Copy(io.Discard, r)
		cancel()
	}()
	for ctx.Err() == nil {
		c.mu.Lock()
		state, path, image, changed := c.state, c.path, c.image, c.changed
		c.mu.Unlock()
		fctx, fcancel := context.WithCancel(ctx)
		go func() {
			select {
			case <-changed:
				fcancel()
			case <-fctx.Done():
			}
		}()
		err := c.feed(fctx, conn, state.Source, path, image, w, h, fps)
		fcancel()
		if ctx.Err() != nil {
			return
		}
		select {
		case <-changed:
			continue
		default:
		}
		if err != nil {
			c.log.Warn("camera", "source", state.Source, "err", err)
			c.mu.Lock()
			if c.changed == changed {
				c.state.Error = err.Error()
			}
			c.mu.Unlock()
		}
		select {
		case <-changed:
		case <-ctx.Done():
		}
	}
}

func (c *Camera) feed(ctx context.Context, conn net.Conn, src contract.CameraSource, path string, image bool, w, h, fps int) error {
	out := &frameWriter{w: conn, size: w * h * 3 / 2}
	args := cameraArgs(src, path, image, c.font, w, h, fps)
	if src != contract.CameraBrowser {
		return runFFmpeg(ctx, c.ffmpeg, args, nil, out)
	}
	pr, pw := io.Pipe()
	go c.pump(ctx, pw, fps)
	return runFFmpeg(ctx, c.ffmpeg, args, pr, out)
}

// pump hands ffmpeg the browser's latest frame fps times a second, the same
// one again when no new one came.
func (c *Camera) pump(ctx context.Context, w *io.PipeWriter, fps int) {
	defer w.Close()
	tick := time.NewTicker(time.Second / time.Duration(fps))
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		c.mu.Lock()
		frame := c.frame
		c.mu.Unlock()
		if frame == nil {
			continue
		}
		if _, err := w.Write(frame); err != nil {
			return
		}
	}
}

// frameWriter passes on whole frames only, so a source that stops mid-frame
// doesn't shift the HAL's stream.
type frameWriter struct {
	w    io.Writer
	size int
	buf  []byte
}

func (f *frameWriter) Write(p []byte) (int, error) {
	f.buf = append(f.buf, p...)
	for len(f.buf) >= f.size {
		if _, err := f.w.Write(f.buf[:f.size]); err != nil {
			return 0, err
		}
		f.buf = f.buf[f.size:]
	}
	if cap(f.buf) > 4*f.size {
		f.buf = append([]byte(nil), f.buf...)
	}
	return len(p), nil
}

// cameraArgs makes ffmpeg read a source in real time as I420 frames of w×h.
// The HAL's sensor is mounted at 90° like a phone's back camera, so a
// picture drawn upright in portrait is turned a quarter counter-clockwise.
func cameraArgs(src contract.CameraSource, path string, image bool, font string, w, h, fps int) []string {
	pw, ph, rate := strconv.Itoa(h), strconv.Itoa(w), strconv.Itoa(fps)
	size := pw + "x" + ph
	var input []string
	filters := "scale=" + pw + ":" + ph + ":force_original_aspect_ratio=increase,crop=" + pw + ":" + ph + ",setsar=1,fps=" + rate
	switch src {
	case contract.CameraBars:
		input = []string{"-re", "-f", "lavfi", "-i", "smptehdbars=size=" + size + ":rate=" + rate}
		filters = "drawtext=fontfile=" + font + ":text='%{localtime}':fontcolor=white:fontsize=h/24:x=(w-text_w)/2:y=h/10" +
			":box=1:boxcolor=black@0.6:boxborderw=16," + filters
	case contract.CameraBlack:
		input = []string{"-re", "-f", "lavfi", "-i", "color=c=black:size=" + size + ":rate=" + rate}
	case contract.CameraFile:
		if image {
			input = []string{"-re", "-loop", "1", "-framerate", rate, "-i", path}
		} else {
			input = []string{"-re", "-stream_loop", "-1", "-i", path}
		}
	case contract.CameraBrowser:
		input = []string{"-f", "image2pipe", "-framerate", rate, "-c:v", "mjpeg", "-i", "pipe:0"}
	}
	args := append([]string{"-hide_banner", "-loglevel", "error"}, input...)
	return append(args, "-an", "-vf", filters+",transpose=2,format=yuv420p", "-f", "rawvideo", "-pix_fmt", "yuv420p", "pipe:1")
}
