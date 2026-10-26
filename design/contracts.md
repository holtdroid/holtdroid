# Contracts

All inter-service APIs are JSON over HTTP, defined once in
`internal/contract` as Go interfaces + huma operations:

| Contract | Interface | Server registration | Go client |
|----------|-----------|---------------------|-----------|
| Provider | `contract.Provider` | `contract.RegisterProvider(api, impl)` | `contract.NewProviderClient(url, hc)` |
| Agent | `contract.Agent` | `contract.RegisterAgent(api, impl)` | `contract.NewAgentClient(url, hc)` — only `Status`, for providers; browsers go through the api proxy |

The api works against the interfaces, so an in-process implementation (as
`holtdroid dev` does) and an HTTP client are interchangeable. Huma generates
OpenAPI from the same types: `holtdroid openapi api` (UI API) and
`holtdroid openapi agent` (Agent API) feed the generated TypeScript clients.
Round-trip tests (`internal/contract/contract_test.go`) run each built-in
implementation through a real HTTP server and client; a reusable conformance
package for third-party implementations is on the roadmap.

Conventions:
- Times are RFC 3339 UTC. IDs are opaque strings.
- Errors use huma's RFC 9457 problem details.
- Streams are SSE (`text/event-stream`) with a named `event:` per message.
- Internal endpoints are served on a separate port from anything user-facing
  where a service has both.
