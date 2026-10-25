package agent

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/netem"
)

// Controls reads and changes device settings through adb shell.
type Controls struct {
	dev        Device
	localesDex string
	appLocales string
	usbNetwork bool
	root       bool
	su         bool
	now        func() time.Time

	shaper networkShaper

	mu          sync.Mutex
	geo         *contract.GeoPoint
	geoOverride bool
}

type networkShaper interface {
	Current() contract.NetworkProfile
	Set(ctx context.Context, id contract.NetworkProfile) error
	Close(ctx context.Context) error
}

// resetNetwork drops shaping a previous agent left on the tun.
func (c *Controls) resetNetwork(ctx context.Context) error {
	if c.shaper == nil {
		return nil
	}
	return c.shaper.Close(ctx)
}

// NewControls changes the system language by running localesDex, a dex
// file on the agent's disk, with app_process; empty disables it.
// NewControls fakes the GPS and simulates the battery when root is set;
// su runs setting changes through su (a rooted phone), otherwise the shell is
// already root (redroid) or the change needs none.
func NewControls(dev Device, localesDex string, root, su bool) *Controls {
	return &Controls{dev: dev, localesDex: localesDex, root: root || su, su: su, now: time.Now}
}

// exec runs a setting-changing command, as root through su on a rooted phone.
func (c *Controls) exec(ctx context.Context, cmd string) (string, error) {
	if c.su {
		cmd = suWrap(cmd)
	}
	return c.dev.Shell(ctx, cmd)
}

const stateScript = `echo "airplane=$(settings get global airplane_mode_on)"
echo "wifi=$(settings get global wifi_on)"
echo "data=$(settings get global mobile_data)"
echo "saver=$(settings get global low_power)"
echo "level=$(dumpsys battery get level)"
echo "ac=$(dumpsys battery get ac)"
echo "usb=$(dumpsys battery get usb)"
echo "night=$(cmd uimode night)"
echo "font=$(settings get system font_scale)"
echo "density=$(wm density | tr '\n' ' ')"
echo "rotation=$(settings get system user_rotation)"
echo "tz=$(getprop persist.sys.timezone)"
echo "locale=$(getprop persist.sys.locale)"
echo "productLocale=$(getprop ro.product.locale)"
echo "locales=$(settings get system system_locales)"
echo "autotime=$(settings get global auto_time)"`

var (
	localeTagRe       = regexp.MustCompile(`^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{1,8})*$`)
	physicalDensityRe = regexp.MustCompile(`Physical density: (\d+)`)
	overrideDensityRe = regexp.MustCompile(`Override density: (\d+)`)
)

func (c *Controls) State(ctx context.Context) (contract.DeviceState, error) {
	out, err := c.dev.Shell(ctx, stateScript)
	if err != nil {
		return contract.DeviceState{}, err
	}
	v := map[string]string{}
	for line := range strings.SplitSeq(out, "\n") {
		if k, val, ok := strings.Cut(strings.TrimSpace(line), "="); ok {
			v[k] = strings.TrimSpace(val)
		}
	}
	s := contract.DeviceState{
		AirplaneMode: v["airplane"] == "1",
		WiFi:         v["wifi"] == "1" || v["wifi"] == "2",
		MobileData:   v["data"] != "0",
		BatterySaver: v["saver"] == "1",
		Charging:     v["ac"] == "true" || v["usb"] == "true",
		DarkMode:     strings.Contains(v["night"], ": yes"),
		FontScale:    1,
		TimeZone:     cmp.Or(v["tz"], "UTC"),
		Locale:       cmp.Or(v["locale"], v["productLocale"], "en-US"),
		AutoTime:     v["autotime"] != "0",
	}
	for tag := range strings.SplitSeq(v["locales"], ",") {
		if tag = strings.TrimSpace(tag); localeTagRe.MatchString(tag) && tag != "null" {
			s.Locales = append(s.Locales, tag)
		}
	}
	s.USBNetwork = c.usbNetwork
	if c.shaper != nil {
		s.NetworkProfile, s.NetworkProfiles = c.shaper.Current(), netem.Catalog()
	}
	s.LanguageScope = contract.LanguageSystem
	if c.appLocales != "" {
		s.LanguageScope = contract.LanguageApp
		if tags := c.appLanguages(ctx); len(tags) > 0 {
			s.Locale, s.Locales = tags[0], tags
		}
	}
	if len(s.Locales) == 0 {
		s.Locales = []string{s.Locale}
	}
	s.BatteryLevel, _ = strconv.Atoi(v["level"])
	if f, err := strconv.ParseFloat(v["font"], 64); err == nil && f > 0 {
		s.FontScale = f
	}
	if m := physicalDensityRe.FindStringSubmatch(v["density"]); m != nil {
		s.DefaultDensity, _ = strconv.Atoi(m[1])
		s.Density = s.DefaultDensity
	}
	if m := overrideDensityRe.FindStringSubmatch(v["density"]); m != nil {
		s.Density, _ = strconv.Atoi(m[1])
	}
	if r, err := strconv.Atoi(v["rotation"]); err == nil && r >= 0 && r <= 3 {
		s.Rotation = r
	}
	if c.root {
		c.mu.Lock()
		s.Geo = c.geo
		s.GeoOverride = c.geoOverride
		s.CanFakeGeo = true
		s.CanSimulateBattery = true
		c.mu.Unlock()
	}
	if s.TimeOffset, err = c.timeOffset(ctx); err != nil {
		return contract.DeviceState{}, err
	}
	return s, nil
}

