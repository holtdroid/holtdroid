// Package vpn renders the sing-box config of a session's vpn sidecar: a tun
// inbound the device's traffic is routed into and a selector over the configured
// locations, switched by the agent through the clash API.
package vpn

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/netip"
	"regexp"
	"slices"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/secrets"
)

const (
	Direct   = "direct"
	Selector = "select"
	ClashAPI = "127.0.0.1:9090"
	// Proxy is the sidecar's mixed inbound, for the agent's own requests
	// that must leave through the location (its traffic skips the tun).
	Proxy = "127.0.0.1:7890"

	TunInterface = "holtdroid0"
	TunNetwork   = "198.18.0.0/30"
	TunTable     = "2022"
)

type Config struct {
	Image       string
	BypassCIDRs []string
	DNS         string
	Resolver    string
	Direct      bool
	Default     string
	Locations   []Location
}

// Location is one egress choice. Outbound is a sing-box outbound or endpoint
// object without a tag, whose string fields may be secret references, or a
// secret reference whose value is that object as JSON.
type Location struct {
	ID       string
	Label    string
	Outbound any
	// Geo is where this location is; a session's GPS is faked to a random
	// point within it (Radius metres, default 10km). Empty leaves the GPS
	// alone.
	Geo *GeoArea
	// Timezone is the IANA zone set with the location (e.g. Europe/Kyiv).
	Timezone string
}

// GeoArea is a circle a faked GPS position is placed in at random.
type GeoArea struct {
	Lat    float64
	Lng    float64
	Radius float64 // metres; 0 means the default 10km
}

func DefaultConfig() Config {
	return Config{
		Image:       "ghcr.io/sagernet/sing-box:v1.14.2",
		BypassCIDRs: []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"},
		DNS:         "1.1.1.1",
		Direct:      true,
	}
}

type Secrets interface {
	Resolve(ctx context.Context, ref secrets.Ref) (string, error)
}

var locationID = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)

var endpointTypes = []string{"wireguard", "tailscale"}

func (c Config) Enabled() bool { return len(c.Locations) > 0 }

func (c Config) Validate() error {
	if !c.Enabled() {
		return nil
	}
	var errs []error
	seen := map[string]bool{}
	for i, l := range c.Locations {
		switch {
		case !locationID.MatchString(l.ID):
			errs = append(errs, fmt.Errorf("vpn.locations[%d]: id %q must be lowercase letters, digits and dashes", i, l.ID))
		case l.ID == Direct || l.ID == Selector:
			errs = append(errs, fmt.Errorf("vpn.locations[%d]: id %q is reserved", i, l.ID))
		case seen[l.ID]:
			errs = append(errs, fmt.Errorf("vpn.locations[%d]: duplicate id %q", i, l.ID))
		}
		seen[l.ID] = true
		switch o := l.Outbound.(type) {
		case string:
			if ref := secrets.Ref(o); ref.Scheme() == "" || ref.Scheme() == o {
				errs = append(errs, fmt.Errorf("vpn.locations[%d].outbound: a string must be a secret reference like file:/path", i))
			}
		case map[string]any:
			if _, err := outbound(l.ID, o); err != nil {
				errs = append(errs, fmt.Errorf("vpn.locations[%d].outbound: %w", i, err))
			}
		default:
			errs = append(errs, fmt.Errorf("vpn.locations[%d].outbound: want a sing-box outbound object or a secret reference", i))
		}
		if g := l.Geo; g != nil {
			if g.Lat < -90 || g.Lat > 90 || g.Lng < -180 || g.Lng > 180 {
				errs = append(errs, fmt.Errorf("vpn.locations[%d].geo: lat/lng out of range", i))
			}
			if g.Radius < 0 {
				errs = append(errs, fmt.Errorf("vpn.locations[%d].geo.radius must be >= 0", i))
			}
		}
	}
	for _, cidr := range c.BypassCIDRs {
		if _, err := netip.ParsePrefix(cidr); err != nil {
			errs = append(errs, fmt.Errorf("vpn.bypassCIDRs: %w", err))
		}
	}
	if _, err := netip.ParseAddr(c.DNS); err != nil {
		errs = append(errs, fmt.Errorf("vpn.dns must be an IP address: %w", err))
	}
	if c.Resolver != "" {
		if _, err := netip.ParseAddr(c.Resolver); err != nil {
			errs = append(errs, fmt.Errorf("vpn.resolver must be an IP address: %w", err))
		}
	}
	if c.Default != "" && !slices.ContainsFunc(c.Offered(), func(l contract.Location) bool { return l.ID == c.Default }) {
		errs = append(errs, fmt.Errorf("vpn.default: unknown location %q", c.Default))
	}
	return errors.Join(errs...)
}

