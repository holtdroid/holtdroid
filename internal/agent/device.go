package agent

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"math/rand/v2"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/agent/redroid"
	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/netem"
)

// Controls reads and changes device settings through adb shell.
type Controls struct {
	dev        Device
	toolsDex   string
	appLocales string
	usbNetwork bool
	root       bool
	su         bool
	redroid    bool
	now        func() time.Time

	shaper    networkShaper
	routeTick time.Duration

	geoMu       sync.Mutex
	mu          sync.Mutex
	geo         *contract.GeoPoint
	geoOverride bool
	route       *routeRun
	tzOverride  bool
	vpnTZ       string
	unmuteTo    int
	brightness  int
	apiLevel    int
	lockPIN     bool
	wifi        bool
	mobileData  bool
	simWiFi     bool
}

type networkShaper interface {
	Current() contract.NetworkProfile
	Set(ctx context.Context, id contract.NetworkProfile) error
	Region() *contract.NetworkRegionState
	Route() *contract.NetworkRoute
	Watch(ctx context.Context)
	SetRegion(ctx context.Context, in contract.NetworkRegionSettings) error
	Refresh()
	Close(ctx context.Context) error
}

// resetNetwork drops shaping a previous agent left on the tun and starts
// measuring the session's route.
func (c *Controls) resetNetwork(ctx context.Context) error {
	if c.shaper == nil {
		return nil
	}
	go c.shaper.Watch(ctx)
	return c.shaper.Close(ctx)
}

