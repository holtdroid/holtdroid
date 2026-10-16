# Contracts

All inter-service APIs are JSON over HTTP, defined once in
`internal/contract` as Go interfaces + huma operations:

| Contract | Interface | Server registration | Go client |
|----------|-----------|---------------------|-----------|
| Source | `contract.Source` | `contract.RegisterSource(api, impl)` | `contract.NewSourceClient(url, hc)` |
| Provider | `contract.Provider` | `contract.RegisterProvider(api, impl)` | `contract.NewProviderClient(url, hc)` |
| Agent | `contract.Agent` | `contract.RegisterAgent(api, impl)` | — (browsers only, via the api proxy) |

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

## Source API

Implemented by `source-*` services. Consumed only by the api.

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/v1/artifacts?cursor=&limit=` | `{items: Artifact[], nextCursor?}` newest first |
| `GET` | `/v1/artifacts/{id}` | `Artifact` |
| `GET` | `/v1/artifacts/{id}/download` | the APK bytes (`application/vnd.android.package-archive`), `Content-Length` when known |
| `GET` | `/v1/health` | `{ok: true}` |

```go
type Artifact struct {
	ID         string    // stable within the source, e.g. Slack file ID
	FileName   string
	Size       int64
	UploadedAt time.Time
	UploadedBy string    // display name
	Note       string    // e.g. the Slack message text
	Link       string    // permalink back to the origin (message/thread)
}
```

Sources do not parse APKs. The api downloads, parses with
`internal/apk` (package, versionName, versionCode, label, icon, ABIs,
minSdk) and caches both file and metadata keyed by `{source}/{id}`.

### source-slack specifics

- Config: `token` (secret ref, bot token `xoxb-…`), `channels` (IDs),
  `pollInterval` (default 1m), `lookback` (default 30d).
- Bot scopes: `channels:history`, `groups:history`, `files:read`; the bot must
  be invited to each channel.
- Lists messages via `conversations.history`, keeps files whose name ends in
  `.apk` (and optionally `.apks`/`.xapk` later), downloads with
  `url_private_download` + bearer token.

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
| `GET` | `/v1/health` | `{ok: true}` |

```go
type Capabilities struct {
	Kind      string     // "emulator", "physical", …
	Display   string     // "novnc" | "scrcpy"
	DevTools  bool
	Clipboard bool
	Locations []Location // empty when VPN is not supported/configured
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
	ArtifactURL string // api-internal URL the agent downloads from
	Package     string
	Owner       string
	Location    string // optional
}

type Session struct {
	ID           string
	Slot         string
	Owner        string
	Package      string
	ArtifactRef  string // "{source}/{id}"
	Location     string
	State        string // provisioning|booting|installing|instrumenting|ready|stopping|failed
	Reason       string // set when failed
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
| `GET` | `/v1/health` | 200 once `ready`, 503 before | `Ready` |
| `GET` | `/v1/status` | SSE, `event: state` with `{state, reason?, detail?}`; first event is the current state | `WatchStatus` |
| `GET` | `/v1/devtools/targets` | `{items: [{socket, pid, process, id, type, title, url, frontendRev}]}` | `Targets` |
| `GET` | `/v1/clipboard` | `{text}` | `Clipboard` |
| `POST` | `/v1/clipboard` | `{text}` → 204 | `SetClipboard` |
| `GET` | `/v1/clipboard/events` | SSE, `event: clip` with `{text}` on every device-side change | `WatchClipboard` |
| `GET` | `/v1/network` | `{location, externalIp, country}` | `Network` |
| `PUT` | `/v1/network/location` | `{location}` → `network` | `SetLocation` |
| `POST` | `/v1/app/{restart\|reinstall}` | 202 | `App` |
| `GET` | `/display/` | the screen renderer page, loaded in an iframe as-is; for noVNC it serves its own `vnc.html` and `/display/websockify` | – |
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

### ssh-gateway internal API (planned)

| Method | Path | Notes |
|--------|------|-------|
| `PUT` | `/v1/users/{user}/keys` | from the api: `{groups, admin, keys: [authorized_keys lines]}`; replaces that user's set and restarts its TTL |
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
| `GET` | `/api/v1/ssh` | planned; `{enabled, host, port, allowADB, allowReverse, clientIsolation}` for the UI |
| `PUT` | `/api/v1/ssh/keys` | planned; `{keys: [{name, publicKey}]}` — the caller's full key list, replaces the previous one; 422 on invalid or already-claimed keys |
| `GET` | `/api/v1/sources` | configured sources |
| `GET` | `/api/v1/artifacts?source=&cursor=&limit=` | without `source`: first page of every source merged, newest first; with it: that source, cursor paging. Items carry cached APK metadata once known; per-source failures come back in `errors[]` instead of failing the call |
| `GET` | `/api/v1/artifacts/{source}/{id}/icon` | PNG, 404 until the APK was parsed |
| `GET` | `/api/v1/providers` | `{name, capabilities, capacity, error?}` per provider |
| `GET` | `/api/v1/sessions` | `{items, errors}`, each item with `idleDeadline` and `ttlDeadline` |
| `POST` | `/api/v1/sessions` | `{source, artifactId, provider, location?}`; 409 when no slot is free, 422 for an invalid APK or unknown location |
| `GET` | `/api/v1/sessions/{provider}/{id}` | one session |
| `DELETE` | `/api/v1/sessions/{provider}/{id}` | owner or admin only |
| `POST` | `/api/v1/sessions/{provider}/{id}/extend` | owner or admin only; counts as activity |
| `POST` | `/api/v1/sessions/{provider}/{id}/heartbeat` | `{active}`; sent every 30 s by a visible session tab, `active` = the user gave input since the previous heartbeat |
| `GET` | `/api/v1/events` | SSE `event: sessions`, the full `{items, errors}` whenever it changes |
| `*` | `/s/{provider}/{id}/…` | proxy to the session's agent (HTTP + WS); any authenticated user may use it; non-GET requests count as activity |
| `GET` | `/internal/artifacts/{source}/{id}` | APK download for agents, **internal port only** |
| `GET` | `/internal/sessions/{slug}` | planned, gateway only: `{provider, id, owner, state, tunnelUrl}` |
| `POST` | `/internal/sessions/{slug}/activity` | planned, gateway only: tunnel traffic counts as activity |

The APK cache is warmed in the background: listing artifacts queues up to
`cache.warm` uncached ones for download and parsing, so icons and package
names show up without anyone launching them first.

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
    url: http://holtdroid-source-slack:8080
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
