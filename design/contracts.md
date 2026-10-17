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

Sync jobs announce builds with a **launch link**:
`{publicURL}/?source={source}&launch={id}`, `id` = base64url (no padding)
of the key inside the source — the same ID the UI API uses
(`GET /api/v1/artifacts/{source}/{id}`). The home page opens the launch
dialog for it; with `&quick=1` it starts a session right away on the
last-used provider and location and falls back to the dialog. The Slack sync lives in its own repository,
[kriakiku/holtdroid-slack-sync](https://github.com/kriakiku/holtdroid-slack-sync)
(decision #30).

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
	ID    string // node name for emulators, device serial for phones
	Label string
	State string // "free" | "busy" | "offline"
}

type CreateSession struct {
	ArtifactURL string // api-internal URL the agent downloads from, pinned to one cached revision
	ArtifactRef string // "{source}/{key}@{revision}", opaque to providers
	Package     string
	Owner       string
	Location    string // optional
}

type Session struct {
	ID           string
	Slot         string
	Owner        string
	Package      string
	ArtifactRef  string // as given in CreateSession
	Location     string
	State        string // provisioning|booting|installing|instrumenting|ready|stopping|failed
	Reason       string // set when failed
	Detail       string // optional progress note while starting, e.g. "waiting for the session image"
	AgentURL     string // in-cluster base URL of the agent, never exposed to browsers
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
| `GET` | `/v1/network` | `{location, externalIp, country}` | `Network` |
| `PUT` | `/v1/network/location` | `{location}` → `network` | `SetLocation` |
| `POST` | `/v1/app/{restart\|reinstall}` | 202; `restart` also starts a closed app, `reinstall` uninstalls first (clears data) and installs the current build | `App` |
| `POST` | `/v1/install` | `Install` → 204 once the new build runs; 400 with the adb message when it can't be installed (the previous build is kept or put back). Called by providers; the api proxy refuses it from browsers | `Install` |
| `GET` | `/v1/device` | `DeviceState`: `{airplaneMode, wifi, mobileData, batterySaver, batteryLevel, charging, darkMode, fontScale, density, defaultDensity, rotation, networkProfile?, timeZone, locale, autoTime, timeOffset}`; `rotation` is `Surface.ROTATION_*`, `timeOffset` is device clock minus real time in ms, `networkProfile` is absent when the device can't emulate network conditions | `Device` |
| `PATCH` | `/v1/device` | `DeviceSettings` (any subset of the writable fields above; `density: 0` restores the default; `timeOffset` sets the clock to real time + offset and turns `autoTime` off; `autoTime: true` syncs the clock) → `DeviceState` | `UpdateDevice` |
| `POST` | `/v1/device/actions/{volume-up\|volume-down\|mute\|lock\|unlock\|back\|home\|recents\|notifications\|rotate-left\|rotate-right}` | 204 | `DeviceAction` |
| `GET` | `/v1/device/screenshot` | `image/png` of the current screen | `Screenshot` |
| `WS` | `/display/scrcpy` | the screen: device → browser binary messages are the scrcpy 3.3.3 video socket after its dummy byte (64-byte device name, codec meta, packets with frame meta), browser → device binary messages are scrcpy control messages (architecture.md "Screen") | – |
| `WS` | `/devtools/{socket}/page/{id}` | proxied CDP WebSocket | – |
| `GET` | `/devtools-frontend/@{rev}/…` | cached DevTools frontend; the UI opens `inspector.html?ws(s)=<host>/s/{provider}/{session}/devtools/{socket}/page/{id}` | – |

Planned tunnel endpoints, served on the agent's **second port** (`:8081`),
reachable only by the ssh-gateway and never through the api proxy:

| Method | Path | Notes |
|--------|------|-------|
| `WS` | `/tunnel/adb` | one WebSocket per ADB connection, raw bytes to the device's adbd |
| `WS` | `/tunnel/reverse/{port}` | publishes device `localhost:{port}` (`adb reverse`); device-side connections arrive as yamux streams over this socket; closing it removes the reverse |

`Session` will gain `tunnelUrl` (the agent's tunnel base URL) next to
`agentUrl`.

### ssh-gateway internal API

`contract.RegisterSSHGateway` / `contract.SSHGatewayClient`; the in-memory
key store is `internal/sshgateway.Keys`.

| Method | Path | Notes |
|--------|------|-------|
| `PUT` | `/v1/users/{user}/keys` | from the api: `{groups, admin, keys: [authorized_keys lines]}`; replaces that user's set and restarts its TTL; an empty list drops it. 409 with `errors[].location = body.keys[i]` when another user holds a key — nothing is changed then |
| `GET` | `/v1/health` | readiness |

The fake provider (`internal/provider/fake`) implements all of it with
placeholder HTML for the screen and DevTools pages.

## UI API (served by api)

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
| `GET` | `/api/v1/ssh` | `{enabled, host?, port, allowADB, allowReverse, clientIsolation}` for the UI; empty `host` = the UI's own host |
| `PUT` | `/api/v1/ssh/keys` | `{keys: [{name, publicKey}]}` (≤ 32) — the caller's full key list, replaces the previous one on every gateway replica → `{replicas}`; 404 when SSH is disabled, 422 on invalid, duplicate or already-claimed keys (`errors[].location = body.keys[i].publicKey`), 502 when no replica accepted |
| `GET` | `/api/v1/sources` | `[{name, readOnly}]` |
| `GET` | `/api/v1/artifacts?source=&cursor=&limit=` | artifacts the caller may see (private ones only for owner/admins) from every source or one, newest first, offset cursor. Items: `{source, id, revision, fileName, size, uploadedAt, meta, app?, iconUrl?, canManage}` — `id` is base64url of the key, `meta` the sidecar, `app` the parsed APK once cached; per-source failures come back in `errors[]` |
| `PATCH` | `/api/v1/artifacts/{source}/{id}` | `{visibility}` → artifact; owner or admin, 403 on `readOnly` sources, 404 when the caller can't see it |
| `DELETE` | `/api/v1/artifacts/{source}/{id}` | APK + sidecar; owner or admin (ownerless: admin), 403 on `readOnly` sources |
| `GET` | `/api/v1/icons/{key}` | PNG by cache key (from `iconUrl`), immutable |
| `GET` | `/api/v1/uploads` | `{enabled, source?, maxSize}` |
| `POST` | `/api/v1/uploads` | multipart `file` (+ `visibility`, `title`, `note`, `changelog`) → 201 artifact; 403 when disabled, 422 when not an APK, body capped at `maxSize` |
| `GET` | `/api/v1/providers` | `{name, capabilities, capacity, error?}` per provider |
| `GET` | `/api/v1/sessions` | `{items, errors}`, each item with `idleDeadline` and `ttlDeadline` |
| `POST` | `/api/v1/sessions` | `{source, artifactId, provider, location?}`; 404 for artifacts the caller can't see, 409 when no slot is free, 422 for an invalid APK or unknown location |
| `GET` | `/api/v1/sessions/{provider}/{id}` | one session |
| `DELETE` | `/api/v1/sessions/{provider}/{id}` | owner or admin only |
| `POST` | `/api/v1/sessions/{provider}/{id}/extend` | owner or admin only; counts as activity |
| `POST` | `/api/v1/sessions/{provider}/{id}/heartbeat` | `{active}`; sent every 30 s by a visible session tab, `active` = the user gave input since the previous heartbeat |
| `GET` | `/api/v1/events` | SSE `event: sessions`, the full `{items, errors}` whenever it changes; `event: artifacts` `{revision}` whenever any source changes |
| `*` | `/s/{provider}/{id}/…` | proxy to the session's agent (HTTP + WS); any authenticated user may use it; non-GET requests count as activity |
| `GET` | `/internal/artifacts/{key}` | APK download for agents by cache key, **internal port only** |
| `GET` | `/internal/sessions/{slug}` | planned, gateway only: `{provider, id, owner, state, tunnelUrl}` |
| `POST` | `/internal/sessions/{slug}/activity` | planned, gateway only: tunnel traffic counts as activity |

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
