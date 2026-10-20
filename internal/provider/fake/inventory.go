package fake

import (
	"context"
	"fmt"
	"math"
	"slices"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func (p *Provider) Inventory(context.Context) (contract.Inventory, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	c := p.capacity()
	sessions := map[string]string{}
	for _, d := range p.sessions {
		s := d.session()
		sessions[s.Slot] = s.ID
	}
	inv := contract.Inventory{Maintenance: c.Maintenance, Devices: []contract.InventoryDevice{}}
	for i, slot := range c.Slots {
		inv.Devices = append(inv.Devices, contract.InventoryDevice{Slot: slot, Session: sessions[slot.ID], Device: p.deviceInfo(i, sessions[slot.ID] != "")})
	}
	return inv, nil
}

func (p *Provider) deviceInfo(i int, busy bool) *contract.DeviceInfo {
	t := float64(p.now().Unix())
	warm := 0.0
	if busy {
		warm = 9
	}
	temp := func(base, period float64) float64 {
		return math.Round((base+warm+2*math.Sin(t/period+float64(i)))*10) / 10
	}
	return &contract.DeviceInfo{
		Manufacturer:  "Holtdroid",
		Model:         fmt.Sprintf("Fake device %d", i+1),
		Device:        "fake",
		Android:       "15",
		SDK:           35,
		Build:         "AP3A.241105.008",
		SecurityPatch: "2024-11-05",
		ABIs:          []string{"x86_64", "arm64-v8a"},
		Cores:         4,
		MemoryTotal:   4 << 30,
		StorageUsed:   int64(3+i) << 30,
		StorageTotal:  16 << 30,
		Uptime:        3600*float64(i+1) + math.Mod(t, 3600),
		Battery:       &contract.Battery{Level: 100 - 7*i, Status: "charging", Health: "good", Plugged: "usb", Celsius: temp(29, 300), Voltage: 4.2},
		Thermal: []contract.Temperature{
			{Source: contract.TemperatureDevice, Type: "cpu", Name: "cpu0", Celsius: temp(38, 60)},
			{Source: contract.TemperatureDevice, Type: "gpu", Name: "gpu", Celsius: temp(35, 90)},
			{Source: contract.TemperatureDevice, Type: "battery", Name: "battery", Celsius: temp(29, 300)},
			{Source: contract.TemperatureDevice, Type: "skin", Name: "skin", Celsius: temp(31, 200)},
		},
	}
}

func (p *Provider) SetMaintenance(_ context.Context, req contract.SetMaintenance) error {
	if req.Slot != "" && !slices.Contains(p.slotIDs(), req.Slot) {
		return fmt.Errorf("%w: unknown slot %q", contract.ErrInvalid, req.Slot)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.maintenance.Set(req, p.now())
	return nil
}
