package api

import (
	"net/http"
	"strings"
	"testing"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func TestInventory(t *testing.T) {
	h := newHarness(t, 2)
	v := h.create("otter")

	if rec := h.do(http.MethodGet, "/api/v1/admin/inventory", "otter", "users", nil); rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin inventory: %d", rec.Code)
	}
	rec := h.do(http.MethodGet, "/api/v1/admin/inventory", "root", "admins", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("inventory: %d %s", rec.Code, rec.Body.String())
	}
	inv := decode[InventoryView](t, rec)
	if len(inv.Providers) != 1 || inv.Providers[0].Kind != "fake" || len(inv.Providers[0].Devices) != 2 {
		t.Fatalf("inventory %+v", inv)
	}
	d := inv.Providers[0].Devices[0]
	if d.Session != v.ID || d.Slot.State != contract.SlotBusy || d.Device == nil || d.Device.Battery == nil || len(d.Device.Thermal) == 0 {
		t.Fatalf("device %+v", d)
	}
}

func TestMaintenance(t *testing.T) {
	h := newHarness(t, 2)
	slot := "/api/v1/admin/providers/fake/slots/fake-2/maintenance"
	whole := "/api/v1/admin/providers/fake/maintenance"
	hold := map[string]any{"enabled": true, "reason": "new cable"}

	if rec := h.do(http.MethodPut, slot, "otter", "users", hold); rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin hold: %d", rec.Code)
	}
	if rec := h.do(http.MethodPut, "/api/v1/admin/providers/fake/slots/fake-9/maintenance", "root", "admins", hold); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unknown slot: %d", rec.Code)
	}
	if rec := h.do(http.MethodPut, "/api/v1/admin/providers/nope/maintenance", "root", "admins", hold); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown provider: %d", rec.Code)
	}
	if rec := h.do(http.MethodPut, slot, "root", "admins", hold); rec.Code != http.StatusNoContent {
		t.Fatalf("hold: %d %s", rec.Code, rec.Body.String())
	}
	providers := decode[[]ProviderView](t, h.do(http.MethodGet, "/api/v1/providers", "otter", "", nil))
	held := providers[0].Capacity.Slots[1]
	if held.State != contract.SlotMaintenance || held.Maintenance.Reason != "new cable" || held.Maintenance.By != "root" {
		t.Fatalf("held slot %+v", held)
	}
	if v := h.create("otter"); v.Slot != "fake-1" {
		t.Fatalf("launched on %s", v.Slot)
	}

	if rec := h.do(http.MethodPut, slot, "root", "admins", map[string]any{"enabled": false}); rec.Code != http.StatusNoContent {
		t.Fatalf("release: %d", rec.Code)
	}
	if rec := h.do(http.MethodPut, whole, "root", "admins", map[string]any{"enabled": true, "reason": "upgrade"}); rec.Code != http.StatusNoContent {
		t.Fatalf("hold provider: %d", rec.Code)
	}
	rec := h.do(http.MethodPost, "/api/v1/sessions", "beaver", "", map[string]string{"source": "local", "artifactId": encodeID("hello.apk"), "provider": "fake"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("launch on a held provider: %d %s", rec.Code, rec.Body.String())
	}
	if got := strings.Count(h.audit.String(), `"action":"provider.maintenance"`); got != 6 {
		t.Fatalf("%d maintenance events in %s", got, h.audit.String())
	}
}
