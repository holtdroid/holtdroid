package netem

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

var update = flag.Bool("update", false, "rewrite golden files")

func TestDirection(t *testing.T) {
	for _, tc := range []struct {
		name string
		link Link
		kbit int
		want string
	}{
		{"delay only", Link{RTT: 300 * ms}, 0, "delay 150ms limit 10000"},
		{"jitter rate loss", Link{RTT: 70 * ms, Jitter: 20 * ms, Loss: 0.5}, 10_000, "delay 35ms 10ms limit 446 loss random 0.5%"},
		{"small queue floor", Link{RTT: 800 * ms}, 50, "delay 400ms limit 20"},
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

func TestRegions(t *testing.T) {
	seen := map[string]bool{}
	for _, r := range Regions {
		if seen[r.ID] || r.Name == "" || r.Description == "" || len(r.Country) != 2 || r.Edge == "" || r.EdgeRTT <= 0 || r.Access.RTT <= 0 {
			t.Errorf("region %q: duplicate or incomplete", r.ID)
		}
		seen[r.ID] = true
		for _, s := range Servers {
			if r.Servers[s.ID] <= 0 {
				t.Errorf("region %q: no round trip to %s", r.ID, s.ID)
			}
		}
	}
	if len(cdnPrefixes) < 300 || len(RegionCatalog()) != len(Regions) || len(ServerCatalog()) != len(Servers) {
		t.Errorf("%d CDN prefixes, catalogs %d/%d", len(cdnPrefixes), len(RegionCatalog()), len(ServerCatalog()))
	}
}

func TestParseChoice(t *testing.T) {
	c, err := parseChoice(contract.NetworkRegionSettings{Region: "bd", Backends: []string{" API.example.com. ", "api.example.com", "10.0.0.1"}})
	if err != nil || c.server.ID != "frankfurt" || strings.Join(c.backends, ",") != "api.example.com,10.0.0.1" {
		t.Errorf("choice = %+v, %v", c, err)
	}
	if c, err := parseChoice(contract.NetworkRegionSettings{}); c != nil || err != nil {
		t.Errorf("empty region = %+v, %v", c, err)
	}
	for _, in := range []contract.NetworkRegionSettings{
		{Region: "atlantis"},
		{Region: "bd", Server: "moon"},
		{Region: "bd", Backends: []string{"https://api.example.com"}},
		{Region: "bd", Backends: []string{"localhost"}},
	} {
		if _, err := parseChoice(in); !errors.Is(err, contract.ErrInvalid) {
			t.Errorf("%+v: %v", in, err)
		}
	}
}

type recorder struct {
	mu       sync.Mutex
	scripts  []string
	fail     bool
	tick     chan time.Time
	measures int
	m        measured
}

func (r *recorder) run(_ context.Context, script string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.scripts = append(r.scripts, script)
	if r.fail && strings.Contains(script, "handle 20: netem") {
		return errors.New("boom")
	}
	return nil
}

func (r *recorder) measure(context.Context, *choice) measured {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.measures++
	return r.m
}

func (r *recorder) got() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.scripts...)
}

func newTestShaper() (*Shaper, *recorder) {
	r := &recorder{tick: make(chan time.Time)}
	s := NewShaper("holtdroid0", "198.18.0.0/30", "", slog.New(slog.DiscardHandler))
	s.run, s.measure = r.run, r.measure
	s.after = func(time.Duration) <-chan time.Time { return r.tick }
	return s, r
}

