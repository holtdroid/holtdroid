package netem

import (
	"net/netip"
	"testing"
)

func TestCDN(t *testing.T) {
	for addr, want := range map[string]string{
		"104.18.24.163":     "cloudflare",
		"::ffff:1.1.1.1":    "cloudflare",
		"151.101.1.1":       "fastly",
		"8.8.8.8":           "google",
		"81.2.69.160":       "",
		"2606:4700::6810:1": "",
	} {
		if got := CDN(netip.MustParseAddr(addr)); got != want {
			t.Errorf("%s: %q, want %q", addr, got, want)
		}
	}
}
