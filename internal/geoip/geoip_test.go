package geoip_test

import (
	"net/netip"
	"os"
	"path/filepath"
	"testing"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/geoip"
	"github.com/holtdroid/holtdroid/internal/geoip/geoiptest"
)

func TestLookup(t *testing.T) {
	db, err := geoip.Open(geoiptest.Databases(t))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if db.Built().IsZero() {
		t.Error("no build time")
	}
	for _, tc := range []struct {
		addr string
		want contract.IPInfo
	}{
		{"81.2.69.160", contract.IPInfo{Address: "81.2.69.160", Country: "PL", Continent: "EU", ASN: 5617, Org: "Orange Polska"}},
		{"::ffff:81.2.69.1", contract.IPInfo{Address: "81.2.69.1", Country: "PL", Continent: "EU", ASN: 5617, Org: "Orange Polska"}},
		{"104.16.1.1", contract.IPInfo{Address: "104.16.1.1", CDN: true}},
		{"10.0.0.1", contract.IPInfo{Address: "10.0.0.1", Private: true}},
		{"100.64.1.1", contract.IPInfo{Address: "100.64.1.1", Private: true}},
		{"9.9.9.9", contract.IPInfo{Address: "9.9.9.9"}},
	} {
		if got := db.Lookup(netip.MustParseAddr(tc.addr)); got != tc.want {
			t.Errorf("%s: got %+v, want %+v", tc.addr, got, tc.want)
		}
	}
}

func TestMissing(t *testing.T) {
	db, err := geoip.Open(geoip.Config{Country: filepath.Join(t.TempDir(), "none.mmdb")})
	if err != nil {
		t.Fatal(err)
	}
	if c, a := db.Missing(); !c || !a {
		t.Errorf("missing = %v %v", c, a)
	}
	if got := db.Lookup(netip.MustParseAddr("81.2.69.1")); got != (contract.IPInfo{Address: "81.2.69.1"}) {
		t.Errorf("got %+v", got)
	}
	if _, err := geoip.Open(geoip.Config{Country: writeBroken(t)}); err == nil {
		t.Error("a broken database opened")
	}
}

func writeBroken(t *testing.T) string {
	p := filepath.Join(t.TempDir(), "broken.mmdb")
	if err := os.WriteFile(p, []byte("nope"), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}
