package agent

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/holtdroid/holtdroid/internal/contract"
)

const micDexRemote = "/data/local/tmp/holtdroid-mic.dex"

var (
	errNoMicrophone = errors.New("the device's microphone can't be replaced in this session")
	micMediaID      = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
)

// Microphone replaces what the device's microphone hears. The Mic helper
// registers an AudioPolicy that routes every recording to a remote submix
// and plays what the agent sends it there (decision #146); it is gone, and
// the microphone silent again, as soon as the helper exits.
type Microphone struct {
	dev       ScrcpyDevice
	dex       string
	ffmpeg    string
	dir       string
	hc        *http.Client
	log       *slog.Logger
	available bool

	mu     sync.Mutex
	ctx    context.Context
	state  contract.Microphone
	stop   context.CancelFunc
	done   chan struct{}
	pushed bool
}

func NewMicrophone(dev ScrcpyDevice, dex, ffmpeg, dir string, available bool, log *slog.Logger) *Microphone {
	return &Microphone{
		dev: dev, dex: dex, ffmpeg: ffmpeg, dir: dir, available: available, log: log,
		hc:    &http.Client{Timeout: 30 * time.Minute},
		state: contract.Microphone{Source: contract.MicOff},
	}
}

// Run lets sources play once the device is up and stops them when ctx ends.
func (m *Microphone) Run(ctx context.Context) {
	m.mu.Lock()
	m.ctx = ctx
	m.mu.Unlock()
	<-ctx.Done()
	m.halt()
}

func (m *Microphone) State() contract.Microphone {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.state
	s.Available = m.available
	return s
}

func (m *Microphone) Set(ctx context.Context, in contract.SetMicrophone) (contract.Microphone, error) {
	if !m.available {
		return contract.Microphone{}, errNoMicrophone
	}
	next := contract.Microphone{Source: in.Source}
	var produce func(context.Context, io.Writer) error
	switch in.Source {
	case contract.MicOff:
	case contract.MicTone, contract.MicBeeps, contract.MicNoise:
		args := micArgs(in.Source, "")
		produce = func(ctx context.Context, w io.Writer) error { return m.runFFmpeg(ctx, args, w) }
	case contract.MicFile:
		if !micMediaID.MatchString(in.MediaID) || in.FileURL == "" {
			return contract.Microphone{}, fmt.Errorf("%w: the file source needs a media id and a file URL", contract.ErrInvalid)
		}
		path, err := m.download(ctx, in.MediaID, in.FileURL)
		if err != nil {
			return contract.Microphone{}, err
		}
		next.MediaID, next.File = in.MediaID, in.File
		args := micArgs(contract.MicFile, path)
		produce = func(ctx context.Context, w io.Writer) error { return m.runFFmpeg(ctx, args, w) }
	default:
		return contract.Microphone{}, fmt.Errorf("%w: unknown microphone source %q", contract.ErrInvalid, in.Source)
	}
	if _, err := m.play(next, produce); err != nil {
		return contract.Microphone{}, err
	}
	return m.State(), nil
}

// ServeBrowser takes the viewer's microphone over a WebSocket for as long as
// it stays open.
func (m *Microphone) ServeBrowser(w http.ResponseWriter, r *http.Request) {
	if !m.available {
		http.Error(w, errNoMicrophone.Error(), http.StatusConflict)
		return
	}
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer func() { _ = ws.CloseNow() }()
	ws.SetReadLimit(1 << 20)
	done, err := m.play(contract.Microphone{Source: contract.MicBrowser}, func(ctx context.Context, out io.Writer) error {
		return pipeBrowser(ctx, ws, out)
	})
	if err != nil {
		_ = ws.Close(websocket.StatusTryAgainLater, err.Error())
		return
	}
	select {
	case <-done:
		if s := m.State(); s.Error != "" {
			_ = ws.Close(websocket.StatusInternalError, s.Error)
		}
	case <-r.Context().Done():
		m.mu.Lock()
		browser := m.state.Source == contract.MicBrowser
		m.mu.Unlock()
		if browser {
			m.halt()
		}
	}
}

// pipeBrowser turns the browser's mono samples into the helper's stereo.
func pipeBrowser(ctx context.Context, ws *websocket.Conn, out io.Writer) error {
	var odd []byte
	for {
		typ, data, err := ws.Read(ctx)
		if err != nil {
			return browserEnded(ctx, err)
		}
		if typ != websocket.MessageBinary {
			continue
		}
		data = append(odd, data...)
		n := len(data) &^ 1
		odd = append([]byte(nil), data[n:]...)
		stereo := make([]byte, 2*n)
		for i := 0; i < n; i += 2 {
			copy(stereo[2*i:], data[i:i+2])
			copy(stereo[2*i+2:], data[i:i+2])
		}
		if _, err := out.Write(stereo); err != nil {
			return err
		}
	}
}

// browserEnded is nil when the browser closed the socket or another source
// took over.
func browserEnded(ctx context.Context, err error) error {
	if websocket.CloseStatus(err) == websocket.StatusNormalClosure || ctx.Err() != nil {
		err = nil
	}
	return err
}

// micArgs reads a source with ffmpeg in real time as the helper's PCM:
// signed 16-bit stereo at 48 kHz. The tone is the EBU line-up level,
// -18 dBFS, which is ffmpeg's default sine amplitude.
func micArgs(source contract.MicrophoneSource, file string) []string {
	rate := strconv.Itoa(contract.MicrophoneRate)
	var input []string
	switch source {
	case contract.MicTone:
		input = []string{"-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=" + rate}
	case contract.MicBeeps:
		input = []string{"-f", "lavfi", "-i", `aevalsrc=0.5*sin(2*PI*1000*t)*lt(mod(t\,1)\,0.1):s=` + rate}
	case contract.MicNoise:
		input = []string{"-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.25:sample_rate=" + rate}
	case contract.MicFile:
		input = []string{"-stream_loop", "-1", "-i", file}
	}
	args := append([]string{"-hide_banner", "-loglevel", "error", "-nostdin", "-re"}, input...)
	return append(args, "-vn", "-ac", "2", "-ar", rate, "-f", "s16le", "pipe:1")
}

