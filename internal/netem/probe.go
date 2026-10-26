package netem

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/netip"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

// DownProbe is a download that measures the route's bandwidth.
const DownProbe = "https://speed.cloudflare.com/__down?bytes=10000000"

// measured is the session's own route: round trips to the nearest CDN
// edge and to each server location (0 when unknown) taken at at, its
// download rate in kbit/s taken at downAt, and a region's backend
// addresses.
type measured struct {
	edge     time.Duration
	servers  map[string]time.Duration
	at       time.Time
	down     int
	downAt   time.Time
	backends []netip.Addr
}

func (m measured) empty() bool {
	for _, d := range m.servers {
		if d > 0 {
			return false
		}
	}
	return m.edge == 0
}

// differs ignores the few milliseconds a round trip wanders, since every
// change re-applies the qdiscs and drops what they hold.
func (m measured) differs(o measured) bool {
	near := func(a, b time.Duration) bool { return (a - b).Abs() < 10*time.Millisecond }
	if !near(m.edge, o.edge) || !slices.Equal(m.backends, o.backends) {
		return true
	}
	for _, s := range Servers {
		if !near(m.servers[s.ID], o.servers[s.ID]) {
			return true
		}
	}
	return false
}

func (m measured) route() *contract.NetworkRoute {
	if m.edge == 0 && len(m.servers) == 0 && m.down == 0 {
		return nil
	}
	r := &contract.NetworkRoute{Edge: int(m.edge.Milliseconds()), Down: m.down, At: m.at, DownAt: m.downAt}
	for _, s := range Servers {
		if d := m.servers[s.ID]; d > 0 {
			r.Servers = append(r.Servers, contract.NetworkServerRTT{Server: s.ID, RTT: int(d.Milliseconds())})
		}
	}
	return r
}

// prober measures through the VPN sidecar's proxy, so it follows the
// device's route without crossing the shaped tun.
type prober struct {
	proxy *url.URL
	log   *slog.Logger
}

func (p prober) client(timeout time.Duration) *http.Client {
	t := &http.Transport{MaxIdleConnsPerHost: 1}
	if p.proxy != nil {
		t.Proxy = http.ProxyURL(p.proxy)
	}
	return &http.Client{Transport: t, Timeout: timeout}
}

// measure takes the round trips; what fails stays 0.
func (p prober) measure(ctx context.Context) measured {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	m := measured{servers: map[string]time.Duration{}}
	var mu sync.Mutex
	var wg sync.WaitGroup
	probe := func(target string, set func(time.Duration)) {
		d, err := p.rtt(ctx, target)
		if err != nil {
			p.log.Debug("network route: round trip", "target", target, "err", err)
		}
		mu.Lock()
		set(d)
		mu.Unlock()
	}
	wg.Go(func() { probe(EdgeProbe, func(d time.Duration) { m.edge = d }) })
	for _, s := range Servers {
		wg.Go(func() { probe(s.Probe, func(d time.Duration) { m.servers[s.ID] = d }) })
	}
	wg.Wait()
	return m
}

// seed turns a route measured earlier back into a measurement.
func seed(r contract.NetworkRoute) measured {
	m := measured{
		edge: time.Duration(r.Edge) * time.Millisecond, servers: map[string]time.Duration{}, at: r.At,
		down: r.Down, downAt: r.DownAt,
	}
	for _, s := range r.Servers {
		m.servers[s.Server] = time.Duration(s.RTT) * time.Millisecond
	}
	return m
}

// rtt is the quickest of three requests on one kept-alive connection; the
// first request, which also opens the connection, doesn't count.
func (p prober) rtt(ctx context.Context, target string) (time.Duration, error) {
	hc := p.client(5 * time.Second)
	defer hc.CloseIdleConnections()
	var best time.Duration
	for i := range 4 {
		var wrote, first time.Time
		trace := &httptrace.ClientTrace{
			WroteRequest:         func(httptrace.WroteRequestInfo) { wrote = time.Now() },
			GotFirstResponseByte: func() { first = time.Now() },
		}
		req, err := http.NewRequestWithContext(httptrace.WithClientTrace(ctx, trace), http.MethodGet, target, nil)
		if err != nil {
			return 0, err
		}
		resp, err := hc.Do(req)
		if err != nil {
			return 0, err
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		_ = resp.Body.Close()
		if d := first.Sub(wrote); i > 0 && (best == 0 || d < best) {
			best = d
		}
	}
	return best, nil
}

// down is the rate of a download in kbit/s, counted from its first byte
// for up to 10 seconds.
func (p prober) down(ctx context.Context, target string) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	hc := p.client(0)
	defer hc.CloseIdleConnections()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return 0, err
	}
	resp, err := hc.Do(req)
	if err != nil {
		return 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	start := time.Now()
	body := resp.Body
	t := time.AfterFunc(10*time.Second, func() { _ = body.Close() })
	defer t.Stop()
	n, err := io.Copy(io.Discard, body)
	elapsed := time.Since(start)
	if n < 1<<20 || elapsed <= 0 {
		return 0, errors.Join(errors.New("too little data for a rate"), err)
	}
	return int(float64(n) * 8 / elapsed.Seconds() / 1000), nil
}

func resolve(ctx context.Context, hosts []string) []netip.Addr {
	var mu sync.Mutex
	var out []netip.Addr
	var wg sync.WaitGroup
	for _, h := range hosts {
		if strings.HasPrefix(h, "*.") {
			continue
		}
		wg.Go(func() {
			addrs := []netip.Addr{}
			if a, err := netip.ParseAddr(h); err == nil {
				addrs = append(addrs, a)
			} else if found, err := net.DefaultResolver.LookupNetIP(ctx, "ip4", h); err == nil {
				addrs = found
			}
			mu.Lock()
			out = append(out, addrs...)
			mu.Unlock()
		})
	}
	wg.Wait()
	for i, a := range out {
		out[i] = a.Unmap()
	}
	slices.SortFunc(out, func(a, b netip.Addr) int { return a.Compare(b) })
	return slices.Compact(out)
}
