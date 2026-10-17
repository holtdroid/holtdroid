package agent

import (
	"cmp"
	"context"
	"fmt"
	"io/fs"
	"log/slog"
	"math"
	"path"
	"regexp"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kriakiku/holtdroid/internal/contract"
)

// Metrics samples the device, the app and the container the agent shares
// with the emulator, but only while someone watches.
type Metrics struct {
	dev      Device
	pkg      string
	root     fs.FS
	interval time.Duration
	now      func() time.Time
	log      *slog.Logger

	mu   sync.Mutex
	subs map[chan contract.Metrics]struct{}
	stop context.CancelFunc
}

func NewMetrics(dev Device, pkg string, root fs.FS, log *slog.Logger) *Metrics {
	return &Metrics{dev: dev, pkg: pkg, root: root, interval: 2 * time.Second, now: time.Now, log: log, subs: map[chan contract.Metrics]struct{}{}}
}

func (m *Metrics) Watch(ctx context.Context, send func(contract.Metrics) error) error {
	ch, cancel := m.subscribe()
	defer cancel()
	for {
		select {
		case <-ctx.Done():
			return nil
		case s := <-ch:
			if err := send(s); err != nil {
				return err
			}
		}
	}
}

func (m *Metrics) subscribe() (<-chan contract.Metrics, func()) {
	ch := make(chan contract.Metrics, 1)
	m.mu.Lock()
	m.subs[ch] = struct{}{}
	if m.stop == nil {
		ctx, stop := context.WithCancel(context.Background())
		m.stop = stop
		go m.run(ctx)
	}
	m.mu.Unlock()
	return ch, func() {
		m.mu.Lock()
		delete(m.subs, ch)
		if len(m.subs) == 0 && m.stop != nil {
			m.stop()
			m.stop = nil
		}
		m.mu.Unlock()
	}
}

func (m *Metrics) run(ctx context.Context) {
	prev, err := m.sample(ctx)
	if err != nil {
		m.log.Debug("metrics sample", "err", err)
	}
	wait := time.Second
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		wait = m.interval
		cur, err := m.sample(ctx)
		if err != nil {
			if ctx.Err() == nil {
				m.log.Debug("metrics sample", "err", err)
			}
			continue
		}
		if prev != nil {
			m.broadcast(diff(prev, cur))
		}
		prev = cur
	}
}

func (m *Metrics) broadcast(s contract.Metrics) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for ch := range m.subs {
		select {
		case <-ch:
		default:
		}
		ch <- s
	}
}

type procSample struct {
	name  string
	ticks uint64
	pss   int64
}

type frameSample struct{ total, janky uint64 }

type hostSample struct {
	usage, throttled uint64
	limit            float64
	working, memMax  int64
}

type sample struct {
	at                  time.Time
	cpuTotal, cpuIdle   uint64
	cores               int
	memTotal, memAvail  int64
	dataUsed, dataTotal int64
	rx, tx              uint64
	procs               map[int]procSample
	frames              map[int]frameSample
	temps               []contract.Temperature
	host                *hostSample
}

func metricsScript(pkg string) string {
	return fmt.Sprintf(`echo '#stat'; head -n1 /proc/stat
echo '#cores'; grep -c ^processor /proc/cpuinfo
echo '#mem'; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo
echo '#df'; df -k /data | tail -n1
echo '#net'; cat /proc/net/dev
echo '#procs'
ps -A -o PID,NAME | while read pid name; do case "$name" in '%[1]s'|'%[1]s':*|*webview:sandboxed_process*)
  pss=$(grep '^Pss:' /proc/$pid/smaps_rollup 2>/dev/null | tr -s ' ' | cut -d' ' -f2)
  echo "$pid $name ${pss:-0} $(cat /proc/$pid/stat 2>/dev/null)";; esac; done
echo '#gfx'; dumpsys gfxinfo '%[1]s' | grep -E '^\*\* Graphics info for pid|^Total frames rendered|^Janky frames:'
echo '#thermal'; dumpsys thermalservice | grep -E 'Temperature\{|temperatures'`, pkg)
}

