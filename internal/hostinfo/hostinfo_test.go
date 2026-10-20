package hostinfo

import (
	"fmt"
	"testing"
	"testing/fstest"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func TestZones(t *testing.T) {
	got := Zones(fstest.MapFS{
		"sys/class/thermal/thermal_zone0/type":   {Data: []byte("x86_pkg_temp\n")},
		"sys/class/thermal/thermal_zone0/temp":   {Data: []byte("61540\n")},
		"sys/class/thermal/thermal_zone1/type":   {Data: []byte("acpitz\n")},
		"sys/class/thermal/thermal_zone1/temp":   {Data: []byte("-1\n")},
		"sys/class/thermal/cooling_device0/type": {Data: []byte("Processor\n")},
	})
	want := []contract.Temperature{{Source: contract.TemperatureHost, Type: "x86_pkg_temp", Name: "thermal_zone0", Celsius: 61.5}}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("got %+v", got)
	}
}

func TestRead(t *testing.T) {
	got := Read(fstest.MapFS{
		"proc/sys/kernel/hostname":            {Data: []byte("k3s-1\n")},
		"proc/sys/kernel/osrelease":           {Data: []byte("6.12.40\n")},
		"proc/cpuinfo":                        {Data: []byte("processor\t: 0\nmodel name\t: Intel(R) Core(TM) i5-8500T\n\nprocessor\t: 1\nmodel name\t: Intel(R) Core(TM) i5-8500T\n")},
		"proc/meminfo":                        {Data: []byte("MemTotal:       32768000 kB\nMemFree:  1000 kB\nMemAvailable:   16384000 kB\n")},
		"proc/loadavg":                        {Data: []byte("1.50 0.75 0.25 2/900 1234\n")},
		"proc/uptime":                         {Data: []byte("3600.50 7000.00\n")},
		"sys/class/hwmon/hwmon1/name":         {Data: []byte("coretemp\n")},
		"sys/class/hwmon/hwmon1/temp1_input":  {Data: []byte("48000\n")},
		"sys/class/hwmon/hwmon1/temp1_label":  {Data: []byte("Package id 0\n")},
		"sys/class/hwmon/hwmon1/temp10_input": {Data: []byte("45000\n")},
		"sys/class/hwmon/hwmon1/temp2_input":  {Data: []byte("46000\n")},
		"sys/class/hwmon/hwmon1/temp2_label":  {Data: []byte("Core 0\n")},
		"sys/class/hwmon/hwmon2/name":         {Data: []byte("nvme\n")},
		"sys/class/hwmon/hwmon2/temp1_input":  {Data: []byte("38850\n")},
	})
	if got.Hostname != "k3s-1" || got.Kernel != "6.12.40" || got.CPU != "Intel(R) Core(TM) i5-8500T" || got.Cores != 2 {
		t.Errorf("machine %+v", got)
	}
	if got.MemoryTotal != 32768000<<10 || got.MemoryAvailable != 16384000<<10 || got.Load1 != 1.5 || got.Load15 != 0.25 || got.Uptime != 3600.5 {
		t.Errorf("load %+v", got)
	}
	want := []contract.Temperature{
		{Source: contract.TemperatureHost, Type: "coretemp", Name: "Package id 0", Celsius: 48},
		{Source: contract.TemperatureHost, Type: "coretemp", Name: "Core 0", Celsius: 46},
		{Source: contract.TemperatureHost, Type: "coretemp", Name: "temp10", Celsius: 45},
		{Source: contract.TemperatureHost, Type: "nvme", Name: "temp1", Celsius: 38.9},
	}
	if fmt.Sprint(got.Thermal) != fmt.Sprint(want) {
		t.Errorf("thermal %+v", got.Thermal)
	}
}
