package recording

import (
	"encoding/binary"

	"github.com/holtdroid/holtdroid/internal/contract"
)

const (
	controlKey   = 0
	controlTouch = 2

	controlBackOrScreenOn = 4

	keyHome    = 3
	keyBack    = 4
	keyRecents = 187

	moveEvery = 33
)

var navKeys = map[uint32]string{keyHome: "home", keyBack: "back", keyRecents: "recents"}

// ParseControl turns a scrcpy control message the viewer sent into a
// recording event when it is a touch or a navigation key. Typed text and
// every other key are left out.
func ParseControl(msg []byte) (contract.RecordingEvent, bool) {
	switch {
	case len(msg) == 14 && msg[0] == controlKey:
		if msg[1] != 0 {
			return contract.RecordingEvent{}, false
		}
		name, ok := navKeys[binary.BigEndian.Uint32(msg[2:6])]
		if !ok {
			return contract.RecordingEvent{}, false
		}
		return contract.RecordingEvent{Type: contract.EventKey, Key: name}, true
	case len(msg) == 2 && msg[0] == controlBackOrScreenOn:
		if msg[1] != 0 {
			return contract.RecordingEvent{}, false
		}
		return contract.RecordingEvent{Type: contract.EventKey, Key: "back"}, true
	case len(msg) == 32 && msg[0] == controlTouch:
		var action contract.TouchAction
		switch msg[1] {
		case 0, 5:
			action = contract.TouchDown
		case 2:
			action = contract.TouchMove
		case 1, 3, 6:
			action = contract.TouchUp
		default:
			return contract.RecordingEvent{}, false
		}
		w, h := float64(binary.BigEndian.Uint16(msg[18:20])), float64(binary.BigEndian.Uint16(msg[20:22]))
		if w == 0 || h == 0 {
			return contract.RecordingEvent{}, false
		}
		pointer := binary.BigEndian.Uint64(msg[2:10])
		id := int(pointer)
		if pointer > 100 {
			id = 0
		}
		return contract.RecordingEvent{Type: contract.EventTouch, Touch: &contract.RecordingTouch{
			Action: action, Pointer: id,
			X: clamp01(float64(binary.BigEndian.Uint32(msg[10:14])) / w),
			Y: clamp01(float64(binary.BigEndian.Uint32(msg[14:18])) / h),
		}}, true
	}
	return contract.RecordingEvent{}, false
}

func clamp01(v float64) float64 { return min(1, max(0, v)) }

// Control records a control message from the viewer; moves of one finger
// are kept at most every 33 ms.
func (r *Recorder) Control(msg []byte) {
	ev, ok := ParseControl(msg)
	if !ok {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stopped {
		return
	}
	if t := ev.Touch; t != nil {
		now := r.elapsed()
		if t.Action == contract.TouchMove {
			if last, seen := r.moved[t.Pointer]; seen && now-last < moveEvery {
				return
			}
		}
		r.moved[t.Pointer] = now
		if t.Action == contract.TouchDown && r.onTouch != nil {
			go r.onTouch(now)
		}
	}
	r.eventLocked(ev)
}