func (m *Metrics) sample(ctx context.Context) (*sample, error) {
	out, err := m.dev.Shell(ctx, metricsScript(m.pkg))
	if err != nil {
		return nil, err
	}
	s := parseDeviceSample(out)
	s.at = m.now()
	s.host = readHost(m.root)
	s.temps = append(s.temps, readHostThermal(m.root)...)
	return s, nil
}

func parseDeviceSample(out string) *sample {
	s := &sample{procs: map[int]procSample{}, frames: map[int]frameSample{}}
	sections := map[string][]string{}
	section := ""
	for line := range strings.SplitSeq(out, "\n") {
		line = strings.TrimSpace(line)
		if name, ok := strings.CutPrefix(line, "#"); ok && !strings.Contains(name, " ") {
			section = name
			continue
		}
		if line != "" {
			sections[section] = append(sections[section], line)
		}
	}
	for _, line := range sections["stat"] {
		if f := strings.Fields(line); len(f) >= 9 && f[0] == "cpu" {
			for i, v := range f[1:9] {
				n, _ := strconv.ParseUint(v, 10, 64)
				s.cpuTotal += n
				if i == 3 || i == 4 {
					s.cpuIdle += n
				}
			}
		}
	}
	for _, line := range sections["cores"] {
		s.cores, _ = strconv.Atoi(line)
	}
	for _, line := range sections["mem"] {
		f := strings.Fields(line)
		if len(f) < 2 {
			continue
		}
		kb, _ := strconv.ParseInt(f[1], 10, 64)
		switch f[0] {
		case "MemTotal:":
			s.memTotal = kb << 10
		case "MemAvailable:":
			s.memAvail = kb << 10
		}
	}
	for _, line := range sections["df"] {
		if f := strings.Fields(line); len(f) >= 3 {
			total, _ := strconv.ParseInt(f[1], 10, 64)
			used, _ := strconv.ParseInt(f[2], 10, 64)
			s.dataTotal, s.dataUsed = total<<10, used<<10
		}
	}
	for _, line := range sections["net"] {
		iface, counters, ok := strings.Cut(line, ":")
		f := strings.Fields(counters)
		if !ok || len(f) < 9 || strings.TrimSpace(iface) == "lo" {
			continue
		}
		rx, _ := strconv.ParseUint(f[0], 10, 64)
		tx, _ := strconv.ParseUint(f[8], 10, 64)
		s.rx += rx
		s.tx += tx
	}
	for _, line := range sections["procs"] {
		if pid, p, ok := parseProc(line); ok {
			s.procs[pid] = p
		}
	}
	parseGfx(sections["gfx"], s.frames)
	s.temps = parseThermal(sections["thermal"])
	return s
}

// parseProc reads "pid name pss /proc/pid/stat"; the comm in the stat line
// may contain spaces, so its fields are counted from the closing paren.
func parseProc(line string) (int, procSample, bool) {
	f := strings.SplitN(line, " ", 4)
	if len(f) < 4 {
		return 0, procSample{}, false
	}
	pid, err := strconv.Atoi(f[0])
	if err != nil {
		return 0, procSample{}, false
	}
	pss, _ := strconv.ParseInt(f[2], 10, 64)
	i := strings.LastIndexByte(f[3], ')')
	if i < 0 {
		return 0, procSample{}, false
	}
	rest := strings.Fields(f[3][i+1:])
	if len(rest) < 13 {
		return 0, procSample{}, false
	}
	utime, _ := strconv.ParseUint(rest[11], 10, 64)
	stime, _ := strconv.ParseUint(rest[12], 10, 64)
	return pid, procSample{name: f[1], ticks: utime + stime, pss: pss << 10}, true
}

var (
	gfxPIDRe   = regexp.MustCompile(`for pid (\d+)`)
	gfxCountRe = regexp.MustCompile(`:\s*(\d+)`)
)

