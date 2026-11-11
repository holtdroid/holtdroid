package agent

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func TestParseScreenState(t *testing.T) {
	for _, tt := range []struct {
		name, out string
		want      contract.Screen
	}{
		{"awake", "  mWakefulness=Awake\n    mShowingDream=false mDreamingLockscreen=false\n    mKeyguardShowing=false", contract.Screen{On: true}},
		{"lock screen", "  mWakefulness=Awake\n    mShowingDream=false mDreamingLockscreen=true\n", contract.Screen{On: true, Locked: true}},
		{"keyguard controller", "  mWakefulness=Awake\n    mKeyguardShowing=true", contract.Screen{On: true, Locked: true}},
		{"off", "  mWakefulness=Asleep\n    mShowingDream=false mDreamingLockscreen=true", contract.Screen{Locked: true}},
		{"dozing", "  mWakefulness=Dozing\n", contract.Screen{}},
		{"nothing", "", contract.Screen{On: true}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := parseScreenState(tt.out); got != tt.want {
				t.Errorf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestRecordScreen(t *testing.T) {
	dev := scriptedShell{outs: make(chan string)}
	s := NewScreenState(dev, slog.New(slog.DiscardHandler))
	s.interval = time.Millisecond
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	got := make(chan contract.RecordingEvent, 8)
	go func() { _ = recordScreen(ctx, s, func(ev contract.RecordingEvent) { got <- ev }) }()
	for _, out := range []string{"  mWakefulness=Awake\n", "  mWakefulness=Awake\n", "  mWakefulness=Asleep\n"} {
		dev.outs <- out
	}
	for _, want := range []contract.Screen{{On: true}, {}} {
		select {
		case ev := <-got:
			if ev.Type != contract.EventScreen || ev.Screen == nil || *ev.Screen != want {
				t.Fatalf("event %+v, want a screen event %+v", ev, want)
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("no screen event %+v", want)
		}
	}
}