func (m *Microphone) runFFmpeg(ctx context.Context, args []string, w io.Writer) error {
	var stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, m.ffmpeg, args...)
	cmd.Stdout, cmd.Stderr = w, &stderr
	cmd.WaitDelay = 2 * time.Second
	if err := cmd.Run(); err != nil && ctx.Err() == nil {
		if msg := bytes.TrimSpace(stderr.Bytes()); len(msg) > 0 {
			return fmt.Errorf("ffmpeg: %s", lastLine(msg))
		}
		return fmt.Errorf("ffmpeg: %w", err)
	}
	return nil
}

func lastLine(b []byte) string {
	if i := bytes.LastIndexByte(b, '\n'); i >= 0 {
		b = b[i+1:]
	}
	return string(b)
}

// download keeps one media file at a time: the one playing.
func (m *Microphone) download(ctx context.Context, id, url string) (string, error) {
	if err := os.MkdirAll(m.dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(m.dir, id)
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := m.hc.Do(req)
	if err != nil {
		return "", fmt.Errorf("download the media file: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download the media file: %s", resp.Status)
	}
	f, err := os.CreateTemp(m.dir, ".download-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(f.Name())
	_, err = io.Copy(f, resp.Body)
	if err = errors.Join(err, f.Close()); err != nil {
		return "", fmt.Errorf("download the media file: %w", err)
	}
	if entries, err := os.ReadDir(m.dir); err == nil {
		for _, e := range entries {
			if e.Name() != filepath.Base(f.Name()) {
				_ = os.Remove(filepath.Join(m.dir, e.Name()))
			}
		}
	}
	return path, os.Rename(f.Name(), path)
}

// play stops what plays and starts produce feeding a new helper until the
// returned channel closes; a nil produce leaves the microphone off.
func (m *Microphone) play(next contract.Microphone, produce func(context.Context, io.Writer) error) (<-chan struct{}, error) {
	m.halt()
	m.mu.Lock()
	defer m.mu.Unlock()
	if produce == nil {
		m.state = next
		return nil, nil
	}
	if m.ctx == nil || m.ctx.Err() != nil {
		return nil, errors.New("the device is not up yet")
	}
	ctx, cancel := context.WithCancel(m.ctx)
	done := make(chan struct{})
	m.state, m.stop, m.done = next, cancel, done
	go func() {
		defer close(done)
		defer cancel()
		err := m.feed(ctx, produce)
		if ctx.Err() != nil && err == nil {
			return
		}
		m.mu.Lock()
		if m.done == done {
			m.state = contract.Microphone{Source: contract.MicOff}
			if err != nil {
				m.state.Error = err.Error()
			}
		}
		m.mu.Unlock()
		if err != nil {
			m.log.Warn("microphone", "source", next.Source, "err", err)
		}
	}()
	return done, nil
}

func (m *Microphone) halt() {
	m.mu.Lock()
	stop, done := m.stop, m.done
	m.stop, m.done = nil, nil
	m.state = contract.Microphone{Source: contract.MicOff}
	m.mu.Unlock()
	if stop != nil {
		stop()
		<-done
	}
}

// feed starts the helper, connects to it and writes what produce makes
// until either ends.
func (m *Microphone) feed(ctx context.Context, produce func(context.Context, io.Writer) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	if err := m.push(ctx); err != nil {
		return err
	}
	name := fmt.Sprintf("holtdroid_mic_%08x", rand.Int32())
	port, err := m.dev.ForwardTo(ctx, "localabstract:"+name)
	if err != nil {
		return err
	}
	defer func() { _ = m.dev.RemoveForward(context.WithoutCancel(ctx), port) }()
	exited := make(chan error, 1)
	go func() { exited <- m.dev.Run(ctx, "CLASSPATH="+micDexRemote+" app_process / Mic "+name) }()

	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	deadline := time.Now().Add(15 * time.Second)
	var conn net.Conn
	for {
		if conn, err = dialScrcpy(ctx, addr); err == nil {
			break
		}
		select {
		case err := <-exited:
			return fmt.Errorf("the microphone helper exited: %w", errors.Join(err, errors.New("no connection")))
		case <-ctx.Done():
			return nil
		case <-time.After(100 * time.Millisecond):
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("the microphone helper did not accept a connection: %w", err)
		}
	}
	defer conn.Close()
	go func() {
		<-ctx.Done()
		conn.Close()
	}()
	produced := make(chan error, 1)
	go func() { produced <- produce(ctx, conn) }()
	select {
	case err := <-produced:
		return err
	case err := <-exited:
		if ctx.Err() != nil {
			return nil
		}
		return fmt.Errorf("the microphone helper exited: %w", errors.Join(err, errors.New("stopped")))
	}
}

func (m *Microphone) push(ctx context.Context) error {
	m.mu.Lock()
	pushed := m.pushed
	m.mu.Unlock()
	if pushed {
		return nil
	}
	if err := m.dev.Push(ctx, m.dex, micDexRemote); err != nil {
		return fmt.Errorf("push the microphone helper: %w", err)
	}
	m.mu.Lock()
	m.pushed = true
	m.mu.Unlock()
	return nil
}
