package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/recording"
)

const (
	recordingDevicePoll = 30 * time.Second
	thumbnailWidth      = 360
)

type execOutDevice interface {
	ExecOut(ctx context.Context, cmd string, w io.Writer) error
}

func (a *Agent) Recording(context.Context) contract.RecordingState {
	a.recMu.Lock()
	defer a.recMu.Unlock()
	if a.rec != nil {
		s := a.rec.State()
		s.ID = a.recID
		return s
	}
	return a.recLast
}

func (a *Agent) StartRecording(_ context.Context, target contract.RecordingTarget) (contract.RecordingState, error) {
	if a.Status(context.Background()).State != contract.StateReady {
		return contract.RecordingState{}, fmt.Errorf("%w: the session isn't ready", contract.ErrInvalid)
	}
	if err := a.startRecording(target); err != nil {
		return contract.RecordingState{}, err
	}
	return a.Recording(context.Background()), nil
}

func (a *Agent) StopRecording(ctx context.Context) (contract.RecordingState, error) {
	a.recMu.Lock()
	rec, thumb := a.rec, a.recThumb
	a.recMu.Unlock()
	if rec == nil {
		return a.Recording(ctx), nil
	}
	a.watch.stop(rec)
	if !thumb.picked() {
		a.thumbnail(ctx, rec)
	}
	s := rec.Stop(ctx)
	a.recordingEnded(rec, s)
	return a.Recording(ctx), nil
}

func (a *Agent) startRecording(target contract.RecordingTarget) error {
	a.recMu.Lock()
	defer a.recMu.Unlock()
	if a.rec != nil {
		return fmt.Errorf("%w: recording %s is in progress", contract.ErrBusy, a.recID)
	}
	ctx, cancel := context.WithCancel(a.recCtx)
	var rec *recording.Recorder
	thumb := &thumbPicker{best: -1}
	rec = recording.Start(target, recording.DefaultConfig(), a.log,
		recording.OnStop(func(s contract.RecordingState) { a.recordingEnded(rec, s) }),
		recording.OnTouch(func(t int64) { a.touchThumbnail(ctx, rec, thumb, t) }))
	a.rec, a.recID, a.recCancel, a.recThumb = rec, target.ID, cancel, thumb
	a.watch.record(rec, target.ID)
	a.screen.video.attach(ctx, rec)
	a.screen.sound.attach(ctx, rec)
	go a.feedRecording(ctx, rec, thumb)
	a.mu.Lock()
	a.status.Recording, a.status.RecordedAt = target.ID, rec.State().StartedAt
	a.mu.Unlock()
	a.notify()
	a.log.Info("recording started", "recording", target.ID)
	return nil
}

func (a *Agent) recordingEnded(rec *recording.Recorder, s contract.RecordingState) {
	a.watch.stop(rec)
	a.screen.video.detach(rec)
	a.screen.sound.detach(rec)
	a.recMu.Lock()
	if a.rec != rec {
		a.recMu.Unlock()
		return
	}
	s.ID = a.recID
	a.rec, a.recLast = nil, s
	a.recCancel()
	a.recMu.Unlock()
	a.mu.Lock()
	a.status.Recording, a.status.RecordedAt = "", time.Time{}
	a.mu.Unlock()
	a.notify()
	a.log.Info("recording stopped", "recording", s.ID, "duration", s.Duration, "size", s.Size, "err", s.Error)
}

// shutdownRecording uploads the rest of a recording when the agent stops.
func (a *Agent) shutdownRecording() {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	_, _ = a.StopRecording(ctx)
}

// record adds an event to the recording in progress, if any.
func (a *Agent) record(ev contract.RecordingEvent) {
	a.recMu.Lock()
	rec := a.rec
	a.recMu.Unlock()
	if rec != nil {
		rec.Event(ev)
	}
}

func (a *Agent) feedRecording(ctx context.Context, rec *recording.Recorder, thumb *thumbPicker) {
	go a.recordLogcat(ctx, rec)
	go func() {
		select {
		case <-ctx.Done():
		case <-time.After(thumbnailAt):
			if !thumb.picked() {
				a.thumbnail(ctx, rec)
			}
		}
	}()
	a.recordInfo(ctx, rec)
	if n, err := a.network.Get(ctx); err == nil {
		rec.Event(contract.RecordingEvent{Type: contract.EventNetwork, Network: &n})
	}
	var lastDevice []byte
	pollDevice := func() {
		st, err := a.controls.State(ctx)
		if err != nil {
			return
		}
		if b, _ := json.Marshal(st); string(b) != string(lastDevice) {
			lastDevice = b
			rec.Event(contract.RecordingEvent{Type: contract.EventDevice, Device: &st})
		}
	}
	pollDevice()
	metrics, stopMetrics := a.metrics.subscribe()
	defer stopMetrics()
	var dnsEvents <-chan contract.DNSEvent
	if a.resolver != nil {
		var stop func()
		dnsEvents, stop = a.resolver.Subscribe()
		defer stop()
	}
	updates, stopUpdates := a.subscribe()
	defer stopUpdates()
	var last contract.StatusEvent
	sendStatus := func() {
		s := a.Status(ctx)
		s.Recording, s.RecordedAt = "", time.Time{}
		if s != last {
			last = s
			rec.Event(contract.RecordingEvent{Type: contract.EventStatus, Status: &s})
		}
	}
	sendStatus()
	tick := time.NewTicker(recordingDevicePoll)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case m := <-metrics:
			rec.Event(contract.RecordingEvent{Type: contract.EventMetrics, Metrics: &m})
		case ev := <-dnsEvents:
			rec.Event(contract.RecordingEvent{Type: contract.EventDNS, DNS: &ev})
		case <-updates:
			sendStatus()
		case <-tick.C:
			pollDevice()
		}
	}
}