// Offered lists the locations a session can switch between.
func (c Config) Offered() []contract.Location {
	if !c.Enabled() {
		return nil
	}
	var out []contract.Location
	if c.Direct {
		out = append(out, contract.Location{ID: Direct, Label: "Direct"})
	}
	for _, l := range c.Locations {
		out = append(out, contract.Location{ID: l.ID, Label: cmp.Or(l.Label, l.ID)})
	}
	return out
}

// DefaultLocation is where a session starts without an explicit choice.
func (c Config) DefaultLocation() string {
	offered := c.Offered()
	switch {
	case len(offered) == 0:
		return ""
	case c.Default != "":
		return c.Default
	}
	return offered[0].ID
}

func (c Config) initial(location string) (string, error) {
	location = cmp.Or(location, c.DefaultLocation())
	if !slices.ContainsFunc(c.Offered(), func(l contract.Location) bool { return l.ID == location }) {
		return "", fmt.Errorf("%w: unknown location %q", contract.ErrInvalid, location)
	}
	return location, nil
}

// Render returns the sidecar's sing-box config with the selector starting at
// location ("" picks the default). The tun doesn't route by itself: Android
// in the same network namespace owns the policy routing, and the agent adds
// the rules that lead apps into it (decision #82).
func (c Config) Render(ctx context.Context, sec Secrets, location string) ([]byte, error) {
	inbounds := []obj{
		{
			"type":           "tun",
			"tag":            "tun",
			"interface_name": TunInterface,
			"address":        []string{"198.18.0.1/30"},
			"auto_route":     false,
		},
		{"type": "mixed", "tag": "agent", "listen": "127.0.0.1", "listen_port": 7890},
	}
	rules := []obj{
		{"action": "sniff"},
		{"protocol": "dns", "action": "hijack-dns"},
	}
	return c.render(ctx, sec, location, inbounds, rules, nil, ClashAPI, "eth0")
}

const bypass = "bypass"

// tunnelDNS are the DNS servers Holtdroid Tunnel announces to apps; nothing
// answers them, so anything but plain DNS (Android's private DNS probe on
// 853) is refused at once instead of timing out on the bypass route.
var tunnelDNS = []string{"172.19.0.2/32", "fdfe:dcba:9876::2/128"}

// RenderProxy returns the config of a session's sing-box on a phone's host:
// a mixed inbound on listen, which the phone's tunnel app reaches through adb
// reverse, and the clash API on clash. The bypass CIDRs go out directly, as
// they skip the tun on an emulator.
func (c Config) RenderProxy(ctx context.Context, sec Secrets, location string, listen netip.AddrPort, clash string) ([]byte, error) {
	inbound := []obj{{
		"type":        "mixed",
		"tag":         "phone",
		"listen":      listen.Addr().String(),
		"listen_port": listen.Port(),
	}}
	rules := []obj{
		{"action": "sniff"},
		{"protocol": "dns", "action": "hijack-dns"},
		{"port": 53, "action": "hijack-dns"},
		{"ip_cidr": tunnelDNS, "action": "reject"},
		{"ip_cidr": c.BypassCIDRs, "outbound": bypass},
	}
	return c.render(ctx, sec, location, inbound, rules, []obj{{"type": "direct", "tag": bypass}}, clash, "")
}

