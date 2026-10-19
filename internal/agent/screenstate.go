package agent

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/kriakiku/holtdroid/internal/contract"
)

const screenStateScript = `dumpsys power | grep -m1 'mWakefulness='
dumpsys window | grep -E 'mDreamingLockscreen=|isKeyguardShowing=|mShowingLockscreen='
dumpsys activity activities | grep -m1 'mKeyguardShowing='`

// ScreenState polls whether the display is awake and the keyguard is up
// while someone watches, and reports every change.
type ScreenState struct {
	dev      Device
	interval time.Duration
	log      *slog.Logger

	mu   sync.Mutex
	subs map[chan contract.Screen]struct{}
	last *contract.Screen
	stop context.CancelFunc
}

func NewScreenState(dev Device, log *slog.Logger) *ScreenState {
	return &ScreenState{dev: dev, interval: time.Second, log: log, subs: map[chan contract.Screen]struct{}{}}
}

func (s *ScreenState) Watch(ctx context.Context, send func(contract.Screen) error) error {
	ch := make(chan contract.Screen, 1)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	if s.last != nil {
		ch <- *s.last
	}
	if s.stop == nil {
		pctx, stop := context.WithCancel(context.Background())
		s.stop = stop
		go s.run(pctx)
	}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.subs, ch)
		if len(s.subs) == 0 && s.stop != nil {
			s.stop()
			s.stop = nil
			s.last = nil
		}
		s.mu.Unlock()
	}()
	for {
		select {
		case <-ctx.Done():
			return nil
		case st := <-ch:
			if err := send(st); err != nil {
				return err
			}
		}
	}
}

func (s *ScreenState) run(ctx context.Context) {
	for {
		out, err := s.dev.Shell(ctx, screenStateScript)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			s.log.Debug("screen state poll", "err", err)
		} else {
			s.publish(ctx, parseScreenState(out))
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(s.interval):
		}
	}
}

func (s *ScreenState) publish(ctx context.Context, st contract.Screen) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ctx.Err() != nil || (s.last != nil && *s.last == st) {
		return
	}
	s.last = &st
	for ch := range s.subs {
		select {
		case <-ch:
		default:
		}
		ch <- st
	}
}

func parseScreenState(out string) contract.Screen {
	st := contract.Screen{On: true}
	for line := range strings.SplitSeq(out, "\n") {
		for f := range strings.FieldsSeq(line) {
			k, v, ok := strings.Cut(f, "=")
			if !ok {
				continue
			}
			switch k {
			case "mWakefulness":
				st.On = v == "Awake"
			case "mDreamingLockscreen", "isKeyguardShowing", "mShowingLockscreen", "mKeyguardShowing":
				st.Locked = st.Locked || v == "true"
			}
		}
	}
	return st
}