func parseGfx(lines []string, into map[int]frameSample) {
	pid := 0
	for _, line := range lines {
		if m := gfxPIDRe.FindStringSubmatch(line); m != nil {
			pid, _ = strconv.Atoi(m[1])
			continue
		}
		m := gfxCountRe.FindStringSubmatch(line)
		if m == nil || pid == 0 {
			continue
		}
		n, _ := strconv.ParseUint(m[1], 10, 64)
		f := into[pid]
		switch {
		case strings.HasPrefix(line, "Total frames rendered:"):
			f.total = n
		case strings.HasPrefix(line, "Janky frames:"):
			f.janky = n
		}
		into[pid] = f
	}
}

var (
	temperatureRe = regexp.MustCompile(`mValue=([^,]+), mType=(-?\d+), mName=([^,]+)`)
	thermalTypes  = map[int]string{
		-1: "unknown", 0: "cpu", 1: "gpu", 2: "battery", 3: "skin", 4: "usb", 5: "amplifier",
		9: "npu", 10: "tpu", 11: "display", 12: "modem", 13: "soc", 14: "wifi", 15: "camera",
		16: "flashlight", 17: "speaker", 18: "ambient", 19: "pogo",
	}
)

// parseThermal prefers what the HAL reports right now over the cached
// values the service last handed to listeners.
func parseThermal(lines []string) []contract.Temperature {
	bySection := map[bool][]contract.Temperature{}
	current := false
	for _, line := range lines {
		if strings.HasSuffix(line, ":") {
			current = strings.HasPrefix(line, "Current temperatures")
			continue
		}
		m := temperatureRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		v, err := strconv.ParseFloat(m[1], 64)
		typ, _ := strconv.Atoi(m[2])
		name, known := thermalTypes[typ]
		if err != nil || math.IsNaN(v) || !known {
			continue
		}
		bySection[current] = append(bySection[current], contract.Temperature{
			Source: contract.TemperatureDevice, Type: name, Name: m[3], Celsius: math.Round(v*10) / 10,
		})
	}
	if t := bySection[true]; len(t) > 0 {
		return t
	}
	return bySection[false]
}

// cgroupDir finds the container's own cgroup: privileged containers see
// the node's whole hierarchy at /sys/fs/cgroup.
func cgroupDir(root fs.FS) string {
	if b, err := fs.ReadFile(root, "proc/self/cgroup"); err == nil {
		for line := range strings.SplitSeq(string(b), "\n") {
			if p, ok := strings.CutPrefix(strings.TrimSpace(line), "0::"); ok {
				return path.Join("sys/fs/cgroup", p)
			}
		}
	}
	return "sys/fs/cgroup"
}

func readHost(root fs.FS) *hostSample {
	cg := cgroupDir(root) + "/"
	stat, err := keyValues(root, cg+"cpu.stat")
	if err != nil {
		return nil
	}
	current, err := readInt(root, cg+"memory.current")
	if err != nil {
		return nil
	}
	h := &hostSample{usage: uint64(stat["usage_usec"]), throttled: uint64(stat["throttled_usec"]), limit: float64(runtime.NumCPU())}
	if b, err := fs.ReadFile(root, cg+"cpu.max"); err == nil {
		if f := strings.Fields(string(b)); len(f) == 2 && f[0] != "max" {
			quota, _ := strconv.ParseFloat(f[0], 64)
			period, _ := strconv.ParseFloat(f[1], 64)
			if quota > 0 && period > 0 {
				h.limit = quota / period
			}
		}
	}
	h.working = current
	if ms, err := keyValues(root, cg+"memory.stat"); err == nil {
		h.working = max(0, current-ms["inactive_file"])
	}
	if h.memMax, err = readInt(root, cg+"memory.max"); err != nil {
		if mi, err := keyValues(root, "proc/meminfo"); err == nil {
			h.memMax = mi["MemTotal:"] << 10
		}
	}
	return h
}

