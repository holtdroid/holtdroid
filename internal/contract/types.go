package contract

import (
	"errors"
	"fmt"
	"slices"
	"time"
)

var (
	ErrNotFound   = errors.New("not found")
	ErrNoCapacity = errors.New("no free slot")
	ErrInvalid    = errors.New("invalid request")
	ErrBusy       = errors.New("busy")
	ErrTooLarge   = errors.New("too large")
)

type Health struct {
	OK bool `json:"ok"`
}

type DisplayKind string

const DisplayScrcpy DisplayKind = "scrcpy"

type Location struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type Capabilities struct {
	Kind            string      `json:"kind"`
	Display         DisplayKind `json:"display" enum:"scrcpy"`
	DevTools        bool        `json:"devtools"`
	Clipboard       bool        `json:"clipboard"`
	Locations       []Location  `json:"locations"`
	DefaultLocation string      `json:"defaultLocation,omitempty"`
	ABIs            []string    `json:"abis"`
	Screens         []Display   `json:"screens,omitempty" doc:"screens a session can be launched with (virtual devices); the first is the default"`
	Versions        []string    `json:"versions,omitempty" doc:"Android versions a session can be launched with (virtual devices), newest first"`
}

// Display is a virtual device's screen: size, density and the emulated
// cutout (none, or one of Android's DisplayCutoutEmulation overlays).
type Display struct {
	ID     string `json:"id" minLength:"1"`
	Label  string `json:"label"`
	Width  int    `json:"width" minimum:"1"`
	Height int    `json:"height" minimum:"1"`
	DPI    int    `json:"dpi" minimum:"1"`
	Cutout string `json:"cutout,omitempty" enum:"none,corner,double,hole,tall,waterfall"`
}

var Cutouts = []string{"none", "corner", "double", "hole", "tall", "waterfall"}

type SlotState string

const (
	SlotFree        SlotState = "free"
	SlotBusy        SlotState = "busy"
	SlotOffline     SlotState = "offline"
	SlotMaintenance SlotState = "maintenance"
)

type Slot struct {
	ID           string            `json:"id"`
	Label        string            `json:"label"`
	State        SlotState         `json:"state" enum:"free,busy,offline,maintenance"`
	Capabilities *SlotCapabilities `json:"capabilities,omitempty" doc:"what this slot's device can do, when it differs from device to device; empty means the provider's capabilities"`
	Maintenance  *Maintenance      `json:"maintenance,omitempty" doc:"set while the slot, or its whole provider, is held for maintenance: no new sessions start on it, a running one keeps going"`
}

type DevToolsScope string

const (
	DevToolsAll        DevToolsScope = "all"
	DevToolsDebuggable DevToolsScope = "debuggable"
)

// SlotCapabilities describe one physical device.
type SlotCapabilities struct {
	Model    string        `json:"model,omitempty"`
	Android  string        `json:"android,omitempty" doc:"Android version, e.g. 15"`
	ABIs     []string      `json:"abis"`
	Root     bool          `json:"root" doc:"the agent has root on the device"`
	DevTools DevToolsScope `json:"devtools" enum:"all,debuggable" doc:"all WebViews, or only those of debuggable builds"`
	ADB      bool          `json:"adb" doc:"ADB tunnels (browser and holtdroid client) are available"`
	Shell    bool          `json:"shell" doc:"ADB runs any shell command, so the Terminal tab is offered; otherwise only the allowlisted commands behind the other tabs"`
	AppData  bool          `json:"appData" doc:"app data can be saved and restored"`
}

type Capacity struct {
	Slots       []Slot       `json:"slots"`
	Maintenance *Maintenance `json:"maintenance,omitempty" doc:"the whole provider is held for maintenance"`
}

func (c Capacity) Free() int {
	n := 0
	for _, s := range c.Slots {
		if s.State == SlotFree {
			n++
		}
	}
	return n
}

