package fake

import (
	"context"
	"hash/fnv"
	"math"
	"math/rand/v2"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

const metricsInterval = 2 * time.Second

// WatchMetrics makes up a plausible, slowly wandering load.
func (d *device) WatchMetrics(ctx context.Context, send func(contract.Metrics) error) error {
	h := fnv.New64a()
	_, _ = h.Write([]byte(d.session().ID))
	rng := rand.New(rand.NewPCG(h.Sum64(), 1))
	walk := func(v, lo, hi, step float64) float64 {
		return math.Min(hi, math.Max(lo, v+(rng.Float64()*2-1)*step))
	}
	cpu, appCPU, mem, rx, tx, fps, temp := 30.0, 12.0, 2.4, 40e3, 8e3, 50.0, 48.0
	const gib = 1 << 30
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(metricsInterval):
		}
		cpu = walk(cpu, 5, 95, 12)
		appCPU = math.Min(cpu, walk(appCPU, 1, 60, 6))
		mem = walk(mem, 1.6, 3.6, 0.1)
		rx = walk(rx, 0, 2e6, 3e5)
		tx = walk(tx, 0, 3e5, 4e4)
		fps = walk(fps, 0, 60, 15)
		temp = walk(temp, 38, 88, 2.5)

		s, _, gen := d.snapshot()
		m := contract.Metrics{
			At:       time.Now().UTC(),
			Interval: metricsInterval.Seconds(),
			Device: contract.DeviceLoad{
				Cores: 4, CPU: round(cpu), MemoryUsed: int64(mem * gib), MemoryTotal: 4 * gib,
				StorageUsed: 31 * gib / 10, StorageTotal: 6 * gib, RxRate: math.Round(rx), TxRate: math.Round(tx),
			},
			Host: &contract.HostLoad{
				CPU: round(cpu * 0.06 * 1.3), CPULimit: 6, Throttled: round(math.Max(0, cpu-80)),
				MemoryUsed: int64((mem + 1.4) * gib), MemoryLimit: 7 * gib,
			},
			Thermal: []contract.Temperature{
				{Source: contract.TemperatureDevice, Type: "cpu", Name: "cpu0", Celsius: round(temp)},
				{Source: contract.TemperatureDevice, Type: "battery", Name: "battery", Celsius: round(temp*0.55 + 8)},
				{Source: contract.TemperatureDevice, Type: "skin", Name: "skin", Celsius: round(temp*0.6 + 6)},
				{Source: contract.TemperatureHost, Type: "x86_pkg_temp", Name: "thermal_zone0", Celsius: round(temp + 6)},
			},
		}
		if d.Status(ctx).AppRunning {
			pid := 4200 + gen
			m.App = &contract.AppLoad{
				Processes: []contract.ProcessLoad{
					{PID: pid, Name: s.Package, CPU: round(appCPU * 0.4), Memory: int64(mem * 0.08 * gib)},
					{PID: 4300, Name: "com.google.android.webview:sandboxed_process0", CPU: round(appCPU * 0.6), Memory: int64(mem * 0.06 * gib)},
				},
				FPS:  math.Round(fps),
				Jank: round(math.Max(0, (cpu-50)/4)),
			}
		}
		if err := send(m); err != nil {
			return err
		}
	}
}

func round(v float64) float64 { return math.Round(v*10) / 10 }
