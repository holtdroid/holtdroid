package api

import (
	"net/http"
	"testing"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func TestDNSPresets(t *testing.T) {
	h := newHarness(t, 1)
	empty := contract.DNSSettings{TTLMode: contract.DNSTTLKeep, Rewrites: []contract.DNSRewrite{}}
	settings := contract.DNSSettings{TTLMode: contract.DNSTTLLimit, MaxTTL: 5, Rewrites: []contract.DNSRewrite{
		{Pattern: "*.API.example.com.", Kind: contract.DNSRewriteAddress, Addresses: []string{"10.0.0.7"}, Enabled: true},
	}}

	rec := h.do(http.MethodPost, dnsPresetsPath, "otter", "", DNSPresetInput{Name: " staging ", Settings: settings})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	p := decode[DNSPreset](t, rec)
	if p.Name != "staging" || p.Settings.Rewrites[0].Pattern != "*.api.example.com" {
		t.Fatalf("created %+v", p)
	}

	bad := DNSPresetInput{Name: "bad", Settings: contract.DNSSettings{TTLMode: contract.DNSTTLKeep, Rewrites: []contract.DNSRewrite{{Pattern: "a..b", Kind: contract.DNSRewriteNXDomain}}}}
	if rec := h.do(http.MethodPost, dnsPresetsPath, "otter", "", bad); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid rewrite: %d", rec.Code)
	}

	if l := decode[DNSPresetList](t, h.do(http.MethodGet, dnsPresetsPath, "beaver", "", nil)); len(l.Items) != 0 {
		t.Fatalf("another user sees %+v", l.Items)
	}
	if rec := h.do(http.MethodPut, dnsPresetsPath+"/"+p.ID, "beaver", "", DNSPresetInput{Name: "x", Settings: empty}); rec.Code != http.StatusNotFound {
		t.Fatalf("another user's update: %d %s", rec.Code, rec.Body.String())
	}
	if rec := h.do(http.MethodDelete, dnsPresetsPath+"/"+p.ID, "beaver", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("another user's delete: %d", rec.Code)
	}

	rec = h.do(http.MethodPut, dnsPresetsPath+"/"+p.ID, "otter", "", DNSPresetInput{Name: "prod", Settings: empty})
	if rec.Code != http.StatusOK {
		t.Fatalf("update: %d %s", rec.Code, rec.Body.String())
	}
	if u := decode[DNSPreset](t, rec); u.Name != "prod" || len(u.Settings.Rewrites) != 0 || u.Settings.TTLMode != contract.DNSTTLKeep || !u.CreatedAt.Equal(p.CreatedAt) {
		t.Fatalf("updated %+v", u)
	}
	if l := decode[DNSPresetList](t, h.do(http.MethodGet, dnsPresetsPath, "otter", "", nil)); len(l.Items) != 1 || l.Items[0].Name != "prod" {
		t.Fatalf("list %+v", l.Items)
	}
	if rec := h.do(http.MethodDelete, dnsPresetsPath+"/"+p.ID, "otter", "", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rec.Code)
	}
	if l := decode[DNSPresetList](t, h.do(http.MethodGet, dnsPresetsPath, "otter", "", nil)); len(l.Items) != 0 {
		t.Fatalf("after delete %+v", l.Items)
	}
}

func TestProxyDNS(t *testing.T) {
	h := newHarness(t, 1)
	v := h.create("otter")
	base := "/s/fake/" + v.ID + "/v1/dns"
	settings := contract.DNSSettings{TTLMode: contract.DNSTTLKeep, Rewrites: []contract.DNSRewrite{
		{Pattern: "api.example.com", Kind: contract.DNSRewriteNXDomain, Enabled: true},
	}}
	if rec := h.do(http.MethodPut, base, "otter", "", settings); rec.Code != http.StatusOK {
		t.Fatalf("set: %d %s", rec.Code, rec.Body.String())
	}
	st := decode[contract.DNSState](t, h.do(http.MethodGet, base, "otter", "", nil))
	if !st.Available || len(st.Settings.Rewrites) != 1 {
		t.Fatalf("state %+v", st)
	}
	if rec := h.do(http.MethodPost, base+"/flush", "otter", "", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("flush: %d", rec.Code)
	}
}
