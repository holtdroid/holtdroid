package netem

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/netip"
	"net/url"
	"slices"
	"sync"
	"time"
)

// measured is the session's own route: round trips to the nearest CDN
// edge and to the chosen server location (0 when unknown) and the
// backends' addresses.
type measured struct {
	edge, origin time.Duration
	backends     []netip.Addr
}

// differs ignores the few milliseconds a round trip wanders, since every
// change re-applies the qdiscs and drops what they hold.
func (m measured) differs(o measured) bool {
	near := func(a, b time.Duration) bool { return (a - b).Abs() < 10*time.Millisecond }
	return !near(m.edge, o.edge) || !near(m.origin, o.origin) || !slices.Equal(m.backends, o.backends)
}

// prober measures through the VPN sidecar's proxy, so it follows the
// device's route without crossing the shaped tun.
type prober struct {
	proxy *url.URL
}

func (p prober) client() *http.Client {
	t := &http.Transport{MaxIdleConnsPerHost: 1}
	if p.proxy != nil {
		t.Proxy = http.ProxyURL(p.proxy)
	}
	return &http.Client{Transport: t, Timeout: 5 * time.Second}
}

// rtt is the quickest of three requests on one kept-alive connection; the
// first request, which also opens the connection, doesn't count.
func (p prober) rtt(ctx context.Context, target string) (time.Duration, error) {
	hc := p.client()
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

func resolve(ctx context.Context, hosts []string) []netip.Addr {
	var mu sync.Mutex
	var out []netip.Addr
	var wg sync.WaitGroup
	for _, h := range hosts {
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