// Pick returns the index of the free slot a session goes to: the slot with
// the given ID, or the first free one when id is empty.
func (c Capacity) Pick(id string) (int, error) {
	if id == "" {
		if i := slices.IndexFunc(c.Slots, func(s Slot) bool { return s.State == SlotFree }); i >= 0 {
			return i, nil
		}
		return -1, ErrNoCapacity
	}
	i := slices.IndexFunc(c.Slots, func(s Slot) bool { return s.ID == id })
	switch {
	case i < 0:
		return -1, fmt.Errorf("%w: unknown slot %q", ErrInvalid, id)
	case c.Slots[i].State != SlotFree:
		return -1, ErrNoCapacity
	}
	return i, nil
}

type SessionState string

const (
	StateProvisioning  SessionState = "provisioning"
	StateBooting       SessionState = "booting"
	StateInstalling    SessionState = "installing"
	StateRestoring     SessionState = "restoring"
	StateInstrumenting SessionState = "instrumenting"
	StateReady         SessionState = "ready"
	StateStopping      SessionState = "stopping"
	StateFailed        SessionState = "failed"
)

type CreateSession struct {
	ArtifactURL string          `json:"artifactUrl" format:"uri"`
	ArtifactRef string          `json:"artifactRef" minLength:"1"`
	Package     string          `json:"package" minLength:"1"`
	Owner       string          `json:"owner" minLength:"1"`
	Location    string          `json:"location,omitempty"`
	Slot        string          `json:"slot,omitempty" doc:"run on this slot; empty picks any free one"`
	Screen      string          `json:"screen,omitempty" doc:"one of the provider's screens; empty takes the first"`
	Android     string          `json:"android,omitempty" doc:"one of the provider's Android versions; empty takes the newest"`
	AppData     *AppDataRestore `json:"appData,omitempty" doc:"app data to put back after installing the app and before it first starts"`
}

type AppDataKind string

const (
	AppDataData  AppDataKind = "data"
	AppDataCache AppDataKind = "cache"
)

type AppDataRestore struct {
	URL   string `json:"url" format:"uri" doc:"a zstd-compressed tar from the agent's app data export"`
	Cache bool   `json:"cache" doc:"also restore the cache directories, if the archive has them"`
}

func (r *AppDataRestore) Kind() AppDataKind {
	switch {
	case r == nil:
		return ""
	case r.Cache:
		return AppDataCache
	default:
		return AppDataData
	}
}

// AppDataExport asks the agent to stop the app and stream its private data.
type AppDataExport struct {
	Cache        bool  `json:"cache" doc:"include cache and code_cache"`
	MaxCacheSize int64 `json:"maxCacheSize,omitempty" minimum:"0" doc:"bytes; a bigger cache is left out, 0 means no limit"`
	MaxSize      int64 `json:"maxSize,omitempty" minimum:"0" doc:"bytes; the cache is left out when it would push the archive over this, and data bigger than this is refused; 0 means no limit"`
	Restart      bool  `json:"restart" doc:"start the app again once the archive is written"`
}

// AppDataInfo describes an export before its archive is streamed.
type AppDataInfo struct {
	Size  int64 `json:"size" doc:"bytes on the device, uncompressed"`
	Cache bool  `json:"cache" doc:"the archive includes the cache"`
}

type Session struct {
	ID           string            `json:"id"`
	Slot         string            `json:"slot"`
	Owner        string            `json:"owner"`
	Package      string            `json:"package"`
	ArtifactRef  string            `json:"artifactRef"`
	Location     string            `json:"location,omitempty"`
	AppData      AppDataKind       `json:"appData,omitempty" enum:"data,cache" doc:"the app data restored at launch: data, or data with its cache; empty for a fresh install"`
	State        SessionState      `json:"state" enum:"provisioning,booting,installing,restoring,instrumenting,ready,stopping,failed"`
	Reason       string            `json:"reason,omitempty"`
	Detail       string            `json:"detail,omitempty"`
	Capabilities *SlotCapabilities `json:"capabilities,omitempty" doc:"the capabilities of the slot the session runs on, when the provider reports them per slot"`
	AgentURL     string            `json:"agentUrl"`
	TunnelURL    string            `json:"tunnelUrl,omitempty" doc:"in-cluster base URL of the agent's tunnel endpoints, for the ssh-gateway only"`
	CreatedAt    time.Time         `json:"createdAt"`
	LastActivity time.Time         `json:"lastActivity"`
}

type SessionList struct {
	Items []Session `json:"items"`
}

