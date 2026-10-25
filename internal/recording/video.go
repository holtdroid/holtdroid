package recording

import (
	"bytes"
	"fmt"

	"github.com/bluenviron/mediacommon/v2/pkg/codecs/h264"
	"github.com/bluenviron/mediacommon/v2/pkg/formats/fmp4"
	"github.com/bluenviron/mediacommon/v2/pkg/formats/fmp4/seekablebuffer"
	"github.com/bluenviron/mediacommon/v2/pkg/formats/mp4/codecs"

	"github.com/holtdroid/holtdroid/internal/contract"
)

const timeScale = 90_000

type video struct {
	epoch   int
	config  []byte
	broken  bool
	waitKey bool
	based   bool
	basePTS int64
	baseT   int64
	samples []sample
	bytes   int
	seq     int
}

type sample struct {
	pts   int64
	at    int64
	key   bool
	nalus [][]byte
}

// Video adds a packet of the H.264 stream. A config packet that differs
// from the current one, or follows a Break, starts a new epoch; pictures
// before its first key frame are dropped.
func (r *Recorder) Video(p Packet) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stopped {
		return
	}
	v := &r.video
	if p.Config {
		if !v.broken && v.epoch >= 0 && bytes.Equal(p.Data, v.config) {
			return
		}
		r.closeSegment()
		if err := r.newEpoch(p.Data); err != nil {
			r.log.Warn("recording: bad config packet", "err", err)
			v.broken = true
		}
		return
	}
	if v.epoch < 0 || v.broken || (v.waitKey && !p.Key) {
		return
	}
	var nalus h264.AnnexB
	if err := nalus.Unmarshal(p.Data); err != nil {
		return
	}
	if n := len(v.samples); n > 0 && p.PTS <= v.samples[n-1].pts {
		return
	}
	v.waitKey = false
	now := r.elapsed()
	if !v.based {
		v.basePTS, v.baseT, v.based = p.PTS, now, true
	}
	if n := len(v.samples); n > 0 {
		long := p.PTS - v.samples[0].pts
		if p.Key && long >= r.cfg.Segment.Microseconds() || long >= r.cfg.MaxSegment.Microseconds() || v.bytes >= r.cfg.MaxSegmentSize {
			r.writeSegment(p.PTS)
		}
	}
	v.samples = append(v.samples, sample{pts: p.PTS, at: now, key: p.Key, nalus: nalus})
	v.bytes += len(p.Data)
}

// Break says the packets will come from another stream next, which starts
// with its own config packet and timestamps.
func (r *Recorder) Break() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stopped {
		return
	}
	r.closeSegment()
	r.video.broken = true
}

func (r *Recorder) newEpoch(config []byte) error {
	var nalus h264.AnnexB
	if err := nalus.Unmarshal(config); err != nil {
		return err
	}
	var spsNAL, ppsNAL []byte
	for _, n := range nalus {
		if len(n) == 0 {
			continue
		}
		switch h264.NALUType(n[0] & 0x1f) {
		case h264.NALUTypeSPS:
			spsNAL = n
		case h264.NALUTypePPS:
			ppsNAL = n
		}
	}
	if len(spsNAL) < 4 || ppsNAL == nil {
		return fmt.Errorf("no SPS and PPS in %d NAL units", len(nalus))
	}
	var sps h264.SPS
	if err := sps.Unmarshal(spsNAL); err != nil {
		return err
	}
	init := fmp4.Init{Tracks: []*fmp4.InitTrack{{ID: 1, TimeScale: timeScale, Codec: &codecs.H264{SPS: spsNAL, PPS: ppsNAL}}}}
	var buf seekablebuffer.Buffer
	if err := init.Marshal(&buf); err != nil {
		return err
	}
	e := len(r.manifest.Epochs)
	name := fmt.Sprintf("init-%d.mp4", e)
	r.put(name, buf.Bytes())
	r.manifest.Epochs = append(r.manifest.Epochs, contract.RecordingEpoch{
		Init:     name,
		Codec:    fmt.Sprintf("avc1.%02x%02x%02x", spsNAL[1], spsNAL[2], spsNAL[3]),
		Width:    sps.Width(),
		Height:   sps.Height(),
		Segments: []contract.RecordingSegment{},
	})
	r.video = video{epoch: e, config: bytes.Clone(config), waitKey: true, seq: r.video.seq}
	r.dirty = true
	return nil
}

// closeSegment writes the pictures collected so far; the last one lasts
// until now, at most a second.
func (r *Recorder) closeSegment() {
	v := &r.video
	if len(v.samples) == 0 {
		return
	}
	last := v.samples[len(v.samples)-1]
	tail := min(max(r.elapsed()-last.at, 16), 1000)
	r.writeSegment(last.pts + tail*1000)
	v.waitKey = true
}

func (r *Recorder) writeSegment(endPTS int64) {
	v := &r.video
	samples := make([]*fmp4.Sample, len(v.samples))
	for i, s := range v.samples {
		next := endPTS
		if i+1 < len(v.samples) {
			next = v.samples[i+1].pts
		}
		payload, err := h264.AVCC(s.nalus).Marshal()
		if err != nil {
			r.log.Warn("recording: bad picture", "err", err)
			v.samples, v.bytes = nil, 0
			return
		}
		samples[i] = &fmp4.Sample{Duration: uint32(max((next-s.pts)*timeScale/1_000_000, 1)), IsNonSyncSample: !s.key, Payload: payload}
	}
	first := v.samples[0]
	v.samples, v.bytes = nil, 0
	v.seq++
	part := fmp4.Part{SequenceNumber: uint32(v.seq), Tracks: []*fmp4.PartTrack{{
		ID:       1,
		BaseTime: uint64(max(first.pts-v.basePTS, 0) * timeScale / 1_000_000),
		Samples:  samples,
	}}}
	var buf seekablebuffer.Buffer
	if err := part.Marshal(&buf); err != nil {
		r.log.Warn("recording: write segment", "err", err)
		return
	}
	name := fmt.Sprintf("seg-%d.m4s", v.seq)
	r.put(name, buf.Bytes())
	ep := &r.manifest.Epochs[v.epoch]
	ep.Segments = append(ep.Segments, contract.RecordingSegment{
		File:     name,
		Start:    v.baseT + max(first.pts-v.basePTS, 0)/1000,
		Duration: (endPTS - first.pts) / 1000,
		Size:     int64(buf.Len()),
		Key:      first.key,
	})
	r.dirty = true
}
