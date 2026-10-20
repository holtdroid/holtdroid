package agent

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

const vibrationsIdle = `  CurrentVibration:
    null

  NextVibration:
  Recent vibrations:
    TOUCH:
      10-17 05:26:35.392 |   effect |             finished | duration:   103ms | start: 05:26:35.395 | end: 05:26:35.496 | scale:     NONE (adaptive=1.00) | flags:    0 | usage: TOUCH | category=KEYBOARD | com.google.android.inputmethod.latin (uid=10153, deviceId=0) | reason: performHapticFeedback(constant=3): View#performHapticFeedback | played: Prebaked=CLICK(MEDIUM, with fallback) | original: null

  Aggregated vibration history:
`

const vibrationsRunning = `  CurrentVibration:
    Vibration:
      status = running
      durationMs = -1
      createTime = 10-17 05:41:23.528
      startTime = 10-17 05:41:23.529
      endTime = null
      playedEffect = Mono{mEffect=Composed{segments=[Step{amplitude=1.0, frequencyHz=0.0, duration=3000}], repeat=-1}}
      originalEffect = Mono{mEffect=Composed{segments=[Step{amplitude=-1.0, frequencyHz=0.0, duration=3000}], repeat=-1}}
      scale = NONE
      adaptiveScale = 1.00
      callerInfo = CallerInfo{ uid=10190, opPkg=com.example.shop, deviceId=0, attrs=VibrationAttributes{mUsage=NOTIFICATION, mAudioUsage= USAGE_UNKNOWN, mCategory=UNKNOWN, mFlags=0}, reason=null}

  NextVibration:
  Recent vibrations:
    TOUCH:
      10-17 05:26:35.392 |   effect |             finished | duration:   103ms | start: 05:26:35.395 | end: 05:26:35.496 | scale:     NONE (adaptive=1.00) | flags:    0 | usage: TOUCH | category=KEYBOARD | com.google.android.inputmethod.latin (uid=10153, deviceId=0) | reason: performHapticFeedback(constant=3): View#performHapticFeedback | played: Prebaked=CLICK(MEDIUM, with fallback) | original: null
      10-17 05:41:20.100 |   effect |             finished | duration:    40ms | start: 05:41:20.101 | end: 05:41:20.141 | scale:     NONE (adaptive=1.00) | flags:    0 | usage: TOUCH | com.google.android.apps.nexuslauncher (uid=10179, deviceId=0) | reason: null | played: Prebaked=CLICK(MEDIUM, with fallback) | original: null

  Aggregated vibration history:
`

const vibrationsDone = `  CurrentVibration:
    null

  NextVibration:
  Recent vibrations:
    NOTIFICATION:
      10-17 05:41:23.528 |   effect |             finished | duration:  3001ms | start: 05:41:23.529 | end: 05:41:26.530 | scale:     NONE (adaptive=1.00) | flags:    0 | usage: NOTIFICATION | com.example.shop (uid=10190, deviceId=0) | reason: null | played: Step=3000ms(amplitude=1.00) | original: Step=3000ms(amplitude=-1.00)
      10-17 05:41:27.000 |   effect | ignored_for_settings | duration:     0ms | start: 05:41:27.000 | end: 05:41:27.000 | scale:     NONE (adaptive=1.00) | flags:    0 | usage: NOTIFICATION | com.example.shop (uid=10190, deviceId=0) | reason: null | played: null | original: Step=500ms(amplitude=-1.00)
    COMMUNICATION_REQUEST:
      10-17 05:41:28.307 |   effect |             finished | duration:   801ms | start: 05:41:28.308 | end: 05:41:29.109 | scale:     NONE (adaptive=1.00) | flags: 10011 | usage: COMMUNICATION_REQUEST | root (uid=0, deviceId=0) | reason: test | played: Step=800ms(amplitude=1.00) | original: Step=800ms(amplitude=-1.00)

  Aggregated vibration history:
`

func TestParseVibrations(t *testing.T) {
	got := parseVibrations(vibrationsRunning)
	want := []vibrationEntry{
		{key: "10-17 05:41:23.528", Usage: "NOTIFICATION", Package: "com.example.shop", DurationMS: 3000},
		{key: "10-17 05:26:35.392", Usage: "TOUCH", Package: "com.google.android.inputmethod.latin", DurationMS: 103},
		{key: "10-17 05:41:20.100", Usage: "TOUCH", Package: "com.google.android.apps.nexuslauncher", DurationMS: 40},
	}
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("entry %d = %+v, want %+v", i, got[i], want[i])
		}
	}
	done := parseVibrations(vibrationsDone)
	if len(done) != 3 || done[1].ignored == false || done[2].Package != "root" || done[2].DurationMS != 801 {
		t.Errorf("done = %+v", done)
	}
}

type scriptedShell struct {
	Device
	outs chan string
}

func (s scriptedShell) Shell(ctx context.Context, _ string) (string, error) {
	select {
	case out := <-s.outs:
		return out, nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

func TestVibrationsWatch(t *testing.T) {
	dev := scriptedShell{outs: make(chan string)}
	v := NewVibrations(dev, slog.New(slog.NewTextHandler(io.Discard, nil)))
	v.interval = time.Millisecond
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	got := make(chan contract.Vibration, 8)
	go func() {
		_ = v.Watch(ctx, func(e contract.Vibration) error {
			got <- e
			return nil
		})
	}()
	for _, out := range []string{vibrationsIdle, vibrationsRunning, vibrationsDone, vibrationsDone, vibrationsDone} {
		dev.outs <- out
	}
	want := []contract.Vibration{
		{Usage: "NOTIFICATION", Package: "com.example.shop", DurationMS: 3000},
		{Usage: "COMMUNICATION_REQUEST", Package: "root", DurationMS: 801},
	}
	for _, w := range want {
		select {
		case e := <-got:
			if e != w {
				t.Errorf("got %+v, want %+v", e, w)
			}
		case <-time.After(time.Second):
			t.Fatalf("no vibration, want %+v", w)
		}
	}
	select {
	case e := <-got:
		t.Errorf("unexpected %+v", e)
	default:
	}
}
