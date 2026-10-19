// Package hostinfo describes the machine it runs on from /proc and /sys.
// Both are host-wide inside a container, which is what node-info relies on.
package hostinfo

import (
	"cmp"
	"context"
	"io/fs"
	"math"
	"path"
	"runtime"
	"slices"
	"strconv"
	"strings"

	"github.com/kriakiku/holtdroid/internal/contract"
)

func Read(root fs.FS) contract.HostInfo {
	h := contract.HostInfo{Arch: runtime.GOARCH, Conditions: []string{}}
	h.Hostname = readString(root, "proc/sys/kernel/hostname")
	h.Kernel = readString(root, "proc/sys/kernel/osrelease")
	if b, err := fs.ReadFile(root, "proc/cpuinfo"); err == nil {
		for line := range strings.SplitSeq(string(b), "\n") {
			key, value, ok := strings.Cut(line, ":")
			key, value = strings.TrimSpace(key), strings.TrimSpace(value)
			switch {
			case !ok:
			case key == "processor":
				h.Cores++
			case h.CPU == "" && (key == "model name" || key == "Hardware" || key == "Model"):
				h.CPU = value
			}
		}
	}
	if b, err := fs.ReadFile(root, "proc/meminfo"); err == nil {
		for line := range strings.SplitSeq(string(b), "\n") {
			f := strings.Fields(line)
			if len(f) < 2 {
				continue
			}
			kb, _ := strconv.ParseInt(f[1], 10, 64)
			switch f[0] {
			case "MemTotal:":
				h.MemoryTotal = kb << 10
			case "MemAvailable:":
				h.MemoryAvailable = kb << 10
			}
		}
	}
	if f := strings.Fields(readString(root, "proc/loadavg")); len(f) >= 3 {
		h.Load1, _ = strconv.ParseFloat(f[0], 64)
		h.Load5, _ = strconv.ParseFloat(f[1], 64)
		h.Load15, _ = strconv.ParseFloat(f[2], 64)
	}
	if f := strings.Fields(readString(root, "proc/uptime")); len(f) >= 1 {
		h.Uptime, _ = strconv.ParseFloat(f[0], 64)
	}
	h.Thermal = append(Zones(root), Hwmon(root)...)
	return h
}

// Zones reads the kernel's thermal zones; zones without a reading are left out.
func Zones(root fs.FS) []contract.Temperature {
	zones, _ := fs.Glob(root, "sys/class/thermal/thermal_zone*")
	var out []contract.Temperature
	for _, z := range zones {
		milli, err := readInt(root, path.Join(z, "temp"))
		typ := readString(root, path.Join(z, "type"))
		if err != nil || typ == "" || milli <= 0 {
			continue
		}
		out = append(out, contract.Temperature{Source: contract.TemperatureHost, Type: typ, Name: path.Base(z), Celsius: celsius(milli)})
	}
	return out
}

// Hwmon reads the temperature inputs of hardware monitoring chips: CPU
// packages and cores (coretemp, k10temp), NVMe drives, chipsets.
func Hwmon(root fs.FS) []contract.Temperature {
	chips, _ := fs.Glob(root, "sys/class/hwmon/hwmon*")
	var out []contract.Temperature
	for _, chip := range chips {
		name := readString(root, path.Join(chip, "name"))
		inputs, _ := fs.Glob(root, path.Join(chip, "temp*_input"))
		slices.SortFunc(inputs, func(a, b string) int { return cmp.Compare(sensorIndex(a), sensorIndex(b)) })
		for _, in := range inputs {
			milli, err := readInt(root, in)
			if err != nil || milli <= 0 {
				continue
			}
			sensor := strings.TrimSuffix(path.Base(in), "_input")
			label := cmp.Or(readString(root, path.Join(chip, sensor+"_label")), sensor)
			out = append(out, contract.Temperature{Source: contract.TemperatureHost, Type: cmp.Or(name, path.Base(chip)), Name: label, Celsius: celsius(milli)})
		}
	}
	return out
}

func sensorIndex(input string) int {
	n, _ := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(path.Base(input), "temp"), "_input"))
	return n
}

func celsius(milli int64) float64 { return math.Round(float64(milli)/100) / 10 }

func readString(root fs.FS, name string) string {
	b, err := fs.ReadFile(root, name)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func readInt(root fs.FS, name string) (int64, error) {
	return strconv.ParseInt(readString(root, name), 10, 64)
}

// Node serves Read over the node contract.
type Node struct{ Root fs.FS }

func (n Node) Host(context.Context) (contract.HostInfo, error) { return Read(n.Root), nil }
