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
[kriakiku/holtdroid-sync](https://github.com/kriakiku/holtdroid-sync)
implements it on top of AWS IAM Identity Center.

Sync jobs announce builds with a **launch link**:
`{publicURL}/?source={source}&launch={id}`, `id` = base64url (no padding)
of the key inside the source — the same ID the UI API uses
(`GET /api/v1/artifacts/{source}/{id}`). The home page opens the launch
dialog for it; with `&quick=1` it starts a session right away on the
last-used provider and location and falls back to the dialog. The sync jobs live in their own repository,
[kriakiku/holtdroid-sync](https://github.com/kriakiku/holtdroid-sync)
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
```

The api parses APKs itself (`internal/apk`: package, versionName,
versionCode, label, icon, ABIs, minSdk) and caches file and metadata keyed by
`hash(source, key, revision)`.

## Provider API

Implemented by `provider-*` services. Consumed only by the api.

| Method | Path | Body / Response |
|--------|------|-----------------|
| `GET` | `/v1/capabilities` | `Capabilities` |
| `GET` | `/v1/capacity` | `{slots: Slot[]}` |
| `GET` | `/v1/sessions` | `{items: Session[]}` |
| `POST` | `/v1/sessions` | `CreateSession` → `Session` |
| `GET` | `/v1/sessions/{id}` | `Session` |
| `DELETE` | `/v1/sessions/{id}` | 204 |
| `POST` | `/v1/sessions/{id}/touch` | `{lastActivity}` → 204 |
| `POST` | `/v1/sessions/{id}/install` | `Install` `{artifactUrl, artifactRef, keepData}` → `Session`; only for a `ready` session (400 otherwise); hands the build to the agent's `/v1/install` and, once it runs, records `artifactRef` as the session's artifact. A failed install (400 with the adb message) keeps the recorded one |
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
}

type Location struct {
	ID    string // "pl", "ua", "direct"
	Label string // "Poland"
}

type Slot struct {
	ID           string // node name for emulators, device serial for phones
	Label        string
	State        string // "free" | "busy" | "offline"
	Capabilities *SlotCapabilities // optional: set by providers whose devices differ (phones)
}

// What one device can do, where the provider-wide Capabilities can't say it.
type SlotCapabilities struct {
	Model    string   // "Google Pixel 7"
	Android  string   // "15"
	ABIs     []string
	Root     bool     // the agent has root on the device
	DevTools string   // "all" | "debuggable": every WebView, or only debuggable builds'
	ADB      bool     // browser ADB and ADB tunnels
	AppData  bool     // app data can be saved and restored; the api skips saves when false
}

type CreateSession struct {
	ArtifactURL string // api-internal URL the agent downloads from, pinned to one cached revision
	ArtifactRef string // "{source}/{key}@{revision}", opaque to providers
	Package     string
	Owner       string
	Location    string // optional
	Slot        string // optional: run on this slot; 422 if unknown, 409 if not free; empty takes any free one (decision #76)
	AppData     *AppDataRestore // optional: {url, cache}, decision #49
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

## Agent API

Implemented by every device agent. Reached by browsers only through the api
proxy at `/s/{provider}/{session}/…`; the api strips that prefix and sets
`X-Forwarded-Prefix`. The JSON/SSE part is `contract.RegisterAgent`; display
and DevTools routes are plain HTTP next to it because they carry HTML,
static assets and WebSockets.

| Method | Path | Notes | In `contract.Agent` |
|--------|------|-------|----|
| `GET` | `/v1/health` | 200 once `ready`, 503 before | `Status` |
| `GET` | `/v1/state` | the current `{state, reason?, detail?, appRunning}`; providers read it with `contract.AgentClient` | `Status` |
| `GET` | `/v1/status` | SSE, `event: state` with `{state, reason?, detail?, appRunning}`; first event is the current state. `appRunning` is false once the app is closed; the device stays `ready` | `WatchStatus` |
| `GET` | `/v1/devtools/targets` | `{items: [{socket, pid, process, id, type, title, url, frontendRev}]}` | `Targets` |
| `GET` | `/v1/clipboard` | `{text}` | `Clipboard` |
| `POST` | `/v1/clipboard` | `{text}` → 204 | `SetClipboard` |
| `GET` | `/v1/clipboard/events` | SSE, `event: clip` with `{text}` on every device-side change | `WatchClipboard` |
| `GET` | `/v1/vibrations` | SSE, `event: vibration` with `{usage, package?, durationMs}` for each vibration that starts after the stream opens; touch feedback (`TOUCH`, `HARDWARE_FEEDBACK`, `PHYSICAL_EMULATION`) is left out, `durationMs` is 0 when the length isn't known yet. The device is only polled while someone listens (decision #54) | `WatchVibrations` |
| `GET` | `/v1/network` | `{location, externalIp, country}` | `Network` |
| `PUT` | `/v1/network/location` | `{location}` → `network` | `SetLocation` |
| `POST` | `/v1/app/{restart\|reinstall}` | 202; `restart` also starts a closed app, `reinstall` uninstalls first (clears data) and installs the current build | `App` |
| `POST` | `/v1/install` | `Install` → 204 once the new build runs; 400 with the adb message when it can't be installed (the previous build is kept or put back). Called by providers; the api proxy refuses it from browsers | `Install` |
| `POST` | `/v1/app-data/export` | `AppDataExport` `{cache, maxCacheSize?, maxSize?, restart}` → `application/zstd` stream of a tar of `/data/data/{pkg}` and `/data/user_de/0/{pkg}` (numeric owners, without `lib`), headers `X-App-Data-Size` (bytes on the device) and `X-App-Data-Cache` (whether `cache/` and `code_cache/` are in it). The app is stopped first; `restart` starts it again afterwards. The cache is left out when it is bigger than `maxCacheSize` or would push the total over `maxSize`; data alone over `maxSize` → 413, no data → 404, another app action running → 423, not `ready` → 400. Called by the api; the proxy refuses it from browsers (decision #49) | `ExportAppData` |
| `GET` | `/v1/device` | `DeviceState`: `{airplaneMode, wifi, mobileData, batterySaver, batteryLevel, charging, darkMode, fontScale, density, defaultDensity, rotation, networkProfile?, timeZone, locale, locales, languageScope, geo?: {latitude, longitude}, canFakeGeo, canSimulateBattery, autoTime, timeOffset}`; `languageScope` is `system` (the locales are the system languages) or `app` (phones without root: only the app under test's language, set with `cmd locale set-app-locales`), `canSimulateBattery` is false where only battery saver works; `rotation` is `Surface.ROTATION_*`, `timeOffset` is device clock minus real time in ms, `networkProfile` is absent when the device can't emulate network conditions, `locales` is the system language list (`locale` first, the rest add keyboard layouts), `geo` is absent while the GPS reports the emulator's default position | `Device` |
| `PATCH` | `/v1/device` | `DeviceSettings` (any subset of the writable fields above; `locales` replaces the whole list; `resetGeo: true` puts the default GPS position back; `density: 0` restores the default; `timeOffset` sets the clock to real time + offset and turns `autoTime` off; `autoTime: true` syncs the clock) → `DeviceState` | `UpdateDevice` |
| `POST` | `/v1/device/actions/{volume-up\|volume-down\|mute\|screen-off\|lock\|unlock\|back\|home\|recents\|notifications\|quick-settings\|rotate-left\|rotate-right}` | 204 | `DeviceAction` |
| `GET` | `/v1/device/screenshot` | `image/png` of the current screen | `Screenshot` |
| `GET` | `/v1/tunnels?probe=` | SSE, `event: tunnels` with `{adb: [{user, client, since}], reverse: [{port, user, since, connections, state}]}` — what the ssh-gateway (`client: ssh`) and browsers (`client: browser`) have open into the device; the first event is the current set. `state` (`unknown`, `up`, `down`) says whether a server answers behind the port on the publisher's machine; `probe=true` makes the agent check it while the stream is open (decision #52) | `WatchTunnels` |
| `GET` | `/v1/tunnels/current` | the same `Tunnels` once, as JSON, for the api | `Tunnels` |
| `GET` | `/v1/metrics` | SSE, `event: metrics` every ~2 s with `{at, interval, device: {cores, cpu, memoryUsed, memoryTotal, storageUsed, storageTotal, rxRate, txRate}, app?: {processes: [{pid, name, cpu, memory}], fps, jank}, host?: {cpu, cpuLimit, throttled, memoryUsed, memoryLimit}, thermal: [{source, type, name, celsius}]}` (decision #40). `cpu` percentages are of all device cores, `memory` is PSS, rates are bytes/s since the previous sample; `app` is absent while the app is closed, `host` is the container an emulator runs in. The device is only sampled while someone listens | `WatchMetrics` |
| `WS` | `/display/scrcpy?codec=&maxSize=&maxFps=&bitRate=` | the screen: device → browser binary messages are the scrcpy 3.3.3 video socket after its dummy byte (64-byte device name, codec meta, packets with frame meta), browser → device binary messages are scrcpy control messages (architecture.md "Screen"). `codec` is `h264` (default), `h265` or `av1`; a codec the device can't encode closes the socket with 4001 (`contract.DisplayUnsupportedCodec`). Invalid options → 400 | – |
| `WS` | `/adb` | the browser's ADB connection (decision #51): binary messages carry raw adb protocol bytes to and from adbd, relayed packet by packet; OPENs of `reboot:`, `unroot:`, `remount:`, `tcpip:`, `usb:`, `sideload:`, `*-verity:` are answered with CLSE. On phones the agent speaks the device side itself (decision #68): CNXN without AUTH, every OPEN checked against the refusal list, `root:`, `reverse:`, frida-server forwards and the provider's `adb.shell` policy, allowed ones replayed through `host:transport:<serial>` on the host adb server. The api proxy allows it per `adb.browser` / `adb.ownerOnly` (403 otherwise) and sets `X-Holtdroid-User` to the signed-in user; 502 before the upgrade when adbd is unreachable | – |
| `WS` | `/display/audio` | device audio: binary messages are a scrcpy 3.3.3 audio socket after its dummy byte (4-byte codec id, `opus` or 0 when the device can't capture, then packets with frame meta); browser messages are ignored | – |
| `WS` | `/devtools/{socket}/page/{id}` | proxied CDP WebSocket | – |
| `GET` | `/devtools-frontend/@{rev}/…` | cached DevTools frontend; the UI opens `inspector.html?ws(s)=<host>/s/{provider}/{session}/devtools/{socket}/page/{id}` | – |

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
| `GET` | `/api/v1/artifacts?source=&cursor=&limit=` | artifacts the caller may see (private ones only for owner/admins) from every source or one, newest first, offset cursor. Items: `{source, id, revision, fileName, size, uploadedAt, meta, app?, iconUrl?, canManage}` — `id` is base64url of the key, `meta` the sidecar, `app` the parsed APK once cached; per-source failures come back in `errors[]` |
| `PATCH` | `/api/v1/artifacts/{source}/{id}` | `{visibility}` → artifact; owner or admin, 403 on `readOnly` sources, 404 when the caller can't see it |
| `DELETE` | `/api/v1/artifacts/{source}/{id}` | APK + sidecar; owner or admin (ownerless: admin), 403 on `readOnly` sources |
| `GET` | `/api/v1/icons/{key}` | PNG by cache key (from `iconUrl`), immutable |
| `GET` | `/api/v1/uploads` | `{enabled, source?, maxSize}` |
| `POST` | `/api/v1/uploads` | multipart `file` (+ `visibility`, `title`, `note`, `changelog`) → 201 artifact; 403 when disabled, 422 when not an APK, body capped at `maxSize` |
| `GET` | `/api/v1/providers` | `{name, capabilities, capacity, error?}` per provider |
| `GET` | `/api/v1/sessions` | `{items, errors}`, each item with `idleDeadline` and `ttlDeadline` |
| `POST` | `/api/v1/sessions` | `{source, artifactId, provider?, slot?, location?, appData?: {id, cache}, queue?}`. Without `provider` the api takes the first provider in `providers[]` order that offers the location and has a free slot (for app data, one that can restore it); `slot` needs `provider` (decision #76). 404 for artifacts the caller can't see or app data that isn't the caller's for that package, 403 for `appData` while app data is off, 409 when no slot is free (or others are queued for that provider) and `queue` is false, 422 for an invalid APK or unknown location. With `queue: true` it waits in line (one per target: any provider, a provider, or one slot) until a slot frees up; cancelling the request leaves the line (decision #57) |
| `GET` | `/api/v1/sessions/{provider}/{id}` | one session |
| `DELETE` | `/api/v1/sessions/{provider}/{id}` | owner or admin only; with app data on, a `ready` session's app data is saved into the owner's first (a failed save is logged and audited, the session is stopped anyway) |
| `POST` | `/api/v1/sessions/{provider}/{id}/app-data` | owner or admin; saves the app data now into the session owner's saves and restarts the app → `AppDataView`; 403 when off, 404 when the app has no data, 413 over `appData.maxSize`, 423 while another app action runs |
| `GET` | `/api/v1/app-data?package=` | the caller's saves, newest first: `{enabled, cache, export, keep, maxAge, items: [{id, package, label?, versionName?, versionCode?, source, artifactId, iconUrl?, cache, size, compressed, createdAt, lastUsedAt, expiresAt?}]}`; `maxAge` in seconds, `size` bytes on the device, `compressed` bytes stored |
| `DELETE` | `/api/v1/app-data/{package}/{id}` | the caller's own save only (admins included), 404 otherwise |
| `GET` | `/api/v1/app-data/{package}/{id}/download` | `application/zstd` attachment; 403 when `appData.export` is off |
| `POST` | `/api/v1/sessions/{provider}/{id}/extend` | owner or admin only; counts as activity |
| `POST` | `/api/v1/sessions/{provider}/{id}/heartbeat` | `{active}`; sent every 30 s by a visible session tab, `active` = the user gave input since the previous heartbeat |
| `GET` | `/api/v1/admin/audit` | admins only (403 otherwise): `{enabled, events, oldest?, maxEvents, maxAge (s), persistent, actors, actions}` of the api's audit store |
| `GET` | `/api/v1/admin/audit/events?action=&result=&service=&actor=&session=&q=&since=&until=&before=&limit=` | admins only: `{items, next?}` newest first; `action`, `result`, `service` take comma-separated lists, an action matches exactly or by group (`session` = `session.*`), `q` searches every field case-insensitively, `before` is the `next` of the previous page, `limit` ≤ 500 (default 100); 404 when the store is off |
| `GET` | `/api/v1/admin/audit/export?…` | admins only: every event matching the same filters as `application/x-ndjson`, newest first; emits `audit.export` |
| `GET` | `/api/v1/events` | SSE `event: sessions`, the full `{items, errors}` whenever it changes; `event: artifacts` `{revision}` whenever any source changes |
| `*` | `/s/{provider}/{id}/…` | proxy to the session's agent (HTTP + WS); any authenticated user may use it; non-GET requests count as activity |
| `GET` | `/internal/artifacts/{key}` | APK download for agents by cache key, **internal port only** |
| `GET` | `/internal/app-data/{key}` | app data download for agents, **internal port only**; `key` is `{user hash}/{package}/{id}.tar.zst`, ids carry 96 random bits |
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
