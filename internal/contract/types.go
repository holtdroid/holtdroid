package contract

import (
	"errors"
	"time"
)

var (
	ErrNotFound   = errors.New("not found")
	ErrNoCapacity = errors.New("no free slot")
	ErrInvalid    = errors.New("invalid request")
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
	StateInstrumenting SessionState = "instrumenting"
	StateReady         SessionState = "ready"
	StateStopping      SessionState = "stopping"
	StateFailed        SessionState = "failed"
)

type CreateSession struct {
	ArtifactURL string `json:"artifactUrl" format:"uri"`
	ArtifactRef string `json:"artifactRef" minLength:"1"`
	Package     string `json:"package" minLength:"1"`
	Owner       string `json:"owner" minLength:"1"`
	Location    string `json:"location,omitempty"`
}

type Session struct {
	ID           string       `json:"id"`
	Slot         string       `json:"slot"`
	Owner        string       `json:"owner"`
	Package      string       `json:"package"`
	ArtifactRef  string       `json:"artifactRef"`
	Location     string       `json:"location,omitempty"`
	State        SessionState `json:"state" enum:"provisioning,booting,installing,instrumenting,ready,stopping,failed"`
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
	State      SessionState `json:"state" enum:"provisioning,booting,installing,instrumenting,ready,stopping,failed"`
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
	AutoTime       bool           `json:"autoTime"`
	TimeOffset     int64          `json:"timeOffset" doc:"device clock minus real time, in milliseconds"`
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
	Locale         *string         `json:"locale,omitempty" pattern:"^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{1,8})*$" maxLength:"35"`
	AutoTime       *bool           `json:"autoTime,omitempty" doc:"true syncs the clock with real time and keeps it synced"`
	TimeOffset     *int64          `json:"timeOffset,omitempty" minimum:"-3155760000000" maximum:"3155760000000" doc:"sets the device clock to real time plus this many milliseconds and turns autoTime off"`
}

// Tunnels is what the ssh-gateway has open into a session right now.
type Tunnels struct {
	ADB     []ADBTunnel     `json:"adb"`
	Reverse []ReverseTunnel `json:"reverse"`
}

type ADBTunnel struct {
	User  string    `json:"user"`
	Since time.Time `json:"since"`
}

type ReverseTunnel struct {
	Port        int       `json:"port" doc:"device port published as localhost:{port}"`
	User        string    `json:"user"`
	Since       time.Time `json:"since"`
	Connections int       `json:"connections" doc:"device-side connections open right now"`
}
