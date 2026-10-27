package fake

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/recording"
)

// recorder records a fake session with the agent's recorder: the looping
// screen, the made-up metrics and logs, and the settings as they change.
type recorder struct {
	mu     sync.Mutex
	rec    *recording.Recorder
	id     string
	cancel context.CancelFunc
	last   contract.RecordingState
}

func (d *device) Recording(context.Context) contract.RecordingState {
	d.rec.mu.Lock()
	defer d.rec.mu.Unlock()
	if d.rec.rec != nil {
		s := d.rec.rec.State()
		s.ID = d.rec.id
		return s
	}
	return d.rec.last
}

func (d *device) StartRecording(ctx context.Context, target contract.RecordingTarget) (contract.RecordingState, error) {
	if d.session().State != contract.StateReady {
		return contract.RecordingState{}, fmt.Errorf("%w: the session isn't ready", contract.ErrInvalid)
	}
	if err := d.startRecording(target); err != nil {
		return contract.RecordingState{}, err
	}
	return d.Recording(ctx), nil
}

func (d *device) StopRecording(ctx context.Context) (contract.RecordingState, error) {
	d.rec.mu.Lock()
	rec := d.rec.rec
	d.rec.mu.Unlock()
	if rec != nil {
		d.thumbnail(ctx, rec)
		d.recordingEnded(rec, rec.Stop(ctx))
	}
	return d.Recording(ctx), nil
}

func (d *device) startRecording(target contract.RecordingTarget) error {
	d.rec.mu.Lock()
	defer d.rec.mu.Unlock()
	if d.rec.rec != nil {
		return fmt.Errorf("%w: recording %s is in progress", contract.ErrBusy, d.rec.id)
	}
	ctx, cancel := context.WithCancel(context.Background())
	var rec *recording.Recorder
	rec = recording.Start(target, recording.DefaultConfig(), slog.Default().With("component", "fake-agent"),
		recording.OnStop(func(s contract.RecordingState) { d.recordingEnded(rec, s) }))
	d.rec.rec, d.rec.id, d.rec.cancel = rec, target.ID, cancel
	go d.recordScreen(ctx, rec)
	go d.recordState(ctx, rec)
	go d.recordLogs(ctx, rec)
	go d.recordDevTools(ctx, rec)
	go func() {
		select {
		case <-ctx.Done():
		case <-time.After(3 * time.Second):
			d.thumbnail(ctx, rec)
		}
	}()
	d.update(func() { d.recID, d.recAt = target.ID, rec.State().StartedAt })
	return nil
}

func (d *device) recordingEnded(rec *recording.Recorder, s contract.RecordingState) {
	d.rec.mu.Lock()
	if d.rec.rec != rec {
		d.rec.mu.Unlock()
		return
	}
	s.ID = d.rec.id
	d.rec.rec, d.rec.last = nil, s
	d.rec.cancel()
	d.rec.mu.Unlock()
	d.update(func() { d.recID, d.recAt = "", time.Time{} })
}

func (d *device) thumbnail(ctx context.Context, rec *recording.Recorder) {
	png, err := d.Screenshot(ctx)
	if err != nil {
		return
	}
	if jpeg, err := recording.Thumbnail(png, 360); err == nil {
		rec.Thumbnail(jpeg)
	}
}

func (d *device) recordScreen(ctx context.Context, rec *recording.Recorder) {
	tick := time.NewTicker(time.Second / screenFPS)
	defer tick.Stop()
	var pts int64
	for {
		for _, p := range screenPackets {
			if !p.config {
				select {
				case <-ctx.Done():
					return
				case <-tick.C:
				}
				pts += int64(time.Second/time.Microsecond) / screenFPS
			}
			rec.Video(recording.Packet{Config: p.config, Key: p.key, PTS: pts, Data: p.data})
		}
	}
}

func (d *device) recordLogs(ctx context.Context, rec *recording.Recorder) {
	_, ch, cancel := d.log.subscribe(0)
	defer cancel()
	for {
		select {
		case <-ctx.Done():
			return
		case e := <-ch:
			rec.Logcat(strings.TrimRight(formatLogEntry(e), "\n"))
		}
	}
}

func (d *device) recordState(ctx context.Context, rec *recording.Recorder) {
	s := d.session()
	rec.Event(contract.RecordingEvent{Type: contract.EventInfo, Info: &contract.RecordingInfoData{
		Manufacturer: "Holtdroid", Model: "Fake device", Android: "15", SDK: 35, Build: "fake-1", ABI: "x86_64",
		WebView: "com.android.webview " + cmp.Or(s.WebView, "128.0.6613.146"), Package: s.Package, VersionName: "1.0", VersionCode: 1,
		ArtifactRef: s.ArtifactRef,
	}})
	go d.recordDNS(ctx, rec)
	go func() {
		_ = d.WatchMetrics(ctx, func(m contract.Metrics) error {
			rec.Event(contract.RecordingEvent{Type: contract.EventMetrics, Metrics: &m})
			return nil
		})
	}()
	var lastDevice, lastNetwork, lastStatus string
	poll := func() {
		if st, err := d.Device(ctx); err == nil {
			if b, _ := json.Marshal(st); string(b) != lastDevice {
				lastDevice = string(b)
				rec.Event(contract.RecordingEvent{Type: contract.EventDevice, Device: &st})
			}
		}
		if n, err := d.Network(ctx); err == nil {
			if b, _ := json.Marshal(n); string(b) != lastNetwork {
				lastNetwork = string(b)
				rec.Event(contract.RecordingEvent{Type: contract.EventNetwork, Network: &n})
			}
		}
		st := d.Status(ctx)
		st.Recording, st.RecordedAt = "", time.Time{}
		if b, _ := json.Marshal(st); string(b) != lastStatus {
			lastStatus = string(b)
			rec.Event(contract.RecordingEvent{Type: contract.EventStatus, Status: &st})
		}
	}
	updates, stop := d.subscribe()
	defer stop()
	poll()
	for {
		select {
		case <-ctx.Done():
			return
		case <-updates:
			poll()
		}
	}
}