// timeOffset compares the device clock with ours, taking the middle of the
// adb round trip as the moment the device read its clock.
func (c *Controls) timeOffset(ctx context.Context) (int64, error) {
	before := c.now()
	out, err := c.dev.Shell(ctx, "date +%s%N")
	if err != nil {
		return 0, err
	}
	mid := before.Add(c.now().Sub(before) / 2)
	device, err := parseDeviceClock(out)
	if err != nil {
		return 0, err
	}
	return device.Sub(mid).Milliseconds(), nil
}

// parseDeviceClock reads `date +%s%N`; shells without %N print it literally.
func parseDeviceClock(out string) (time.Time, error) {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, strings.TrimSpace(out))
	n, err := strconv.ParseInt(digits, 10, 64)
	if err != nil || digits == "" {
		return time.Time{}, fmt.Errorf("device clock: unexpected output %q", out)
	}
	if len(digits) > 12 {
		return time.Unix(0, n), nil
	}
	return time.Unix(n, 0), nil
}

func (c *Controls) Update(ctx context.Context, in contract.DeviceSettings) (contract.DeviceState, error) {
	for _, tag := range in.Locales {
		if !localeTagRe.MatchString(tag) || len(tag) > 35 {
			return contract.DeviceState{}, fmt.Errorf("%w: bad language tag %q", contract.ErrInvalid, tag)
		}
	}
	var cmds []string
	add := func(cmd ...string) { cmds = append(cmds, cmd...) }

	if in.AirplaneMode != nil {
		add("cmd connectivity airplane-mode " + pick(*in.AirplaneMode, "enable", "disable"))
	}
	if in.WiFi != nil {
		add("svc wifi " + pick(*in.WiFi, "enable", "disable"))
	}
	if in.MobileData != nil {
		add("svc data " + pick(*in.MobileData, "enable", "disable"))
	}
	if !c.root && (in.Charging != nil || in.BatteryLevel != nil) {
		return contract.DeviceState{}, fmt.Errorf("%w: this device's battery can't be simulated", contract.ErrInvalid)
	}
	charging := in.Charging
	if in.BatterySaver != nil && *in.BatterySaver && charging == nil {
		charging = new(false)
	}
	if charging != nil {
		if *charging {
			add("dumpsys battery set ac 1", "dumpsys battery set status 2")
		} else {
			add("dumpsys battery unplug", "dumpsys battery set status 3")
		}
	}
	if in.BatteryLevel != nil {
		add(fmt.Sprintf("dumpsys battery set level %d", *in.BatteryLevel))
	}
	if in.BatterySaver != nil {
		add("cmd power set-mode " + pick(*in.BatterySaver, "1", "0"))
	}
	if in.DarkMode != nil {
		add("cmd uimode night " + pick(*in.DarkMode, "yes", "no"))
	}
	if in.FontScale != nil {
		add("settings put system font_scale " + strconv.FormatFloat(*in.FontScale, 'f', -1, 64))
	}
	if in.Density != nil {
		if *in.Density == 0 {
			add("wm density reset")
		} else {
			add(fmt.Sprintf("wm density %d", *in.Density))
		}
	}
	if in.Rotation != nil {
		add(rotate(*in.Rotation)...)
	}
	if in.TimeZone != nil {
		add("settings put global auto_time_zone 0", "cmd alarm set-timezone "+*in.TimeZone)
	}
	if in.AutoTime != nil && !*in.AutoTime && in.TimeOffset == nil {
		add("settings put global auto_time 0")
	}
	if len(cmds) > 0 {
		if _, err := c.exec(ctx, strings.Join(cmds, " && ")); err != nil {
			return contract.DeviceState{}, err
		}
	}

	switch {
	case in.AutoTime != nil && *in.AutoTime:
		if err := c.setTime(ctx, 0, true); err != nil {
			return contract.DeviceState{}, err
		}
	case in.TimeOffset != nil:
		if err := c.setTime(ctx, *in.TimeOffset, false); err != nil {
			return contract.DeviceState{}, err
		}
	}

	if in.NetworkProfile != nil {
		if err := c.setNetwork(ctx, *in.NetworkProfile); err != nil {
			return contract.DeviceState{}, err
		}
	}
	if in.Geo != nil || in.ResetGeo {
		if err := c.setGeo(ctx, in.Geo); err != nil {
			return contract.DeviceState{}, err
		}
		c.mu.Lock()
		c.geoOverride = in.Geo != nil
		c.mu.Unlock()
	}
	if len(in.Locales) > 0 && c.appLocales != "" {
		if _, err := c.dev.Shell(ctx, "cmd locale set-app-locales "+c.appLocales+" --user 0 --locales "+in.Locales[0]); err != nil {
			return contract.DeviceState{}, fmt.Errorf("set the app's language: %w", err)
		}
	} else if len(in.Locales) > 0 {
		if c.localesDex == "" {
			return contract.DeviceState{}, errors.New("changing the system language is not supported here")
		}
		var tags []string
		for _, tag := range in.Locales {
			if !slices.ContainsFunc(tags, func(t string) bool { return strings.EqualFold(t, tag) }) {
				tags = append(tags, tag)
			}
		}
		if err := c.setLocales(ctx, strings.Join(tags, ",")); err != nil {
			return contract.DeviceState{}, fmt.Errorf("set system language: %w", err)
		}
	}
	return c.State(ctx)
}

