package vpn

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/kriakiku/holtdroid/internal/config"
	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/secrets"
)

var update = flag.Bool("update", false, "rewrite golden files")

type fakeSecrets map[secrets.Ref]string

func (f fakeSecrets) Resolve(_ context.Context, ref secrets.Ref) (string, error) {
	v, ok := f[ref]
	if !ok {
		return "", errors.New("not found")
	}
	return v, nil
}

const wireguardNL = `{"type":"wireguard","mtu":1280,"address":["10.5.0.2/32"],"private_key":"YNXtAzepDqRv9H52osJVDQnznT5AL11eBnfXyTMR0Gk=",
"peers":[{"address":"nl1.example.net","port":51820,"public_key":"Z1XXLsKYkYxuiYjJIkRvtIKFepCYHTgON+GwPq7SOV4=","allowed_ips":["0.0.0.0/0","::/0"]}]}`

func gateway(id string) map[string]any {
	return map[string]any{"type": "socks", "server": "vpn-gateway.vpn.svc.cluster.local", "server_port": 1080, "username": id, "password": "holtdroid"}
}

func TestRender(t *testing.T) {
	sec := fakeSecrets{"file:/run/secrets/vpn/nl.json": wireguardNL}
	tests := []struct {
		name     string
		cfg      func(*Config)
		location string
	}{
		{"gateway", func(c *Config) {
			c.Locations = []Location{{ID: "de", Label: "Germany", Outbound: gateway("de")}, {ID: "pl", Outbound: gateway("pl")}}
		}, ""},
		{"wireguard-no-direct", func(c *Config) {
			c.Direct = false
			c.DNS = "9.9.9.9"
			c.Resolver = "10.43.0.10"
			c.BypassCIDRs = []string{"10.42.0.0/16", "10.43.0.0/16"}
			c.Locations = []Location{{ID: "de", Outbound: gateway("de")}, {ID: "nl", Label: "Netherlands", Outbound: "file:/run/secrets/vpn/nl.json"}}
		}, "nl"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := DefaultConfig()
			tt.cfg(&cfg)
			if err := cfg.Validate(); err != nil {
				t.Fatal(err)
			}
			got, err := cfg.Render(t.Context(), sec, tt.location)
			if err != nil {
				t.Fatal(err)
			}
			golden := filepath.Join("testdata", tt.name+".json")
			if *update {
				if err := os.WriteFile(golden, append(got, '\n'), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			want, err := os.ReadFile(golden)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(append(got, '\n'), want) {
				t.Errorf("render differs from %s (run with -update):\n%s", golden, got)
			}
		})
	}
}

func TestRenderErrors(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Locations = []Location{{ID: "nl", Outbound: "env:NL"}}
	tests := []struct {
		name     string
		sec      fakeSecrets
		location string
		want     string
	}{
		{"unknown location", fakeSecrets{"env:NL": wireguardNL}, "us", `unknown location "us"`},
		{"missing secret", fakeSecrets{}, "", "not found"},
		{"secret not json", fakeSecrets{"env:NL": "SECRET-KEY"}, "", "not a JSON object"},
		{"secret with a tag", fakeSecrets{"env:NL": `{"type":"socks","tag":"x"}`}, "", "must be left out"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := cfg.Render(t.Context(), tt.sec, tt.location)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("err = %v, want %q", err, tt.want)
			}
			if strings.Contains(err.Error(), "SECRET-KEY") {
				t.Fatalf("error leaks the secret: %v", err)
			}
		})
	}
	if _, err := cfg.Render(t.Context(), fakeSecrets{"env:NL": wireguardNL}, "us"); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("unknown location: %v, want ErrInvalid", err)
	}
	if _, err := DefaultConfig().Render(t.Context(), nil, ""); err == nil {
		t.Fatal("render without locations succeeded")
	}
}

