package agent

import (
	"testing"

	"github.com/kriakiku/holtdroid/internal/contract"
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
