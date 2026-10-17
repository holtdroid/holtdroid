// Package vpn renders the sing-box config of a session's vpn sidecar: a tun
// inbound capturing the device's traffic and a selector over the configured
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

	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/secrets"
)

const (
	Direct   = "direct"
	Selector = "select"
	ClashAPI = "127.0.0.1:9090"
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
// location ("" picks the default).
func (c Config) Render(ctx context.Context, sec Secrets, location string) ([]byte, error) {
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
		Inbounds: []obj{{
			"type":                  "tun",
			"tag":                   "tun",
			"address":               []string{"198.18.0.1/30", "fdfe:dcba:9876::1/126"},
			"auto_route":            true,
			"route_exclude_address": c.BypassCIDRs,
		}},
		Outbounds: outbounds,
		Endpoints: endpoints,
		Route: obj{
			"rules": []obj{
				{"action": "sniff"},
				{"protocol": "dns", "action": "hijack-dns"},
			},
			"final":                   Selector,
			"auto_detect_interface":   true,
			"default_domain_resolver": "local",
		},
		Experimental: obj{"clash_api": obj{"external_controller": ClashAPI}},
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