- Requests carry W3C trace context (`traceparent`): the Go clients inject it
  and every service continues it (decision #44). Implementations in other
  languages should do the same; it is harmless to ignore.
- Every service may serve Prometheus metrics on its own port
  (`telemetry.metrics.listen`), never on a contract port.

## Artifact sources (file layout)

Builds are not served through an API: a source is a directory or an S3
bucket/prefix that the api lists itself (`internal/source`, decisions.md
#27). The contract for anything that publishes builds (a Slack sync, CI) is
the layout:

- every `*.apk` (any depth, case-insensitive) is an artifact; hidden files
  and directories are ignored;
- next to `x.apk` an optional `x.apk.meta.json`, written **before** the APK
  when owner or visibility matter;
- next to `x.apk` an optional `x.apk.icon.png`, also written **before** the
  APK. It may be PNG, JPEG or WebP data, up to 4 MiB and 4096 px per side.
  The api decodes it, re-renders it as a 256 px PNG, and uses it instead of
  the icon it extracts from the APK. An icon that can't be decoded is
  ignored;
- replacing a file in place is fine: its revision (ETag, else size + mtime)
  changes and the api treats it as a new build.

A source may carry `include` rules (`internal/rules`, gitignore style:
`/a/*` is anchored, a bare `*.apk` matches names at any depth, `**` spans
directories, a pattern that matches a directory matches everything below
it, `!` excludes, the last match wins, and a list that starts with `!` starts
from everything). Keys are relative to the source root. Excluded keys are
neither listed nor launchable. Sync jobs that filter (holtdroid-s3-sync,
holtdroid-github-sync) use the same syntax.

An S3 source may get temporary keys from a **credentials endpoint**
(`s3.credentialsURL`) instead of `accessKey`/`secretKey`. The endpoint is a
`GET` that returns the ECS container credentials document
`{"AccessKeyId", "SecretAccessKey", "Token", "Expiration"}`; the
`Authorization` header carries `s3.credentialsToken` when it is set. The api
fetches new keys a minute before `Expiration`, and any status other than 200
is a listing error for that source.
The broker of the `s3` job in
[holtdroid/holtdroid-sync](https://github.com/holtdroid/holtdroid-sync)
implements it on top of AWS IAM Identity Center.

Sync jobs announce builds with a **launch link**:
`{publicURL}/?source={source}&launch={id}`, `id` = base64url (no padding)
of the key inside the source — the same ID the UI API uses
(`GET /api/v1/artifacts/{source}/{id}`). The home page opens the launch
dialog for it; with `&quick=1` it starts a session right away on the
last-used provider and location and falls back to the dialog. The sync jobs live in their own repository,
[holtdroid/holtdroid-sync](https://github.com/holtdroid/holtdroid-sync)
(decisions #30, #43).

```go
type Meta struct { // x.apk.meta.json; every field optional, unknown ones ignored
	Title      string            // display name instead of the APK label
	Note       string            // short description, e.g. the Slack message text
	Changelog  string            // plain text / Markdown
	UploadedBy string            // display name
	UploadedAt time.Time         // RFC 3339; default: the file's mtime
	Link       string            // back to the origin (message, pipeline)
	Origin     string            // "slack", "ci", "upload", …
	Tags       map[string]string // branch, commit, flavor, …
	Owner      string            // portal user ID allowed to manage it
	Visibility string            // "public" (default) | "private"
}
```

Config (api):

```yaml
sources:                    # default: one filesystem source "local" at /var/lib/holtdroid/apks
  - name: slack             # [a-z0-9][a-z0-9_-]*
    type: s3                # filesystem | s3, options as in storage
    s3: { endpoint: …, bucket: apks, prefix: slack, accessKey: env:…, secretKey: env:… }
    readOnly: true          # no deletes/visibility changes through the portal
    pollInterval: 30s
uploads:
  enabled: true
  source: ""                # default: the first source; must not be readOnly
  prefix: uploads
  maxSize: 1GiB
  temporaryTTL: 168h        # temporary uploads are deleted this long after their last launch
downloads:
  adminOnly: false          # true: only admins may download APKs from the UI
```

The api parses APKs itself (`internal/apk`: package, versionName,
versionCode, label, icon, ABIs, minSdk) and caches file and metadata keyed by
`hash(source, key, revision)`.

## Provider API

Implemented by `provider-*` services. Consumed only by the api.

| Method | Path | Body / Response |
|--------|------|-----------------|
| `GET` | `/v1/capabilities` | `Capabilities` |
| `GET` | `/v1/capacity` | `{slots: Slot[], maintenance?}` |
| `GET` | `/v1/sessions` | `{items: Session[]}` |
| `POST` | `/v1/sessions` | `CreateSession` → `Session` |
| `GET` | `/v1/sessions/{id}` | `Session` |
| `DELETE` | `/v1/sessions/{id}` | 204 |
| `POST` | `/v1/sessions/{id}/touch` | `{lastActivity}` → 204 |
| `POST` | `/v1/sessions/{id}/install` | `Install` `{artifactUrl, artifactRef, keepData}` → `Session`; only for a `ready` session (400 otherwise); hands the build to the agent's `/v1/install` and, once it runs, records `artifactRef` as the session's artifact. A failed install (400 with the adb message) keeps the recorded one |
| `GET` | `/v1/inventory` | `Inventory`: every slot with its session and what the provider knows about the device or machine behind it |
| `PUT` | `/v1/maintenance` | `SetMaintenance` → 204; holds a slot (or, without `slot`, the whole provider) for maintenance or releases it; 400 for an unknown slot |
| `GET` | `/v1/health` | `{ok: true}` |

```go
type Capabilities struct {
	Kind      string     // "emulator", "physical", …
	Display   string     // "scrcpy"
	DevTools  bool
	Clipboard bool
	Locations []Location // empty when VPN is not supported/configured
	DefaultLocation string // where a session starts when CreateSession has no location
	ABIs      []string   // what the device can run, incl. translated ABIs
	Screens   []Display  // optional (virtual devices): screens a launch may pick; the first is the default (decision #83)
	Versions  []string   // optional (virtual devices): Android versions a launch may pick, newest first
	WebView   bool       // a launch may install a WebView build from the api's catalog over the built-in one (decision #88)
}

type Display struct {
	ID     string // "hd", "pixel-6a"
	Brand  string // a real device's maker; empty for a generic screen (decision #89)
	Label  string // "HD+", "Pixel 6a"
	Like   string // phones with this screen: "Galaxy A05, Redmi 13C"
	Width  int
	Height int
	DPI    int
	Radius float64      // display corner radius in dp
	Cutout string       // "none" | "corner" | "double" | "hole" | "tall" | "waterfall": the Android overlay that gives apps the insets; derived from Shape when empty
	Shape  *CutoutShape // what the UI draws over the stream; derived from Cutout when empty
}

type CutoutShape struct {
	Kind   string  // "circle" | "pill" | "drop" | "notch"
	Align  string  // "left" | "center" | "right"; center when empty
	Offset float64 // dp from the left or right edge to the shape's center
	Top    float64 // dp from the top edge to the shape's top
	Width  float64 // dp
	Height float64 // dp; defaults to Width
}

type Location struct {
	ID    string // "pl", "ua", "direct"
	Label string // "Poland"
}

type Slot struct {
	ID           string // node name for emulators, device serial for phones
	Label        string
	State        string // "free" | "busy" | "offline" | "maintenance"
	Capabilities *SlotCapabilities // optional: set by providers whose devices differ (phones)
	Maintenance  *Maintenance      // set while the slot or its whole provider is held
}

type Capacity struct {
	Slots       []Slot
	Maintenance *Maintenance // the whole provider is held
}

// A held slot takes no new sessions; a busy one stays "busy" until its
// session ends and then reads "maintenance". A slot's own hold wins over
// the provider's. Providers keep holds where their sessions live (emulator:
// a ConfigMap, phones: the state file) and apply them with
// contract.MaintenanceState.Apply.
type Maintenance struct {
	Reason string
	By     string    // the admin, filled by the api
	Since  time.Time
}

type SetMaintenance struct {
	Slot    string // empty: the whole provider
	Enabled bool
	Reason  string // ≤ 500 characters
	By      string
}

type Inventory struct {
	Maintenance *Maintenance
	Host        *HostInfo // the machine the devices hang off (phones over USB)
	Devices     []InventoryDevice
}

type InventoryDevice struct {
	Slot    Slot
	Session string      // the session running on it
	Device  *DeviceInfo // the Android device, when the provider can ask it (phones, fake devices)
	Host    *HostInfo   // the machine the slot is (emulator nodes)
	Error   string      // why details are missing (adb state, node-info unreachable)
}

type DeviceInfo struct {
	Manufacturer, Model, Device, Android, Build, SecurityPatch string
	SDK                       int
	ABIs                      []string
	Cores                     int
	MemoryTotal               int64
	StorageUsed, StorageTotal int64   // /data
	Uptime                    float64 // seconds
	Battery                   *Battery // {level, status, health, plugged, celsius, voltage}
	Thermal                   []Temperature
}

type HostInfo struct {
	Hostname, OS, Kernel, Arch, CPU string
	Cores                          int
	MemoryTotal, MemoryAvailable   int64
	Load1, Load5, Load15           float64
	Uptime                         float64
	Runtime, Kubelet               string   // Kubernetes nodes
	Conditions                     []string // NotReady, MemoryPressure, DiskPressure, PIDPressure, Unschedulable
	Thermal                        []Temperature // thermal zones and hwmon sensors
}

// What one device can do, where the provider-wide Capabilities can't say it.
type SlotCapabilities struct {
	Model    string   // "Google Pixel 7"
	Android  string   // "15"
	ABIs     []string
	Root     bool     // the agent has root on the device
	DevTools string   // "all" | "debuggable": every WebView, or only debuggable builds'
	ADB      bool     // browser ADB and ADB tunnels
	Screen   *Display // virtual devices: the screen chosen at launch (size, density, emulated cutout); the UI draws the cutout over the stream
	Shell    bool     // ADB runs any shell command (the UI offers the Terminal tab); false: only the allowlisted commands behind the other tabs
	AppData  bool     // app data can be saved and restored; the api skips saves when false
}

type CreateSession struct {
	ArtifactURL string // api-internal URL the agent downloads from, pinned to one cached revision
	ArtifactRef string // "{source}/{key}@{revision}", opaque to providers
	Package     string
	Owner       string
	Location    string // optional
	Slot        string // optional: run on this slot; 422 if unknown, 409 if not free; empty takes any free one (decision #76)
	Screen      string // optional: one of Capabilities.Screens; 422 if unknown; empty takes the first (decision #83)
	Android     string // optional: one of Capabilities.Versions; 422 if unknown; empty takes the newest
	AppData     *AppDataRestore // optional: {url, cache}, decision #49
	WebView     *WebViewInstall // optional: needs Capabilities.WebView, decision #88
	Frontend    string          // optional, 40 hex digits: the build's `frontend` tag, the DevTools frontend for the app's own sockets when they report an all-zero revision (Chromium browser builds, decision #91)
	Recording   *RecordingTarget // optional: record the session from the moment it is first ready (decision #96)
}

// The agent PUTs every file of the recording to url + "/" + name, the
// manifest last; the url carries a secret only this agent knows.
type RecordingTarget struct {
	ID  string // 20261025T120000Z-<24 hex>
	URL string // api-internal, /internal/recordings/{user hash}/{id}/{secret}
}

// The agent installs url before the app; a failed install fails the
// session. A com.android.webview build (package empty) updates the built-in
// WebView; another package (com.google.android.webview) is installed next
// to it and made the WebView with `cmd webviewupdate
// set-webview-implementation`, which fails the session unless the image
// lists it as a provider. Frontend is the Chromium commit whose DevTools
// frontend fits it, used for WebViews that report an all-zero revision.
type WebViewInstall struct {
	URL      string // api-internal, /internal/webview/{id}
	Version  string // "158.0.8123.0"
	Package  string // optional, "com.google.android.webview"
	Frontend string // optional, 40 hex digits
}

// The agent downloads url (a zstd tar from /v1/app-data/export) and puts it
// back after installing the app and before it first starts; cache also
// restores cache/ and code_cache/. A failed restore fails the session.
type AppDataRestore struct {
	URL   string // api-internal, /internal/app-data/{key}
	Cache bool
}

type Session struct {
	ID           string
	Slot         string
	Owner        string
	Package      string
	ArtifactRef  string // as given in CreateSession
	Location     string
	AppData      string // ""|data|cache: what was restored at launch, from CreateSession.AppData
	WebView      string // the WebView version installed at launch; empty for the built-in one
	State        string // provisioning|booting|installing|restoring|instrumenting|ready|stopping|failed
	Reason       string // set when failed
	Detail       string // optional progress note while starting, e.g. "waiting for the session image"
	AgentURL     string // in-cluster base URL of the agent, never exposed to browsers
	TunnelURL    string // optional: base URL of the agent's tunnel endpoints, for the ssh-gateway only
	Capabilities *SlotCapabilities // optional: the slot's, copied at create; the api passes it to the UI
	CreatedAt    time.Time
	LastActivity time.Time
}
```

## Node API

Served by `holtdroid node-info` on every machine a provider runs devices on
(the chart's DaemonSet on emulator nodes, port 8090). Consumed only by
providers; `contract.RegisterNode` and `contract.NewNodeClient`.

| Method | Path | Body / Response |
|--------|------|-----------------|
| `GET` | `/v1/host` | `HostInfo` read from `/proc` and `/sys` (CPU model, cores, memory, load, uptime, kernel, thermal zones, hwmon temperatures); both are host-wide inside an ordinary container |
| `GET` | `/v1/health` | `{ok: true}` |

The emulator provider finds the node-info Pods by `nodeInfo.selector` in its
namespace and merges what they say into the `HostInfo` it builds from the
Node object (OS image, kubelet, runtime, conditions).

## Agent API

Implemented by every device agent. Reached by browsers only through the api
proxy at `/s/{provider}/{session}/…`; the api strips that prefix and sets
`X-Forwarded-Prefix`. The JSON/SSE part is `contract.RegisterAgent`; display
and DevTools routes are plain HTTP next to it because they carry HTML,
static assets and WebSockets.

| Method | Path | Notes | In `contract.Agent` |
|--------|------|-------|----|
| `GET` | `/v1/health` | 200 once `ready`, 503 before | `Status` |
| `GET` | `/v1/state` | the current `{state, reason?, detail?, appRunning, recording?, recordedAt?}`; providers read it with `contract.AgentClient` | `Status` |
| `GET` | `/v1/status` | SSE, `event: state` with `{state, reason?, detail?, appRunning, recording?, recordedAt?}`; first event is the current state. `appRunning` is false once the app is closed; the device stays `ready`. `recording` is the id of the recording in progress and `recordedAt` when it started | `WatchStatus` |
| `GET` | `/v1/devtools/targets` | `{items: [{socket, pid, process, id, type, title, url, frontendRev}]}` | `Targets` |
| `GET` | `/v1/devtools/sockets` | SSE, `event: line` with `DevToolsEntry` (`page`, `socket` and `frame` only): first the lines the agent kept (the session's socket traffic, up to 16 MB), then every target and the sockets open now (without `seq`), then each change and frame; `wall` is the agent's clock, `t` the recording time and `recording` its id while one runs, `seq` numbers the lines so a watcher that reconnects skips what it has (decisions #117, #118) | `WatchSockets` |
| `GET` | `/v1/clipboard` | `{text}` | `Clipboard` |
| `POST` | `/v1/clipboard` | `{text}` → 204 | `SetClipboard` |
| `GET` | `/v1/clipboard/events` | SSE, `event: clip` with `{text}` on every device-side change | `WatchClipboard` |
| `GET` | `/v1/vibrations` | SSE, `event: vibration` with `{usage, package?, durationMs}` for each vibration that starts after the stream opens; touch feedback (`TOUCH`, `HARDWARE_FEEDBACK`, `PHYSICAL_EMULATION`) is left out, `durationMs` is 0 when the length isn't known yet. The device is only polled while someone listens (decision #54) | `WatchVibrations` |
| `GET` | `/v1/screen` | SSE, `event: screen` with `{on, locked}`: the current state first, then one event per change. `on` is false while the display is off or dozing, `locked` while the keyguard shows. The device is only polled while someone listens | `WatchScreen` |
| `GET` | `/v1/network` | `{location, externalIp, country}` | `Network` |
| `PUT` | `/v1/network/location` | `{location}` → `network` | `SetLocation` |
| `POST` | `/v1/app/{restart\|reinstall}` | 202; `restart` also starts a closed app, `reinstall` uninstalls first (clears data) and installs the current build | `App` |
| `POST` | `/v1/install` | `Install` → 204 once the new build runs; 400 with the adb message when it can't be installed (the previous build is kept or put back). Called by providers; the api proxy refuses it from browsers | `Install` |
| `POST` | `/v1/app-data/export` | `AppDataExport` `{cache, maxCacheSize?, maxSize?, restart}` → `application/zstd` stream of a tar of `/data/data/{pkg}` and `/data/user_de/0/{pkg}` (numeric owners, without `lib`), headers `X-App-Data-Size` (bytes on the device) and `X-App-Data-Cache` (whether `cache/` and `code_cache/` are in it). The app is stopped first; `restart` starts it again afterwards. The cache is left out when it is bigger than `maxCacheSize` or would push the total over `maxSize`; data alone over `maxSize` → 413, no data → 404, another app action running → 423, not `ready` → 400. Called by the api; the proxy refuses it from browsers (decision #49) | `ExportAppData` |
| `GET` | `/v1/device` | `DeviceState`: `{airplaneMode, wifi, mobileData, batterySaver, batteryLevel, charging, darkMode, fontScale, brightness, autoBrightness, density, defaultDensity, rotation, screenWidth, screenHeight, refreshRate, volume, volumeMax, muted, navigation?, networkProfile?, networkProfiles?: [{id, name, description, scenario, rtt?, jitter?, down?, up?, loss?}], networkRegion?: {region, server, backends?, paths: [{class: edge|origin, target, baseline?, added}]}, networkRegions?: [{id, name, country, description, access: {rtt, jitter?, down?, up?, loss?}, edge, edgeRtt, servers: [{server, rtt}]}], networkServers?: [{id, name}], timeZone, timeZoneOverride, vpnTimeZone?, locale, locales, languageScope, geo?: {latitude, longitude}, canFakeGeo, canSimulateBattery, canSetTime, usbNetwork, autoTime, timeOffset}`; `usbNetwork` says the device reaches the internet over USB (phones with VPN locations), so Wi-Fi and mobile data are off by design; `languageScope` is `system` (the locales are the system languages) or `app` (phones without root: only the app under test's language, set with `cmd locale set-app-locales`), `canSimulateBattery` is false where only battery saver works, `canSetTime` is false where the clock can't move off real time (redroid shares the node's clock); on redroid `wifi` is Android's own Wi-Fi when the node has `mac80211_hwsim` (decision #105) and otherwise a virtual radio like `mobileData` (decision #101); `rotation` is `Surface.ROTATION_*`, `timeZoneOverride` says the time zone was picked by the user rather than following the VPN location, `vpnTimeZone` is the active location's zone (absent when it has none), `screenWidth`/`screenHeight` are the display size as streamed (`wm size`, the override when set; 0 when unknown), `refreshRate` is the display's fastest mode in Hz (0 when unknown), `volume` and `volumeMax` are the media stream's step and highest step (`volumeMax` 0 when the device doesn't report them), `muted` is the media stream's mute, `navigation` is Android's system navigation, `gestures` or `buttons`, absent where it can't be switched (phones; on redroid it picks the navbar overlay and gestures are the default, decision #110), `brightness` is the position of the shade's brightness slider in percent (Android's gamma curve over the display's brightness range, decision #101) and `autoBrightness` its adaptive mode; setting `brightness` turns adaptive off unless `autoBrightness` is set too, `timeOffset` is device clock minus real time in ms, `networkProfile` and `networkProfiles` are absent when the device can't emulate network conditions (phones, sessions without a VPN tun); `networkProfiles` are the networks and scenarios (`scenario: true`) it may be set to, with the link's added round trip and jitter in ms, kbit/s down and up (absent is unlimited) and percent lost in each direction, `locales` is the system language list (`locale` first, the rest add keyboard layouts), `geo` is absent while the GPS reports the emulator's default position | `Device` |
| `PATCH` | `/v1/device` | `DeviceSettings` (any subset of the writable fields above; `networkRegion: {region, server?, backends?}` replaces the region, measuring the session's route first (decision #132), `region: ""` turns it off; `locales` replaces the whole list; `resetGeo: true` puts the default GPS position back; `route: {points, speed, loop?}` moves the GPS from the first point along the rest in straight lines around the cruising `speed` m/s (speeding up from the start, slowing for turns and the end, drifting a few percent, decision #100), with `loop` back to the first point and round again; `DeviceState.route` reports it with `travelled`, `length`, `duration` (seconds per pass), `currentSpeed` and `moving` (false at the end of a route without loop) until `geo`, `resetGeo`, another `route` or `stopRoute: true` (keeps the position) ends it (decision #98); `timeZone` overrides the VPN location's zone for the session and `resetTimeZone: true` follows it again; `density: 0` restores the default; `navigation` is refused where `DeviceState.navigation` is absent; `volume` sets the media step, `muted: true` sets it to the lowest step and `false` brings back the step it had; `timeOffset` sets the clock to real time + offset and turns `autoTime` off; `autoTime: true` syncs the clock) → `DeviceState` | `UpdateDevice` |
| `POST` | `/v1/device/actions/{volume-up\|volume-down\|mute\|screen-off\|lock\|unlock\|back\|home\|recents\|notifications\|quick-settings\|rotate-left\|rotate-right}` | 204 | `DeviceAction` |
| `GET` | `/v1/device/screenshot` | `image/png` of the current screen | `Screenshot` |
| `GET` | `/v1/recording` | `RecordingState` `{active, id?, startedAt?, duration, size, error?}`: the recording in progress, or the last one with why it stopped on its own | `Recording` |
| `POST` | `/v1/recording` | `RecordingTarget` → `RecordingState`; starts recording the screen, events, logcat and the WebViews' DevTools traffic to the target (decisions #96, #112). 400 before the session is ready, 423 while another recording runs | `StartRecording` |
| `DELETE` | `/v1/recording` | → `RecordingState` once the last files are uploaded (the api waits up to a minute); a no-op without a recording | `StopRecording` |
| `GET` | `/v1/tunnels?probe=` | SSE, `event: tunnels` with `{adb: [{user, client, since}], reverse: [{port, user, since, connections, state}]}` — what the ssh-gateway (`client: ssh`) and browsers (`client: browser`) have open into the device; the first event is the current set. `state` (`unknown`, `up`, `down`) says whether a server answers behind the port on the publisher's machine; `probe=true` makes the agent check it while the stream is open (decision #52) | `WatchTunnels` |
| `GET` | `/v1/tunnels/current` | the same `Tunnels` once, as JSON, for the api | `Tunnels` |
| `GET` | `/v1/metrics` | SSE, `event: metrics` every ~2 s with `{at, interval, device: {cores, cpu, memoryUsed, memoryTotal, storageUsed, storageTotal, rxRate, txRate}, app?: {processes: [{pid, name, cpu, memory}], fps, jank}, host?: {cpu, cpuLimit, throttled, memoryUsed, memoryLimit}, thermal: [{source, type, name, celsius}]}` (decision #40). `cpu` percentages are of all device cores (for redroid the `android` container's CPU limit, with memory from its cgroup and `/data` as `du` of the emptyDir against `redroid.dataSize`, since the guest's `/proc` and `df` show the node), `memory` is PSS, rates are bytes/s since the previous sample; `app` is absent while the app is closed, `host` is the container an emulator runs in. The device is only sampled while someone listens | `WatchMetrics` |
| `WS` | `/display/scrcpy?codec=&maxSize=&maxFps=&bitRate=` | the screen: device → browser binary messages are the scrcpy 3.3.3 video socket after its dummy byte (64-byte device name, codec meta, packets with frame meta), browser → device binary messages are scrcpy control messages (architecture.md "Screen"). `codec` is `h264` (default), `h265` or `av1`; `maxFps` is 1–60 (60 by default); a codec the device can't encode closes the socket with 4001 (`contract.DisplayUnsupportedCodec`). Invalid options → 400 | – |
| `WS` | `/adb` | the browser's ADB connection (decision #51): binary messages carry raw adb protocol bytes to and from adbd, relayed packet by packet; OPENs of `reboot:`, `unroot:`, `remount:`, `tcpip:`, `usb:`, `sideload:`, `*-verity:` are answered with CLSE. On phones the agent speaks the device side itself (decision #68): CNXN without AUTH, every OPEN checked against the refusal list, `root:`, `reverse:`, frida-server forwards and the provider's `adb.shell` policy, allowed ones replayed through `host:transport:<serial>` on the host adb server. The api proxy allows it per `adb.browser` / `adb.ownerOnly` (403 otherwise) and sets `X-Holtdroid-User` to the signed-in user; 502 before the upgrade when adbd is unreachable | – |
| `WS` | `/display/audio` | device audio: binary messages are a scrcpy 3.3.3 audio socket after its dummy byte (4-byte codec id, `opus` or 0 when the device can't capture, then packets with frame meta); browser messages are ignored | – |
| `WS` | `/devtools/{socket}/page/{id}` | proxied CDP WebSocket | – |

Tunnel endpoints, served on the agent's **second port** (`tunnelListen`,
`:8081`) at `Session.tunnelUrl`, reachable only by the ssh-gateway and never
through the api proxy. The gateway's side is `contract.TunnelClient`; the
agent's is `agent.Tunnels`, which the fake provider reuses.

| Method | Path | Notes |
|--------|------|-------|
| `WS` | `/tunnel/adb` | one WebSocket per ADB connection, binary messages carry raw bytes to the device's adbd, relayed and filtered like `/adb` (on phones through the same proxy); 502 before the upgrade when adbd (or, on phones, the host adb server or the phone) is unreachable |
| `WS` | `/tunnel/reverse/{port}` | publishes device `localhost:{port}` (`adb reverse`) before the upgrade; device-side connections arrive as yamux streams the agent opens over this socket (the gateway is the yamux server); closing it removes the reverse. 400 for a port outside 1–65535, 409 when the port is already published, 502 when adb fails |

Both carry `X-Holtdroid-User` (the computer owner's login, for `/v1/tunnels`).
Messages are at most 1 MiB.

### ssh-gateway internal API

`contract.RegisterSSHGateway` / `contract.SSHGatewayClient`; the gateway
itself (`sshgateway.Gateway`) implements it. Each replica knows only the
connect clients attached to it, so the api asks every replica.

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/v1/host-keys` | `{keys: [authorized_keys lines]}`, the host keys the api hands to enrolling clients |
| `GET` | `/v1/users/{user}/computers` | `{computers: [Computer]}` attached to this replica: `{id, hostname, os, arch, version, clientIP, since, listening: [{port, process?}], published: [port], adb: [{session, port}]}`; a computer that reconnected appears once |
| `PUT` | `/v1/users/{user}/computers/{computer}/published` | `{ports}` → 204 after the gateway sent the client a `publish` message; 404 when no client of that computer is attached here |
| `GET` | `/v1/health` | readiness |

In the other direction the gateway calls the api's internal port through
`contract.SSHSessions` / `contract.SSHSessionsClient` (rows at the end of the
UI API table).

### Connect client protocol

Types in `internal/contract/control`, which has no dependencies so the
client binary stays small (decision #64).

- **Enrollment and refresh** are the UI API's `POST /api/v1/connect/enroll`
  and `/refresh` below.
- **SSH login** as the user's handle with a certificate from the api's CA:
  principal = handle, key id = computer id, extensions `user@holtdroid`,
  `admin@holtdroid` (`true` or absent), `hostname@holtdroid`.
- **ADB**: `direct-tcpip` to `{provider}-{id}:5555`.
- **Published ports**: `tcpip-forward` / `cancel-tcpip-forward` for the port
  on every ready session of the user.
- **Control**: subsystem `holtdroid-control@holtdroid` on a `session`
  channel, one JSON object per line, `{type, …}`:

| `type` | From | Fields |
|--------|------|--------|
| `hello` | client, once | `hello: {version, os, arch}` |
| `gateway` | gateway, first | `gateway: {adb, publish}`: whether this gateway carries ADB and published ports; the client opens no ADB ports and asks for no ports when they are off |
| `state` | client, on change | `state: {listening: [{port, process?}], published: [port], adb: [{session, port}], mode, pinned: [port]}`: `published` is what the gateway accepted, `pinned` what the user picked, `mode` `manual`, `dev` or `all` (decision #65) |
| `sessions` | gateway, on change and when the channel opens | `sessions: [{slug, provider, id, package?, label?, versionName?}]`, the user's ready sessions; absent = none |
| `publish` | gateway | `publish: [port]`, the exact set of pinned ports (from the portal); absent = none. The mode adds its ports on top |

The fake provider (`internal/provider/fake`) implements all of it with
placeholder HTML for the screen and DevTools pages.

## UI API (served by api)

Every protected endpoint, and the session proxy, also accepts
`Authorization: Bearer {accessToken}` from a connect client's `Credentials`
(audience `connect-access`, as long as the certificate) as the computer's
user with the groups it was enrolled with.

Generated into `web/src/api/schema.d.ts`. Sessions are addressed by
`{provider}/{id}` — session IDs are only unique within a provider, and
keeping the provider in the path is what lets the api stay stateless.

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/v1/auth` | public; `{mode, identity?, loginUrl?}`. In the anonymous mode it signs newcomers in (Set-Cookie) |
| `POST` | `/api/v1/auth/login` | public; `{password}` → session cookie (password mode) |
| `POST` | `/api/v1/auth/logout` | public; clears the cookie |
| `GET` | `/api/v1/auth/oidc/login?redirect=` | public; browser redirect to the IdP |
| `GET` | `/api/v1/auth/oidc/callback` | public; sets the cookie and redirects back |
| `GET` | `/api/v1/me` | `{user, name, email, groups, admin}` |
| `GET` | `/api/v1/adb` | `{browser, ownerOnly}`: whether session pages may open ADB at `/s/{provider}/{id}/adb`, and whether only owners and admins may |
| `GET` | `/api/v1/ssh` | `{enabled, host?, port, allowADB, allowReverse, maxTunnels, insecureTLS, handle?}` for the UI (`insecureTLS` adds `-k` to the connect command); empty `host` = the UI's own host; `handle` is the caller's `user-{pseudonym}` SSH name |
| `POST` | `/api/v1/connect/codes` | `{code, expiresAt}`: a one-time enrollment code for the caller, valid `ssh.codeTTL`; the UI shows `curl -fsSL {origin}/tunnel.sh \| sh -s -- {code}`. 404 when SSH is disabled |
| `POST` | `/api/v1/connect/enroll` | public; from the client: `{code, publicKey, hostname, os, arch}` → `Credentials` `{user, computer, handle, host, port, hostKeys, certificate, certificateExpiresAt, refreshToken, refreshExpiresAt, accessToken}`; 401 for an invalid, expired or already used code, 422 for an invalid key, 502 when no gateway names its host key. Emits `ssh.enroll` |
| `POST` | `/api/v1/connect/refresh` | public; from the client: `{refreshToken, publicKey}` → new `Credentials` with a new refresh token; 401 when the token is invalid or expired or the key isn't the one it was issued for |
| `GET` | `/api/v1/ssh/computers` | the caller's connected computers from every gateway replica → `{computers: [Computer]}`; empty when SSH is disabled, 502 when no replica answered. The UI polls it every 3 s |
| `PUT` | `/api/v1/ssh/computers/{id}/published` | `{ports}` (≤ 256, each 1–65535) → 204 once the replica holding that computer passed it on; 404 when it isn't connected |
| `GET` | `/api/v1/ssh/tunnels` | the caller's tunnels open right now → `{sessions: [{provider, id, adb: [ADBTunnel], reverse: [ReverseTunnel]}]}`, only sessions with at least one; the api asks the agent of every ready session (`GET /v1/tunnels/current`) and leaves out those that don't answer within 5 s. Empty when SSH is disabled. The UI polls it every 5 s for the Computers page |
| `GET` | `/tunnel.sh` | public; the bootstrap script with the portal URL and the SHA-256 of each build in `ssh.clientDir`; 404 when SSH is disabled |
| `GET` | `/connect/holtdroid-{os}-{arch}` | public; a client build (`darwin`/`linux`, `amd64`/`arm64`) |
| `GET` | `/connect/manifest.json` | public; `{clients: [{platform, sha256}]}` of the builds in `ssh.clientDir`; clients compare it with their own SHA-256 to offer an update |
| `GET` | `/api/v1/sources` | `[{name, readOnly}]` |
| `GET` | `/api/v1/apps` | `{items: [{package, description, updatedBy?, updatedAt}]}`: apps that have a description (decision #129) |
| `PUT` | `/api/v1/apps/{package}` | `{description}` (at most 4000 characters, trimmed; empty removes it) → the app; anyone signed in. Emits `app.update` |
| `GET` | `/api/v1/artifacts?source=&cursor=&limit=` | artifacts the caller may see (private ones only for owner/admins) from every source or one, newest first, offset cursor. Items: `{source, id, revision, fileName, size, uploadedAt, meta, app?, iconUrl?, canManage, canDownload}` — `id` is base64url of the key, `meta` the sidecar, `app` the parsed APK once cached; per-source failures come back in `errors[]` |
| `PATCH` | `/api/v1/artifacts/{source}/{id}` | `{visibility}` → artifact; owner or admin, 403 on `readOnly` sources, 404 when the caller can't see it |
| `DELETE` | `/api/v1/artifacts/{source}/{id}` | APK + sidecar; owner or admin (ownerless: admin), 403 on `readOnly` sources |
| `GET` | `/api/v1/artifacts/{source}/{id}/download` | the APK as an attachment (`application/vnd.android.package-archive`); 404 when the caller can't see it, 403 for non-admins with `downloads.adminOnly`. Emits `artifact.download` |
| `GET` | `/api/v1/icons/{key}` | PNG by cache key (from `iconUrl`), immutable |
| `GET` | `/api/v1/uploads` | `{enabled, source?, maxSize}` |
| `POST` | `/api/v1/uploads` | multipart `file` (+ `visibility`, `title`, `note`, `changelog`) → 201 artifact; 403 when disabled, 422 when not an APK, body capped at `maxSize` |
| `GET` | `/api/v1/providers` | `{name, capabilities, capacity, error?}` per provider |
| `GET` | `/api/v1/sessions` | `{items, errors}`, each item with `idleDeadline` and `ttlDeadline` |
| `GET` | `/api/v1/map` | `{enabled, routing, style?, darkStyle?}`: the GPS map's MapLibre style URLs under the tile proxy (decision #97); `enabled: false` without `map.url`, `routing` while `routing.url` is set |
| `POST` | `/api/v1/map/route` | `{points (2–20), mode: walk\|run\|drive}` → `{points, length}`: a path along roads through the points from the Valhalla server at `routing.url` (`pedestrian` costing for walk and run, `auto` for drive), at most 5000 points, ready for the agent's `route` (decision #99); 404 without `routing.url`, 422 when there is no path, 502 when the server is unreachable |
| `GET` | `/api/v1/map/tiles/{path}` | proxies `map.url` + `path` (style, TileJSON, tiles, sprites, glyphs), rewriting `map.url` in JSON responses to this prefix; 404 without `map.url`, 502 when the tile server is unreachable |
| `GET` | `/api/v1/webviews` | the WebView catalog (decision #88), newest milestone first: `[{id, title, version, milestone, channels, minSdk, released, size}]`, where `minSdk` is the higher of the APK's and the sidecar's `requiresSdk`; empty without `webview.storage`. `createSession` answers 422 for a build whose `minSdk` is above the requested Android version |
| `POST` | `/api/v1/sessions` | `{source, artifactId, provider?, slot?, screen?, android?, location?, appData?: {id, cache}, webview?, queue?, record?}`. `record` matters only in `recordings.mode` `auto` (false turns it off) and `manual` (true turns it on); in `always` it is ignored; with recordings on the api creates the recording and passes its target in `CreateSession.recording`, or launches without one when the quota is full of kept recordings. `webview` is an id from `/api/v1/webviews` and keeps only providers with the `webview` capability (422 when none is left or no catalog is configured, 404 for an unknown build). Without `provider` the api takes the first provider in `providers[]` order that offers the location and has a free slot (for app data, one that can restore it); `slot` needs `provider` (decision #76). 404 for artifacts the caller can't see or app data that isn't the caller's for that package, 403 for `appData` while app data is off, 409 when no slot is free (or others are queued for that provider) and `queue` is false, 422 for an invalid APK, an unknown location, or an `android` version below the build's `minSdk` (the APK's, or the sidecar's `requiresSdk` tag when higher; also returned as `minSdk` on artifacts). With `queue: true` it waits in line (one per target: any provider, a provider, or one slot) until a slot frees up; cancelling the request leaves the line (decision #57) |
| `GET` | `/api/v1/sessions/{provider}/{id}` | one session |
| `DELETE` | `/api/v1/sessions/{provider}/{id}` | owner or admin only; with app data on, a `ready` session's app data is saved into the owner's first (a failed save is logged and audited, the session is stopped anyway) |
| `POST` | `/api/v1/sessions/{provider}/{id}/app-data` | owner or admin; saves the app data now into the session owner's saves and restarts the app → `AppDataView`; 403 when off, 404 when the app has no data, 413 over `appData.maxSize`, 423 while another app action runs |
| `GET` | `/api/v1/app-data?package=` | the caller's saves, newest first: `{enabled, cache, export, keep, maxAge, items: [{id, package, label?, versionName?, versionCode?, source, artifactId, iconUrl?, cache, size, compressed, createdAt, lastUsedAt, expiresAt?}]}`; `maxAge` in seconds, `size` bytes on the device, `compressed` bytes stored |
| `DELETE` | `/api/v1/app-data/{package}/{id}` | the caller's own save only (admins included), 404 otherwise |
| `GET` | `/api/v1/app-data/{package}/{id}/download` | `application/zstd` attachment; 403 when `appData.export` is off |
| `POST` | `/api/v1/sessions/{provider}/{id}/recording` | owner or admin; starts a new recording of a `ready` session → `RecordingView`; 403 when recordings are off, 423 while one runs, 507 when the owner's quota is full of kept recordings |
| `DELETE` | `/api/v1/sessions/{provider}/{id}/recording` | owner or admin; stops the recording and waits for its last files → 204; 403 in `recordings.mode: always` |
| `POST` | `/api/v1/sessions/{provider}/{id}/recording/markers` | owner or admin; `{label?, icon?, t?, recording?}` → `{recording, marker}`: pins a marker on the session's running recording at `t` (a live DevTools line's recording time), or at the agent's own time (it reads `GET /v1/recording`); 422 when nothing is being recorded or `recording` isn't the one running |
| `PUT` | `/api/v1/recordings/{id}/markers` | the owner; `{items: [{id?, t, label?, icon?}]}` replaces the recording's markers (at most 200, icons `pin,bug,flag,star,alert,check`) → `{items}` |
| `GET` | `/api/v1/recordings/{id}/export` (and `/api/v1/shared/{token}/export`) | every file of the recording as one ZIP (`.holtdroid`, see "Recording archive" below), streamed from storage, entries stored; `RecordingView.exportUrl` |
| `GET` | `/api/v1/recordings/{id}/logcat.log` (and `/api/v1/shared/{token}/logcat.log`) | the logcat with ANSI colours by level; `logcat.txt` is the same without them |
| `GET` | `/api/v1/recordings` | the caller's recordings, newest first: `{enabled, mode (always\|auto\|manual), share, quota, used, maxAge, minDuration, items: [RecordingView]}`; a `RecordingView` has `{id, package, label?, versionName?, source, artifactId, provider?, session?, location?, webview?, state (pending\|recording\|done\|failed\|interrupted), reason?, createdAt, startedAt?, duration, size, filesUrl, iconUrl?, thumbnailUrl?, logcatUrl, keep, expiresAt?, share?: {token, url}}` |
| `GET` | `/api/v1/recordings/{id}` | `{recording, markers, manifest?, shared: false}`; the manifest is the agent's `RecordingManifest` |
| `GET` | `/api/v1/recordings/{id}/events` | `{items: [RecordingEvent]}`: every event of the recording in order |
| `GET` | `/api/v1/recordings/{id}/devtools` | `{items: [DevToolsEntry]}`: every DevTools line of the recording (pages, requests, console, WebSocket states and frames, `dropped` notes), in the order written; a request is one line written when it ended, with `start`, `response` and `end` times (decision #112) |
| `GET` | `/api/v1/recordings/{id}/files/{file}` | a file the manifest lists, `icon.png` or `thumb.jpg`; `.gz` chunks are sent with `Content-Encoding: gzip` |
| `GET` | `/api/v1/recordings/{id}/logcat.txt` | the whole logcat as one text attachment |
| `PUT` | `/api/v1/recordings/{id}/name` | the owner; `{name}` (at most 120 characters, whitespace tidied) → `RecordingView` with `title`; an empty name goes back to the app's |
| `PUT` | `/api/v1/recordings/{id}/keep` | `{keep}` → `RecordingView`; a kept recording is exempt from `recordings.maxAge`, not from the quota |
| `POST`, `DELETE` | `/api/v1/recordings/{id}/share` | make (or return the existing) share link, or turn it off → `RecordingView`; 403 when `recordings.share` is off |
| `DELETE` | `/api/v1/recordings/{id}` | → 204; the caller's own recordings only |
| `GET` | `/api/v1/shared/{token}`, `…/events`, `…/devtools`, `…/files/{file}`, `…/logcat.txt` | the same for a share link, **without sign-in**; `shared: true`, the owner's name, no `share` or session |
| `POST` | `/api/v1/sessions/{provider}/{id}/extend` | owner or admin only; counts as activity |
| `POST` | `/api/v1/sessions/{provider}/{id}/heartbeat` | `{active}`; sent every 30 s by a visible session tab, `active` = the user gave input since the previous heartbeat |
| `GET` | `/api/v1/admin/audit` | admins only (403 otherwise): `{enabled, events, oldest?, maxEvents, maxAge (s), persistent, actors, actions}` of the api's audit store |
| `GET` | `/api/v1/admin/audit/events?action=&result=&service=&actor=&session=&q=&since=&until=&before=&limit=` | admins only: `{items, next?}` newest first; `action`, `result`, `service` take comma-separated lists, an action matches exactly or by group (`session` = `session.*`), `q` searches every field case-insensitively, `before` is the `next` of the previous page, `limit` ≤ 500 (default 100); 404 when the store is off |
| `GET` | `/api/v1/admin/audit/export?…` | admins only: every event matching the same filters as `application/x-ndjson`, newest first; emits `audit.export` |
| `GET` | `/api/v1/admin/inventory` | admins only: `{providers: [{name, kind?, error?, maintenance?, host?, devices: InventoryDevice[]}]}`, one entry per provider in config order |
| `PUT` | `/api/v1/admin/providers/{provider}/maintenance` | admins only: `{enabled, reason?}` → 204; holds or releases the whole provider; emits `provider.maintenance` |
| `PUT` | `/api/v1/admin/providers/{provider}/slots/{slot}/maintenance` | admins only: the same for one slot; 422 for an unknown slot |
| `GET` | `/api/v1/events` | SSE `event: sessions`, the full `{items, errors}` whenever it changes; `event: artifacts` `{revision}` whenever any source changes |
| `*` | `/s/{provider}/{id}/…` | proxy to the session's agent (HTTP + WS); any authenticated user may use it; non-GET requests count as activity |
| `GET` | `/internal/artifacts/{key}` | APK download for agents by cache key, **internal port only** |
| `GET` | `/internal/app-data/{key}` | app data download for agents, **internal port only**; `key` is `{user hash}/{package}/{id}.tar.zst`, ids carry 96 random bits |
| `GET` | `/internal/webview/{id}` | a WebView build from the catalog for agents, **internal port only**, streamed from `webview.storage` (decision #88) |
| `PUT` | `/internal/recordings/{user hash}/{id}/{secret}/{file}` | recording uploads from agents, **internal port only** (decision #96): 404 unless the secret's SHA-256 matches the recording's meta; `file` is `init-N.mp4`, `seg-N.m4s`, `ainit-N.mp4`, `aseg-N.m4s`, `events-N.jsonl.gz`, `logcat-N.log.gz`, `devtools-N.jsonl.gz`, `thumb.jpg` or `manifest.json`, at most `recordings.maxFileSize`. A manifest updates the recording's state and, while it records, checks the owner's quota: 507 when nothing more can be deleted to make room |
| `GET` | `/internal/ssh/authority` | gateway only, **internal port**: `{publicKey}` of the CA that signs connect clients' certificates; 404 when SSH is disabled |
| `POST` | `/internal/sessions/{slug}/activity` | gateway only, **internal port**: tunnel traffic counts as activity → 204; 404 for an unknown session |
| `GET` | `/internal/users/{handle}/sessions` | gateway only, **internal port**: `{sessions: [SSHSession]}` (`{provider, id, owner, state, tunnelUrl?, package?, label?, versionName?}`), every session (any state) whose owner has this `user-…` handle; empty for an unknown handle; 500 if a provider can't list, so the gateway keeps what it has |
| `POST` | `/internal/audit/events` | gateway only, **internal port**: a JSON array (≤ 1000) of audit events the gateway emitted, kept in the api's audit store → 204; dropped when `audit.store` is off |

The APK cache is warmed in the background: listing artifacts and polling
sources queue up to `cache.warm` uncached revisions for download and
parsing, so icons and package names show up without anyone launching them
first.

## Configuration and secrets

One YAML file per service (koanf, `--config`), every key overridable by
env (`HOLTDROID_` prefix, `__` between levels, matched case-insensitively).
Logging is not part of the file: `--log-level`/`--log-format` or
`HOLTDROID_LOG_LEVEL`/`HOLTDROID_LOG_FORMAT`. Example for api:

```yaml
listen: ":8080"
internalListen: ":8081"
publicURL: "https://android.example.com"
auth:
  mode: oidc                # anonymous | password | oidc | header | none
  sessionKey: env:SESSION_KEY
  adminGroups: [admins]
  oidc:
    issuer: https://auth.example.com
    clientID: holtdroid
    clientSecret: env:OIDC_CLIENT_SECRET
storage:
  type: s3                  # filesystem | s3
  s3:
    endpoint: https://s3.example.com
    bucket: holtdroid
    accessKey: env:S3_ACCESS_KEY
    secretKey: env:S3_SECRET_KEY
sessions:
  idleTimeout: 30m
  maxTTL: 8h
cache:
  maxSize: 20GiB
  warm: 10
secrets:
  openbao:
    address: https://bao.example.com
    kubernetes: { role: holtdroid }
sources:
  - name: slack
    type: s3
    readOnly: true
    s3: { endpoint: https://s3.example.com, bucket: apks, prefix: slack, accessKey: env:S3_ACCESS_KEY, secretKey: env:S3_SECRET_KEY }
  - name: local
    type: filesystem
    filesystem: { dir: /var/lib/holtdroid/apks }
uploads:
  source: local
providers:
  - name: emulator
    url: http://holtdroid-provider-emulator:8080
```

Secret values are references resolved through `internal/secrets`:

| Scheme | Example | Resolver |
|--------|---------|----------|
| `env:` | `env:SLACK_BOT_TOKEN` | environment variable |
| `file:` | `file:/run/secrets/slack/token` | file contents, trailing newline trimmed |
| `openbao:` | `openbao:secret/holtdroid#slack_bot_token` | KV v2 `mount/path#field`; auth by token ref or Kubernetes auth role, configured under `secrets.openbao` |

A plain string without a scheme is rejected for fields typed as secrets, so
a token can never end up inlined in a config file by accident. New schemes
are added by implementing `secrets.Resolver` and registering it.

Every service also reads `telemetry` (`metrics.listen`, `tracing.{enabled,
endpoint, insecure, sampleRatio}`), and the api and the ssh-gateway read
`audit` (`stdout`, `otlp.{enabled, endpoint, insecure}`, `webhook.{url,
authorization, batchSize, flushInterval, retries, timeout}`; `url` and
`authorization` are secret references; api only: `store.{enabled,
maxEvents, maxAge, path}`; ssh-gateway only: `forward`, which sends its
events to the api's `/internal/audit/events` with the webhook's batching
settings). `provider-emulator` passes
`sessionTelemetry.{metricsPort, tracing}` to session agents as
`HOLTDROID_TELEMETRY__*` variables. The audit event schema (version 1) is in
`internal/audit` and documented on the public "Monitoring and audit" page.

## Recording archive (`.holtdroid`)

A ZIP (ZIP64 when it needs to be; entries are stored, not deflated, and carry
data descriptors) written by `GET …/export` and read by the web client with
`File.slice`, so nothing but the index and the needed entries is loaded.

| Entry | What |
|-------|------|
| `holtdroid.json` | `{format: "holtdroid-recording", version: 1, exportedAt, recording: RecordingView, markers: [RecordingMarker]}`; the view has no URLs, owner, session, keep or share; readers refuse another `format` and a higher `version` |
| `manifest.json` | the agent's `RecordingManifest` as uploaded |
| `init-N.mp4`, `seg-N.m4s` | the video, as listed in the manifest |
| `ainit-N.mp4`, `aseg-N.m4s` | the sound (Opus in fragmented MP4), as listed in the manifest's `audio`; older archives have none |
| `events-N.jsonl.gz`, `logcat-N.log.gz` | gzipped event lines and logcat text |
| `devtools-N.jsonl.gz` | gzipped `DevToolsEntry` lines, as listed in the manifest's `devtools`; older archives have none |
| `thumb.jpg`, `icon.png` | the preview and the app's icon, when there are any |