type Touch struct {
	LastActivity time.Time `json:"lastActivity"`
}

type StatusEvent struct {
	State      SessionState `json:"state" enum:"provisioning,booting,installing,restoring,instrumenting,ready,stopping,failed"`
	Reason     string       `json:"reason,omitempty"`
	Detail     string       `json:"detail,omitempty"`
	AppRunning bool         `json:"appRunning" doc:"The app is running under instrumentation; once it is closed it stays closed until it is started again"`
}

// Install replaces the app in a running session with another build of the
// same package.
type Install struct {
	ArtifactURL string `json:"artifactUrl" format:"uri"`
	ArtifactRef string `json:"artifactRef" minLength:"1"`
	KeepData    bool   `json:"keepData" doc:"Install over the current build, upgrade or downgrade, keeping the app's data; otherwise uninstall it first"`
}

type DevToolsTarget struct {
	Socket      string `json:"socket"`
	PID         int    `json:"pid"`
	Process     string `json:"process"`
	ID          string `json:"id"`
	Type        string `json:"type"`
	Title       string `json:"title"`
	URL         string `json:"url"`
	FrontendRev string `json:"frontendRev"`
}

type DevToolsTargets struct {
	Items []DevToolsTarget `json:"items"`
}

type Clipboard struct {
	Text string `json:"text" maxLength:"65536"`
}

type Vibration struct {
	Usage      string `json:"usage" doc:"VibrationAttributes usage: NOTIFICATION, ALARM, RINGTONE, COMMUNICATION_REQUEST, MEDIA, UNKNOWN, …"`
	Package    string `json:"package,omitempty"`
	DurationMS int64  `json:"durationMs" doc:"0 when the length isn't known yet (a running or repeating pattern)"`
}

type Screen struct {
	On     bool `json:"on" doc:"the display is awake; false while it is off or dozing"`
	Locked bool `json:"locked" doc:"the keyguard is showing"`
}

type Network struct {
	Location   string `json:"location"`
	ExternalIP string `json:"externalIp,omitempty"`
	Country    string `json:"country,omitempty"`
}

type SetLocation struct {
	Location string `json:"location" minLength:"1"`
}

type DeviceAction string

const (
	DeviceVolumeUp      DeviceAction = "volume-up"
	DeviceVolumeDown    DeviceAction = "volume-down"
	DeviceMute          DeviceAction = "mute"
	DeviceScreenOff     DeviceAction = "screen-off"
	DeviceLock          DeviceAction = "lock"
	DeviceUnlock        DeviceAction = "unlock"
	DeviceBack          DeviceAction = "back"
	DeviceHome          DeviceAction = "home"
	DeviceRecents       DeviceAction = "recents"
	DeviceNotifications DeviceAction = "notifications"
	DeviceQuickSettings DeviceAction = "quick-settings"
	DeviceRotateLeft    DeviceAction = "rotate-left"
	DeviceRotateRight   DeviceAction = "rotate-right"
)

// NetworkProfile is an emulated link: speed and latency of a mobile network.
type NetworkProfile string

const (
	NetworkFull  NetworkProfile = "full"
	NetworkLTE   NetworkProfile = "lte"
	NetworkHSDPA NetworkProfile = "hsdpa"
	NetworkUMTS  NetworkProfile = "umts"
	NetworkEDGE  NetworkProfile = "edge"
	NetworkGPRS  NetworkProfile = "gprs"
	NetworkGSM   NetworkProfile = "gsm"
)

