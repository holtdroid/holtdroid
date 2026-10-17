package contract

import (
	"errors"
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
}

type SlotState string

const (
	SlotFree    SlotState = "free"
	SlotBusy    SlotState = "busy"
	SlotOffline SlotState = "offline"
)

type Slot struct {
	ID    string    `json:"id"`
	Label string    `json:"label"`
	State SlotState `json:"state" enum:"free,busy,offline"`
}

type Capacity struct {
	Slots []Slot `json:"slots"`
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
	ID           string       `json:"id"`
	Slot         string       `json:"slot"`
	Owner        string       `json:"owner"`
	Package      string       `json:"package"`
	ArtifactRef  string       `json:"artifactRef"`
	Location     string       `json:"location,omitempty"`
	AppData      AppDataKind  `json:"appData,omitempty" enum:"data,cache" doc:"the app data restored at launch: data, or data with its cache; empty for a fresh install"`
	State        SessionState `json:"state" enum:"provisioning,booting,installing,restoring,instrumenting,ready,stopping,failed"`
	Reason       string       `json:"reason,omitempty"`
	Detail       string       `json:"detail,omitempty"`
	AgentURL     string       `json:"agentUrl"`
	TunnelURL    string       `json:"tunnelUrl,omitempty" doc:"in-cluster base URL of the agent's tunnel endpoints, for the ssh-gateway only"`
	CreatedAt    time.Time    `json:"createdAt"`
	LastActivity time.Time    `json:"lastActivity"`
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
	AirplaneMode   bool           `json:"airplaneMode"`
	WiFi           bool           `json:"wifi"`
	MobileData     bool           `json:"mobileData"`
	BatterySaver   bool           `json:"batterySaver"`
	BatteryLevel   int            `json:"batteryLevel"`
	Charging       bool           `json:"charging"`
	DarkMode       bool           `json:"darkMode"`
	FontScale      float64        `json:"fontScale"`
	Density        int            `json:"density"`
	DefaultDensity int            `json:"defaultDensity"`
	Rotation       int            `json:"rotation" minimum:"0" maximum:"3"`
	NetworkProfile NetworkProfile `json:"networkProfile,omitempty" enum:"full,lte,hsdpa,umts,edge,gprs,gsm" doc:"empty when the device can't emulate network conditions"`
	TimeZone       string         `json:"timeZone"`
	Locale         string         `json:"locale"`
	Locales        []string       `json:"locales" doc:"the system languages in order: the first is locale, the rest add their keyboard layouts"`
	Geo            *GeoPoint      `json:"geo,omitempty" doc:"the faked GPS position; empty while the device reports its default one"`
	CanFakeGeo     bool           `json:"canFakeGeo"`
	AutoTime       bool           `json:"autoTime"`
	TimeOffset     int64          `json:"timeOffset" doc:"device clock minus real time, in milliseconds"`
}

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