// render binds outbounds to iface behind a tun, where they would otherwise
// loop; a phone's sing-box runs in the host's network, and binding there
// would route cluster addresses (the resolver) past the pod network.
func (c Config) render(ctx context.Context, sec Secrets, location string, inbounds, rules, extra []obj, clash, iface string) ([]byte, error) {
	if !c.Enabled() {
		return nil, errors.New("vpn: no locations configured")
	}
	initial, err := c.initial(location)
	if err != nil {
		return nil, err
	}

	var outbounds, endpoints []obj
	if c.Direct {
		outbounds = append(outbounds, obj{"type": "direct", "tag": Direct})
	}
	for _, l := range c.Locations {
		raw, err := resolve(ctx, sec, l)
		if err != nil {
			return nil, err
		}
		o, err := outbound(l.ID, raw)
		if err != nil {
			return nil, fmt.Errorf("vpn location %q: %w", l.ID, err)
		}
		if typ, _ := o["type"].(string); slices.Contains(endpointTypes, typ) {
			endpoints = append(endpoints, o)
		} else {
			outbounds = append(outbounds, o)
		}
	}
	tags := make([]string, 0, len(c.Offered()))
	for _, l := range c.Offered() {
		tags = append(tags, l.ID)
	}
	outbounds = append(outbounds, obj{
		"type":                        "selector",
		"tag":                         Selector,
		"outbounds":                   tags,
		"default":                     initial,
		"interrupt_exist_connections": true,
	})
	outbounds = append(outbounds, extra...)

	route := obj{
		"rules":                   rules,
		"final":                   Selector,
		"default_domain_resolver": "local",
	}
	if iface != "" {
		route["default_interface"] = iface
	}
	return json.MarshalIndent(sidecar{
		Log: obj{"level": "warn", "timestamp": true},
		DNS: obj{
			"servers": []obj{
				c.resolver(),
				{"type": "udp", "tag": "tunnel", "server": c.DNS, "detour": Selector},
			},
			"final":    "tunnel",
			"strategy": "ipv4_only",
		},
		Inbounds:     inbounds,
		Outbounds:    outbounds,
		Endpoints:    endpoints,
		Route:        route,
		Experimental: obj{"clash_api": obj{"external_controller": clash}},
	}, "", "  ")
}

type obj = map[string]any

// sing-box's local resolver sends *.local names, including *.cluster.local,
// to mDNS; an explicit resolver avoids that.
func (c Config) resolver() obj {
	if c.Resolver != "" {
		return obj{"type": "udp", "tag": "local", "server": c.Resolver}
	}
	return obj{"type": "local", "tag": "local"}
}

type sidecar struct {
	Log          obj   `json:"log"`
	DNS          obj   `json:"dns"`
	Inbounds     []obj `json:"inbounds"`
	Outbounds    []obj `json:"outbounds"`
	Endpoints    []obj `json:"endpoints,omitempty"`
	Route        obj   `json:"route"`
	Experimental obj   `json:"experimental"`
}

func resolve(ctx context.Context, sec Secrets, l Location) (map[string]any, error) {
	switch o := l.Outbound.(type) {
	case map[string]any:
		v, err := resolveFields(ctx, sec, o)
		if err != nil {
			return nil, fmt.Errorf("vpn location %q: %w", l.ID, err)
		}
		return v.(map[string]any), nil
	case string:
		value, err := sec.Resolve(ctx, secrets.Ref(o))
		if err != nil {
			return nil, fmt.Errorf("vpn location %q: %w", l.ID, err)
		}
		var m map[string]any
		if json.Unmarshal([]byte(value), &m) != nil {
			return nil, fmt.Errorf("vpn location %q: the outbound secret is not a JSON object", l.ID)
		}
		return m, nil
	}
	return nil, fmt.Errorf("vpn location %q: no outbound", l.ID)
}

// resolveFields replaces string values that are secret references, at any
// depth, with the secret.
func resolveFields(ctx context.Context, sec Secrets, v any) (any, error) {
	switch t := v.(type) {
	case string:
		if !secrets.IsRef(t) {
			return t, nil
		}
		return sec.Resolve(ctx, secrets.Ref(t))
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			r, err := resolveFields(ctx, sec, val)
			if err != nil {
				return nil, err
			}
			out[k] = r
		}
		return out, nil
	case []any:
		out := make([]any, len(t))
		for i, val := range t {
			r, err := resolveFields(ctx, sec, val)
			if err != nil {
				return nil, err
			}
			out[i] = r
		}
		return out, nil
	}
	return v, nil
}

func outbound(id string, in map[string]any) (map[string]any, error) {
	typ, _ := in["type"].(string)
	switch typ {
	case "":
		return nil, errors.New(`missing "type"`)
	case "selector", "urltest", "block", "dns":
		return nil, fmt.Errorf("type %q can't be a location", typ)
	}
	if tag, ok := in["tag"]; ok && tag != id {
		return nil, fmt.Errorf("tag %v must be left out, it is the location id", tag)
	}
	out := maps.Clone(in)
	out["tag"] = id
	return out, nil
}