// NewControls changes the system language by running toolsDex, a dex
// file on the agent's disk, with app_process; empty disables it.
// NewControls fakes the GPS and simulates the battery when root is set;
// su runs setting changes through su (a rooted phone), otherwise the shell is
// already root (redroid) or the change needs none.
func NewControls(dev Device, toolsDex string, root, su bool) *Controls {
	return &Controls{dev: dev, toolsDex: toolsDex, root: root || su, su: su, now: time.Now, routeTick: time.Second, brightness: -1, wifi: true, mobileData: true}
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
dumpsys battery | grep -E '^  (AC powered|USB powered|level):' | sed 's/^  /battery./; s/: /=/'
echo "night=$(cmd uimode night)"
echo "font=$(settings get system font_scale)"
echo "brightness=$(settings get system screen_brightness)"
echo "autoBrightness=$(settings get system screen_brightness_mode)"
echo "density=$(wm density | tr '\n' ' ')"
echo "size=$(wm size | tr '\n' ' ')"
echo "rotation=$(settings get system user_rotation)"
echo "tz=$(getprop persist.sys.timezone)"
echo "locale=$(getprop persist.sys.locale)"
echo "productLocale=$(getprop ro.product.locale)"
echo "locales=$(settings get system system_locales)"
echo "autotime=$(settings get global auto_time)"
echo "volume=$(cmd media_session volume --stream 3 --get 2>/dev/null | grep 'volume is')"
display=$(dumpsys display)
echo "fps=$(echo "$display" | grep -o 'fps=[0-9.]*' | tr '\n' ' ')"
echo "$display" | grep -o -m1 'mCachedBrightnessInfo.brightnessMin=[0-9.]*'
echo "sdk=$(getprop ro.build.version.sdk)"
dumpsys power | grep -o -m1 'mScreenBrightnessSettingMinimumFloat=[0-9.]*'
echo "nav=$(settings get secure navigation_mode)"
echo "musicMuted=$(dumpsys audio | grep -A1 -- '- STREAM_MUSIC:' | grep Muted)"`

var (
	localeTagRe       = regexp.MustCompile(`^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{1,8})*$`)
	physicalDensityRe = regexp.MustCompile(`Physical density: (\d+)`)
	overrideDensityRe = regexp.MustCompile(`Override density: (\d+)`)
	physicalSizeRe    = regexp.MustCompile(`Physical size: (\d+)x(\d+)`)
	overrideSizeRe    = regexp.MustCompile(`Override size: (\d+)x(\d+)`)
	volumeRe          = regexp.MustCompile(`volume is (\d+) in range \[(\d+)\.\.(\d+)\]`)
)

const getVolume = "cmd media_session volume --stream 3 --get"

func parseVolume(out string) (volume, low, high int, ok bool) {
	m := volumeRe.FindStringSubmatch(out)
	if m == nil {
		return 0, 0, 0, false
	}
	volume, _ = strconv.Atoi(m[1])
	low, _ = strconv.Atoi(m[2])
	high, _ = strconv.Atoi(m[3])
	return volume, low, high, high > low
}

func (c *Controls) State(ctx context.Context) (contract.DeviceState, error) {
	out, err := c.dev.Shell(ctx, stateScript)
	if err != nil {
		return contract.DeviceState{}, err
	}
	v := parseKV(out)
	s := contract.DeviceState{
		AirplaneMode: v["airplane"] == "1",
		WiFi:         v["wifi"] == "1" || v["wifi"] == "2",
		MobileData:   v["data"] != "0",
		BatterySaver: v["saver"] == "1",
		Charging:     v["battery.AC powered"] == "true" || v["battery.USB powered"] == "true",
		DarkMode:     strings.Contains(v["night"], ": yes"),
		FontScale:    1,
		TimeZone:     cmp.Or(v["tz"], "UTC"),
		Locale:       cmp.Or(v["locale"], v["productLocale"], "en-US"),
		AutoTime:     v["autotime"] != "0",
		CanSetTime:   true,
	}
	for tag := range strings.SplitSeq(v["locales"], ",") {
		if tag = strings.TrimSpace(tag); localeTagRe.MatchString(tag) && tag != "null" {
			s.Locales = append(s.Locales, tag)
		}
	}
	s.USBNetwork = c.usbNetwork
	if c.redroid {
		c.mu.Lock()
		if !c.simWiFi {
			s.WiFi = c.wifi
		}
		s.MobileData = c.mobileData
		c.mu.Unlock()
		s.CanSetTime = false
		s.Navigation = contract.NavigationButtons
		if v["nav"] == "2" {
			s.Navigation = contract.NavigationGestures
		}
	}
	c.mu.Lock()
	s.TimeZoneOverride, s.VPNTimeZone = c.tzOverride, c.vpnTZ
	c.mu.Unlock()
	if c.shaper != nil {
		s.NetworkProfile, s.NetworkProfiles = c.shaper.Current(), netem.Catalog()
		s.NetworkRegion, s.NetworkRegions, s.NetworkServers = c.shaper.Region(), netem.RegionCatalog(), netem.ServerCatalog()
		s.NetworkRoute = c.shaper.Route()
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
	s.BatteryLevel, _ = strconv.Atoi(v["battery.level"])
	if f, err := strconv.ParseFloat(v["font"], 64); err == nil && f > 0 {
		s.FontScale = f
	}
	if b, err := strconv.Atoi(v["brightness"]); err == nil {
		low := brightnessMin(v)
		c.mu.Lock()
		s.Brightness = brightnessPercent(b, low)
		if c.brightness >= 0 && brightnessSetting(c.brightness, low) == b {
			s.Brightness = c.brightness
		}
		c.mu.Unlock()
	}
	s.AutoBrightness = v["autoBrightness"] == "1"
	if m := physicalDensityRe.FindStringSubmatch(v["density"]); m != nil {
		s.DefaultDensity, _ = strconv.Atoi(m[1])
		s.Density = s.DefaultDensity
	}
	if m := overrideDensityRe.FindStringSubmatch(v["density"]); m != nil {
		s.Density, _ = strconv.Atoi(m[1])
	}
	for _, re := range []*regexp.Regexp{physicalSizeRe, overrideSizeRe} {
		if m := re.FindStringSubmatch(v["size"]); m != nil {
			s.ScreenWidth, _ = strconv.Atoi(m[1])
			s.ScreenHeight, _ = strconv.Atoi(m[2])
		}
	}
	if r, err := strconv.Atoi(v["rotation"]); err == nil && r >= 0 && r <= 3 {
		s.Rotation = r
	}
	for f := range strings.FieldsSeq(v["fps"]) {
		if hz, err := strconv.ParseFloat(strings.TrimPrefix(f, "fps="), 64); err == nil {
			s.RefreshRate = max(s.RefreshRate, int(math.Round(hz)))
		}
	}
	if volume, low, high, ok := parseVolume(v["volume"]); ok {
		s.Volume, s.VolumeMax = volume, high
		s.Muted = strings.Contains(v["musicMuted"], "true") || volume == low
	}
	if c.root {
		c.mu.Lock()
		s.Geo = c.geo
		s.GeoOverride = c.geoOverride
		if r := c.route; r != nil {
			_, st := r.motion.State(c.now().Sub(r.start).Seconds())
			st.Points = slices.Clone(st.Points)
			s.Route = &st
		}
		s.CanFakeGeo = true
		s.CanSimulateBattery = true
		c.mu.Unlock()
	}
	if s.TimeOffset, err = c.timeOffset(ctx); err != nil {
		return contract.DeviceState{}, err
	}
	return s, nil
}

func parseKV(out string) map[string]string {
	v := map[string]string{}
	for line := range strings.SplitSeq(out, "\n") {
		if k, val, ok := strings.Cut(strings.TrimSpace(line), "="); ok {
			v[k] = strings.TrimSpace(val)
		}
	}
	return v
}

const brightnessRangeScript = `echo "sdk=$(getprop ro.build.version.sdk)"
dumpsys display | grep -o -m1 'mCachedBrightnessInfo.brightnessMin=[0-9.]*'
dumpsys power | grep -o -m1 'mScreenBrightnessSettingMinimumFloat=[0-9.]*'
true`

// brightnessMin is the lowest brightness the shade's slider goes down to:
// the display's current minimum since Android 12, the settings minimum
// before.
func brightnessMin(v map[string]string) float64 {
	key := "mCachedBrightnessInfo.brightnessMin"
	if sdk, err := strconv.Atoi(v["sdk"]); err == nil && sdk <= 30 {
		key = "mScreenBrightnessSettingMinimumFloat"
	}
	low, err := strconv.ParseFloat(v[key], 64)
	if err != nil || low < 0 || low >= 1 {
		return 0
	}
	return low
}

// The shade's brightness slider is in Android's gamma space (BrightnessUtils,
// an HLG curve), so a percentage there is not a percentage of the linear
// brightness the display and the settings store.
const (
	gammaR = 0.5
	gammaA = 0.17883277
	gammaB = 0.28466892
	gammaC = 0.55991073
)

func gammaToLinear(gamma, low float64) float64 {
	var r float64
	if gamma <= gammaR {
		r = (gamma / gammaR) * (gamma / gammaR)
	} else {
		r = math.Exp((gamma-gammaC)/gammaA) + gammaB
	}
	return low + (1-low)*min(max(r, 0), 12)/12
}

func linearToGamma(linear, low float64) float64 {
	n := min(max((linear-low)/(1-low), 0), 1) * 12
	if n <= 1 {
		return math.Sqrt(n) * gammaR
	}
	return gammaA*math.Log(n-gammaB) + gammaC
}

// brightnessSetting is the 1–255 screen_brightness Android stores for a
// slider percentage.
func brightnessSetting(percent int, low float64) int {
	return int(math.Round(1 + gammaToLinear(float64(percent)/100, low)*254))
}

func brightnessPercent(setting int, low float64) int {
	linear := min(max(float64(setting-1)/254, 0), 1)
	return min(100, max(0, int(math.Round(linearToGamma(linear, low)*100))))
}

// radiosScript stands in for mobile data on redroid, which has no modem, and
// for Wi-Fi when the image has no simulated one. The app under test sees the
// network as the radio that is on (the Frida script reads
// debug.holtdroid.network).
//
// With the simulated Wi-Fi (decision #105) Wi-Fi is Android's own; mobile
// data is the router namespace's second uplink, eth1, which Android takes for
// Ethernet and the app sees as mobile data. It is up only while Wi-Fi is off,
// as a phone prefers Wi-Fi, and Ethernet would keep Android off the Wi-Fi.
//
// Without it the Ethernet network is shown as either radio, and with both off
// or in airplane mode only root keeps a route.
func (c *Controls) radiosScript() string {
	c.mu.Lock()
	wifi, data := c.wifi, c.mobileData
	c.mu.Unlock()
	mode := "none"
	switch {
	case wifi:
		mode = "wifi"
	case data:
		mode = "mobile"
	}
	return "m=" + mode + " d=" + pick(data, "1", "0") + `
