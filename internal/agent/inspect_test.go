package agent

import (
	"reflect"
	"testing"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func TestParseInspect(t *testing.T) {
	out := `#props
[ro.build.display.id]: [UP1A.231005.007.A055FXXS4CXG1]
[ro.build.version.release]: [14]
[ro.build.version.sdk]: [34]
[ro.build.version.security_patch]: [2024-07-01]
[ro.product.cpu.abilist]: [arm64-v8a,armeabi-v7a,armeabi]
[ro.product.device]: [a05]
[ro.product.manufacturer]: [samsung]
[ro.product.model]: [SM-A055F]
#battery
Current Battery Service state:
  AC powered: false
  USB powered: true
  Wireless powered: false
  status: 2
  health: 2
  present: true
  level: 85
  scale: 100
  voltage: 4231
  temperature: 281
#thermal
Current temperatures from HAL:
	Temperature{mValue=36.1, mType=0, mName=AP, mStatus=0}
	Temperature{mValue=28.1, mType=2, mName=BAT, mStatus=0}
#cores
8
#mem
MemTotal:        3748092 kB
#df
/dev/block/dm-45  52428800 20971520 31457280  40% /data
#uptime
86400.25 300000.00
`
	got := parseInspect(out)
	want := contract.DeviceInfo{
		Manufacturer: "samsung", Model: "SM-A055F", Device: "a05", Android: "14", SDK: 34,
		Build: "UP1A.231005.007.A055FXXS4CXG1", SecurityPatch: "2024-07-01",
		ABIs: []string{"arm64-v8a", "armeabi-v7a", "armeabi"}, Cores: 8,
		MemoryTotal: 3748092 << 10, StorageUsed: 20971520 << 10, StorageTotal: 52428800 << 10, Uptime: 86400.25,
		Battery: &contract.Battery{Level: 85, Status: "charging", Health: "good", Plugged: "usb", Celsius: 28.1, Voltage: 4.231},
		Thermal: []contract.Temperature{
			{Source: contract.TemperatureDevice, Type: "cpu", Name: "AP", Celsius: 36.1},
			{Source: contract.TemperatureDevice, Type: "battery", Name: "BAT", Celsius: 28.1},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %+v %+v\nwant %+v %+v", got, *got.Battery, want, *want.Battery)
	}
}

func TestParseBatteryAbsent(t *testing.T) {
	if b := parseBattery([]string{"present: false", "level: 0"}); b != nil {
		t.Errorf("got %+v", b)
	}
}
