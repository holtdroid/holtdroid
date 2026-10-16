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

type Artifact struct {
	ID         string    `json:"id"`
	FileName   string    `json:"fileName"`
	Size       int64     `json:"size"`
	UploadedAt time.Time `json:"uploadedAt"`
	UploadedBy string    `json:"uploadedBy,omitempty"`
	Note       string    `json:"note,omitempty"`
	Link       string    `json:"link,omitempty"`
}

type ArtifactPage struct {
	Items      []Artifact `json:"items"`
	NextCursor string     `json:"nextCursor,omitempty"`
}

type DisplayKind string

const (
	DisplayNoVNC  DisplayKind = "novnc"
	DisplayScrcpy DisplayKind = "scrcpy"
)

type Location struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type Capabilities struct {
	Kind      string      `json:"kind"`
	Display   DisplayKind `json:"display" enum:"novnc,scrcpy"`
	DevTools  bool        `json:"devtools"`
	Clipboard bool        `json:"clipboard"`
	Locations []Location  `json:"locations"`
	ABIs      []string    `json:"abis"`
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
	AgentURL     string       `json:"agentUrl"`
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
	State  SessionState `json:"state" enum:"provisioning,booting,installing,instrumenting,ready,stopping,failed"`
	Reason string       `json:"reason,omitempty"`
	Detail string       `json:"detail,omitempty"`
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
	Text string `json:"text" maxLength:"1048576"`
}

type Network struct {
	Location   string `json:"location"`
	ExternalIP string `json:"externalIp,omitempty"`
	Country    string `json:"country,omitempty"`
}

type SetLocation struct {
	Location string `json:"location" minLength:"1"`
}