type DeviceState struct {
	AirplaneMode       bool           `json:"airplaneMode"`
	WiFi               bool           `json:"wifi"`
	MobileData         bool           `json:"mobileData"`
	BatterySaver       bool           `json:"batterySaver"`
	BatteryLevel       int            `json:"batteryLevel"`
	Charging           bool           `json:"charging"`
	DarkMode           bool           `json:"darkMode"`
	FontScale          float64        `json:"fontScale"`
	Density            int            `json:"density"`
	DefaultDensity     int            `json:"defaultDensity"`
	Rotation           int            `json:"rotation" minimum:"0" maximum:"3"`
	NetworkProfile     NetworkProfile `json:"networkProfile,omitempty" enum:"full,lte,hsdpa,umts,edge,gprs,gsm" doc:"empty when the device can't emulate network conditions"`
	TimeZone           string         `json:"timeZone"`
	Locale             string         `json:"locale"`
	Locales            []string       `json:"locales" doc:"the system languages in order: the first is locale, the rest add their keyboard layouts"`
	LanguageScope      LanguageScope  `json:"languageScope" enum:"system,app" doc:"system: locales are the system languages; app: only the app under test's language can be set (phones without root)"`
	Geo                *GeoPoint      `json:"geo,omitempty" doc:"the faked GPS position; empty while the device reports its default one"`
	GeoOverride        bool           `json:"geoOverride" doc:"the GPS is a session override set by the user; otherwise it follows the VPN location"`
	CanFakeGeo         bool           `json:"canFakeGeo"`
	CanSimulateBattery bool           `json:"canSimulateBattery" doc:"the battery level and charging can be set; battery saver works everywhere"`
	USBNetwork         bool           `json:"usbNetwork" doc:"the device reaches the internet over USB through the host, so Wi-Fi and mobile data are off on purpose"`
	AutoTime           bool           `json:"autoTime"`
	TimeOffset         int64          `json:"timeOffset" doc:"device clock minus real time, in milliseconds"`
}

type LanguageScope string

const (
	LanguageSystem LanguageScope = "system"
	LanguageApp    LanguageScope = "app"
)

type GeoPoint struct {
	Latitude  float64 `json:"latitude" minimum:"-90" maximum:"90"`
	Longitude float64 `json:"longitude" minimum:"-180" maximum:"180"`
}

// DeviceSettings changes the fields that are set and leaves the rest alone.
type DeviceSettings struct {
	AirplaneMode   *bool           `json:"airplaneMode,omitempty"`
	WiFi           *bool           `json:"wifi,omitempty"`
	MobileData     *bool           `json:"mobileData,omitempty"`
	BatterySaver   *bool           `json:"batterySaver,omitempty"`
	BatteryLevel   *int            `json:"batteryLevel,omitempty" minimum:"0" maximum:"100"`
	Charging       *bool           `json:"charging,omitempty"`
	DarkMode       *bool           `json:"darkMode,omitempty"`
	FontScale      *float64        `json:"fontScale,omitempty" minimum:"0.5" maximum:"3"`
	Density        *int            `json:"density,omitempty" minimum:"0" maximum:"1000" doc:"0 restores the default"`
	Rotation       *int            `json:"rotation,omitempty" minimum:"0" maximum:"3"`
	NetworkProfile *NetworkProfile `json:"networkProfile,omitempty" enum:"full,lte,hsdpa,umts,edge,gprs,gsm"`
	TimeZone       *string         `json:"timeZone,omitempty" pattern:"^[A-Za-z][A-Za-z0-9_+/-]*$" maxLength:"64"`
	Locales        []string        `json:"locales,omitempty" minItems:"1" maxItems:"8" doc:"the system languages in order: the first sets the UI language, the rest add their keyboard layouts"`
	Geo            *GeoPoint       `json:"geo,omitempty" doc:"fakes the GPS position"`
	ResetGeo       bool            `json:"resetGeo,omitempty" doc:"puts the default GPS position back"`
	AutoTime       *bool           `json:"autoTime,omitempty" doc:"true syncs the clock with real time and keeps it synced"`
	TimeOffset     *int64          `json:"timeOffset,omitempty" minimum:"-3155760000000" maximum:"3155760000000" doc:"sets the device clock to real time plus this many milliseconds and turns autoTime off"`
}

// Tunnels is what the ssh-gateway and browsers have open into a session right now.
type Tunnels struct {
	ADB     []ADBTunnel     `json:"adb"`
	Reverse []ReverseTunnel `json:"reverse"`
}

type ADBTunnel struct {
	User   string    `json:"user"`
	Client string    `json:"client" enum:"ssh,browser" doc:"ssh: through the ssh-gateway, browser: the portal's own ADB connection"`
	Since  time.Time `json:"since"`
}