func readHostThermal(root fs.FS) []contract.Temperature {
	zones, _ := fs.Glob(root, "sys/class/thermal/thermal_zone*")
	var out []contract.Temperature
	for _, z := range zones {
		milli, err := readInt(root, path.Join(z, "temp"))
		typ, terr := fs.ReadFile(root, path.Join(z, "type"))
		if err != nil || terr != nil || milli <= 0 {
			continue
		}
		t := strings.TrimSpace(string(typ))
		out = append(out, contract.Temperature{Source: contract.TemperatureHost, Type: t, Name: path.Base(z), Celsius: math.Round(float64(milli)/100) / 10})
	}
	return out
}

func readInt(root fs.FS, name string) (int64, error) {
	b, err := fs.ReadFile(root, name)
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64)
}

func keyValues(root fs.FS, name string) (map[string]int64, error) {
	b, err := fs.ReadFile(root, name)
	if err != nil {
		return nil, err
	}
	kv := map[string]int64{}
	for line := range strings.SplitSeq(string(b), "\n") {
		if f := strings.Fields(line); len(f) >= 2 {
			kv[f[0]], _ = strconv.ParseInt(f[1], 10, 64)
		}
	}
	return kv, nil
}

func diff(prev, cur *sample) contract.Metrics {
	secs := cur.at.Sub(prev.at).Seconds()
	dTotal := float64(cur.cpuTotal - prev.cpuTotal)
	out := contract.Metrics{
		At:       cur.at.UTC(),
		Interval: math.Round(secs*100) / 100,
		Device: contract.DeviceLoad{
			Cores:        cur.cores,
			MemoryUsed:   cur.memTotal - cur.memAvail,
			MemoryTotal:  cur.memTotal,
			StorageUsed:  cur.dataUsed,
			StorageTotal: cur.dataTotal,
			RxRate:       rate(prev.rx, cur.rx, secs),
			TxRate:       rate(prev.tx, cur.tx, secs),
		},
		Thermal: cur.temps,
	}
	if out.Thermal == nil {
		out.Thermal = []contract.Temperature{}
	}
	if dTotal > 0 && cur.cpuTotal > prev.cpuTotal {
		out.Device.CPU = percent(float64(cur.cpuTotal-prev.cpuTotal)-float64(cur.cpuIdle-prev.cpuIdle), dTotal)
	}
	if len(cur.procs) > 0 {
		app := &contract.AppLoad{Processes: []contract.ProcessLoad{}}
		for pid, p := range cur.procs {
			load := contract.ProcessLoad{PID: pid, Name: p.name, Memory: p.pss}
			if old, ok := prev.procs[pid]; ok && dTotal > 0 && p.ticks >= old.ticks {
				load.CPU = percent(float64(p.ticks-old.ticks), dTotal)
			}
			app.Processes = append(app.Processes, load)
		}
		slices.SortFunc(app.Processes, func(a, b contract.ProcessLoad) int { return cmp.Compare(a.PID, b.PID) })
		var frames, janky uint64
		for pid, f := range cur.frames {
			if old, ok := prev.frames[pid]; ok && f.total >= old.total && f.janky >= old.janky {
				frames += f.total - old.total
				janky += f.janky - old.janky
			}
		}
		if secs > 0 {
			app.FPS = math.Round(float64(frames)/secs*10) / 10
		}
		if frames > 0 {
			app.Jank = percent(float64(janky), float64(frames))
		}
		out.App = app
	}
	if prev.host != nil && cur.host != nil && secs > 0 && cur.host.usage >= prev.host.usage && cur.host.throttled >= prev.host.throttled {
		usec := secs * 1e6
		out.Host = &contract.HostLoad{
			CPU:         math.Round(float64(cur.host.usage-prev.host.usage)/usec*100) / 100,
			CPULimit:    cur.host.limit,
			Throttled:   min(100, percent(float64(cur.host.throttled-prev.host.throttled), usec)),
			MemoryUsed:  cur.host.working,
			MemoryLimit: cur.host.memMax,
		}
	}
	return out
}

func rate(prev, cur uint64, secs float64) float64 {
	if cur < prev || secs <= 0 {
		return 0
	}
	return math.Round(float64(cur-prev) / secs)
}

func percent(part, whole float64) float64 {
	if whole <= 0 {
		return 0
	}
	return math.Round(max(0, part)/whole*1000) / 10
}
