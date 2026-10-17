package agent

import (
	"context"
	"log/slog"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kriakiku/holtdroid/internal/contract"
)

const vibrationScript = `dumpsys vibrator_manager | sed -n '/^  CurrentVibration:/,/^  NextVibration:/p;/^  Recent vibrations:/,/^  Aggregated/p'`

var touchUsages = map[string]bool{"TOUCH": true, "HARDWARE_FEEDBACK": true, "PHYSICAL_EMULATION": true}

// Vibrations polls the vibrator service's history while someone watches
// and reports the vibrations that weren't there on the previous poll.
type Vibrations struct {
	dev      Device
	interval time.Duration
	log      *slog.Logger

	mu   sync.Mutex
	subs map[chan contract.Vibration]struct{}
	stop context.CancelFunc
}

func NewVibrations(dev Device, log *slog.Logger) *Vibrations {
	return &Vibrations{dev: dev, interval: time.Second, log: log, subs: map[chan contract.Vibration]struct{}{}}
}

func (v *Vibrations) Watch(ctx context.Context, send func(contract.Vibration) error) error {
	ch := make(chan contract.Vibration, 16)
	v.mu.Lock()
	v.subs[ch] = struct{}{}
	if v.stop == nil {
		pctx, stop := context.WithCancel(context.Background())
		v.stop = stop
		go v.run(pctx)
	}
	v.mu.Unlock()
	defer func() {
		v.mu.Lock()
		delete(v.subs, ch)
		if len(v.subs) == 0 && v.stop != nil {
			v.stop()
			v.stop = nil
		}
		v.mu.Unlock()
	}()
	for {
		select {
		case <-ctx.Done():
			return nil
		case e := <-ch:
			if err := send(e); err != nil {
				return err
			}
		}
	}
}

func (v *Vibrations) run(ctx context.Context) {
	var seen map[string]bool
	for {
		out, err := v.dev.Shell(ctx, vibrationScript)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			v.log.Debug("vibrations poll", "err", err)
		} else {
			cur := parseVibrations(out)
			next := make(map[string]bool, len(cur))
			for _, e := range cur {
				next[e.key] = true
				if seen != nil && !seen[e.key] && !e.ignored && !touchUsages[e.Usage] {
					v.broadcast(e.Vibration)
				}
			}
			seen = next
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(v.interval):
		}
	}
}

func (v *Vibrations) broadcast(e contract.Vibration) {
	v.mu.Lock()
	defer v.mu.Unlock()
	for ch := range v.subs {
		select {
		case ch <- e:
		default:
		}
	}
}

type vibrationEntry struct {
	contract.Vibration
	key     string
	ignored bool
}

var (
	recentVibrationRe = regexp.MustCompile(`^(\d\d-\d\d \d\d:\d\d:\d\d\.\d+) \|[^|]*\|\s*(\w+) \| duration:\s*(\d+)ms .*\| usage: (\w+) \|`)
	vibrationPkgRe    = regexp.MustCompile(`\| ([\w.]+) \(uid=`)
	currentFieldRe    = regexp.MustCompile(`^(\w+) = (.*)$`)
	currentUsageRe    = regexp.MustCompile(`mUsage=(\w+)`)
	currentPkgRe      = regexp.MustCompile(`opPkg=([\w.]+)`)
	stepDurationRe    = regexp.MustCompile(`duration=(\d+)`)
)

// parseVibrations reads the CurrentVibration block and the Recent
// vibrations lines of dumpsys vibrator_manager (Android 14+), keyed by
// their create time.
func parseVibrations(out string) []vibrationEntry {
	var entries []vibrationEntry
	var cur *vibrationEntry
	for line := range strings.SplitSeq(out, "\n") {
		line = strings.TrimSpace(line)
		if m := recentVibrationRe.FindStringSubmatch(line); m != nil {
			ms, _ := strconv.ParseInt(m[3], 10, 64)
			e := vibrationEntry{key: m[1], ignored: strings.HasPrefix(m[2], "ignored") || ms == 0}
			e.Usage, e.DurationMS = m[4], ms
			if p := vibrationPkgRe.FindStringSubmatch(line); p != nil {
				e.Package = p[1]
			}
			entries = append(entries, e)
			continue
		}
		switch {
		case line == "Vibration:":
			cur = &vibrationEntry{}
			continue
		case cur == nil:
			continue
		}
		m := currentFieldRe.FindStringSubmatch(line)
		if m == nil {
			if cur.key != "" {
				entries = append(entries, *cur)
			}
			cur = nil
			continue
		}
		switch m[1] {
		case "createTime":
			cur.key = m[2]
		case "status":
			cur.ignored = strings.HasPrefix(m[2], "ignored")
		case "playedEffect":
			if strings.Contains(m[2], "repeat=-1") {
				for _, d := range stepDurationRe.FindAllStringSubmatch(m[2], -1) {
					n, _ := strconv.ParseInt(d[1], 10, 64)
					cur.DurationMS += n
				}
			}
		case "callerInfo":
			if u := currentUsageRe.FindStringSubmatch(m[2]); u != nil {
				cur.Usage = u[1]
			}
			if p := currentPkgRe.FindStringSubmatch(m[2]); p != nil {
				cur.Package = p[1]
			}
		}
	}
	if cur != nil && cur.key != "" {
		entries = append(entries, *cur)
	}
	return entries
}
