package physical

import (
	"cmp"
	"context"
	"fmt"
	"maps"
	"os"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/hostinfo"
)

const inspectTimeout = 5 * time.Second

func (p *Provider) Inventory(ctx context.Context) (contract.Inventory, error) {
	p.mu.Lock()
	c := p.capacityLocked()
	sessions := map[string]string{}
	for id, s := range p.sessions {
		sessions[s.s.Slot] = id
	}
	states := map[string]string{}
	for _, ph := range p.cfg.Phones {
		states[ph.Serial] = p.inventory[ph.Serial].state
	}
	p.mu.Unlock()

	inv := contract.Inventory{Maintenance: c.Maintenance, Devices: make([]contract.InventoryDevice, len(c.Slots))}
	ctx, cancel := context.WithTimeout(ctx, inspectTimeout)
	defer cancel()
	var wg sync.WaitGroup
	for i, slot := range c.Slots {
		d := &inv.Devices[i]
		d.Slot, d.Session = slot, sessions[slot.ID]
		if st := states[slot.ID]; st != "device" {
			d.Error = "adb: " + cmp.Or(st, "not connected")
			continue
		}
		wg.Go(func() {
			info, err := p.host.Inspect(ctx, slot.ID)
			if err != nil {
				d.Error = fmt.Sprintf("inspect: %v", err)
				return
			}
			d.Device = &info
		})
	}
	host := hostinfo.Read(p.root)
	if name, err := os.Hostname(); err == nil {
		host.Hostname = cmp.Or(host.Hostname, name)
	}
	inv.Host = &host
	wg.Wait()
	return inv, nil
}

func (p *Provider) SetMaintenance(_ context.Context, req contract.SetMaintenance) error {
	if req.Slot != "" && !p.listed(req.Slot) {
		return fmt.Errorf("%w: unknown phone %q", contract.ErrInvalid, req.Slot)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	prev := p.maintenance
	p.maintenance = contract.MaintenanceState{Provider: prev.Provider, Slots: maps.Clone(prev.Slots)}
	p.maintenance.Set(req, p.now())
	if err := p.saveLocked(); err != nil {
		p.maintenance = prev
		return err
	}
	return nil
}