a=$(settings get global airplane_mode_on)
if [ "$(getprop vendor.holtdroid.wifi)" = 1 ]; then
  case $(settings get global wifi_on) in 1|2) m=wifi ;; *) [ $d = 1 ] && [ "$a" != 1 ] && m=mobile || m=none ;; esac
  nsenter --net=/proc/$(cat /data/vendor/wifi/router.pid)/ns/net -- ip link set mobile0 $([ $m = mobile ] && echo up || echo down)
else
  [ "$a" = 1 ] && m=none
fi
setprop debug.holtdroid.network $m
while ip rule del pref 8990 2>/dev/null; do :; done
[ $m != none ] || [ "$(getprop vendor.holtdroid.wifi)" = 1 ] || ip rule add pref 8990 not uidrange 0-0 unreachable`
}

// syncRadios follows the simulated Wi-Fi when the image has one: the user
// turns it on and off in Android's own quick settings too, and the mobile
// uplink has to give way to it.
func (c *Controls) syncRadios(ctx context.Context, every time.Duration, log *slog.Logger) {
	if !c.redroid {
		return
	}
	for {
		out, err := c.dev.Shell(ctx, "getprop vendor.holtdroid.wifi")
		if err == nil {
			if strings.TrimSpace(out) != "1" {
				return
			}
			c.mu.Lock()
			c.simWiFi = true
			c.mu.Unlock()
			break
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(every):
		}
	}
	for {
		if _, err := c.dev.Shell(ctx, c.radiosScript()); err != nil && ctx.Err() == nil {
			log.Warn("sync radios", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(every):
		}
	}
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
	c.mu.Lock()
	simWiFi := c.simWiFi
	if c.redroid {
		if in.WiFi != nil {
			c.wifi = *in.WiFi
		}
		if in.MobileData != nil {
			c.mobileData = *in.MobileData
		}
	}
	c.mu.Unlock()
	if (!c.redroid || simWiFi) && in.WiFi != nil {
		add("svc wifi " + pick(*in.WiFi, "enable", "disable"))
	}
	if !c.redroid && in.MobileData != nil {
		add("svc data " + pick(*in.MobileData, "enable", "disable"))
	}
	if !c.root && (in.Charging != nil || in.BatteryLevel != nil) {
		return contract.DeviceState{}, fmt.Errorf("%w: this device's battery can't be simulated", contract.ErrInvalid)
	}
	charging := in.Charging
	if in.BatterySaver != nil && *in.BatterySaver && charging == nil {
		charging = new(false)
	}
	if in.BatteryLevel != nil {
		add(fmt.Sprintf("dumpsys battery set level %d", max(*in.BatteryLevel, 1)))
	}
	if charging != nil {
		if *charging {
			add("dumpsys battery set ac 1", "dumpsys battery set status 2")
		} else {
			add("dumpsys battery unplug", "dumpsys battery set status 3")
		}
	}
	if charging != nil || in.BatteryLevel != nil {
		add("dumpsys battery set present 1")
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
	switch {
	case in.AutoBrightness != nil:
		add("settings put system screen_brightness_mode " + pick(*in.AutoBrightness, "1", "0"))
	case in.Brightness != nil:
		add("settings put system screen_brightness_mode 0")
	}
	if in.Brightness != nil {
		out, err := c.dev.Shell(ctx, brightnessRangeScript)
		if err != nil {
			return contract.DeviceState{}, err
		}
		low := brightnessMin(parseKV(out))
		level := gammaToLinear(float64(*in.Brightness)/100, low)
		add(fmt.Sprintf("{ cmd display set-brightness %s >/dev/null 2>&1 || settings put system screen_brightness %d; }",
			strconv.FormatFloat(level, 'f', 6, 64), brightnessSetting(*in.Brightness, low)))
		c.mu.Lock()
		c.brightness = *in.Brightness
		c.mu.Unlock()
	}
	if in.Rotation != nil {
		add(rotate(*in.Rotation)...)
	}
	if in.Navigation != nil {
		if !c.redroid {
			return contract.DeviceState{}, fmt.Errorf("%w: this device's navigation can't be switched", contract.ErrInvalid)
		}
		add(pick(*in.Navigation == contract.NavigationGestures, redroid.GestureNavigation, redroid.ButtonNavigation))
	}
	if in.TimeZone != nil {
		add("settings put global auto_time_zone 0", "cmd alarm set-timezone "+*in.TimeZone)
	}
	if c.redroid && in.TimeOffset != nil {
		return contract.DeviceState{}, fmt.Errorf("%w: this device's clock is the server's and can't be changed", contract.ErrInvalid)
	}
	if in.AutoTime != nil && (c.redroid || !*in.AutoTime && in.TimeOffset == nil) {
		add("settings put global auto_time " + pick(*in.AutoTime, "1", "0"))
	}
	if len(cmds) > 0 {
		if _, err := c.exec(ctx, strings.Join(cmds, " && ")); err != nil {
			return contract.DeviceState{}, err
		}
	}

	if c.redroid && (in.AirplaneMode != nil || in.WiFi != nil || in.MobileData != nil) {
		if _, err := c.dev.Shell(ctx, c.radiosScript()); err != nil {
			return contract.DeviceState{}, err
		}
	}

	switch {
	case c.redroid:
	case in.AutoTime != nil && *in.AutoTime:
		if err := c.setTime(ctx, 0, true); err != nil {
			return contract.DeviceState{}, err
		}
	case in.TimeOffset != nil:
		if err := c.setTime(ctx, *in.TimeOffset, false); err != nil {
			return contract.DeviceState{}, err
		}
	}

	if in.Volume != nil || in.Muted != nil {
		if err := c.setVolume(ctx, in.Volume, in.Muted); err != nil {
			return contract.DeviceState{}, fmt.Errorf("set the volume: %w", err)
		}
	}
	if in.NetworkProfile != nil {
		if err := c.setNetwork(ctx, *in.NetworkProfile); err != nil {
			return contract.DeviceState{}, err
		}
	}
	if in.NetworkRegion != nil {
		if err := c.setRegion(ctx, *in.NetworkRegion); err != nil {
			return contract.DeviceState{}, err
		}
	}
	if in.TimeZone != nil {
		c.mu.Lock()
		c.tzOverride = true
		c.mu.Unlock()
	}
	if in.ResetTimeZone && in.TimeZone == nil {
		c.mu.Lock()
		c.tzOverride = false
		tz := c.vpnTZ
		c.mu.Unlock()
		if tz != "" {
			if err := c.setTimezone(ctx, tz); err != nil {
				return contract.DeviceState{}, err
			}
		}
	}
	if in.Geo != nil || in.ResetGeo || in.StopRoute || in.Route != nil {
		c.stopRoute()
	}
	if in.Geo != nil || in.ResetGeo {
		if err := c.setGeo(ctx, in.Geo); err != nil {
			return contract.DeviceState{}, err
		}
		c.mu.Lock()
		c.geoOverride = in.Geo != nil
		c.mu.Unlock()
	}
	if in.Route != nil {
		if err := c.startRoute(ctx, *in.Route); err != nil {
			return contract.DeviceState{}, err
		}
	}
	if len(in.Locales) > 0 && c.appLocales != "" {
		if _, err := c.dev.Shell(ctx, "cmd locale set-app-locales "+c.appLocales+" --user 0 --locales "+in.Locales[0]); err != nil {
			return contract.DeviceState{}, fmt.Errorf("set the app's language: %w", err)
		}
	} else if len(in.Locales) > 0 {
		if c.toolsDex == "" {
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

const toolsRemote = "/data/local/tmp/holtdroid-tools.dex"

func (c *Controls) setLocales(ctx context.Context, tags string) error {
	if err := c.dev.Push(ctx, c.toolsDex, toolsRemote); err != nil {
		return err
	}
	_, err := c.exec(ctx, "CLASSPATH="+toolsRemote+" app_process / Locales "+tags)
	return err
}

func (c *Controls) setTime(ctx context.Context, offset int64, auto bool) error {
	at := c.now().Add(time.Duration(offset) * time.Millisecond).UnixMilli()
	_, err := c.exec(ctx, fmt.Sprintf("settings put global auto_time %s && cmd alarm set-time %d", pick(auto, "1", "0"), at))
	return err
}

// setVolume mutes by setting the media volume to its lowest step, which
// Android treats as muted, and remembers the step to unmute to: a step above
// it unmutes the stream.
func (c *Controls) setVolume(ctx context.Context, volume *int, muted *bool) error {
	out, err := c.dev.Shell(ctx, getVolume)
	if err != nil {
		return err
	}
	current, low, high, ok := parseVolume(out)
	if !ok {
		return fmt.Errorf("%w: this device doesn't report its volume", contract.ErrInvalid)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if current > low {
		c.unmuteTo = current
	}
	var target int
	switch {
	case muted != nil && *muted:
		target = low
	case volume != nil:
		target = min(max(*volume, low), high)
		if target > low {
			c.unmuteTo = target
		}
	default:
		target = c.unmuteTo
		if target <= low || target > high {
			target = max(low+1, (high+2)/3)
		}
	}
	_, err = c.dev.Shell(ctx, fmt.Sprintf("cmd media_session volume --stream 3 --set %d", target))
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

func (c *Controls) setRegion(ctx context.Context, in contract.NetworkRegionSettings) error {
	if c.shaper != nil {
		return c.shaper.SetRegion(ctx, in)
	}
	if in.Region == "" {
		return nil
	}
	return fmt.Errorf("%w: this device can't emulate network conditions", contract.ErrInvalid)
}

// networkMoved measures the route again after the VPN location changed.
func (c *Controls) networkMoved() {
	if c.shaper != nil {
		c.shaper.Refresh()
	}
}

func (c *Controls) setGeo(ctx context.Context, geo *contract.GeoPoint) error {
	if !c.root {
		return fmt.Errorf("%w: this device can't fake its location", contract.ErrInvalid)
	}
	c.geoMu.Lock()
	defer c.geoMu.Unlock()
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
	if c.legacyLocation(ctx) {
		return c.setGeoDex(ctx, geo)
	}
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
	cmds := []string{"appops set 2000 android:mock_location allow", "appops set 0 android:mock_location allow"}
	for _, p := range mockProviders {
		cmds = append(cmds,
			"cmd location providers add-test-provider "+p+" >/dev/null 2>&1",
			"cmd location providers set-test-provider-enabled "+p+" true",
			"cmd location providers set-test-provider-location "+p+" --location "+lat+","+lng)
	}
	_, err := c.dev.Shell(ctx, strings.Join(cmds, "\n"))
	return err
}

// setGeoDex drives the test providers on Android 11, whose cmd location has
// no providers command, through ILocationManager from the shell uid.
func (c *Controls) setGeoDex(ctx context.Context, geo *contract.GeoPoint) error {
	if err := c.dev.Push(ctx, c.toolsDex, toolsRemote); err != nil {
		return err
	}
	args := "remove"
	if geo != nil {
		args = "set " + strconv.FormatFloat(geo.Latitude, 'f', 7, 64) + "," + strconv.FormatFloat(geo.Longitude, 'f', 7, 64)
	}
	_, err := c.exec(ctx, `appops set 2000 android:mock_location allow && su 2000 sh -c "CLASSPATH=`+toolsRemote+` app_process / Geo `+args+" "+strings.Join(mockProviders, " ")+`"`)
	return err
}

func (c *Controls) legacyLocation(ctx context.Context) bool {
	sdk := c.sdk(ctx)
	return c.toolsDex != "" && sdk > 0 && sdk <= 30
}

// sdk is the device's API level, 0 when it can't be read.
func (c *Controls) sdk(ctx context.Context) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.apiLevel == 0 {
		out, _ := c.dev.Shell(ctx, "getprop ro.build.version.sdk")
		c.apiLevel, _ = strconv.Atoi(strings.TrimSpace(out))
	}
	return c.apiLevel
}

type routeRun struct {
	motion *contract.Motion
	start  time.Time
	cancel context.CancelFunc
}

func (c *Controls) startRoute(ctx context.Context, route contract.GeoRoute) error {
	if len(route.Points) < 2 || route.Speed <= 0 {
		return fmt.Errorf("%w: a route needs two points and a speed", contract.ErrInvalid)
	}
	route.Points = slices.Clone(route.Points)
	if err := c.setGeo(ctx, &route.Points[0]); err != nil {
		return err
	}
	runCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	run := &routeRun{motion: route.Motion(), start: c.now(), cancel: cancel}
	c.mu.Lock()
	c.route, c.geoOverride = run, true
	c.mu.Unlock()
	go c.drive(runCtx, run)
	return nil
}

func (c *Controls) stopRoute() {
	c.mu.Lock()
	run := c.route
	c.route = nil
	c.mu.Unlock()
	if run != nil {
		run.cancel()
	}
}

// drive moves the test providers along the route every routeTick until it is
// stopped or, without loop, reaches its last point.
func (c *Controls) drive(ctx context.Context, run *routeRun) {
	t := time.NewTicker(c.routeTick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		pt, st := run.motion.State(c.now().Sub(run.start).Seconds())
		c.geoMu.Lock()
		if ctx.Err() == nil {
			if err := c.moveGeoRoot(ctx, pt); err != nil {
				_ = c.setGeoRoot(ctx, &pt)
			}
			c.mu.Lock()
			c.geo = &pt
			c.mu.Unlock()
		}
		c.geoMu.Unlock()
		if !st.Moving {
			return
		}
	}
}

func (c *Controls) moveGeoRoot(ctx context.Context, pt contract.GeoPoint) error {
	if c.legacyLocation(ctx) {
		return c.setGeoDex(ctx, &pt)
	}
	loc := strconv.FormatFloat(pt.Latitude, 'f', 7, 64) + "," + strconv.FormatFloat(pt.Longitude, 'f', 7, 64)
	cmds := make([]string, 0, len(mockProviders))
	for _, p := range mockProviders {
		cmds = append(cmds, "cmd location providers set-test-provider-location "+p+" --location "+loc)
	}
	_, err := c.dev.Shell(ctx, strings.Join(cmds, " && "))
	return err
}

// FollowLocation sets the timezone for the active VPN location (unless the
// user has picked one for the session) and
// fakes the GPS to pt (unless the user has overridden it for the session). It
// is applied quietly on a location switch, not as a user setting.
func (c *Controls) FollowLocation(ctx context.Context, pt *contract.GeoPoint, tz string) error {
	c.mu.Lock()
	if tz != "" {
		c.vpnTZ = tz
	}
	tzOverride, override := c.tzOverride, c.geoOverride
	c.mu.Unlock()
	if tz != "" && !tzOverride {
		if err := c.setTimezone(ctx, tz); err != nil {
			return err
		}
	}
	if override || !c.root || pt == nil {
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
	if c.redroid && action == contract.DeviceLock {
		return c.lock(ctx)
	}
	if c.redroid && action == contract.DeviceUnlock {
		return c.unlock(ctx)
	}
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

// redroid builds Android with config_disableLockscreenByDefault, so there is
// no lock screen unless a credential is set. Since Android 12 an overlay
// fabricated from the shell turns that off; Android 11 gets lockPIN instead.
const (
	lockPINCode = "0000"
	lockScript  = `locksettings set-disabled false >/dev/null 2>&1