type ReverseTunnel struct {
	Port        int       `json:"port" doc:"device port published as localhost:{port}"`
	User        string    `json:"user"`
	Since       time.Time `json:"since"`
	Connections int       `json:"connections" doc:"device-side connections open right now"`
	State       PortState `json:"state" enum:"unknown,up,down" doc:"whether a server answers behind the port on the publisher's machine"`
}

type PortState string

const (
	PortUnknown PortState = "unknown"
	PortUp      PortState = "up"
	PortDown    PortState = "down"
)

// Metrics is one sample of a session's load. Rates are averaged since the
// previous sample; what a device can't measure is left out.
type Metrics struct {
	At       time.Time     `json:"at"`
	Interval float64       `json:"interval" doc:"seconds since the previous sample"`
	Device   DeviceLoad    `json:"device"`
	App      *AppLoad      `json:"app,omitempty" doc:"absent while the app isn't running"`
	Host     *HostLoad     `json:"host,omitempty" doc:"the container the device runs in, for emulators"`
	Thermal  []Temperature `json:"thermal"`
}

type DeviceLoad struct {
	Cores        int     `json:"cores"`
	CPU          float64 `json:"cpu" doc:"percent of all cores"`
	MemoryUsed   int64   `json:"memoryUsed"`
	MemoryTotal  int64   `json:"memoryTotal"`
	StorageUsed  int64   `json:"storageUsed" doc:"bytes used on /data"`
	StorageTotal int64   `json:"storageTotal"`
	RxRate       float64 `json:"rxRate" doc:"bytes per second received, all interfaces but loopback"`
	TxRate       float64 `json:"txRate" doc:"bytes per second sent"`
}

type AppLoad struct {
	Processes []ProcessLoad `json:"processes" doc:"the app's processes and its WebView renderers"`
	FPS       float64       `json:"fps" doc:"frames the app rendered per second; 0 while nothing changes on screen"`
	Jank      float64       `json:"jank" doc:"percent of those frames that missed their deadline"`
}

type ProcessLoad struct {
	PID    int     `json:"pid"`
	Name   string  `json:"name"`
	CPU    float64 `json:"cpu" doc:"percent of all device cores"`
	Memory int64   `json:"memory" doc:"proportional set size in bytes"`
}

type HostLoad struct {
	CPU         float64 `json:"cpu" doc:"cores in use"`
	CPULimit    float64 `json:"cpuLimit" doc:"cores the container may use: its limit, or every core of the node"`
	Throttled   float64 `json:"throttled" doc:"percent of the interval the container was CPU-throttled"`
	MemoryUsed  int64   `json:"memoryUsed" doc:"working set: usage without inactive page cache"`
	MemoryLimit int64   `json:"memoryLimit" doc:"the container's memory limit, or the node's memory"`
}

type TemperatureSource string

const (
	TemperatureDevice TemperatureSource = "device"
	TemperatureHost   TemperatureSource = "host"
)

type Temperature struct {
	Source  TemperatureSource `json:"source" enum:"device,host"`
	Type    string            `json:"type" doc:"cpu, gpu, battery, skin, npu, … or the host's thermal zone type"`
	Name    string            `json:"name" doc:"the sensor, or the host's thermal zone"`
	Celsius float64           `json:"celsius"`
}

type Maintenance struct {
	Reason string    `json:"reason,omitempty"`
	By     string    `json:"by,omitempty" doc:"the admin who set it"`
	Since  time.Time `json:"since"`
}

type SetMaintenance struct {
	Slot    string `json:"slot,omitempty" doc:"one slot; empty holds or releases the whole provider"`
	Enabled bool   `json:"enabled"`
	Reason  string `json:"reason,omitempty" maxLength:"500"`
	By      string `json:"by,omitempty"`
}

// MaintenanceState is what a provider keeps of its maintenance holds.
type MaintenanceState struct {
	Provider *Maintenance           `json:"provider,omitempty"`
	Slots    map[string]Maintenance `json:"slots,omitempty"`
}

func (m *MaintenanceState) Set(req SetMaintenance, now time.Time) {
	hold := Maintenance{Reason: req.Reason, By: req.By, Since: now.UTC()}
	switch {
	case req.Slot == "" && req.Enabled:
		m.Provider = &hold
	case req.Slot == "":
		m.Provider = nil
	case req.Enabled:
		if m.Slots == nil {
			m.Slots = map[string]Maintenance{}
		}
		m.Slots[req.Slot] = hold
	default:
		delete(m.Slots, req.Slot)
	}
}

