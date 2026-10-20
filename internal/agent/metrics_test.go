package agent

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func deviceOutput(cpu, idle, rx, tx, appTicks, frames, janky int) string {
	return fmt.Sprintf(`#stat
cpu  %d 0 0 %d 0 0 0 0 0 0
#cores
4
#mem
MemTotal:        4000000 kB
MemAvailable:    1000000 kB
#df
/dev/block/dm-5 6000000 2500000 3500000 42%% /data
#net
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 999999 1 0 0 0 0 0 0 999999 1 0 0 0 0 0 0
 wlan0: %d 10 0 0 0 0 0 0 %d 10 0 0 0 0 0 0
#procs
4242 com.example.app 200000 4242 (example app) S 1 0 0 0 -1 0 0 0 0 0 %d 0 0 0
4300 com.google.android.webview:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:0 100000 4300 (ocessService0:0) S 1 0 0 0 -1 0 0 0 0 0 0 0 0 0
#gfx
** Graphics info for pid 4242 [com.example.app] **
Total frames rendered: %d
Janky frames: %d (1.00%%)
Janky frames (legacy): 3 (0.10%%)
#thermal
Cached temperatures:
	Temperature{mValue=30.0, mType=0, mName=cpu0, mStatus=0}
Current temperatures from HAL:
	Temperature{mValue=50.25, mType=0, mName=cpu0, mStatus=0}
	Temperature{mValue=NaN, mType=3, mName=skin, mStatus=0}
	Temperature{mValue=35.0, mType=2, mName=battery, mStatus=0}
	Temperature{mValue=5.0, mType=8, mName=bcl, mStatus=0}
`, cpu, idle, rx, tx, appTicks, frames, janky)
}

func TestMetricsDiff(t *testing.T) {
	at := time.Unix(1_760_000_000, 0)
	prev := parseDeviceSample(deviceOutput(1000, 3000, 1000, 500, 100, 1000, 10))
	prev.at = at
	prev.host = &hostSample{usage: 1_000_000, throttled: 0, limit: 4, working: 3 << 30, memMax: 7 << 30}
	cur := parseDeviceSample(deviceOutput(1300, 3500, 5000, 1500, 180, 1120, 16))
	cur.at = at.Add(2 * time.Second)
	cur.host = &hostSample{usage: 6_000_000, throttled: 500_000, limit: 4, working: 3 << 30, memMax: 7 << 30}

	m := diff(prev, cur)
	if got := m.Device; got.CPU != 37.5 || got.Cores != 4 || got.MemoryUsed != 3_000_000<<10 || got.MemoryTotal != 4_000_000<<10 ||
		got.StorageUsed != 2_500_000<<10 || got.StorageTotal != 6_000_000<<10 || got.RxRate != 2000 || got.TxRate != 500 {
		t.Errorf("device = %+v", got)
	}
	if m.App == nil {
		t.Fatal("no app load")
	}
	if len(m.App.Processes) != 2 || m.App.Processes[0] != (contract.ProcessLoad{PID: 4242, Name: "com.example.app", CPU: 10, Memory: 200000 << 10}) ||
		m.App.Processes[1].Memory != 100000<<10 || m.App.Processes[1].CPU != 0 {
		t.Errorf("processes = %+v", m.App.Processes)
	}
	if m.App.FPS != 60 || m.App.Jank != 5 {
		t.Errorf("fps %v jank %v", m.App.FPS, m.App.Jank)
	}
	if m.Host == nil || *m.Host != (contract.HostLoad{CPU: 2.5, CPULimit: 4, Throttled: 25, MemoryUsed: 3 << 30, MemoryLimit: 7 << 30}) {
		t.Errorf("host = %+v", m.Host)
	}
	want := []contract.Temperature{
		{Source: contract.TemperatureDevice, Type: "cpu", Name: "cpu0", Celsius: 50.3},
		{Source: contract.TemperatureDevice, Type: "battery", Name: "battery", Celsius: 35},
	}
	if fmt.Sprint(m.Thermal) != fmt.Sprint(want) {
		t.Errorf("thermal = %+v", m.Thermal)
	}
}

func TestMetricsRestartedApp(t *testing.T) {
	prev := parseDeviceSample(deviceOutput(1000, 3000, 9000, 9000, 500, 5000, 50))
	cur := parseDeviceSample(deviceOutput(1300, 3500, 100, 100, 20, 30, 1))
	cur.at = prev.at.Add(time.Second)
	m := diff(prev, cur)
	if m.App.FPS != 0 || m.App.Processes[0].CPU != 0 || m.Device.RxRate != 0 {
		t.Errorf("counters that went back produced %+v %+v", m.App, m.Device)
	}

	empty := parseDeviceSample("#procs\n#gfx\n#thermal\n")
	if m := diff(empty, empty); m.App != nil || m.Thermal == nil {
		t.Errorf("no app: %+v", m)
	}
}

