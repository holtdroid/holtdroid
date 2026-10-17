package agent

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kriakiku/holtdroid/internal/contract"
)

type scriptedDevice struct {
	fakeDevice
	mu     sync.Mutex
	state  string
	clock  string
	cmds   []string
	consol []string
}

func (d *scriptedDevice) Shell(_ context.Context, cmd string) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	switch cmd {
	case stateScript:
		return d.state, nil
	case "date +%s%N":
		return d.clock, nil
	case "settings get system user_rotation":
		return "3\n", nil
	}
	d.cmds = append(d.cmds, cmd)
	return "", nil
}

func (d *scriptedDevice) Emu(_ context.Context, cmd string) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.consol = append(d.consol, cmd)
	return "OK", nil
}

func TestControlsState(t *testing.T) {
	now := time.Unix(1_760_000_000, 0)
	dev := &scriptedDevice{
		state: `airplane=0
wifi=1
data=null
saver=1
level=42
ac=false
usb=false
night=Night mode: yes
font=1.3
density=Physical density: 320 Override density: 400 
rotation=1
tz=Europe/Warsaw
locale=
productLocale=en-US
autotime=0
`,
		clock: "1760003600000000000",
	}
	c := NewControls(dev, nil)
	c.now = func() time.Time { return now }
	got, err := c.State(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := contract.DeviceState{
		WiFi: true, MobileData: true, BatterySaver: true, BatteryLevel: 42, DarkMode: true,
		FontScale: 1.3, Density: 400, DefaultDensity: 320, Rotation: 1, NetworkProfile: contract.NetworkFull,
		TimeZone: "Europe/Warsaw", Locale: "en-US", TimeOffset: 3_600_000,
	}
	if got != want {
		t.Fatalf("state\n got %+v\nwant %+v", got, want)
	}
}

func TestParseDeviceClock(t *testing.T) {
	for _, tc := range []struct {
		out  string
		want time.Time
		ok   bool
	}{
		{"1760000000123456789\n", time.Unix(0, 1760000000123456789), true},
		{"1760000000N\r\n", time.Unix(1760000000, 0), true},
		{"1760000000%N", time.Unix(1760000000, 0), true},
		{"date: bad format", time.Time{}, false},
	} {
		got, err := parseDeviceClock(tc.out)
		if (err == nil) != tc.ok || !got.Equal(tc.want) {
			t.Errorf("%q: %v, %v", tc.out, got, err)
		}
	}
}

func TestControlsUpdate(t *testing.T) {
	now := time.UnixMilli(1_760_000_000_000)
	for _, tc := range []struct {
		name    string
		in      contract.DeviceSettings
		cmds    []string
		console []string
	}{
		{"airplane", contract.DeviceSettings{AirplaneMode: new(true)}, []string{"cmd connectivity airplane-mode enable"}, nil},
		{"radios", contract.DeviceSettings{WiFi: new(false), MobileData: new(true)}, []string{"svc wifi disable && svc data enable"}, nil},
		{"battery saver unplugs", contract.DeviceSettings{BatterySaver: new(true)}, []string{"dumpsys battery unplug && dumpsys battery set status 3 && cmd power set-mode 1"}, nil},
		{"charging and level", contract.DeviceSettings{Charging: new(true), BatteryLevel: new(15)}, []string{"dumpsys battery set ac 1 && dumpsys battery set status 2 && dumpsys battery set level 15"}, nil},
		{"display", contract.DeviceSettings{DarkMode: new(true), FontScale: new(1.15), Density: new(0)}, []string{"cmd uimode night yes && settings put system font_scale 1.15 && wm density reset"}, nil},
		{"rotation", contract.DeviceSettings{Rotation: new(2)}, []string{"settings put system accelerometer_rotation 0 && settings put system user_rotation 2"}, nil},
		{"time zone", contract.DeviceSettings{TimeZone: new("Asia/Tokyo")}, []string{"settings put global auto_time_zone 0 && cmd alarm set-timezone Asia/Tokyo"}, nil},
		{"time offset", contract.DeviceSettings{TimeOffset: new(int64(-5000))}, []string{"settings put global auto_time 0 && cmd alarm set-time 1759999995000"}, nil},
		{"auto time", contract.DeviceSettings{AutoTime: new(true)}, []string{"settings put global auto_time 1 && cmd alarm set-time 1760000000000"}, nil},
		{"network", contract.DeviceSettings{NetworkProfile: new(contract.NetworkEDGE)}, nil, []string{"network speed edge", "network delay edge"}},
		{"fast network", contract.DeviceSettings{NetworkProfile: new(contract.NetworkLTE)}, nil, []string{"network speed lte", "network delay none"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dev := &scriptedDevice{clock: "1760000000"}
			c := NewControls(dev, nil)
			c.now = func() time.Time { return now }
			if _, err := c.Update(context.Background(), tc.in); err != nil {
				t.Fatal(err)
			}
			if strings.Join(dev.cmds, "\n") != strings.Join(tc.cmds, "\n") {
				t.Errorf("shell\n got %q\nwant %q", dev.cmds, tc.cmds)
			}
			if strings.Join(dev.consol, "\n") != strings.Join(tc.console, "\n") {
				t.Errorf("console\n got %q\nwant %q", dev.consol, tc.console)
			}
		})
	}
}

func TestControlsLocaleUnsupported(t *testing.T) {
	c := NewControls(&scriptedDevice{clock: "1760000000"}, nil)
	if _, err := c.Update(context.Background(), contract.DeviceSettings{Locale: new("ru-RU")}); err == nil {
		t.Fatal("want an error without a locale setter")
	}
}

func TestControlsActions(t *testing.T) {
	for _, tc := range []struct {
		action contract.DeviceAction
		cmd    string
	}{
		{contract.DeviceVolumeUp, "input keyevent KEYCODE_VOLUME_UP"},
		{contract.DeviceLock, "locksettings set-disabled false && input keyevent KEYCODE_SLEEP && sleep 1 && input keyevent KEYCODE_WAKEUP"},
		{contract.DeviceUnlock, "input keyevent KEYCODE_WAKEUP && wm dismiss-keyguard"},
		{contract.DeviceRecents, "input keyevent KEYCODE_APP_SWITCH"},
		{contract.DeviceQuickSettings, "cmd statusbar expand-settings"},
		{contract.DeviceRotateLeft, "settings put system accelerometer_rotation 0 && settings put system user_rotation 0"},
		{contract.DeviceRotateRight, "settings put system accelerometer_rotation 0 && settings put system user_rotation 2"},
	} {
		dev := &scriptedDevice{}
		if err := NewControls(dev, nil).Action(context.Background(), tc.action); err != nil {
			t.Fatal(err)
		}
		if len(dev.cmds) != 1 || dev.cmds[0] != tc.cmd {
			t.Errorf("%s: %q", tc.action, dev.cmds)
		}
	}
	if err := NewControls(&scriptedDevice{}, nil).Action(context.Background(), "explode"); err == nil {
		t.Fatal("unknown action accepted")
	}
}

func TestAgentDeviceAPI(t *testing.T) {
	h := newHarness(t, nil)
	h.waitState(contract.StateReady)

	if code, body := h.do(http.MethodGet, "/v1/device", ""); code != http.StatusOK || !strings.Contains(body, `"locale":"en-US"`) {
		t.Fatalf("get device %d %s", code, body)
	}
	if code, body := h.do(http.MethodPatch, "/v1/device", `{"locale":"ru-RU","timeOffset":3600000}`); code != http.StatusOK {
		t.Fatalf("patch device %d %s", code, body)
	}
	if code, _ := h.do(http.MethodPatch, "/v1/device", `{"timeZone":"Europe/Warsaw; reboot"}`); code != http.StatusUnprocessableEntity {
		t.Fatalf("shell injection in time zone: %d", code)
	}
	if code, _ := h.do(http.MethodPost, "/v1/device/actions/home", ""); code != http.StatusNoContent {
		t.Fatalf("home %d", code)
	}
	if code, _ := h.do(http.MethodPost, "/v1/device/actions/explode", ""); code != http.StatusUnprocessableEntity {
		t.Fatalf("unknown action %d", code)
	}
	h.inst.mu.Lock()
	locales := h.inst.locales
	h.inst.mu.Unlock()
	h.dev.mu.Lock()
	shells := strings.Join(h.dev.shells, ";")
	h.dev.mu.Unlock()
	if locales != "ru-RU" || !strings.Contains(shells, "cmd alarm set-time") || !strings.Contains(shells, "KEYCODE_HOME") {
		t.Fatalf("locales %q, shells %s", locales, shells)
	}

	resp, err := http.Get(h.url + "/v1/device/screenshot")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("screenshot %d %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
}
