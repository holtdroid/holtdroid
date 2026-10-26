package netem

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"maps"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"slices"
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
	c, err := parseChoice(contract.NetworkRegionSettings{Region: "bd", Backends: []string{" API.example.com. ", "api.example.com", "10.0.0.1", "*.Example.org"}})
	if err != nil || c.server.ID != "frankfurt" || strings.Join(c.backends, ",") != "api.example.com,10.0.0.1,*.example.org" {
		t.Errorf("choice = %+v, %v", c, err)
	}
	for name, want := range map[string]bool{"api.example.com": true, "www.example.com": false, "a.b.example.org": true, "example.org": false} {
		if c.matches(name) != want {
			t.Errorf("matches(%q) = %v", name, !want)
		}
	}
	if c, err := parseChoice(contract.NetworkRegionSettings{}); c != nil || err != nil {
		t.Errorf("empty region = %+v, %v", c, err)
	}
	for _, in := range []contract.NetworkRegionSettings{
		{Region: "atlantis"},
		{Region: "bd", Server: "moon"},
		{Region: "bd", Backends: []string{"https://api.example.com"}},
		{Region: "bd", Backends: []string{"localhost"}},
		{Region: "bd", Backends: []string{"*.*"}},
		{Region: "bd", Backends: []string{"api.*.com"}},
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
	downs    int
	m        measured
	down     int
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

func (r *recorder) measure(context.Context) measured {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.measures++
	m := r.m
	m.servers = maps.Clone(r.m.servers)
	return m
}

func (r *recorder) bandwidth(context.Context) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.downs++
	if r.down == 0 {
		return 0, errors.New("no rate")
	}
	return r.down, nil
}

func (r *recorder) resolve(context.Context, []string) []netip.Addr {
	return []netip.Addr{netip.MustParseAddr("104.16.1.1")}
}

func (r *recorder) counts() (measures, downs int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.measures, r.downs
}

func (r *recorder) got() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.scripts...)
}

