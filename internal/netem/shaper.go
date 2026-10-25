package netem

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"math/rand/v2"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

// Shaper applies profiles to a tun: its egress (what the device sends) is
// the uplink, its ingress is redirected to an ifb device for the downlink.
type Shaper struct {
	dev, ifb string
	run      func(ctx context.Context, script string) error
	after    func(time.Duration) <-chan time.Time
	check    time.Duration
	log      *slog.Logger

	mu      sync.Mutex
	current contract.NetworkProfile
	stop    context.CancelFunc
	done    chan struct{}
}

// NewShaper shapes dev with tc, which needs CAP_NET_ADMIN in dev's network
// namespace.
func NewShaper(dev string, log *slog.Logger) *Shaper {
	return &Shaper{
		dev: dev, ifb: dev + "in", run: sh, after: time.After, check: 10 * time.Second, log: log,
		current: contract.NetworkFull,
	}
}

func sh(ctx context.Context, script string) error {
	out, err := exec.CommandContext(ctx, "sh", "-c", script).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (s *Shaper) Current() contract.NetworkProfile {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.current
}

// Set applies a profile and, for a scenario, keeps stepping through it in
// the background until the next Set or Close.
func (s *Shaper) Set(ctx context.Context, id contract.NetworkProfile) error {
	p, ok := Find(id)
	if !ok {
		return fmt.Errorf("%w: unknown network profile %q", contract.ErrInvalid, id)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.halt()
	first := p.Link
	if len(p.Steps) > 0 {
		first = s.link(p.Steps[0])
	}
	if err := s.run(ctx, s.script(p.ID == contract.NetworkFull, first)); err != nil {
		s.current = contract.NetworkFull
		_ = s.run(ctx, s.clear())
		return fmt.Errorf("apply network profile %s: %w", id, err)
	}
	s.current = id
	if id == contract.NetworkFull {
		return nil
	}
	loop, cancel := context.WithCancel(context.Background())
	s.stop, s.done = cancel, make(chan struct{})
	go s.loop(loop, p, s.done)
	return nil
}

// Close stops a scenario and removes the shaping.
func (s *Shaper) Close(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.halt()
	s.current = contract.NetworkFull
	return s.run(ctx, s.clear())
}

func (s *Shaper) halt() {
	if s.stop != nil {
		s.stop()
		<-s.done
		s.stop, s.done = nil, nil
	}
}

// loop steps through a scenario; a plain link is re-applied whenever the
// tun lost its qdiscs, as it does when the VPN sidecar restarts.
func (s *Shaper) loop(ctx context.Context, p Profile, done chan struct{}) {
	defer close(done)
	if len(p.Steps) == 0 {
		for {
			select {
			case <-ctx.Done():
				return
			case <-s.after(s.check):
			}
			if err := s.run(ctx, s.ensure(p.Link)); err != nil && ctx.Err() == nil {
				s.log.Warn("network profile", "profile", p.ID, "err", err)
			}
		}
	}
	for i, first := 0, true; ; i, first = (i+1)%len(p.Steps), false {
		st := p.Steps[i]
		if !first {
			if err := s.run(ctx, s.script(false, s.link(st))); err != nil && ctx.Err() == nil {
				s.log.Warn("network scenario", "profile", p.ID, "step", i, "err", err)
			}
		}
		d := st.Min
		if st.Max > st.Min {
			d += rand.N(st.Max - st.Min)
		}
		select {
		case <-ctx.Done():
			return
		case <-s.after(d):
		}
	}
}

// outageLink drops everything without touching the routes, so the device
// still sees a connected network: requests hang until they time out.
var outageLink = Link{Loss: 100}

func (s *Shaper) link(st Step) Link {
	if st.Link == outage {
		return outageLink
	}
	p, _ := Find(st.Link)
	return p.Link
}

func (s *Shaper) clear() string {
	return "tc qdisc del dev " + s.dev + " root 2>/dev/null; tc qdisc del dev " + s.dev + " ingress 2>/dev/null; " +
		"tc qdisc del dev " + s.ifb + " root 2>/dev/null; true"
}

// script replaces the qdiscs rather than changing them: tc qdisc change
// keeps a previous rate or slot that the new link doesn't mention.
func (s *Shaper) script(full bool, l Link) string {
	if full {
		return s.clear()
	}
	return s.clear() + "; " + strings.Join([]string{
		"{ ip link show " + s.ifb + " >/dev/null 2>&1 || ip link add " + s.ifb + " type ifb; }",
		"ip link set " + s.ifb + " up",
		"tc qdisc add dev " + s.dev + " root netem " + direction(l, l.Up),
		"tc qdisc add dev " + s.ifb + " root netem " + direction(l, l.Down),
		"tc qdisc add dev " + s.dev + " handle ffff: ingress",
		"tc filter add dev " + s.dev + " parent ffff: matchall action mirred egress redirect dev " + s.ifb,
	}, " && ")
}

func (s *Shaper) ensure(l Link) string {
	return "tc qdisc show dev " + s.dev + " root | grep -q netem || { " + s.script(false, l) + "; }"
}

// direction is the netem options of one direction: half the round trip and
// jitter, the rate, a queue of about half a second at that rate, the loss.
func direction(l Link, kbit int) string {
	var o []string
	if l.RTT > 0 {
		o = append(o, "delay "+msec(l.RTT/2))
		if l.Jitter > 0 {
			o[0] += " " + msec(l.Jitter/2)
		}
	}
	limit := 10000
	if kbit > 0 {
		o = append(o, "rate "+strconv.Itoa(kbit)+"kbit")
		bytes := float64(kbit) * 125 * (l.RTT/2 + 500*time.Millisecond).Seconds()
		limit = min(10000, max(20, int(math.Ceil(bytes/1500))))
	}
	o = append(o, "limit "+strconv.Itoa(limit))
	switch {
	case l.Loss <= 0:
	case l.Burst > 1 && l.Loss < 100:
		r := 100 / float64(l.Burst)
		p := l.Loss * r / (100 - l.Loss)
		o = append(o, "loss gemodel "+pct(p)+" "+pct(r)+" 100% 0%")
	default:
		o = append(o, "loss random "+pct(l.Loss))
	}
	return strings.Join(o, " ")
}

func msec(d time.Duration) string { return strconv.FormatInt(d.Milliseconds(), 10) + "ms" }

func pct(v float64) string { return strconv.FormatFloat(math.Round(v*1000)/1000, 'f', -1, 64) + "%" }
