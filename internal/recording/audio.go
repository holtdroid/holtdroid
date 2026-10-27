package recording

import (
	"bytes"
	"cmp"
	"errors"
	"fmt"
	"time"

	"github.com/bluenviron/mediacommon/v2/pkg/codecs/mpeg4audio"
	"github.com/bluenviron/mediacommon/v2/pkg/formats/fmp4"
	"github.com/bluenviron/mediacommon/v2/pkg/formats/fmp4/seekablebuffer"
	"github.com/bluenviron/mediacommon/v2/pkg/formats/mp4/codecs"

	"github.com/holtdroid/holtdroid/internal/contract"
)

const (
	opusRate     = 48000
	audioSegment = 10 * time.Second
	aacFrame     = 1024
)

// AudioCodec reports whether a recording can keep sound in codec.
func AudioCodec(codec string) bool { return codec == "opus" || codec == "aac" }

// audio is the sound being written: Opus or AAC packets, any of which can
// start a segment, so segments are cut by time alone.
type audio struct {
	epoch   int
	broken  bool
	based   bool
	basePTS int64
	baseT   int64
	samples []audioSample
	seq     int
	format  audioFormat
}

// audioFormat bounds a packet's length in samples, since the packets' times
// give it only roughly.
type audioFormat struct {
	rate, minSamples, maxSamples int64
	frameMicros                  int64
}

type audioSample struct {
	pts  int64
	data []byte
}

// Audio adds a packet of the device's sound: a config packet (OpusHead or an
// AAC AudioSpecificConfig) starts a run, the others are sound. The packets'
// own times pace the sound; the clock of the recording places its first one.
func (r *Recorder) Audio(p Packet) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stopped {
		return
	}
	a := &r.aud
	if p.Config {
		r.closeAudioSegment()
		if err := r.newAudioEpoch(p); err != nil {
			r.log.Warn("recording: audio can't be written", "err", err)
			a.broken = true
		}
		return
	}
	if a.epoch < 0 || a.broken || len(p.Data) == 0 {
		return
	}
	if n := len(a.samples); n > 0 && p.PTS <= a.samples[n-1].pts {
		return
	}
	if !a.based {
		a.basePTS, a.baseT, a.based = p.PTS, r.elapsed(), true
	}
	if len(a.samples) > 0 && p.PTS-a.samples[0].pts >= audioSegment.Microseconds() {
		r.writeAudioSegment(p.PTS)
	}
	a.samples = append(a.samples, audioSample{pts: p.PTS, data: bytes.Clone(p.Data)})
}

// AudioBreak says the sound will come from another capture next, with its
// own config packet and times.
func (r *Recorder) AudioBreak() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stopped {
		return
	}
	r.closeAudioSegment()
	r.aud.broken = true
}

func (r *Recorder) newAudioEpoch(p Packet) error {
	var (
		codec    codecs.Codec
		channels int
		format   audioFormat
	)
	switch p.Codec {
	case "aac":
		var c mpeg4audio.AudioSpecificConfig
		if err := c.Unmarshal(p.Data); err != nil {
			return fmt.Errorf("aac config: %w", err)
		}
		if c.SampleRate <= 0 {
			return errors.New("aac config without a sample rate")
		}
		channels = max(int(c.ChannelConfig), 1)
		codec = &codecs.MPEG4Audio{Config: c}
		rate := int64(c.SampleRate)
		format = audioFormat{rate: rate, minSamples: aacFrame, maxSamples: 4 * aacFrame, frameMicros: aacFrame * 1_000_000 / rate}
	case "opus", "":
		channels = 2
		if len(p.Data) >= 10 && string(p.Data[:8]) == "OpusHead" && p.Data[9] > 0 {
			channels = int(p.Data[9])
		}
		codec = &codecs.Opus{ChannelCount: channels}
		format = audioFormat{rate: opusRate, minSamples: 480, maxSamples: 5760, frameMicros: 20_000}
	default:
		return fmt.Errorf("unknown audio codec %q", p.Codec)
	}
	init := fmp4.Init{Tracks: []*fmp4.InitTrack{{ID: 1, TimeScale: uint32(format.rate), Codec: codec}}}
	var buf seekablebuffer.Buffer
	if err := init.Marshal(&buf); err != nil {
		return err
	}
	e := len(r.manifest.Audio)
	name := fmt.Sprintf("ainit-%d.mp4", e)
	r.put(name, buf.Bytes())
	r.manifest.Audio = append(r.manifest.Audio, contract.RecordingAudio{
		Init: name, Codec: cmp.Or(p.Codec, "opus"), Channels: channels, Rate: int(format.rate), Segments: []contract.RecordingSegment{},
	})
	r.aud = audio{epoch: e, seq: r.aud.seq, format: format}
	r.dirty = true
	return nil
}

// closeAudioSegment writes the packets collected so far; the last one lasts
// one frame.
func (r *Recorder) closeAudioSegment() {
	a := &r.aud
	if len(a.samples) == 0 {
		return
	}
	r.writeAudioSegment(a.samples[len(a.samples)-1].pts + a.format.frameMicros)
}

func (r *Recorder) writeAudioSegment(endPTS int64) {
	a := &r.aud
	f := a.format
	samples := make([]*fmp4.Sample, len(a.samples))
	for i, s := range a.samples {
		next := endPTS
		if i+1 < len(a.samples) {
			next = a.samples[i+1].pts
		}
		d := min(max((next-s.pts)*f.rate/1_000_000, f.minSamples), f.maxSamples)
		samples[i] = &fmp4.Sample{Duration: uint32(d), Payload: s.data}
	}
	first := a.samples[0]
	a.samples = nil
	a.seq++
	offset := max(first.pts-a.basePTS, 0)
	part := fmp4.Part{SequenceNumber: uint32(a.seq), Tracks: []*fmp4.PartTrack{{
		ID: 1, BaseTime: uint64(offset * f.rate / 1_000_000), Samples: samples,
	}}}
	var buf seekablebuffer.Buffer
	if err := part.Marshal(&buf); err != nil {
		r.log.Warn("recording: write an audio segment", "err", err)
		return
	}
	name := fmt.Sprintf("aseg-%d.m4s", a.seq)
	r.put(name, buf.Bytes())
	ep := &r.manifest.Audio[a.epoch]
	ep.Segments = append(ep.Segments, contract.RecordingSegment{
		File: name, Start: a.baseT + offset/1000, Duration: (endPTS - first.pts) / 1000, Size: int64(buf.Len()), Key: true,
	})
	r.dirty = true
}
