package agent

import (
	"bufio"
	"context"
	"crypto/tls"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/agent/conns"
	"github.com/holtdroid/holtdroid/internal/netem"
)

const (
	// edgeProbes is how many addresses the agent asks Cloudflare about per session.
	edgeProbes = 300
	// edgeHost is a name any Cloudflare address answers for.
	edgeHost = "www.cloudflare.com"
)

// edgeProber asks Cloudflare which of its sites answers each of its
// addresses the device reaches, with /cdn-cgi/trace through the same
// location. Cloudflare answers that path at the edge, so the app's servers
// never see it.
type edgeProber struct {
	tracker *conns.Tracker
	ask     func(ctx context.Context, address, host string) string

	mu    sync.Mutex
	asked map[[2]string]bool
	slots chan struct{}
}

func newEdgeProber(tracker *conns.Tracker, proxy string) *edgeProber {
	client := func(serverName string) *http.Client {
		tr := &http.Transport{DisableKeepAlives: true, TLSClientConfig: &tls.Config{ServerName: serverName}}
		if u, err := url.Parse(proxy); proxy != "" && err == nil {
			tr.Proxy = http.ProxyURL(u)
		}
		return &http.Client{Timeout: 5 * time.Second, Transport: tr}
	}
	byAddress, byHost := client(edgeHost), client("")
	return &edgeProber{
		tracker: tracker,
		ask: func(ctx context.Context, address, host string) string {
			ap := netip.AddrPortFrom(netip.MustParseAddr(address), 443)
			if colo := trace(ctx, byAddress, "https://"+ap.String()+"/cdn-cgi/trace", edgeHost); colo != "" || host == "" {
				return colo
			}
			return trace(ctx, byHost, "https://"+host+"/cdn-cgi/trace", "")
		},
		asked: map[[2]string]bool{},
		slots: make(chan struct{}, 2),
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
			if err != nil || !c.End.IsZero() || netem.CDN(addr) != "cloudflare" {
				continue
			}
			key := [2]string{c.Address, c.Outbound}
			p.mu.Lock()
			skip := p.asked[key] || len(p.asked) >= edgeProbes
			p.asked[key] = true
			p.mu.Unlock()
			if !skip {
				go p.probe(ctx, c.Address, c.Host, c.Outbound)
			}
		}
	}
}

func (p *edgeProber) probe(ctx context.Context, address, host, outbound string) {
	select {
	case p.slots <- struct{}{}:
	case <-ctx.Done():
		return
	}
	defer func() { <-p.slots }()
	if colo := p.ask(ctx, address, host); colo != "" {
		p.tracker.SetEdge(address, outbound, colo)
	}
}

// trace asks a /cdn-cgi/trace URL, as host when it is set, for the site
// that answered; "" when it doesn't say.
func trace(ctx context.Context, hc *http.Client, u, host string) string {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return ""
	}
	if host != "" {
		req.Host = host
	}
	resp, err := hc.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	return colo(resp.Body)
}

func colo(r io.Reader) string {
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		if c, ok := strings.CutPrefix(sc.Text(), "colo="); ok && len(c) == 3 {
			return strings.ToUpper(c)
		}
	}
	return ""
}
