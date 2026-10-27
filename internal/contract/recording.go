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
	Audio     []RecordingAudio `json:"audio" doc:"the sound, apart from the video: its own epochs and segments, on the same clock"`
	Events    []RecordingChunk `json:"events" doc:"gzipped JSON lines of RecordingEvent"`
	Logcat    []RecordingChunk `json:"logcat" doc:"gzipped text: the recording time (HH:MM:SS.mmm), two spaces, a logcat threadtime line"`
	DevTools  []RecordingChunk `json:"devtools" doc:"gzipped JSON lines of DevToolsEntry: the WebViews' network, console and WebSockets"`
	Thumbnail string           `json:"thumbnail,omitempty"`
}

type RecordingEpoch struct {
	Init     string             `json:"init"`
	Codec    string             `json:"codec" doc:"RFC 6381, e.g. avc1.640028"`
	Width    int                `json:"width"`
	Height   int                `json:"height"`
	Segments []RecordingSegment `json:"segments"`
}

// RecordingAudio is a run of Opus or AAC sound: an init file and segments of packets,
// which can all be decoded on their own. It starts again when the capture does.
type RecordingAudio struct {
	Init     string             `json:"init"`
	Codec    string             `json:"codec" enum:"opus,aac"`
	Channels int                `json:"channels"`
	Rate     int                `json:"rate" doc:"samples per second"`
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
	EventDNS     RecordingEventType = "dns"
)

