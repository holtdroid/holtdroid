package api

import (
	"net/http"
	"testing"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/geoip/geoiptest"
)

func TestIPInfo(t *testing.T) {
	h := newHarnessWith(t, 1, func(c *Config) { c.GeoIP = geoiptest.Databases(t) })
	rec := h.do(http.MethodPost, "/api/v1/ip-info", "otter", "", map[string]any{"addresses": []string{"81.2.69.160", "104.16.1.1", "nope", "10.1.2.3"}})
	l := decode[IPInfoList](t, rec)
	want := []contract.IPInfo{
		{Address: "81.2.69.160", Country: "PL", Continent: "EU", ASN: 5617, Org: "Orange Polska"},
		{Address: "104.16.1.1", CDN: true},
		{Address: "10.1.2.3", Private: true},
	}
	if rec.Code != http.StatusOK || l.Database == "" || len(l.Addresses) != len(want) {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	for i := range want {
		if l.Addresses[i] != want[i] {
			t.Errorf("%d: %+v, want %+v", i, l.Addresses[i], want[i])
		}
	}
	if rec := h.do(http.MethodPost, "/api/v1/shared/nope/ip-info", "", "", map[string]any{"addresses": []string{"81.2.69.160"}}); rec.Code != http.StatusNotFound {
		t.Errorf("an unknown share token: %d", rec.Code)
	}

	bare := newHarness(t, 1)
	if l := decode[IPInfoList](t, bare.do(http.MethodPost, "/api/v1/ip-info", "otter", "", map[string]any{"addresses": []string{"81.2.69.160"}})); l.Database != "" || l.Addresses[0] != (contract.IPInfo{Address: "81.2.69.160"}) {
		t.Errorf("without databases: %+v", l)
	}
}
