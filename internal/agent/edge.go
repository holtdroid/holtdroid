package agent

import (
	"bufio"
	"context"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/agent/conns"
	"github.com/holtdroid/holtdroid/internal/netem"
)

// edgeProbes is how many hosts the agent asks Cloudflare about per session.
const edgeProbes = 300

// edgeProber asks Cloudflare which of its sites answers each host the
// device reaches through it, with one request to the host's
// /cdn-cgi/trace through the same location; Cloudflare answers it at the
// edge, without reaching the host's servers.
type edgeProber struct {
	tracker *conns.Tracker
	hc      *http.Client
	trace   func(host string) string

	mu    sync.Mutex
	asked map[[2]string]bool
	slots chan struct{}
}

func newEdgeProber(tracker *conns.Tracker, proxy string) *edgeProber {
	tr := &http.Transport{DisableKeepAlives: true}
	if u, err := url.Parse(proxy); proxy != "" && err == nil {
		tr.Proxy = http.ProxyURL(u)
	}
	return &edgeProber{
		tracker: tracker,
		hc:      &http.Client{Timeout: 5 * time.Second, Transport: tr},
		trace:   func(host string) string { return "https://" + host + "/cdn-cgi/trace" },
		asked:   map[[2]string]bool{},
		slots:   make(chan struct{}, 2),
	}
}

func (p *edgeProber) run(ctx context.Context) {
	ch, stop := p.tracker.Subscribe()
	defer stop()
	for {
		select {
		case <-ctx.Done():
			return
		case c := <-ch:
			addr, err := netip.ParseAddr(c.Address)
			if err != nil || c.Host == "" || c.Port != 443 || !c.End.IsZero() || netem.CDN(addr) != "cloudflare" {
				continue
			}
			key := [2]string{c.Host, c.Outbound}
			p.mu.Lock()
			skip := p.asked[key] || len(p.asked) >= edgeProbes
			p.asked[key] = true
			p.mu.Unlock()
			if !skip {
				go p.probe(ctx, c.Host, c.Outbound)
			}
		}
	}
}

func (p *edgeProber) probe(ctx context.Context, host, outbound string) {
	select {
	case p.slots <- struct{}{}:
	case <-ctx.Done():
		return
	}
	defer func() { <-p.slots }()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.trace(host), nil)
	if err != nil {
		return
	}
	resp, err := p.hc.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return
	}
	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		if colo, ok := strings.CutPrefix(sc.Text(), "colo="); ok && len(colo) == 3 {
			p.tracker.SetEdge(host, outbound, strings.ToUpper(colo))
			return
		}
	}
}
