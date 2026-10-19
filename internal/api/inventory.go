package api

import (
	"context"
	"net/http"
	"strconv"
	"sync"

	"github.com/danielgtaylor/huma/v2"

	"github.com/kriakiku/holtdroid/internal/audit"
	"github.com/kriakiku/holtdroid/internal/auth"
	"github.com/kriakiku/holtdroid/internal/contract"
)

type ProviderInventory struct {
	Name        string                     `json:"name"`
	Kind        string                     `json:"kind,omitempty"`
	Error       string                     `json:"error,omitempty"`
	Maintenance *contract.Maintenance      `json:"maintenance,omitempty" doc:"the whole provider is held for maintenance"`
	Host        *contract.HostInfo         `json:"host,omitempty" doc:"the machine the provider's devices hang off"`
	Devices     []contract.InventoryDevice `json:"devices"`
}

type InventoryView struct {
	Providers []ProviderInventory `json:"providers"`
}

type maintenanceBody struct {
	Enabled bool   `json:"enabled"`
	Reason  string `json:"reason,omitempty" maxLength:"500"`
}

type providerMaintenanceInput struct {
	Provider string `path:"provider"`
	Body     maintenanceBody
}

type slotMaintenanceInput struct {
	Provider string `path:"provider"`
	Slot     string `path:"slot"`
	Body     maintenanceBody
}

func (s *Server) registerInventory(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{
		OperationID: "getInventory", Method: http.MethodGet, Path: "/api/v1/admin/inventory", Tags: tags,
		Description: "Every provider's slots with their devices or machines and maintenance holds. Admins only.",
	}, func(ctx context.Context, _ *struct{}) (*out[InventoryView], error) {
		if who, _ := auth.FromContext(ctx); !who.Admin {
			return nil, huma.Error403Forbidden("only admins can see the inventory")
		}
		return &out[InventoryView]{s.inventory(ctx)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "setProviderMaintenance", Method: http.MethodPut, Path: "/api/v1/admin/providers/{provider}/maintenance", Tags: tags, DefaultStatus: http.StatusNoContent,
		Description: "Holds every slot of a provider for maintenance, or releases the hold. Running sessions keep going. Admins only.",
	}, func(ctx context.Context, in *providerMaintenanceInput) (*struct{}, error) {
		return nil, s.setMaintenance(ctx, in.Provider, "", in.Body)
	})

	huma.Register(api, huma.Operation{
		OperationID: "setSlotMaintenance", Method: http.MethodPut, Path: "/api/v1/admin/providers/{provider}/slots/{slot}/maintenance", Tags: tags, DefaultStatus: http.StatusNoContent,
		Description: "Holds one slot for maintenance, or releases it. A running session keeps going. Admins only.",
	}, func(ctx context.Context, in *slotMaintenanceInput) (*struct{}, error) {
		return nil, s.setMaintenance(ctx, in.Provider, in.Slot, in.Body)
	})
}

func (s *Server) inventory(ctx context.Context) InventoryView {
	views := make([]ProviderInventory, len(s.provOrder))
	var wg sync.WaitGroup
	for i, name := range s.provOrder {
		wg.Go(func() {
			v := ProviderInventory{Name: name, Devices: []contract.InventoryDevice{}}
			p := s.providers[name]
			caps, err := p.Capabilities(ctx)
			if err == nil {
				v.Kind = caps.Kind
				var inv contract.Inventory
				if inv, err = p.Inventory(ctx); err == nil {
					v.Maintenance, v.Host, v.Devices = inv.Maintenance, inv.Host, inv.Devices
				}
			}
			if err != nil {
				v.Error = err.Error()
			}
			views[i] = v
		})
	}
	wg.Wait()
	return InventoryView{Providers: views}
}

func (s *Server) setMaintenance(ctx context.Context, provider, slot string, in maintenanceBody) error {
	who, _ := auth.FromContext(ctx)
	ev := audit.Event{Action: audit.Maintenance, Provider: provider, Details: map[string]string{
		"slot": slot, "enabled": strconv.FormatBool(in.Enabled), "reason": in.Reason,
	}}
	if !who.Admin {
		s.emitResult(ctx, ev, errForbidden)
		return huma.Error403Forbidden("only admins can hold devices for maintenance")
	}
	p, err := s.provider(provider)
	if err == nil {
		err = p.SetMaintenance(ctx, contract.SetMaintenance{Slot: slot, Enabled: in.Enabled, Reason: in.Reason, By: who.User})
	}
	s.emitResult(ctx, ev, err)
	if err != nil {
		return httpError(err)
	}
	s.log.Info("maintenance changed", "provider", provider, "slot", slot, "enabled", in.Enabled, "by", who.User)
	return nil
}