func TestRenderFieldRefs(t *testing.T) {
	out := map[string]any{
		"type": "wireguard", "private_key": "env:WG_KEY", "address": []any{"10.5.0.2/32"},
		"peers": []any{map[string]any{"address": "nl1.example.net", "port": 51820, "public_key": "file:/run/nl.pub"}},
	}
	socks := gateway("pl")
	socks["password"] = "env:GATEWAY_PASSWORD"
	cfg := DefaultConfig()
	cfg.Locations = []Location{{ID: "nl", Outbound: out}, {ID: "pl", Outbound: socks}}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	sec := fakeSecrets{"env:WG_KEY": "PRIVATE", "file:/run/nl.pub": "PUBLIC", "env:GATEWAY_PASSWORD": "hunter2"}
	got, err := cfg.Render(t.Context(), sec, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"private_key": "PRIVATE"`, `"public_key": "PUBLIC"`, `"password": "hunter2"`, `"10.5.0.2/32"`} {
		if !strings.Contains(string(got), want) {
			t.Errorf("render lacks %s:\n%s", want, got)
		}
	}
	if socks["password"] != "env:GATEWAY_PASSWORD" || out["peers"].([]any)[0].(map[string]any)["public_key"] != "file:/run/nl.pub" {
		t.Fatal("render modified the config")
	}
	delete(sec, "env:GATEWAY_PASSWORD")
	if _, err := cfg.Render(t.Context(), sec, ""); err == nil || !strings.Contains(err.Error(), `"pl"`) {
		t.Fatalf("missing field secret: %v", err)
	}
}

func TestValidate(t *testing.T) {
	tests := []struct {
		name string
		cfg  func(*Config)
		want string
	}{
		{"disabled", func(*Config) {}, ""},
		{"ok", func(c *Config) {
			c.Locations = []Location{{ID: "de", Outbound: gateway("de")}, {ID: "nl", Outbound: "openbao:secret/vpn#nl"}}
		}, ""},
		{"bad id", func(c *Config) { c.Locations = []Location{{ID: "De", Outbound: gateway("de")}} }, "lowercase"},
		{"reserved id", func(c *Config) { c.Locations = []Location{{ID: "select", Outbound: gateway("de")}} }, "reserved"},
		{"duplicate id", func(c *Config) {
			c.Locations = []Location{{ID: "de", Outbound: gateway("de")}, {ID: "de", Outbound: gateway("de")}}
		}, "duplicate"},
		{"no type", func(c *Config) { c.Locations = []Location{{ID: "de", Outbound: map[string]any{"server": "x"}}} }, `missing "type"`},
		{"selector", func(c *Config) { c.Locations = []Location{{ID: "de", Outbound: map[string]any{"type": "selector"}}} }, "can't be a location"},
		{"plain string", func(c *Config) { c.Locations = []Location{{ID: "de", Outbound: "socks"}} }, "secret reference"},
		{"missing outbound", func(c *Config) { c.Locations = []Location{{ID: "de"}} }, "want a sing-box outbound"},
		{"bad cidr", func(c *Config) {
			c.Locations = []Location{{ID: "de", Outbound: gateway("de")}}
			c.BypassCIDRs = []string{"10.0.0.0"}
		}, "bypassCIDRs"},
		{"dns hostname", func(c *Config) {
			c.Locations = []Location{{ID: "de", Outbound: gateway("de")}}
			c.DNS = "dns.google"
		}, "vpn.dns"},
		{"resolver hostname", func(c *Config) {
			c.Locations = []Location{{ID: "de", Outbound: gateway("de")}}
			c.Resolver = "kube-dns"
		}, "vpn.resolver"},
		{"unknown default", func(c *Config) {
			c.Locations = []Location{{ID: "de", Outbound: gateway("de")}}
			c.Default = "us"
		}, "vpn.default"},
		{"direct default without direct", func(c *Config) {
			c.Locations = []Location{{ID: "de", Outbound: gateway("de")}}
			c.Direct, c.Default = false, Direct
		}, "vpn.default"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := DefaultConfig()
			tt.cfg(&cfg)
			err := cfg.Validate()
			switch {
			case tt.want == "" && err != nil:
				t.Fatal(err)
			case tt.want != "" && (err == nil || !strings.Contains(err.Error(), tt.want)):
				t.Fatalf("err = %v, want %q", err, tt.want)
			}
		})
	}
}

func TestOffered(t *testing.T) {
	cfg := DefaultConfig()
	if got := cfg.Offered(); got != nil {
		t.Fatalf("disabled: %v", got)
	}
	cfg.Locations = []Location{{ID: "de", Label: "Germany", Outbound: gateway("de")}, {ID: "pl", Outbound: gateway("pl")}}
	want := []contract.Location{{ID: "direct", Label: "Direct"}, {ID: "de", Label: "Germany"}, {ID: "pl", Label: "pl"}}
	if got := cfg.Offered(); !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if got := cfg.DefaultLocation(); got != Direct {
		t.Fatalf("default with direct: %q", got)
	}
	cfg.Direct = false
	if got := cfg.Offered(); !slices.Equal(got, want[1:]) {
		t.Fatalf("without direct: got %v", got)
	}
	if got := cfg.DefaultLocation(); got != "de" {
		t.Fatalf("default without direct: %q", got)
	}
	cfg.Default = "pl"
	if got := cfg.DefaultLocation(); got != "pl" {
		t.Fatalf("configured default: %q", got)
	}
	if got := DefaultConfig().DefaultLocation(); got != "" {
		t.Fatalf("default while disabled: %q", got)
	}
}

func TestLoadFromYAML(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	yaml := `
vpn:
  direct: false
  resolver: 10.43.0.10
  locations:
    - id: de
      label: Germany
      outbound: &gateway
        type: socks
        server: vpn-gateway.vpn.svc.cluster.local
        server_port: 1080
        username: de
        password: holtdroid
        udp_over_tcp: true
    - id: pl
      outbound: { <<: *gateway, username: pl }
    - id: nl
      outbound: file:/run/secrets/vpn/nl.json
`
	if err := os.WriteFile(path, []byte(yaml), 0o600); err != nil {
		t.Fatal(err)
	}
	var cfg struct{ VPN Config }
	cfg.VPN = DefaultConfig()
	if err := config.Load(path, cfg, &cfg); err != nil {
		t.Fatal(err)
	}
	if err := cfg.VPN.Validate(); err != nil {
		t.Fatal(err)
	}
	if cfg.VPN.Direct || cfg.VPN.DNS != "1.1.1.1" || len(cfg.VPN.Locations) != 3 {
		t.Fatalf("loaded %+v", cfg.VPN)
	}
	if pl, _ := cfg.VPN.Locations[1].Outbound.(map[string]any); pl["username"] != "pl" || pl["server_port"] != 1080 || pl["udp_over_tcp"] != true {
		t.Fatalf("merged outbound %v", pl)
	}
	if _, err := cfg.VPN.Render(t.Context(), fakeSecrets{"file:/run/secrets/vpn/nl.json": wireguardNL}, ""); err != nil {
		t.Fatal(err)
	}
}
