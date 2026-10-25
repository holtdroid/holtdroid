package contract

import (
	"regexp"
	"time"
)

// RecordingTarget tells an agent where to upload a recording: every file is
// PUT to URL + "/" + its name, the manifest last.
type RecordingTarget struct {
	ID  string `json:"id" pattern:"^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{24}$"`
	URL string `json:"url" format:"uri"`
}

type RecordingStatus string

const (
	RecordingActive      RecordingStatus = "recording"
	RecordingDone        RecordingStatus = "done"
	RecordingFailed      RecordingStatus = "failed"
	RecordingInterrupted RecordingStatus = "interrupted"
)

// RecordingState is the agent's recorder: Active while it records ID.
type RecordingState struct {
	Active    bool      `json:"active"`
	ID        string    `json:"id,omitempty"`
	StartedAt time.Time `json:"startedAt,omitzero"`
	Duration  int64     `json:"duration" doc:"milliseconds recorded"`
	Size      int64     `json:"size" doc:"bytes uploaded"`
	Error     string    `json:"error,omitempty" doc:"why the last recording stopped on its own"`
}

// RecordingManifest lists a recording's files. Times are milliseconds since
// StartedAt. The video is fragmented MP4: one init file per epoch (the
// stream's codec, size or rotation changed) and segments that end at a key
// frame, or after a time or size limit when key frames are rare; a segment
// without Key decodes only after the ones before it back to one with Key.
type RecordingManifest struct {
	State     RecordingStatus  `json:"state" enum:"recording,done,failed,interrupted"`
	Reason    string           `json:"reason,omitempty"`
	StartedAt time.Time        `json:"startedAt"`
	UpdatedAt time.Time        `json:"updatedAt"`
	Duration  int64            `json:"duration"`
	Size      int64            `json:"size" doc:"bytes of every file but the manifest"`
	Epochs    []RecordingEpoch `json:"epochs"`
	Events    []RecordingChunk `json:"events" doc:"gzipped JSON lines of RecordingEvent"`
	Logcat    []RecordingChunk `json:"logcat" doc:"gzipped text: the recording time (HH:MM:SS.mmm), two spaces, a logcat threadtime line"`
	Thumbnail string           `json:"thumbnail,omitempty"`
}

type RecordingEpoch struct {
	Init     string             `json:"init"`
	Codec    string             `json:"codec" doc:"RFC 6381, e.g. avc1.640028"`
	Width    int                `json:"width"`
	Height   int                `json:"height"`
	Segments []RecordingSegment `json:"segments"`
}

type RecordingSegment struct {
	File     string `json:"file"`
	Start    int64  `json:"start"`
	Duration int64  `json:"duration"`
	Size     int64  `json:"size"`
	Key      bool   `json:"key" doc:"starts with a key frame"`
}

type RecordingChunk struct {
	File  string `json:"file"`
	Start int64  `json:"start"`
	End   int64  `json:"end"`
	Size  int64  `json:"size"`
	Lines int    `json:"lines,omitempty"`
}

type RecordingEventType string

const (
	EventInfo    RecordingEventType = "info"
	EventStatus  RecordingEventType = "status"
	EventMetrics RecordingEventType = "metrics"
	EventDevice  RecordingEventType = "device"
	EventNetwork RecordingEventType = "network"
	EventTouch   RecordingEventType = "touch"
	EventKey     RecordingEventType = "key"
)

// RecordingEvent is one line of a recording's events: T is milliseconds
// since the recording started, and exactly one of the payloads is set.
type RecordingEvent struct {
	T       int64              `json:"t"`
	Type    RecordingEventType `json:"type" enum:"info,status,metrics,device,network,touch,key"`
	Info    *RecordingInfoData `json:"info,omitempty"`
	Status  *StatusEvent       `json:"status,omitempty"`
	Metrics *Metrics           `json:"metrics,omitempty"`
	Device  *DeviceState       `json:"device,omitempty"`
	Network *Network           `json:"network,omitempty"`
	Touch   *RecordingTouch    `json:"touch,omitempty"`
	Key     string             `json:"key,omitempty" enum:"back,home,recents" doc:"a navigation key pressed in the portal; typed text is never recorded"`
}

type TouchAction string

const (
	TouchDown TouchAction = "down"
	TouchMove TouchAction = "move"
	TouchUp   TouchAction = "up"
)

// RecordingTouch is a finger (or the mouse) on the screen the viewer
// controls, with a position of 0 to 1 across and down the screen.
type RecordingTouch struct {
	Action  TouchAction `json:"action" enum:"down,move,up"`
	Pointer int         `json:"pointer" doc:"0 for the mouse, else the finger's number"`
	X       float64     `json:"x" minimum:"0" maximum:"1"`
	Y       float64     `json:"y" minimum:"0" maximum:"1"`
}

// RecordingInfoData is what the device says about itself and the app.
type RecordingInfoData struct {
	Manufacturer string `json:"manufacturer,omitempty"`
	Model        string `json:"model,omitempty"`
	Android      string `json:"android,omitempty"`
	SDK          int    `json:"sdk,omitempty"`
	Build        string `json:"build,omitempty"`
	ABI          string `json:"abi,omitempty"`
	WebView      string `json:"webview,omitempty" doc:"the WebView provider's package and version"`
	Package      string `json:"package,omitempty"`
	VersionName  string `json:"versionName,omitempty"`
	VersionCode  int64  `json:"versionCode,omitempty"`
	ArtifactRef  string `json:"artifactRef,omitempty"`
}

var recordingFile = regexp.MustCompile(`^(manifest\.json|thumb\.jpg|init-[0-9]{1,6}\.mp4|seg-[0-9]{1,7}\.m4s|events-[0-9]{1,6}\.jsonl\.gz|logcat-[0-9]{1,6}\.log\.gz)$`)

// RecordingFile reports whether name is a file an agent may upload.
func RecordingFile(name string) bool { return recordingFile.MatchString(name) }