func TestReadHost(t *testing.T) {
	tests := []struct {
		name string
		fs   fstest.MapFS
		want *hostSample
	}{
		{"no cgroup", fstest.MapFS{}, nil},
		{"limits", fstest.MapFS{
			"sys/fs/cgroup/cpu.stat":       {Data: []byte("usage_usec 1500\nnr_throttled 2\nthrottled_usec 300\n")},
			"sys/fs/cgroup/cpu.max":        {Data: []byte("400000 100000\n")},
			"sys/fs/cgroup/memory.current": {Data: []byte("5000\n")},
			"sys/fs/cgroup/memory.stat":    {Data: []byte("anon 3000\ninactive_file 1000\n")},
			"sys/fs/cgroup/memory.max":     {Data: []byte("7000\n")},
		}, &hostSample{usage: 1500, throttled: 300, limit: 4, working: 4000, memMax: 7000}},
		{"session pod", fstest.MapFS{
			"proc/self/cgroup":                                       {Data: []byte("0::/kubepods.slice/pod1.slice/cri-1.scope\n")},
			"sys/fs/cgroup/cpu.stat":                                 {Data: []byte("usage_usec 999999\n")},
			"sys/fs/cgroup/kubepods.slice/pod1.slice/cpu.stat":       {Data: []byte("usage_usec 1500\nthrottled_usec 0\n")},
			"sys/fs/cgroup/kubepods.slice/pod1.slice/cpu.max":        {Data: []byte("200000 100000\n")},
			"sys/fs/cgroup/kubepods.slice/pod1.slice/memory.current": {Data: []byte("5000\n")},
			"sys/fs/cgroup/kubepods.slice/pod1.slice/memory.max":     {Data: []byte("7000\n")},
		}, &hostSample{usage: 1500, limit: 2, working: 5000, memMax: 7000}},
		{"unlimited", fstest.MapFS{
			"proc/self/cgroup":             {Data: []byte("0::/\n")},
			"sys/fs/cgroup/cpu.stat":       {Data: []byte("usage_usec 1500\n")},
			"sys/fs/cgroup/cpu.max":        {Data: []byte("max 100000\n")},
			"sys/fs/cgroup/memory.current": {Data: []byte("5000\n")},
			"sys/fs/cgroup/memory.max":     {Data: []byte("max\n")},
			"proc/meminfo":                 {Data: []byte("MemTotal:       32000 kB\nMemFree: 1 kB\n")},
		}, &hostSample{usage: 1500, limit: -1, working: 5000, memMax: 32000 << 10}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := readHost(tt.fs)
			if got != nil && tt.want != nil && tt.want.limit == -1 {
				tt.want.limit = got.limit
				if got.limit < 1 {
					t.Errorf("limit without cpu.max = %v", got.limit)
				}
			}
			if fmt.Sprint(got) != fmt.Sprint(tt.want) {
				t.Errorf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

type countingDevice struct {
	fakeDevice
	mu    sync.Mutex
	calls int
}

func (d *countingDevice) Shell(context.Context, string) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.calls++
	return deviceOutput(1000*d.calls, 3000*d.calls, 0, 0, 10*d.calls, 0, 0), nil
}

func (d *countingDevice) count() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.calls
}

func TestMetricsSampleOnlyWhileWatched(t *testing.T) {
	dev := &countingDevice{}
	m := NewMetrics(dev, "com.example.app", fstest.MapFS{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	m.interval = 10 * time.Millisecond

	ctx, cancel := context.WithCancel(t.Context())
	got := make(chan contract.Metrics, 1)
	done := make(chan error, 1)
	go func() {
		done <- m.Watch(ctx, func(s contract.Metrics) error {
			select {
			case got <- s:
			default:
			}
			return nil
		})
	}()
	select {
	case s := <-got:
		if s.Device.CPU != 25 || s.Host != nil {
			t.Errorf("sample = %+v", s)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no sample")
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	time.Sleep(50 * time.Millisecond)
	stopped := dev.count()
	time.Sleep(50 * time.Millisecond)
	if dev.count() != stopped {
		t.Errorf("still sampling after the last watcher left: %d → %d", stopped, dev.count())
	}
}