var appLocalesRe = regexp.MustCompile(`are \[(.*)\]`)

// appLanguages are the app's own languages, empty when it follows the
// system.
func (c *Controls) appLanguages(ctx context.Context) []string {
	out, err := c.dev.Shell(ctx, "cmd locale get-app-locales "+c.appLocales+" --user 0")
	m := appLocalesRe.FindStringSubmatch(out)
	if err != nil || m == nil {
		return nil
	}
	var tags []string
	for tag := range strings.SplitSeq(m[1], ",") {
		if tag = strings.TrimSpace(tag); localeTagRe.MatchString(tag) {
			tags = append(tags, tag)
		}
	}
	return tags
}

const localesRemote = "/data/local/tmp/holtdroid-locales.dex"

func (c *Controls) setLocales(ctx context.Context, tags string) error {
	if err := c.dev.Push(ctx, c.localesDex, localesRemote); err != nil {
		return err
	}
	_, err := c.exec(ctx, "CLASSPATH="+localesRemote+" app_process / Locales "+tags)
	return err
}

func (c *Controls) setTime(ctx context.Context, offset int64, auto bool) error {
	at := c.now().Add(time.Duration(offset) * time.Millisecond).UnixMilli()
	_, err := c.exec(ctx, fmt.Sprintf("settings put global auto_time %s && cmd alarm set-time %d", pick(auto, "1", "0"), at))
	return err
}

func (c *Controls) setNetwork(ctx context.Context, p contract.NetworkProfile) error {
	if c.shaper != nil {
		return c.shaper.Set(ctx, p)
	}
	if p == contract.NetworkFull {
		return nil
	}
	return fmt.Errorf("%w: this device can't emulate network conditions", contract.ErrInvalid)
}

func (c *Controls) setGeo(ctx context.Context, geo *contract.GeoPoint) error {
	if !c.root {
		return fmt.Errorf("%w: this device can't fake its location", contract.ErrInvalid)
	}
	if err := c.setGeoRoot(ctx, geo); err != nil {
		return err
	}
	c.mu.Lock()
	c.geo = geo
	c.mu.Unlock()
	return nil
}

// mockProviders are the location providers a rooted device fakes. Test
// providers replace the real ones of the same name, so faking gps and network
// (what fused aggregates) also keeps apps from seeing the real position.
var mockProviders = []string{"gps", "network"}