func (a *Agent) recordInfo(ctx context.Context, rec *recording.Recorder) {
	info, err := deviceInfo(ctx, a.dev, a.cfg.Package)
	if err != nil {
		a.log.Warn("recording: device info", "err", err)
	}
	info.ArtifactRef = a.currentArtifact()
	rec.Event(contract.RecordingEvent{Type: contract.EventInfo, Info: &info})
}

// thumbPicker makes the preview the screen just before the viewer's touch
// nearest to thumbnailAt, taken when the finger goes down.
type thumbPicker struct {
	mu     sync.Mutex
	best   int64
	taking bool
	done   bool
}

func (p *thumbPicker) picked() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.best >= 0
}

const thumbnailAt = 5 * time.Second

func (a *Agent) touchThumbnail(ctx context.Context, rec *recording.Recorder, p *thumbPicker, t int64) {
	p.mu.Lock()
	if p.done || p.taking {
		p.mu.Unlock()
		return
	}
	p.taking = true
	p.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	png, err := a.dev.Screencap(ctx)
	var jpeg []byte
	if err == nil {
		jpeg, err = recording.Thumbnail(png, thumbnailWidth)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.taking = false
	if err != nil {
		return
	}
	at := thumbnailAt.Milliseconds()
	if p.best < 0 || abs64(t-at) < abs64(p.best-at) {
		p.best = t
		rec.Thumbnail(jpeg)
	}
	if t >= at {
		p.done = true
	}
}

func abs64(v int64) int64 { return max(v, -v) }

func (a *Agent) thumbnail(ctx context.Context, rec *recording.Recorder) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	png, err := a.dev.Screencap(ctx)
	if err != nil {
		return
	}
	if jpeg, err := recording.Thumbnail(png, thumbnailWidth); err == nil {
		rec.Thumbnail(jpeg)
	}
}

// recordLogcat follows the device's logcat while the recording runs.
func (a *Agent) recordLogcat(ctx context.Context, rec *recording.Recorder) {
	dev, ok := a.dev.(execOutDevice)
	if !ok {
		return
	}
	for ctx.Err() == nil {
		pr, pw := io.Pipe()
		go func() {
			sc := bufio.NewScanner(pr)
			sc.Buffer(make([]byte, 64<<10), 1<<20)
			for sc.Scan() {
				if line := strings.TrimRight(sc.Text(), "\r"); line != "" && !strings.HasPrefix(line, "--------- beginning of") {
					rec.Logcat(line)
				}
			}
			_, _ = io.Copy(io.Discard, pr)
		}()
		err := dev.ExecOut(ctx, "logcat -v threadtime -T 1", pw)
		pw.Close()
		if ctx.Err() != nil {
			return
		}
		a.log.Debug("recording: logcat ended", "err", err)
		select {
		case <-ctx.Done():
		case <-time.After(5 * time.Second):
		}
	}
}

const infoScript = `for p in ro.product.manufacturer ro.product.model ro.build.version.release ro.build.version.sdk ro.build.display.id ro.product.cpu.abi; do echo "$p=$(getprop $p)"; done
dumpsys webviewupdate 2>/dev/null | grep -m1 'Current WebView package'
dumpsys package %s 2>/dev/null | grep -m2 -oE '(versionName|versionCode)=[^ ]+'`

func deviceInfo(ctx context.Context, dev Device, pkg string) (contract.RecordingInfoData, error) {
	info := contract.RecordingInfoData{Package: pkg}
	out, err := dev.Shell(ctx, fmt.Sprintf(infoScript, pkg))
	if err != nil {
		return info, err
	}
	return parseDeviceInfo(out, info), nil
}

func parseDeviceInfo(out string, info contract.RecordingInfoData) contract.RecordingInfoData {
	for line := range strings.Lines(out) {
		line = strings.TrimSpace(line)
		if rest, ok := strings.CutPrefix(line, "Current WebView package (name, version): "); ok {
			info.WebView = strings.NewReplacer("(", "", ")", "", ", ", " ").Replace(rest)
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		switch k {
		case "ro.product.manufacturer":
			info.Manufacturer = v
		case "ro.product.model":
			info.Model = v
		case "ro.build.version.release":
			info.Android = v
		case "ro.build.version.sdk":
			info.SDK, _ = strconv.Atoi(v)
		case "ro.build.display.id":
			info.Build = v
		case "ro.product.cpu.abi":
			info.ABI = v
		case "versionName":
			info.VersionName = v
		case "versionCode":
			info.VersionCode, _ = strconv.ParseInt(v, 10, 64)
		}
	}
	return info
}