// Apply marks the held slots: a slot's own hold wins over the provider's,
// and a busy slot stays busy until its session ends.
func (m MaintenanceState) Apply(c *Capacity) {
	c.Maintenance = m.Provider
	for i := range c.Slots {
		s := &c.Slots[i]
		if hold, ok := m.Slots[s.ID]; ok {
			s.Maintenance = &hold
		} else {
			s.Maintenance = m.Provider
		}
		if s.Maintenance != nil && s.State != SlotBusy {
			s.State = SlotMaintenance
		}
	}
}

type Inventory struct {
	Maintenance *Maintenance      `json:"maintenance,omitempty" doc:"the whole provider is held for maintenance"`
	Host        *HostInfo         `json:"host,omitempty" doc:"the machine the provider runs on, when its devices hang off it (phones over USB)"`
	Devices     []InventoryDevice `json:"devices"`
}

type InventoryDevice struct {
	Slot    Slot        `json:"slot"`
	Session string      `json:"session,omitempty" doc:"the session running on it"`
	Device  *DeviceInfo `json:"device,omitempty" doc:"the Android device, when it can be asked between sessions (phones, fake devices)"`
	Host    *HostInfo   `json:"host,omitempty" doc:"the machine the slot is (emulator nodes)"`
	Error   string      `json:"error,omitempty" doc:"why some details are missing"`
}

type DeviceInfo struct {
	Manufacturer  string        `json:"manufacturer,omitempty"`
	Model         string        `json:"model,omitempty"`
	Device        string        `json:"device,omitempty" doc:"the product's code name"`
	Android       string        `json:"android,omitempty"`
	SDK           int           `json:"sdk,omitempty"`
	Build         string        `json:"build,omitempty"`
	SecurityPatch string        `json:"securityPatch,omitempty"`
	ABIs          []string      `json:"abis"`
	Cores         int           `json:"cores,omitempty"`
	MemoryTotal   int64         `json:"memoryTotal,omitempty"`
	StorageUsed   int64         `json:"storageUsed,omitempty" doc:"bytes used on /data"`
	StorageTotal  int64         `json:"storageTotal,omitempty"`
	Uptime        float64       `json:"uptime,omitempty" doc:"seconds since boot"`
	Battery       *Battery      `json:"battery,omitempty"`
	Thermal       []Temperature `json:"thermal"`
}

type Battery struct {
	Level   int     `json:"level" doc:"percent"`
	Status  string  `json:"status" enum:"unknown,charging,discharging,not-charging,full"`
	Health  string  `json:"health" enum:"unknown,good,overheat,dead,over-voltage,failure,cold"`
	Plugged string  `json:"plugged,omitempty" enum:"ac,usb,wireless,dock"`
	Celsius float64 `json:"celsius"`
	Voltage float64 `json:"voltage,omitempty" doc:"volts"`
}

type HostInfo struct {
	Hostname        string        `json:"hostname,omitempty"`
	OS              string        `json:"os,omitempty"`
	Kernel          string        `json:"kernel,omitempty"`
	Arch            string        `json:"arch,omitempty"`
	CPU             string        `json:"cpu,omitempty" doc:"the CPU model"`
	Cores           int           `json:"cores,omitempty"`
	MemoryTotal     int64         `json:"memoryTotal,omitempty"`
	MemoryAvailable int64         `json:"memoryAvailable,omitempty"`
	Load1           float64       `json:"load1"`
	Load5           float64       `json:"load5"`
	Load15          float64       `json:"load15"`
	Uptime          float64       `json:"uptime,omitempty" doc:"seconds since boot"`
	Runtime         string        `json:"runtime,omitempty" doc:"the container runtime, for Kubernetes nodes"`
	Kubelet         string        `json:"kubelet,omitempty"`
	Conditions      []string      `json:"conditions" doc:"problems the node reports: NotReady, MemoryPressure, DiskPressure, PIDPressure, Unschedulable, …"`
	Thermal         []Temperature `json:"thermal" doc:"thermal zones and hwmon sensors"`
}
