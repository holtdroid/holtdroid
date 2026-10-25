package netem

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func TestDirection(t *testing.T) {
	for _, tc := range []struct {
		name string
		link Link
		kbit int
		want string
	}{
		{"delay only", Link{RTT: 300 * ms}, 0, "delay 150ms limit 10000"},
		{"jitter rate loss", Link{RTT: 70 * ms, Jitter: 20 * ms, Loss: 0.5}, 10_000, "delay 35ms 10ms rate 10000kbit limit 446 loss random 0.5%"},
		{"small queue floor", Link{RTT: 800 * ms}, 50, "delay 400ms rate 50kbit limit 20"},
		{"burst loss", Link{Loss: 5, Burst: 4}, 0, "limit 10000 loss gemodel 1.316% 25% 100% 0%"},
		{"outage", outageLink, 0, "limit 10000 loss random 100%"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := direction(tc.link, tc.kbit); got != tc.want {
				t.Errorf("direction = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestProfiles(t *testing.T) {
	seen := map[contract.NetworkProfile]bool{}
	for _, p := range Profiles {
		if seen[p.ID] || p.Name == "" || p.Description == "" {
			t.Errorf("profile %q: duplicate or unnamed", p.ID)
		}
		seen[p.ID] = true
		for _, st := range p.Steps {
			if _, ok := Find(st.Link); st.Link != outage && !ok {
				t.Errorf("profile %q: step links unknown %q", p.ID, st.Link)
			}
			if st.Min <= 0 || st.Max < st.Min {
				t.Errorf("profile %q: step %v..%v", p.ID, st.Min, st.Max)
			}
		}
	}
	if len(Catalog()) != len(Profiles) || !seen[contract.NetworkFull] {
		t.Error("catalog misses profiles")
	}
}

type recorder struct {
	mu      sync.Mutex
	scripts []string
	fail    bool
	tick    chan time.Time
}

func (r *recorder) run(_ context.Context, script string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.scripts = append(r.scripts, script)
	if r.fail && strings.Contains(script, "handle 10: netem") {
		return errors.New("boom")
	}
	return nil
}

func (r *recorder) got() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.scripts...)
}

func newTestShaper() (*Shaper, *recorder) {
	r := &recorder{tick: make(chan time.Time)}
	s := NewShaper("holtdroid0", "198.18.0.0/30", slog.New(slog.DiscardHandler))
	s.run = r.run
	s.after = func(time.Duration) <-chan time.Time { return r.tick }
	return s, r
}

func TestSetLink(t *testing.T) {
	s, r := newTestShaper()
	ctx := t.Context()
	if err := s.Set(ctx, "edge"); err != nil {
		t.Fatal(err)
	}
	want := "tc qdisc del dev holtdroid0 root 2>/dev/null; tc qdisc del dev holtdroid0 ingress 2>/dev/null; tc qdisc del dev holtdroid0in root 2>/dev/null; true; " +
		"{ ip link show holtdroid0in >/dev/null 2>&1 || ip link add holtdroid0in type ifb; } && ip link set holtdroid0in up && " +
		"tc qdisc add dev holtdroid0 root handle 1: prio bands 2 priomap 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 && " +
		"tc qdisc add dev holtdroid0 parent 1:1 handle 10: netem delay 250ms 75ms rate 80kbit limit 20 loss random 2% && " +
		"tc filter add dev holtdroid0 parent 1: protocol ip prio 1 u32 match ip dst 198.18.0.0/30 flowid 1:2 && " +
		"tc qdisc add dev holtdroid0in root netem delay 250ms 75ms rate 200kbit limit 20 loss random 2% && " +
		"tc qdisc add dev holtdroid0 handle ffff: ingress && " +
		"tc filter add dev holtdroid0 parent ffff: protocol ip prio 1 u32 match ip src 198.18.0.0/30 action ok && " +
		"tc filter add dev holtdroid0 parent ffff: prio 2 matchall action mirred egress redirect dev holtdroid0in"
	if got := r.got(); len(got) != 1 || got[0] != want {
		t.Fatalf("scripts = %q", got)
	}
	r.tick <- time.Time{}
	r.tick <- time.Time{}
	if got := r.got(); len(got) < 2 || !strings.HasPrefix(got[1], "tc qdisc show dev holtdroid0 | grep -q netem || { ") {
		t.Errorf("no re-check: %q", got)
	}
	if s.Current() != "edge" {
		t.Errorf("current = %q", s.Current())
	}
	if err := s.Set(ctx, contract.NetworkFull); err != nil {
		t.Fatal(err)
	}
	if got := r.got(); strings.Contains(got[len(got)-1], "add") || s.Current() != contract.NetworkFull {
		t.Errorf("full did not clear: %q", got[len(got)-1])
	}
}

func TestSetScenario(t *testing.T) {
	s, r := newTestShaper()
	if err := s.Set(t.Context(), "elevator"); err != nil {
		t.Fatal(err)
	}
	r.tick <- time.Time{}
	r.tick <- time.Time{}
	got := r.got()
	if len(got) < 2 || !strings.Contains(got[0], "rate 3000kbit") || !strings.Contains(got[1], "loss random 100%") {
		t.Fatalf("scripts = %q", got)
	}
	if err := s.Close(t.Context()); err != nil {
		t.Fatal(err)
	}
	if got := r.got(); strings.Contains(got[len(got)-1], "add") {
		t.Errorf("close did not clear: %q", got[len(got)-1])
	}
}

func TestSetErrors(t *testing.T) {
	s, r := newTestShaper()
	if err := s.Set(t.Context(), "nope"); !errors.Is(err, contract.ErrInvalid) {
		t.Errorf("unknown profile: %v", err)
	}
	r.fail = true
	if err := s.Set(t.Context(), "3g"); err == nil || s.Current() != contract.NetworkFull {
		t.Errorf("failed apply: err %v, current %q", err, s.Current())
	}
}