if cmd overlay list android | grep -q holtdroid_lock || cmd overlay fabricate --target android --name holtdroid_lock android:bool/config_disableLockscreenByDefault 0x12 0 >/dev/null 2>&1; then
  cmd overlay enable --user 0 com.android.shell:holtdroid_lock && sleep 1
else
  locksettings set-pin ` + lockPINCode + ` >/dev/null 2>&1; echo pin
fi
input keyevent KEYCODE_SLEEP && sleep 1 && input keyevent KEYCODE_WAKEUP
for i in 1 2 3; do sleep 1; dumpsys power | grep -q mWakefulness=Awake && break; input keyevent KEYCODE_WAKEUP; done; true`
	unlockPINScript = `input keyevent KEYCODE_WAKEUP && wm dismiss-keyguard && sleep 1
if dumpsys window | grep -q isKeyguardShowing=true; then input text ` + lockPINCode + ` && input keyevent KEYCODE_ENTER && sleep 1; fi
locksettings clear --old ` + lockPINCode + ` >/dev/null 2>&1; true`
)

func (c *Controls) lock(ctx context.Context) error {
	out, err := c.dev.Shell(ctx, lockScript)
	if err != nil {
		return err
	}
	if strings.Contains(out, "pin") {
		c.mu.Lock()
		c.lockPIN = true
		c.mu.Unlock()
	}
	return nil
}

func (c *Controls) unlock(ctx context.Context) error {
	c.mu.Lock()
	pin := c.lockPIN
	c.lockPIN = false
	c.mu.Unlock()
	cmd := deviceKeys[contract.DeviceUnlock]
	if pin {
		cmd = unlockPINScript
	}
	_, err := c.dev.Shell(ctx, cmd)
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
