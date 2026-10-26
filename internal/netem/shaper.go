package netem

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"math/rand/v2"
	"net/netip"
	"net/url"
	"os/exec"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

// Shaper applies profiles to a tun: its egress (what the device sends) is
// the uplink, its ingress is redirected to an ifb device for the downlink.
// An htb class per direction holds the link's rate; under it a netem class
// per path: edge (CDN ranges and DNS) and origin (everything else) once a
// region is set, origin alone before. Packets to or from local, the tun's
// own network, skip the shaping: a system-stack tun NATs every TCP packet
// back through the tun to its listener, so each one crosses the tun twice.
type Shaper struct {
	dev, ifb string
	local    string
	run      func(ctx context.Context, script string) error
	after    func(time.Duration) <-chan time.Time
	check    time.Duration
	every    time.Duration
	measure  func(ctx context.Context, bandwidth bool) measured
	resolve  func(ctx context.Context, hosts []string) []netip.Addr
	log      *slog.Logger
	kick     chan struct{}
	learn    chan struct{}

	mu      sync.Mutex
	current contract.NetworkProfile
	region  *choice
	stop    context.CancelFunc
	done    chan struct{}

	mmu     sync.Mutex
	last    measured
	learned []netip.Addr
}

// NewShaper shapes dev with tc, which needs CAP_NET_ADMIN in dev's network
// namespace. proxy is the VPN sidecar's HTTP proxy, which Watch measures
// the session's route through; empty measures directly.
func NewShaper(dev, local, proxy string, log *slog.Logger) *Shaper {
	p := prober{log: log}
	if u, err := url.Parse(proxy); proxy != "" && err == nil {
		p.proxy = u
	}
	return &Shaper{
		dev: dev, ifb: dev + "in", local: local, run: sh, after: time.After, check: 10 * time.Second, every: time.Minute,
		measure: p.measure, resolve: resolve, log: log, kick: make(chan struct{}, 1), learn: make(chan struct{}, 1), current: contract.NetworkFull,
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

func (s *Shaper) Region() *contract.NetworkRegionState {
	s.mu.Lock()
	c := s.region
	s.mu.Unlock()
	if c == nil {
		return nil
	}
	s.mmu.Lock()
	learned := slices.Clone(s.learned)
	s.mmu.Unlock()
	return c.state(s.measured(), learned)
}

// Learn takes the addresses the device got for a name it looked up; a
// region's backend among them gets the servers' path a second later.
func (s *Shaper) Learn(name string, addrs []netip.Addr) {
	s.mu.Lock()
	c := s.region
	s.mu.Unlock()
	if c == nil || len(addrs) == 0 || !c.matches(normalize(name)) {
		return
	}
	s.mmu.Lock()
	n := len(s.learned)
	s.learned = union(s.learned, addrs)
	added := len(s.learned) > n
	s.mmu.Unlock()
	if added {
		select {
		case s.learn <- struct{}{}:
		default:
		}
	}
}

// Route is the session's route as last measured; nil before the first
// measurement.
func (s *Shaper) Route() *contract.NetworkRoute {
	return s.measured().route()
}

func (s *Shaper) measured() measured {
	s.mmu.Lock()
	defer s.mmu.Unlock()
	return s.last
}

func (s *Shaper) setMeasured(m measured) {
	s.mmu.Lock()
	s.last = m
	s.mmu.Unlock()
}

// Set applies a profile and, for a scenario, keeps stepping through it in
// the background until the next change or Close.
func (s *Shaper) Set(ctx context.Context, id contract.NetworkProfile) error {
	p, ok := Find(id)
	if !ok {
		return fmt.Errorf("%w: unknown network profile %q", contract.ErrInvalid, id)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.apply(ctx, p, s.region)
}

// SetRegion emulates a region's paths on top of the current profile, less
// the route Watch measured; an empty region turns them off.
func (s *Shaper) SetRegion(ctx context.Context, in contract.NetworkRegionSettings) error {
	c, err := parseChoice(in)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p, _ := Find(s.current)
	s.halt()
	if c != nil {
		rctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		backends := s.resolve(rctx, c.backends)
		cancel()
		s.mmu.Lock()
		s.last.backends, s.learned = backends, nil
		s.mmu.Unlock()
	}
	return s.apply(ctx, p, c)
}

// Watch measures the session's route until ctx ends: round trips every
// minute, the bandwidth at first and after Refresh. A region is re-applied
// when its route changed or the device looked up a backend at a new
// address.
func (s *Shaper) Watch(ctx context.Context) {
	bandwidth := true
	for {
		m := s.measure(ctx, bandwidth)
		if ctx.Err() != nil {
			return
		}
		s.mu.Lock()
		c := s.region
		s.mu.Unlock()
		prev := s.measured()
		if m.down == 0 {
			m.down = prev.down
		}
		if c != nil {
			m.backends = s.resolve(ctx, c.backends)
		}
		s.setMeasured(m)
		if c != nil && m.differs(prev) {
			s.reapply(ctx)
		}
		for learning := true; learning; {
			learning = false
			select {
			case <-ctx.Done():
				return
			case <-s.kick:
				bandwidth = true
			case <-s.after(s.every):
				bandwidth = m.down == 0
			case <-s.learn:
				learning = true
				select {
				case <-ctx.Done():
					return
				case <-s.after(time.Second):
				}
				s.reapply(ctx)
			}
		}
	}
}

func (s *Shaper) reapply(ctx context.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.region == nil {
		return
	}
	p, _ := Find(s.current)
	if err := s.apply(ctx, p, s.region); err != nil {
		s.log.Warn("network region: re-apply", "err", err)
	}
}

// Refresh measures the route again soon, for when the VPN location
// changed.
func (s *Shaper) Refresh() {
	select {
	case s.kick <- struct{}{}:
	default:
	}
}

func (s *Shaper) apply(ctx context.Context, p Profile, c *choice) error {
	s.halt()
	st := state{profile: p, region: c}
	if err := s.run(ctx, s.script(s.plan(st, 0))); err != nil {
		s.current, s.region = contract.NetworkFull, nil
		_ = s.run(ctx, s.clear())
		return fmt.Errorf("apply network profile %s: %w", p.ID, err)
	}
	s.current, s.region = p.ID, c
	if p.ID == contract.NetworkFull && c == nil {
		return nil
	}
	loop, cancel := context.WithCancel(context.Background())
	s.stop, s.done = cancel, make(chan struct{})
	go s.loop(loop, st, s.done)
	return nil
}

// Close stops a scenario and removes the shaping and the region.
func (s *Shaper) Close(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.halt()
	s.current, s.region = contract.NetworkFull, nil
	return s.run(ctx, s.clear())
}

func (s *Shaper) halt() {
	if s.stop != nil {
		s.stop()
		<-s.done
		s.stop, s.done = nil, nil
	}
}

type state struct {
	profile Profile
	region  *choice
}

// loop steps through a scenario; a plain link is re-applied whenever the
// tun lost its qdiscs, as it does when the VPN sidecar restarts.
func (s *Shaper) loop(ctx context.Context, st state, done chan struct{}) {
	defer close(done)
	steps := st.profile.Steps
	for step := 0; ; {
		wait := s.check
		if len(steps) > 0 {
			wait = hold(steps[step])
		}
		select {
		case <-ctx.Done():
			return
		case <-s.after(wait):
		}
		script := s.ensure(s.plan(st, step))
		if len(steps) > 0 {
			step = (step + 1) % len(steps)
			script = s.script(s.plan(st, step))
		}
		if err := s.run(ctx, script); err != nil && ctx.Err() == nil {
			s.log.Warn("network profile", "profile", st.profile.ID, "step", step, "err", err)
		}
	}
}

func hold(st Step) time.Duration {
	d := st.Min
	if st.Max > st.Min {
		d += rand.N(st.Max - st.Min)
	}
	return d
}

// outageLink drops everything without touching the routes, so the device
// still sees a connected network: requests hang until they time out.
var outageLink = Link{Loss: 100}

func stepLink(st Step) Link {
	if st.Link == outage {
		return outageLink
	}
	p, _ := Find(st.Link)
	return p.Link
}

// plan is what one round shapes: the access link and, with a region, the
// round trips each path adds on top of it. Nil shapes nothing.
type plan struct {
	access       Link
	regional     bool
	edge, origin time.Duration
	backends     []netip.Addr
}

func (s *Shaper) plan(st state, step int) *plan {
	access := st.profile.Link
	switch {
	case len(st.profile.Steps) > 0:
		access = stepLink(st.profile.Steps[step])
	case st.profile.ID == contract.NetworkFull && st.region == nil:
		return nil
	case st.profile.ID == contract.NetworkFull:
		access = st.region.region.Access
	}
	pl := &plan{access: access}
	if c := st.region; c != nil {
		m := s.measured()
		s.mmu.Lock()
		pl.regional, pl.backends = true, union(m.backends, s.learned)
		s.mmu.Unlock()
		pl.edge = extra(c.region.EdgeRTT, m.edge)
		pl.origin = extra(c.region.Servers[c.server.ID], m.servers[c.server.ID])
	}
	return pl
}

func (s *Shaper) clear() string {
	return "set -e\n" +
		"tc qdisc del dev " + s.dev + " root 2>/dev/null || true\n" +
		"tc qdisc del dev " + s.dev + " ingress 2>/dev/null || true\n" +
		"tc qdisc del dev " + s.ifb + " root 2>/dev/null || true\n"
}

// script replaces the qdiscs rather than changing them: tc qdisc change
// keeps a previous rate or slot that the new link doesn't mention.
func (s *Shaper) script(pl *plan) string {
	if pl == nil {
		return s.clear()
	}
	var b strings.Builder
	b.WriteString(s.clear())
	fmt.Fprintf(&b, "ip link show %[1]s >/dev/null 2>&1 || ip link add %[1]s type ifb\nip link set %[1]s up\ntc -batch - <<'EOF'\n", s.ifb)
	s.side(&b, s.dev, "dst", "dport", pl, pl.access.Up)
	s.side(&b, s.ifb, "src", "sport", pl, pl.access.Down)
	fmt.Fprintf(&b, "qdisc add dev %[1]s handle ffff: ingress\n"+
		"filter add dev %[1]s parent ffff: protocol ip prio 1 u32 match ip src %[2]s action ok\n"+
		"filter add dev %[1]s parent ffff: prio 2 matchall action mirred egress redirect dev %[3]s\nEOF\n",
		s.dev, s.local, s.ifb)
	return b.String()
}

// side shapes one direction of dev, matching destinations by addr ("dst"
// or "src") and port ("dport" or "sport"). The backends' own addresses win
// over the CDN ranges they may sit in.
func (s *Shaper) side(b *strings.Builder, dev, addr, port string, pl *plan, kbit int) {
	rate := "10gbit"
	if kbit > 0 {
		rate = strconv.Itoa(kbit) + "kbit"
	}
	fmt.Fprintf(b, "qdisc add dev %s root handle 1: htb default 20\n", dev)
	fmt.Fprintf(b, "class add dev %s parent 1: classid 1:1 htb rate %s\n", dev, rate)
	class := func(id int, rtt time.Duration) {
		l := pl.access
		l.RTT += rtt
		fmt.Fprintf(b, "class add dev %s parent 1:1 classid 1:%d htb rate 8kbit ceil %s quantum 1514\n", dev, id, rate)
		fmt.Fprintf(b, "qdisc add dev %s parent 1:%d handle %d: netem %s\n", dev, id, id, direction(l, kbit))
	}
	class(20, pl.origin)
	if pl.regional {
		class(10, pl.edge)
	}
	if dev == s.dev {
		fmt.Fprintf(b, "class add dev %s parent 1: classid 1:30 htb rate 10gbit quantum 1514\n", dev)
		fmt.Fprintf(b, "filter add dev %s parent 1: protocol ip prio 1 u32 match ip %s %s flowid 1:30\n", dev, addr, s.local)
	}
	if !pl.regional {
		return
	}
	for _, a := range pl.backends {
		fmt.Fprintf(b, "filter add dev %s parent 1: protocol ip prio 2 u32 match ip %s %s/32 flowid 1:20\n", dev, addr, a)
	}
	fmt.Fprintf(b, "filter add dev %s parent 1: protocol ip prio 3 u32 match ip %s 53 0xffff flowid 1:10\n", dev, port)
	for _, p := range cdnPrefixes {
		fmt.Fprintf(b, "filter add dev %s parent 1: protocol ip prio 3 u32 match ip %s %s flowid 1:10\n", dev, addr, p)
	}
}

func (s *Shaper) ensure(pl *plan) string {
	return "tc qdisc show dev " + s.dev + " | grep -q netem && exit 0\n" + s.script(pl)
}

// direction is the netem options of one direction: half the round trip and
// jitter, a queue of about half a second at the link's rate (which the htb
// class above holds), the loss.
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
