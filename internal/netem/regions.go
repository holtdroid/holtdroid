package netem

import (
	_ "embed"
	"fmt"
	"net/netip"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

// Region is a country whose mobile users a session can stand in for.
// Access is its typical mobile link; EdgeRTT and Servers are round trips
// from its operators' networks, beyond the access link, to the CDN edge
// that serves them and to each server location.
type Region struct {
	ID          string
	Name        string
	Country     string
	Description string
	Access      Link
	Edge        string
	EdgeRTT     time.Duration
	Servers     map[string]time.Duration
}

// Server is a place the app's servers may run; Probe answers fast from
// there and measures the session's own route to it.
type Server struct {
	ID, Name, Probe string
}

// EdgeProbe answers from the Cloudflare edge nearest the session's route.
const EdgeProbe = "https://1.1.1.1/cdn-cgi/trace"

var Servers = []Server{
	{"frankfurt", "Frankfurt", "https://dynamodb.eu-central-1.amazonaws.com/"},
	{"virginia", "N. Virginia", "https://dynamodb.us-east-1.amazonaws.com/"},
	{"california", "N. California", "https://dynamodb.us-west-1.amazonaws.com/"},
	{"sao-paulo", "São Paulo", "https://dynamodb.sa-east-1.amazonaws.com/"},
	{"mumbai", "Mumbai", "https://dynamodb.ap-south-1.amazonaws.com/"},
	{"singapore", "Singapore", "https://dynamodb.ap-southeast-1.amazonaws.com/"},
	{"tokyo", "Tokyo", "https://dynamodb.ap-northeast-1.amazonaws.com/"},
}

// rtts lists round trips in the order of Servers.
func rtts(ms ...int) map[string]time.Duration {
	out := make(map[string]time.Duration, len(Servers))
	for i, s := range Servers {
		out[s.ID] = time.Duration(ms[i]) * time.Millisecond
	}
	return out
}

// Regions are rounded estimates: access links from public mobile speed
// reports, round trips from public latency maps. They are plausible, not
// measured per operator.
var Regions = []Region{
	{
		ID: "de", Name: "Germany", Country: "DE", Description: "Good 4G and 5G, CDN edges and big data centres in the country.",
		Access: Link{RTT: 30 * ms, Jitter: 8 * ms, Down: 60_000, Up: 12_000, Loss: 0.2},
		Edge:   "Frankfurt", EdgeRTT: 5 * ms, Servers: rtts(10, 90, 150, 200, 120, 160, 230),
	},
	{
		ID: "us", Name: "United States", Country: "US", Description: "Fast mobile data; distances inside the country are large.",
		Access: Link{RTT: 35 * ms, Jitter: 10 * ms, Down: 100_000, Up: 12_000, Loss: 0.3},
		Edge:   "the nearest metro", EdgeRTT: 10 * ms, Servers: rtts(100, 30, 50, 130, 220, 190, 130),
	},
	{
		ID: "ua", Name: "Ukraine", Country: "UA", Description: "Decent 4G, routes to Europe go through Poland and Germany.",
		Access: Link{RTT: 35 * ms, Jitter: 10 * ms, Down: 30_000, Up: 12_000, Loss: 0.5},
		Edge:   "Kyiv", EdgeRTT: 8 * ms, Servers: rtts(35, 120, 180, 230, 150, 180, 250),
	},
	{
		ID: "kz", Name: "Kazakhstan", Country: "KZ", Description: "Decent 4G, far from most data centres.",
		Access: Link{RTT: 40 * ms, Jitter: 12 * ms, Down: 35_000, Up: 12_000, Loss: 0.5},
		Edge:   "Almaty", EdgeRTT: 10 * ms, Servers: rtts(75, 160, 220, 270, 120, 160, 220),
	},
	{
		ID: "bd", Name: "Bangladesh", Country: "BD", Description: "Slow, uneven 4G; operators without local CDN peering are served from Singapore.",
		Access: Link{RTT: 55 * ms, Jitter: 25 * ms, Down: 15_000, Up: 6_000, Loss: 1},
		Edge:   "Dhaka or Singapore, by operator", EdgeRTT: 30 * ms, Servers: rtts(170, 240, 230, 340, 60, 50, 110),
	},
	{
		ID: "in", Name: "India", Country: "IN", Description: "Fast 5G in cities, busy cells; many CDN edges.",
		Access: Link{RTT: 45 * ms, Jitter: 20 * ms, Down: 90_000, Up: 10_000, Loss: 0.5},
		Edge:   "Mumbai, Chennai, Delhi and others", EdgeRTT: 15 * ms, Servers: rtts(120, 200, 220, 300, 20, 50, 120),
	},
	{
		ID: "pk", Name: "Pakistan", Country: "PK", Description: "Slow 4G; CDN traffic often leaves the country.",
		Access: Link{RTT: 60 * ms, Jitter: 25 * ms, Down: 20_000, Up: 9_000, Loss: 1},
		Edge:   "Karachi or the Middle East, by operator", EdgeRTT: 35 * ms, Servers: rtts(130, 210, 260, 310, 50, 90, 160),
	},
	{
		ID: "id", Name: "Indonesia", Country: "ID", Description: "Average 4G across many islands, close to Singapore.",
		Access: Link{RTT: 45 * ms, Jitter: 20 * ms, Down: 30_000, Up: 12_000, Loss: 0.5},
		Edge:   "Jakarta", EdgeRTT: 15 * ms, Servers: rtts(180, 230, 180, 330, 70, 20, 90),
	},
	{
		ID: "ph", Name: "Philippines", Country: "PH", Description: "Average 4G with high jitter.",
		Access: Link{RTT: 50 * ms, Jitter: 25 * ms, Down: 30_000, Up: 8_000, Loss: 1},
		Edge:   "Manila", EdgeRTT: 20 * ms, Servers: rtts(200, 220, 160, 330, 90, 40, 60),
	},
	{
		ID: "ng", Name: "Nigeria", Country: "NG", Description: "Congested 4G; routes abroad go through Europe.",
		Access: Link{RTT: 65 * ms, Jitter: 30 * ms, Down: 25_000, Up: 9_000, Loss: 1.5},
		Edge:   "Lagos", EdgeRTT: 20 * ms, Servers: rtts(100, 160, 220, 230, 200, 260, 300),
	},
	{
		ID: "ke", Name: "Kenya", Country: "KE", Description: "Congested 4G, submarine cables to Europe and India.",
		Access: Link{RTT: 55 * ms, Jitter: 30 * ms, Down: 25_000, Up: 9_000, Loss: 1.5},
		Edge:   "Nairobi or Mombasa", EdgeRTT: 15 * ms, Servers: rtts(130, 210, 270, 280, 110, 180, 260),
	},
	{
		ID: "eg", Name: "Egypt", Country: "EG", Description: "Slow 4G, close to Europe.",
		Access: Link{RTT: 50 * ms, Jitter: 20 * ms, Down: 20_000, Up: 8_000, Loss: 1},
		Edge:   "Cairo", EdgeRTT: 25 * ms, Servers: rtts(60, 140, 200, 230, 110, 150, 220),
	},
	{
		ID: "br", Name: "Brazil", Country: "BR", Description: "Average 4G, far from everything outside South America.",
		Access: Link{RTT: 40 * ms, Jitter: 15 * ms, Down: 45_000, Up: 12_000, Loss: 0.5},
		Edge:   "São Paulo and other metros", EdgeRTT: 10 * ms, Servers: rtts(200, 120, 170, 15, 300, 330, 260),
	},
}

//go:embed cdn.txt
var cdnList string

type cdnRange struct {
	prefix   netip.Prefix
	provider string
}

var cdnRanges = func() []cdnRange {
	var out []cdnRange
	provider := ""
	for l := range strings.Lines(cdnList) {
		l = strings.TrimSpace(l)
		if p, ok := strings.CutPrefix(l, "# section: "); ok {
			provider = p
		}
		if l != "" && !strings.HasPrefix(l, "#") {
			out = append(out, cdnRange{netip.MustParsePrefix(l), provider})
		}
	}
	return out
}()

var cdnPrefixes = func() []netip.Prefix {
	out := make([]netip.Prefix, len(cdnRanges))
	for i, r := range cdnRanges {
		out[i] = r.prefix
	}
	return out
}()

func FindRegion(id string) (Region, bool) {
	i := slices.IndexFunc(Regions, func(r Region) bool { return r.ID == id })
	if i < 0 {
		return Region{}, false
	}
	return Regions[i], true
}

func findServer(id string) (Server, bool) {
	i := slices.IndexFunc(Servers, func(s Server) bool { return s.ID == id })
	if i < 0 {
		return Server{}, false
	}
	return Servers[i], true
}

var hostName = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$`)

// choice is a validated NetworkRegionSettings.
type choice struct {
	region   Region
	server   Server
	backends []string
}

// parseChoice validates settings; an empty region is nil.
func parseChoice(in contract.NetworkRegionSettings) (*choice, error) {
	if in.Region == "" {
		return nil, nil
	}
	r, ok := FindRegion(in.Region)
	if !ok {
		return nil, fmt.Errorf("%w: unknown network region %q", contract.ErrInvalid, in.Region)
	}
	srv := Servers[0]
	if in.Server != "" {
		if srv, ok = findServer(in.Server); !ok {
			return nil, fmt.Errorf("%w: unknown server location %q", contract.ErrInvalid, in.Server)
		}
	}
	backends, err := CleanBackends(in.Backends)
	if err != nil {
		return nil, err
	}
	return &choice{region: r, server: srv, backends: backends}, nil
}

// CleanBackends normalizes a region's backends, dropping repeats.
func CleanBackends(in []string) ([]string, error) {
	var out []string
	for _, b := range in {
		b = normalize(b)
		if a, err := netip.ParseAddr(b); err == nil && a.Is4() {
			b = a.String()
		} else if h := strings.TrimPrefix(b, "*."); !hostName.MatchString(h) || len(h) > 253 {
			return nil, fmt.Errorf("%w: backend %q is not a host name, *.name or IPv4 address", contract.ErrInvalid, b)
		}
		if !slices.Contains(out, b) {
			out = append(out, b)
		}
	}
	return out, nil
}

func normalize(name string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(name)), ".")
}

// matches is whether a name the device looked up is one of the backends:
// the name itself, or below a *.name.
func (c *choice) matches(name string) bool {
	for _, b := range c.backends {
		if b == name {
			return true
		}
		if suffix, ok := strings.CutPrefix(b, "*"); ok && strings.HasSuffix(name, suffix) {
			return true
		}
	}
	return false
}

// extra is what a path adds once the route's own round trip is taken off.
func extra(path, baseline time.Duration) time.Duration {
	return max(0, path-baseline)
}

func (c *choice) state(m measured, learned []netip.Addr) *contract.NetworkRegionState {
	path := func(class contract.NetworkPathClass, target, base time.Duration) contract.NetworkPath {
		return contract.NetworkPath{
			Class: class, Target: int(target.Milliseconds()), Baseline: int(base.Milliseconds()),
			Added: int(extra(target, base).Milliseconds()),
		}
	}
	return &contract.NetworkRegionState{
		Region: c.region.ID, Server: c.server.ID, Backends: slices.Clone(c.backends),
		Addresses: addrStrings(union(m.backends, learned)),
		Paths: []contract.NetworkPath{
			path(contract.NetworkPathEdge, c.region.EdgeRTT, m.edge),
			path(contract.NetworkPathOrigin, c.region.Servers[c.server.ID], m.servers[c.server.ID]),
		},
	}
}

// RegionState is the state settings ask for over a route, for devices
// that only simulate it.
func RegionState(in contract.NetworkRegionSettings, route *contract.NetworkRoute) (*contract.NetworkRegionState, error) {
	c, err := parseChoice(in)
	if c == nil || err != nil {
		return nil, err
	}
	m := measured{}
	if route != nil {
		m = seed(*route)
	}
	return c.state(m, nil), nil
}

func union(a, b []netip.Addr) []netip.Addr {
	out := slices.Concat(a, b)
	slices.SortFunc(out, func(x, y netip.Addr) int { return x.Compare(y) })
	return slices.Compact(out)
}

func addrStrings(addrs []netip.Addr) []string {
	out := make([]string, 0, len(addrs))
	for _, a := range addrs {
		out = append(out, a.String())
	}
	return out
}

func linkInfo(l Link) contract.NetworkLink {
	return contract.NetworkLink{
		RTT: int(l.RTT.Milliseconds()), Jitter: int(l.Jitter.Milliseconds()), Down: l.Down, Up: l.Up, Loss: l.Loss,
	}
}

func RegionCatalog() []contract.NetworkRegionInfo {
	out := make([]contract.NetworkRegionInfo, 0, len(Regions))
	for _, r := range Regions {
		info := contract.NetworkRegionInfo{
			ID: r.ID, Name: r.Name, Country: r.Country, Description: r.Description, Access: linkInfo(r.Access),
			Edge: r.Edge, EdgeRTT: int(r.EdgeRTT.Milliseconds()),
		}
		for _, s := range Servers {
			info.Servers = append(info.Servers, contract.NetworkServerRTT{Server: s.ID, RTT: int(r.Servers[s.ID].Milliseconds())})
		}
		out = append(out, info)
	}
	return out
}

func ServerCatalog() []contract.NetworkServerInfo {
	out := make([]contract.NetworkServerInfo, 0, len(Servers))
	for _, s := range Servers {
		out = append(out, contract.NetworkServerInfo{ID: s.ID, Name: s.Name})
	}
	return out
}

// CDN is the provider (cloudflare, fastly, google) whose edge ranges in
// cdn.txt hold addr, or "".
func CDN(addr netip.Addr) string {
	addr = addr.Unmap()
	for _, r := range cdnRanges {
		if r.prefix.Contains(addr) {
			return r.provider
		}
	}
	return ""
}

var cgnat = netip.MustParsePrefix("100.64.0.0/10")

// CGNAT reports whether addr is in the shared address space carriers and
// tunnels use.
func CGNAT(addr netip.Addr) bool { return cgnat.Contains(addr.Unmap()) }