// setGeoRoot drives the location service's test providers, which Android lets
// a caller with the mock_location app-op register. geo nil removes them.
func (c *Controls) setGeoRoot(ctx context.Context, geo *contract.GeoPoint) error {
	if geo == nil {
		cmds := []string{}
		for _, p := range mockProviders {
			cmds = append(cmds, "cmd location providers remove-test-provider "+p+" >/dev/null 2>&1")
		}
		_, err := c.dev.Shell(ctx, strings.Join(append(cmds, "true"), "; "))
		return err
	}
	lat := strconv.FormatFloat(geo.Latitude, 'f', -1, 64)
	lng := strconv.FormatFloat(geo.Longitude, 'f', -1, 64)
	cmds := []string{"appops set 2000 android:mock_location allow"}
	for _, p := range mockProviders {
		cmds = append(cmds,
			"cmd location providers add-test-provider "+p+" >/dev/null 2>&1",
			"cmd location providers set-test-provider-enabled "+p+" true",
			"cmd location providers set-test-provider-location "+p+" --location "+lat+","+lng)
	}
	_, err := c.dev.Shell(ctx, strings.Join(cmds, "\n"))
	return err
}

// FollowLocation sets the timezone for the active VPN location (always) and
// fakes the GPS to pt (unless the user has overridden it for the session). It
// is applied quietly on a location switch, not as a user setting.
func (c *Controls) FollowLocation(ctx context.Context, pt *contract.GeoPoint, tz string) error {
	if tz != "" {
		if err := c.setTimezone(ctx, tz); err != nil {
			return err
		}
	}
	c.mu.Lock()
	override := c.geoOverride
	c.mu.Unlock()
	if override {
		return nil
	}
	return c.setGeo(ctx, pt)
}

func (c *Controls) setTimezone(ctx context.Context, tz string) error {
	_, err := c.exec(ctx, "settings put global auto_time_zone 0 && cmd alarm set-timezone "+tz)
	return err
}

// randomInRadius picks a uniformly random point within radius metres of a
// centre (equirectangular approximation, fine for a city-sized radius).
func randomInRadius(lat, lng, radius float64) contract.GeoPoint {
	if radius <= 0 {
		radius = 10000
	}
	d := radius * math.Sqrt(rand.Float64())
	t := 2 * math.Pi * rand.Float64()
	cosLat := math.Cos(lat * math.Pi / 180)
	if cosLat < 1e-9 {
		cosLat = 1e-9
	}
	return contract.GeoPoint{
		Latitude:  lat + (d*math.Sin(t))/111320.0,
		Longitude: lng + (d*math.Cos(t))/(111320.0*cosLat),
	}
}

var deviceKeys = map[contract.DeviceAction]string{
	contract.DeviceVolumeUp:      "input keyevent KEYCODE_VOLUME_UP",
	contract.DeviceVolumeDown:    "input keyevent KEYCODE_VOLUME_DOWN",
	contract.DeviceMute:          "input keyevent KEYCODE_VOLUME_MUTE",
	contract.DeviceScreenOff:     "input keyevent KEYCODE_SLEEP",
	contract.DeviceLock:          "locksettings set-disabled false && input keyevent KEYCODE_SLEEP && sleep 1 && input keyevent KEYCODE_WAKEUP",
	contract.DeviceUnlock:        "input keyevent KEYCODE_WAKEUP && wm dismiss-keyguard",
	contract.DeviceBack:          "input keyevent KEYCODE_BACK",
	contract.DeviceHome:          "input keyevent KEYCODE_HOME",
	contract.DeviceRecents:       "input keyevent KEYCODE_APP_SWITCH",
	contract.DeviceNotifications: "cmd statusbar expand-notifications",
	contract.DeviceQuickSettings: "cmd statusbar expand-settings",
}

// Action presses a key or rotates the screen. Rotation values follow
// Surface.ROTATION_*: turning the device left is +90°.
func (c *Controls) Action(ctx context.Context, action contract.DeviceAction) error {
	if cmd, ok := deviceKeys[action]; ok {
		_, err := c.dev.Shell(ctx, cmd)
		return err
	}
	var step int
	switch action {
	case contract.DeviceRotateLeft:
		step = 1
	case contract.DeviceRotateRight:
		step = 3
	default:
		return fmt.Errorf("%w: unknown action %q", contract.ErrInvalid, action)
	}
	out, err := c.dev.Shell(ctx, "settings get system user_rotation")
	if err != nil {
		return err
	}
	current, _ := strconv.Atoi(strings.TrimSpace(out))
	_, err = c.dev.Shell(ctx, strings.Join(rotate((current+step)%4), " && "))
	return err
}

func rotate(r int) []string {
	return []string{"settings put system accelerometer_rotation 0", fmt.Sprintf("settings put system user_rotation %d", r)}
}

func pick(on bool, yes, no string) string {
	if on {
		return yes
	}
	return no
}
