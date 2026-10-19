package agent

import (
	"context"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/kriakiku/holtdroid/internal/contract"
)

const inspectScript = `echo '#props'; getprop | grep -E '^\[(ro\.product\.(manufacturer|model|device|cpu\.abilist)|ro\.build\.(version\.(release|sdk|security_patch)|display\.id))\]'
echo '#battery'; dumpsys battery
echo '#thermal'; dumpsys thermalservice | grep -E 'Temperature\{|temperatures'
echo '#cores'; grep -c ^processor /proc/cpuinfo
echo '#mem'; grep -E '^MemTotal:' /proc/meminfo
echo '#df'; df -k /data | tail -n1
echo '#uptime'; cat /proc/uptime`

// Inspect describes a device without root: its build, battery, sensors,
// memory and storage.
func Inspect(ctx context.Context, dev interface {
	Shell(ctx context.Context, cmd string) (string, error)
},
) (contract.DeviceInfo, error) {
	out, err := dev.Shell(ctx, inspectScript)
	if err != nil {
		return contract.DeviceInfo{}, err
	}
	return parseInspect(out), nil
}

var (
	inspectProp   = regexp.MustCompile(`^\[([^\]]+)\]: \[(.*)\]$`)
	batteryStatus = map[string]string{"1": "unknown", "2": "charging", "3": "discharging", "4": "not-charging", "5": "full"}
	batteryHealth = map[string]string{"1": "unknown", "2": "good", "3": "overheat", "4": "dead", "5": "over-voltage", "6": "failure", "7": "cold"}
	batteryPlug   = map[string]string{"AC powered": "ac", "USB powered": "usb", "Wireless powered": "wireless", "Dock powered": "dock"}
)

func parseInspect(out string) contract.DeviceInfo {
	sections := splitSections(out)
	props := map[string]string{}
	for _, line := range sections["props"] {
		if m := inspectProp.FindStringSubmatch(line); m != nil {
			props[m[1]] = m[2]
		}
	}
	d := contract.DeviceInfo{
		Manufacturer:  props["ro.product.manufacturer"],
		Model:         props["ro.product.model"],
		Device:        props["ro.product.device"],
		Android:       props["ro.build.version.release"],
		Build:         props["ro.build.display.id"],
		SecurityPatch: props["ro.build.version.security_patch"],
		ABIs:          []string{},
		Thermal:       parseThermal(sections["thermal"]),
	}
	d.SDK, _ = strconv.Atoi(props["ro.build.version.sdk"])
	for abi := range strings.SplitSeq(props["ro.product.cpu.abilist"], ",") {
		if abi = strings.TrimSpace(abi); abi != "" {
			d.ABIs = append(d.ABIs, abi)
		}
	}
	if d.Thermal == nil {
		d.Thermal = []contract.Temperature{}
	}
	d.Battery = parseBattery(sections["battery"])
	for _, line := range sections["cores"] {
		d.Cores, _ = strconv.Atoi(line)
	}
	for _, line := range sections["mem"] {
		if f := strings.Fields(line); len(f) >= 2 {
			kb, _ := strconv.ParseInt(f[1], 10, 64)
			d.MemoryTotal = kb << 10
		}
	}
	for _, line := range sections["df"] {
		if f := strings.Fields(line); len(f) >= 3 {
			total, _ := strconv.ParseInt(f[1], 10, 64)
			used, _ := strconv.ParseInt(f[2], 10, 64)
			d.StorageTotal, d.StorageUsed = total<<10, used<<10
		}
	}
	for _, line := range sections["uptime"] {
		if f := strings.Fields(line); len(f) >= 1 {
			d.Uptime, _ = strconv.ParseFloat(f[0], 64)
		}
	}
	return d
}

func parseBattery(lines []string) *contract.Battery {
	v := map[string]string{}
	for _, line := range lines {
		if key, value, ok := strings.Cut(line, ":"); ok {
			v[strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
	}
	if v["present"] == "false" || v["level"] == "" {
		return nil
	}
	b := &contract.Battery{Status: "unknown", Health: "unknown"}
	b.Level, _ = strconv.Atoi(v["level"])
	if scale, _ := strconv.Atoi(v["scale"]); scale > 0 && scale != 100 {
		b.Level = b.Level * 100 / scale
	}
	if s, ok := batteryStatus[v["status"]]; ok {
		b.Status = s
	}
	if h, ok := batteryHealth[v["health"]]; ok {
		b.Health = h
	}
	for key, plug := range batteryPlug {
		if v[key] == "true" {
			b.Plugged = plug
		}
	}
	if t, err := strconv.ParseFloat(v["temperature"], 64); err == nil {
		b.Celsius = math.Round(t) / 10
	}
	if mv, err := strconv.ParseFloat(v["voltage"], 64); err == nil && mv > 0 {
		b.Voltage = math.Round(mv) / 1000
	}
	return b
}
