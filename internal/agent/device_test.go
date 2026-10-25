package agent

import (
	"context"
	"errors"
	"math"
	"net/http"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

type scriptedDevice struct {
	fakeDevice
	mu     sync.Mutex
	state  string
	clock  string
	volume string
	cmds   []string
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
	case getVolume:
		return d.volume, nil
	case "cmd locale get-app-locales com.example.shop --user 0":
		return "Locales for com.example.shop for user 0 are [lt-LT]\n", nil
	}
	d.cmds = append(d.cmds, cmd)
	return "", nil
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
size=Physical size: 1440x3200 Override size: 1080x2400 
rotation=1
tz=Europe/Warsaw
locale=
productLocale=en-US
locales=en-US,ru-RU
autotime=0
volume=[V] volume is 4 in range [0..15]
fps=fps=60.000004 fps=120.00001 fps=60.0 
musicMuted=   Muted: true
`,
		clock: "1760003600000000000",
	}
	c := NewControls(dev, "", true, false)
	c.now = func() time.Time { return now }
	got, err := c.State(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := contract.DeviceState{
		WiFi: true, MobileData: true, BatterySaver: true, BatteryLevel: 42, DarkMode: true,
		FontScale: 1.3, Density: 400, DefaultDensity: 320, Rotation: 1, ScreenWidth: 1080, ScreenHeight: 2400, RefreshRate: 120, Volume: 4, VolumeMax: 15, Muted: true,
		TimeZone: "Europe/Warsaw", Locale: "en-US", Locales: []string{"en-US", "ru-RU"}, CanFakeGeo: true, CanSimulateBattery: true, LanguageScope: contract.LanguageSystem, TimeOffset: 3_600_000,
	}
	if !reflect.DeepEqual(got, want) {
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
		name string
		in   contract.DeviceSettings
		cmds []string
	}{
		{"airplane", contract.DeviceSettings{AirplaneMode: new(true)}, []string{"cmd connectivity airplane-mode enable"}},
		{"radios", contract.DeviceSettings{WiFi: new(false), MobileData: new(true)}, []string{"svc wifi disable && svc data enable"}},
		{"battery saver unplugs", contract.DeviceSettings{BatterySaver: new(true)}, []string{"dumpsys battery unplug && dumpsys battery set status 3 && cmd power set-mode 1"}},
		{"charging and level", contract.DeviceSettings{Charging: new(true), BatteryLevel: new(15)}, []string{"dumpsys battery set ac 1 && dumpsys battery set status 2 && dumpsys battery set level 15"}},
		{"display", contract.DeviceSettings{DarkMode: new(true), FontScale: new(1.15), Density: new(0)}, []string{"cmd uimode night yes && settings put system font_scale 1.15 && wm density reset"}},
		{"rotation", contract.DeviceSettings{Rotation: new(2)}, []string{"settings put system accelerometer_rotation 0 && settings put system user_rotation 2"}},
		{"time zone", contract.DeviceSettings{TimeZone: new("Asia/Tokyo")}, []string{"settings put global auto_time_zone 0 && cmd alarm set-timezone Asia/Tokyo"}},
		{"time offset", contract.DeviceSettings{TimeOffset: new(int64(-5000))}, []string{"settings put global auto_time 0 && cmd alarm set-time 1759999995000"}},
		{"auto time", contract.DeviceSettings{AutoTime: new(true)}, []string{"settings put global auto_time 1 && cmd alarm set-time 1760000000000"}},
		{"full network", contract.DeviceSettings{NetworkProfile: new(contract.NetworkFull)}, nil},
		{"geo", contract.DeviceSettings{Geo: &contract.GeoPoint{Latitude: 52.2297, Longitude: 21.0122}}, []string{"appops set 2000 android:mock_location allow\n" +
			"cmd location providers add-test-provider gps >/dev/null 2>&1\ncmd location providers set-test-provider-enabled gps true\ncmd location providers set-test-provider-location gps --location 52.2297,21.0122\n" +
			"cmd location providers add-test-provider network >/dev/null 2>&1\ncmd location providers set-test-provider-enabled network true\ncmd location providers set-test-provider-location network --location 52.2297,21.0122"}},
		{"reset geo", contract.DeviceSettings{ResetGeo: true}, []string{"cmd location providers remove-test-provider gps >/dev/null 2>&1; cmd location providers remove-test-provider network >/dev/null 2>&1; true"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dev := &scriptedDevice{clock: "1760000000"}
			c := NewControls(dev, "", true, false)
			c.now = func() time.Time { return now }
			if _, err := c.Update(context.Background(), tc.in); err != nil {
				t.Fatal(err)
			}
			if strings.Join(dev.cmds, "\n") != strings.Join(tc.cmds, "\n") {
				t.Errorf("shell\n got %q\nwant %q", dev.cmds, tc.cmds)
			}
		})
	}
}

func TestControlsVolume(t *testing.T) {
	ctx := context.Background()
	dev := &scriptedDevice{clock: "1760000000", volume: "[V] will get volume\n[V] volume is 7 in range [0..15]\n"}
	c := NewControls(dev, "", false, false)
	step := func(in contract.DeviceSettings, current string, want string) {
		t.Helper()
		dev.volume, dev.cmds = current, nil
		if _, err := c.Update(ctx, in); err != nil {
			t.Fatal(err)
		}
		if got := strings.Join(dev.cmds, "\n"); got != want {
			t.Errorf("shell\n got %q\nwant %q", got, want)
		}
	}
	step(contract.DeviceSettings{Muted: new(true)}, "volume is 7 in range [0..15]", "cmd media_session volume --stream 3 --set 0")
	step(contract.DeviceSettings{Muted: new(false)}, "volume is 0 in range [0..15]", "cmd media_session volume --stream 3 --set 7")
	step(contract.DeviceSettings{Volume: new(40)}, "volume is 7 in range [0..15]", "cmd media_session volume --stream 3 --set 15")

	fresh := NewControls(dev, "", false, false)
	dev.volume, dev.cmds = "volume is 0 in range [0..15]", nil
	if _, err := fresh.Update(ctx, contract.DeviceSettings{Muted: new(false)}); err != nil {
		t.Fatal(err)
	}
	if want := "cmd media_session volume --stream 3 --set 5"; strings.Join(dev.cmds, "\n") != want {
		t.Errorf("unmute without a remembered step: %q", dev.cmds)
	}

	dev.volume = "Unknown command"
	if _, err := fresh.Update(ctx, contract.DeviceSettings{Muted: new(true)}); !errors.Is(err, contract.ErrInvalid) {
		t.Errorf("no volume reported: %v", err)
	}
}

func TestControlsLocaleUnsupported(t *testing.T) {
	c := NewControls(&scriptedDevice{clock: "1760000000"}, "", true, false)
	if _, err := c.Update(context.Background(), contract.DeviceSettings{Locales: []string{"ru-RU"}}); err == nil {
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
		if err := NewControls(dev, "", true, false).Action(context.Background(), tc.action); err != nil {
			t.Fatal(err)
		}
		if len(dev.cmds) != 1 || dev.cmds[0] != tc.cmd {
			t.Errorf("%s: %q", tc.action, dev.cmds)
		}
	}
	if err := NewControls(&scriptedDevice{}, "", true, false).Action(context.Background(), "explode"); err == nil {
		t.Fatal("unknown action accepted")
	}
}

func TestAgentDeviceAPI(t *testing.T) {
	h := newHarness(t, nil)
	h.waitState(contract.StateReady)

	if code, body := h.do(http.MethodGet, "/v1/device", ""); code != http.StatusOK || !strings.Contains(body, `"locale":"en-US"`) {
		t.Fatalf("get device %d %s", code, body)
	}
	if code, body := h.do(http.MethodPatch, "/v1/device", `{"locales":["ru-RU","en-US","ru-RU"],"timeOffset":3600000}`); code != http.StatusOK {
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
	h.dev.mu.Lock()
	shells := strings.Join(h.dev.shells, ";")
	h.dev.mu.Unlock()
	if !strings.Contains(shells, "CLASSPATH=/data/local/tmp/holtdroid-locales.dex app_process / Locales ru-RU,en-US") ||
		!strings.Contains(shells, "cmd alarm set-time") || !strings.Contains(shells, "KEYCODE_HOME") {
		t.Fatalf("shells %s", shells)
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

func TestControlsOnAPhone(t *testing.T) {
	dev := &scriptedDevice{clock: "1760000000"}
	c := NewControls(dev, "", false, false)
	s, err := c.State(context.Background())
	if err != nil || s.CanFakeGeo || s.CanSimulateBattery || s.NetworkProfile != "" {
		t.Fatalf("state %+v, %v", s, err)
	}
	if _, err := c.Update(context.Background(), contract.DeviceSettings{BatteryLevel: new(10)}); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("battery level on a phone: %v", err)
	}
	if _, err := c.Update(context.Background(), contract.DeviceSettings{Geo: &contract.GeoPoint{Latitude: 1}}); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("geo on a phone: %v", err)
	}
}

type stubShaper struct{ current contract.NetworkProfile }

func (s *stubShaper) Current() contract.NetworkProfile { return s.current }

func (s *stubShaper) Set(_ context.Context, id contract.NetworkProfile) error {
	s.current = id
	return nil
}

func (s *stubShaper) Close(context.Context) error {
	s.current = contract.NetworkFull
	return nil
}

func TestControlsNetworkProfile(t *testing.T) {
	c := NewControls(&scriptedDevice{clock: "1760000000"}, "", true, false)
	c.shaper = &stubShaper{current: contract.NetworkFull}
	s, err := c.Update(context.Background(), contract.DeviceSettings{NetworkProfile: new(contract.NetworkProfile("subway"))})
	if err != nil || s.NetworkProfile != "subway" || len(s.NetworkProfiles) == 0 {
		t.Fatalf("state %+v, %v", s, err)
	}
}

func TestControlsAppLanguage(t *testing.T) {
	dev := &scriptedDevice{clock: "1760000000"}
	c := NewControls(dev, "", false, false)
	c.appLocales = "com.example.shop"
	s, err := c.State(context.Background())
	if err != nil || s.LanguageScope != contract.LanguageApp || s.Locale != "lt-LT" || len(s.Locales) != 1 {
		t.Fatalf("state %+v, %v", s, err)
	}
	if _, err := c.Update(context.Background(), contract.DeviceSettings{Locales: []string{"de-DE", "en-US"}}); err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(dev.cmds, "cmd locale set-app-locales com.example.shop --user 0 --locales de-DE") {
		t.Fatalf("cmds %q", dev.cmds)
	}
}

func TestControlsOnARootedPhone(t *testing.T) {
	dev := &scriptedDevice{state: "level=55\n", clock: "1760000000"}
	c := NewControls(dev, "/locales.dex", false, true)
	s, err := c.State(context.Background())
	if err != nil || !s.CanSimulateBattery || !s.CanFakeGeo {
		t.Fatalf("state %+v, %v", s, err)
	}
	if _, err := c.Update(context.Background(), contract.DeviceSettings{BatteryLevel: new(55)}); err != nil {
		t.Fatalf("battery on a rooted phone: %v", err)
	}
	if len(dev.cmds) != 1 || !strings.HasPrefix(dev.cmds[0], "su -c '") || !strings.Contains(dev.cmds[0], "dumpsys battery set level 55") {
		t.Fatalf("rooted update not escalated through su: %q", dev.cmds)
	}
	dev.cmds = nil
	if _, err := c.Update(context.Background(), contract.DeviceSettings{Locales: []string{"de-DE"}}); err != nil {
		t.Fatalf("system language on a rooted phone: %v", err)
	}
	if len(dev.cmds) != 1 || !strings.Contains(dev.cmds[0], "su -c '") || !strings.Contains(dev.cmds[0], "app_process / Locales de-DE") {
		t.Fatalf("system language not set through su app_process: %q", dev.cmds)
	}
	dev.cmds = nil
	if _, err := c.Update(context.Background(), contract.DeviceSettings{Geo: &contract.GeoPoint{Latitude: 48.8566, Longitude: 2.3522}}); err != nil {
		t.Fatalf("fake GPS on a rooted phone: %v", err)
	}
	if len(dev.cmds) != 1 || !strings.Contains(dev.cmds[0], "add-test-provider gps") || !strings.Contains(dev.cmds[0], "set-test-provider-location gps --location 48.8566,2.3522") {
		t.Fatalf("GPS not faked through a test provider: %q", dev.cmds)
	}
}

func TestRandomInRadius(t *testing.T) {
	const lat, lng, r = 50.45, 30.52, 5000.0
	for range 500 {
		p := randomInRadius(lat, lng, r)
		dLat := (p.Latitude - lat) * 111320
		dLng := (p.Longitude - lng) * 111320 * math.Cos(lat*math.Pi/180)
		if d := math.Hypot(dLat, dLng); d > r*1.02 {
			t.Fatalf("point %v is %.0fm from centre, radius %.0f", p, d, r)
		}
	}
	// zero radius falls back to the 10km default, not a single point
	if p := randomInRadius(lat, lng, 0); p.Latitude == lat && p.Longitude == lng {
		t.Fatalf("zero radius did not spread")
	}
}

func TestFollowLocationRooted(t *testing.T) {
	dev := &scriptedDevice{clock: "1760000000"}
	c := NewControls(dev, "", false, true) // rooted phone
	if err := c.FollowLocation(context.Background(), &contract.GeoPoint{Latitude: 50.45, Longitude: 30.52}, "Europe/Kyiv"); err != nil {
		t.Fatal(err)
	}
	all := strings.Join(dev.cmds, "\n")
	if !strings.Contains(all, "su -c") || !strings.Contains(all, "cmd alarm set-timezone Europe/Kyiv") {
		t.Fatalf("timezone not set silently via su: %q", dev.cmds)
	}
	if !strings.Contains(all, "add-test-provider gps") || !strings.Contains(all, "add-test-provider network") {
		t.Fatalf("geo not faked for gps and network (forbid real): %q", dev.cmds)
	}
	// a manual override stops the location from moving the GPS, but tz still follows
	dev.cmds = nil
	if _, err := c.Update(context.Background(), contract.DeviceSettings{Geo: &contract.GeoPoint{Latitude: 1, Longitude: 2}}); err != nil {
		t.Fatal(err)
	}
	dev.cmds = nil
	if err := c.FollowLocation(context.Background(), &contract.GeoPoint{Latitude: 9, Longitude: 9}, "Asia/Tokyo"); err != nil {
		t.Fatal(err)
	}
	all = strings.Join(dev.cmds, "\n")
	if !strings.Contains(all, "set-timezone Asia/Tokyo") {
		t.Fatalf("tz should still follow location under override: %q", dev.cmds)
	}
	if strings.Contains(all, "set-test-provider-location") {
		t.Fatalf("override should keep the location from moving the GPS: %q", dev.cmds)
	}
}