func newTestShaper() (*Shaper, *recorder) {
	r := &recorder{tick: make(chan time.Time)}
	s := NewShaper("holtdroid0", "198.18.0.0/30", "", slog.New(slog.DiscardHandler))
	s.run, s.measure, s.down, s.resolve = r.run, r.measure, r.bandwidth, r.resolve
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
	if s.Current() != "edge" || s.Region() != nil {
		t.Errorf("current = %q, region %v", s.Current(), s.Region())
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
	s.setMeasured(measured{edge: 20 * ms, servers: map[string]time.Duration{"frankfurt": 400 * ms}})
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
	if got := r.got(); !strings.Contains(got[len(got)-1], "handle 10: netem delay 105ms 25ms") {
		t.Errorf("3g under a region:\n%s", got[len(got)-1])
	}
	if err := s.SetRegion(ctx, contract.NetworkRegionSettings{}); err != nil {
		t.Fatal(err)
	}
	if got := r.got(); strings.Contains(got[len(got)-1], "1:10") || s.Region() != nil || s.Current() != "3g" {
		t.Errorf("region off: %q", got[len(got)-1])
	}
}

func TestWatch(t *testing.T) {
	s, r := newTestShaper()
	ctx, cancel := context.WithCancel(t.Context())
	r.m, r.down = measured{edge: 20 * ms, servers: map[string]time.Duration{"frankfurt": 400 * ms}}, 50_000
	done := make(chan struct{})
	go func() {
		s.Watch(ctx)
		close(done)
	}()
	for s.Route() == nil || s.Route().Down == 0 {
		time.Sleep(time.Millisecond)
	}
	if rt := s.Route(); rt.Edge != 20 || rt.Down != 50_000 || rt.At.IsZero() || rt.DownAt.IsZero() || len(rt.Servers) != 1 || rt.Servers[0] != (contract.NetworkServerRTT{Server: "frankfurt", RTT: 400}) {
		t.Errorf("route = %+v", rt)
	}
	if err := s.SetRegion(ctx, contract.NetworkRegionSettings{Region: "bd"}); err != nil {
		t.Fatal(err)
	}
	applied := len(r.got())

	r.mu.Lock()
	r.m.servers["frankfurt"], r.down = 100*ms, 0
	r.mu.Unlock()
	r.tick <- time.Time{}
	for s.Region().Paths[1].Added != 70 {
		time.Sleep(time.Millisecond)
	}
	for len(r.got()) == applied {
		time.Sleep(time.Millisecond)
	}
	if _, downs := r.counts(); downs != 1 || s.Route().Down != 50_000 {
		t.Errorf("%d bandwidth tests, route %+v: want one, kept", downs, s.Route())
	}
	r.mu.Lock()
	r.m = measured{}
	r.mu.Unlock()
	s.Refresh()
	for _, downs := r.counts(); downs < 2; _, downs = r.counts() {
		time.Sleep(time.Millisecond)
	}
	if s.Route().Edge != 20 {
		t.Errorf("a failed measurement dropped the route: %+v", s.Route())
	}
	cancel()
	<-done
}

func TestWait(t *testing.T) {
	s, _ := newTestShaper()
	if d := s.wait(); d != 3*time.Second {
		t.Errorf("before a route: %v", d)
	}
	s.Seed(contract.NetworkRoute{Edge: 30})
	if d := s.wait(); d != time.Minute {
		t.Errorf("with a route: %v", d)
	}
}

func TestSeed(t *testing.T) {
	for _, tc := range []struct {
		name  string
		age   time.Duration
		downs int
	}{{"fresh", time.Hour, 0}, {"stale", 7 * time.Hour, 1}} {
		t.Run(tc.name, func(t *testing.T) {
			s, r := newTestShaper()
			now := time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)
			s.now = func() time.Time { return now }
			r.m, r.down = measured{edge: 8 * ms}, 40_000
			s.Seed(contract.NetworkRoute{Edge: 30, Down: 20_000, At: now.Add(-tc.age), DownAt: now.Add(-tc.age)})
			if rt := s.Route(); rt.Edge != 30 || rt.Down != 20_000 {
				t.Fatalf("seeded route = %+v", rt)
			}
			ctx, cancel := context.WithCancel(t.Context())
			done := make(chan struct{})
			go func() {
				s.Watch(ctx)
				close(done)
			}()
			for measures, downs := r.counts(); measures == 0 || s.Route().Edge != 8 || downs < tc.downs; measures, downs = r.counts() {
				time.Sleep(time.Millisecond)
			}
			time.Sleep(10 * time.Millisecond)
			cancel()
			<-done
			if _, downs := r.counts(); downs != tc.downs {
				t.Errorf("%d bandwidth tests, want %d", downs, tc.downs)
			}
		})
	}
}

func TestLearn(t *testing.T) {
	s, r := newTestShaper()
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		s.Watch(ctx)
		close(done)
	}()
	for measures, _ := r.counts(); measures == 0; measures, _ = r.counts() {
		time.Sleep(time.Millisecond)
	}
	learned := []netip.Addr{netip.MustParseAddr("104.16.9.9")}
	s.Learn("api.example.com", learned)
	if err := s.SetRegion(ctx, contract.NetworkRegionSettings{Region: "bd", Backends: []string{"*.example.com"}}); err != nil {
		t.Fatal(err)
	}
	applied := len(r.got())
	s.Learn("cdn.other.com", learned)
	s.Learn("API.Example.com.", learned)
	r.tick <- time.Time{}
	for len(r.got()) == applied {
		time.Sleep(time.Millisecond)
	}
	if got := r.got(); !strings.Contains(got[len(got)-1], "match ip dst 104.16.9.9/32 flowid 1:20") {
		t.Errorf("learned backend not shaped:\n%.600s", got[len(got)-1])
	}
	if st := s.Region(); !slices.Contains(st.Addresses, "104.16.9.9") || !slices.Contains(st.Addresses, "104.16.1.1") {
		t.Errorf("addresses = %v", st.Addresses)
	}
	cancel()
	<-done
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
	big := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(make([]byte, 4<<20))
	}))
	defer big.Close()
	if kbit, err := (prober{}).down(t.Context(), big.URL); err != nil || kbit <= 0 {
		t.Errorf("down = %d, %v", kbit, err)
	}
	if _, err := (prober{}).down(t.Context(), srv.URL); err == nil {
		t.Error("a two-byte download gave a rate")
	}
	if got := resolve(t.Context(), []string{"10.0.0.2", "10.0.0.1", "10.0.0.2"}); len(got) != 2 || got[0].String() != "10.0.0.1" {
		t.Errorf("resolve = %v", got)
	}
}