// RecordingEvent is one line of a recording's events: T is milliseconds
// since the recording started, and exactly one of the payloads is set.
type RecordingEvent struct {
	T       int64              `json:"t"`
	Type    RecordingEventType `json:"type" enum:"info,status,metrics,device,network,touch,key,dns"`
	Info    *RecordingInfoData `json:"info,omitempty"`
	Status  *StatusEvent       `json:"status,omitempty"`
	Metrics *Metrics           `json:"metrics,omitempty"`
	Device  *DeviceState       `json:"device,omitempty"`
	Network *Network           `json:"network,omitempty"`
	Touch   *RecordingTouch    `json:"touch,omitempty"`
	DNS     *DNSEvent          `json:"dns,omitempty"`
	Key     string             `json:"key,omitempty" enum:"back,home,recents,notifications,quick-settings,volume-up,volume-down,mute,screen-off,lock,unlock,rotate-left,rotate-right" doc:"a device button pressed in the portal (DeviceAction); typed text is never recorded"`
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

var recordingFile = regexp.MustCompile(`^(manifest\.json|thumb\.jpg|a?init-[0-9]{1,6}\.mp4|a?seg-[0-9]{1,7}\.m4s|events-[0-9]{1,6}\.jsonl\.gz|logcat-[0-9]{1,6}\.log\.gz|devtools-[0-9]{1,6}\.jsonl\.gz)$`)

// RecordingFile reports whether name is a file an agent may upload.
func RecordingFile(name string) bool { return recordingFile.MatchString(name) }

type DevToolsEntryType string

const (
	DevToolsPageEntry    DevToolsEntryType = "page"
	DevToolsRequestEntry DevToolsEntryType = "request"
	DevToolsConsoleEntry DevToolsEntryType = "console"
	DevToolsSocketEntry  DevToolsEntryType = "socket"
	DevToolsFrameEntry   DevToolsEntryType = "frame"
	DevToolsDroppedEntry DevToolsEntryType = "dropped"
)

// DevToolsEntry is one line of a recording's devtools files, written by the
// agent's own CDP client to every WebView page. T is milliseconds since the
// recording started, and exactly one of the payloads is set. A request is
// written once it ends (or when the recording does), with the times of its
// stages; a WebSocket's state and each of its frames get lines of their own.
type DevToolsEntry struct {
	T       int64             `json:"t"`
	Type    DevToolsEntryType `json:"type" enum:"page,request,console,socket,frame,dropped"`
	Target  string            `json:"target,omitempty" doc:"the DevTools target (page) it came from"`
	Page    *DevToolsPage     `json:"page,omitempty"`
	Request *DevToolsRequest  `json:"request,omitempty"`
	Console *DevToolsConsole  `json:"console,omitempty"`
	Socket  *DevToolsSocket   `json:"socket,omitempty"`
	Frame   *DevToolsFrame    `json:"frame,omitempty"`
	Dropped int               `json:"dropped,omitempty" doc:"lines left out because one upload got too big"`
	Wall    int64             `json:"wall,omitempty" doc:"live stream only: the agent's clock, milliseconds since the epoch; t is then the recording time, or 0 without a recording"`
	Rec     string            `json:"recording,omitempty" doc:"live stream only: the recording t belongs to"`
	Seq     int64             `json:"seq,omitempty" doc:"live stream only: the line's number since the agent started; lines the stream repeats to describe what is open now have none"`
}

// DevToolsPage is a target the agent follows: a tab, an iframe in its own
// process, or a worker.
type DevToolsPage struct {
	Type    string `json:"type,omitempty" enum:"page,iframe,worker,shared_worker,service_worker" doc:"none in recordings made before it was recorded, which are pages"`
	Parent  string `json:"parent,omitempty" doc:"the target it belongs to: the page of an iframe or a dedicated worker"`
	Process string `json:"process,omitempty"`
	Title   string `json:"title,omitempty"`
	URL     string `json:"url,omitempty"`
	Closed  bool   `json:"closed,omitempty"`
}

type DevToolsRequest struct {
	ID                string            `json:"id"`
	Start             int64             `json:"start" doc:"recording time it was sent"`
	Response          int64             `json:"response,omitempty" doc:"recording time its response headers came"`
	End               int64             `json:"end,omitempty" doc:"recording time it finished or failed; none if it was still loading when the recording ended"`
	Wall              int64             `json:"wall,omitempty" doc:"the device clock when it was sent, milliseconds since the epoch"`
	Method            string            `json:"method"`
	URL               string            `json:"url"`
	ResourceType      string            `json:"resourceType,omitempty" doc:"Document, XHR, Fetch, Script, Image, …"`
	RequestHeaders    map[string]string `json:"requestHeaders,omitempty"`
	PostData          string            `json:"postData,omitempty"`
	PostDataTruncated bool              `json:"postDataTruncated,omitempty"`
	Status            int               `json:"status,omitempty"`
	StatusText        string            `json:"statusText,omitempty"`
	ResponseHeaders   map[string]string `json:"responseHeaders,omitempty"`
	MimeType          string            `json:"mimeType,omitempty"`
	Protocol          string            `json:"protocol,omitempty"`
	RemoteAddress     string            `json:"remoteAddress,omitempty"`
	Cached            string            `json:"cached,omitempty" enum:"memory,disk,service-worker,prefetch"`
	Size              int64             `json:"size,omitempty" doc:"bytes on the wire"`
	Body              string            `json:"body,omitempty"`
	BodyBase64        bool              `json:"bodyBase64,omitempty"`
	BodyTruncated     bool              `json:"bodyTruncated,omitempty"`
	BodySkipped       string            `json:"bodySkipped,omitempty" enum:"type,size,unavailable" doc:"why there is no body: a media, font, image, script or style resource, too big, or the WebView had none"`
	Redirect          string            `json:"redirect,omitempty" doc:"the URL it was redirected to"`
	Error             string            `json:"error,omitempty"`
	Canceled          bool              `json:"canceled,omitempty"`
	Timing            *DevToolsTiming   `json:"timing,omitempty"`
}

// DevToolsTiming is how long each stage of a request took, in milliseconds,
// -1 for a stage it didn't have (HAR's timings).
type DevToolsTiming struct {
	Blocked float64 `json:"blocked"`
	DNS     float64 `json:"dns"`
	Connect float64 `json:"connect" doc:"includes ssl"`
	SSL     float64 `json:"ssl"`
	Send    float64 `json:"send"`
	Wait    float64 `json:"wait"`
	Receive float64 `json:"receive"`
}

type DevToolsConsole struct {
	Source string          `json:"source" enum:"console,exception,browser" doc:"the page's console API, an uncaught exception, or the browser itself (network errors, violations, …)"`
	Level  string          `json:"level" enum:"debug,info,warning,error"`
	Kind   string          `json:"kind,omitempty" doc:"the console call (log, table, assert, …) or the browser's source (network, violation, …)"`
	Text   string          `json:"text"`
	Args   []DevToolsValue `json:"args,omitempty"`
	URL    string          `json:"url,omitempty"`
	Line   int             `json:"line,omitempty"`
	Column int             `json:"column,omitempty"`
	Stack  string          `json:"stack,omitempty"`
	Wall   int64           `json:"wall,omitempty" doc:"the device clock, milliseconds since the epoch"`
}

type DevToolsValue struct {
	Type    string `json:"type" doc:"string, number, boolean, undefined, object, function, symbol or bigint"`
	Subtype string `json:"subtype,omitempty" doc:"null, array, error, date, …"`
	Text    string `json:"text" doc:"a string's value, or what DevTools shows for it"`
	JSON    string `json:"json,omitempty" doc:"the value as JSON when it has one, cut at 64 KB"`
}

type DevToolsSocket struct {
	ID     string `json:"id"`
	URL    string `json:"url"`
	State  string `json:"state" enum:"connecting,open,closed,error,stream" doc:"stream: its traffic looks like video or another media stream, so no more frames are recorded"`
	Status int    `json:"status,omitempty" doc:"the handshake's HTTP status"`
	Error  string `json:"error,omitempty"`
	Frames int    `json:"frames,omitempty" doc:"frames so far, recorded or not"`
	Bytes  int64  `json:"bytes,omitempty"`
}

type DevToolsFrame struct {
	Socket    string `json:"socket"`
	Sent      bool   `json:"sent,omitempty"`
	Opcode    int    `json:"opcode" doc:"1 text, 2 binary"`
	Size      int    `json:"size" doc:"payload bytes"`
	Data      string `json:"data,omitempty" doc:"the text, or base64 of a binary payload, cut at the limit"`
	Truncated bool   `json:"truncated,omitempty"`
}