func golden(t *testing.T, name, got string) {
	t.Helper()
	path := filepath.Join("testdata", name)
	if *update {
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got != string(want) {
		t.Errorf("script differs from %s (run with -update):\n%s", path, got)
	}
}

func TestSetLink(t *testing.T) {
	s, r := newTestShaper()
	ctx := t.Context()
	if err := s.Set(ctx, "edge"); err != nil {
		t.Fatal(err)
	}
	got := r.got()
	if len(got) != 1 {
		t.Fatalf("scripts = %q", got)
	}
	golden(t, "link.sh", got[0])
	r.tick <- time.Time{}
	r.tick <- time.Time{}
	if got := r.got(); len(got) < 2 || !strings.HasPrefix(got[1], "tc qdisc show dev holtdroid0 | grep -q netem && exit 0\n") {
		t.Errorf("no re-check: %q", got)
	}
	if s.Current() != "edge" || s.Region() != nil || r.measures != 0 {
		t.Errorf("current = %q, region %v, %d measures", s.Current(), s.Region(), r.measures)
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
	if len(got) < 2 || !strings.Contains(got[0], "htb rate 3000kbit") || !strings.Contains(got[1], "loss random 100%") {
		t.Fatalf("scripts = %q", got)
	}
	if err := s.Close(t.Context()); err != nil {
		t.Fatal(err)
	}
	if got := r.got(); strings.Contains(got[len(got)-1], "add") {
		t.Errorf("close did not clear: %q", got[len(got)-1])
	}
}

func TestSetRegion(t *testing.T) {
	s, r := newTestShaper()
	ctx := t.Context()
	r.m = measured{edge: 20 * ms, origin: 400 * ms, backends: []netip.Addr{netip.MustParseAddr("104.16.1.1")}}
	if err := s.SetRegion(ctx, contract.NetworkRegionSettings{Region: "bd", Backends: []string{"api.example.com"}}); err != nil {
		t.Fatal(err)
	}
	got := r.got()
	if len(got) != 1 {
		t.Fatalf("scripts = %q", got)
	}
	golden(t, "region.sh", got[0])
	want := []contract.NetworkPath{
		{Class: contract.NetworkPathEdge, Target: 30, Baseline: 20, Added: 10},
		{Class: contract.NetworkPathOrigin, Target: 170, Baseline: 400, Added: 0},
	}
	st := s.Region()
	if st == nil || st.Region != "bd" || st.Server != "frankfurt" || len(st.Paths) != 2 || st.Paths[0] != want[0] || st.Paths[1] != want[1] {
		t.Fatalf("region = %+v", st)
	}

	if err := s.Set(ctx, "3g"); err != nil {
		t.Fatal(err)
	}
	if got := r.got(); !strings.Contains(got[len(got)-1], "handle 10: netem delay 105ms 25ms") || r.measures != 1 {
		t.Errorf("3g under a region: %d measures\n%s", r.measures, got[len(got)-1])
	}

	r.mu.Lock()
	r.m.origin = 100 * ms
	r.mu.Unlock()
	s.Refresh()
	for s.Region().Paths[1].Added != 70 {
		time.Sleep(time.Millisecond)
	}
	if err := s.SetRegion(ctx, contract.NetworkRegionSettings{}); err != nil {
		t.Fatal(err)
	}
	if got := r.got(); strings.Contains(got[len(got)-1], "1:10") || s.Region() != nil || s.Current() != "3g" {
		t.Errorf("region off: %q", got[len(got)-1])
	}
}

func TestSetErrors(t *testing.T) {
	s, r := newTestShaper()
	if err := s.Set(t.Context(), "nope"); !errors.Is(err, contract.ErrInvalid) {
		t.Errorf("unknown profile: %v", err)
	}
	if err := s.SetRegion(t.Context(), contract.NetworkRegionSettings{Region: "nope"}); !errors.Is(err, contract.ErrInvalid) {
		t.Errorf("unknown region: %v", err)
	}
	r.fail = true
	if err := s.Set(t.Context(), "3g"); err == nil || s.Current() != contract.NetworkFull {
		t.Errorf("failed apply: err %v, current %q", err, s.Current())
	}
}

func TestProbe(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(20 * time.Millisecond)
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()
	d, err := prober{}.rtt(t.Context(), srv.URL)
	if err != nil || d < 20*time.Millisecond || d > time.Second {
		t.Errorf("rtt = %v, %v", d, err)
	}
	if got := resolve(t.Context(), []string{"10.0.0.2", "10.0.0.1", "10.0.0.2"}); len(got) != 2 || got[0].String() != "10.0.0.1" {
		t.Errorf("resolve = %v", got)
	}
}
