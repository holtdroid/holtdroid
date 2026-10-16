# Architecture

## Goals

1. A user opens one URL, sees the APKs in the configured sources (a folder
   or bucket that a Slack sync or CI fills, plus their own uploads), picks
   one and gets a running Android device with that APK installed.
2. In the same page: the device screen (interactive), Chrome DevTools attached
   to the app's WebViews with a target switcher, two-way clipboard sync, and a
   VPN location selector for the device's traffic.
3. The home page shows all active sessions with owner, uptime, idle countdown
   and location; sessions are bounded (N slots) and are deleted after a period
   of inactivity or a hard TTL.
4. The APK is never modified.
5. Extensible without touching the core: new origins of builds (any job
   that writes files into a source), new device kinds (physical rooted phones next), new VPN vendors, new secret backends.

### Non-goals (for now)

- Running APK test suites / CI integration (may come later via the same
  contracts).
- Multi-tenant isolation beyond "who owns which session".
- iOS.
- Play Store images or Google account sign-in.

## Components

```mermaid
flowchart LR
  user([Browser]) -->|forward-auth| ingress[Ingress]
  ingress --> api

  subgraph holtdroid namespace
    api["api<br/>(BFF + embedded web UI)"]
    prov["provider-emulator"]
    subgraph session["Session Pod (one per device)"]
      agent["agent + emulator"]
      vpn["vpn (sing-box)"]
    end
  end

  api -- "list / download / upload" --> sources[("sources<br/>folder / S3")]
  sync["sync jobs (Slack, CI, …)<br/>not part of Holtdroid"] -. "*.apk + .meta.json" .-> sources
  api -- Provider API --> prov
  api -- "Agent API (proxied /s/{provider}/{id}/*)" --> agent
  sync -->|Web API| slack[(Slack)]
  prov -->|client-go| k8s[(Kubernetes API)]
  agent -->|artifact download| api
  agent -. shares netns .- vpn
  vpn --> gw[("VPN gateway<br/>(operator's, optional)")]
  vpn --> internet[(Internet)]
```

All services are the same Go binary (`holtdroid <subcommand>`) and the same
image, except the session image, which adds the Android emulator, system
image and Frida on top of the agent.

| Service | Responsibility | Talks to |
|---------|----------------|----------|
| `api` | UI REST API and static web UI, artifact sources (list, watch, uploads), APK cache, provider registry, session proxy `/s/{provider}/{id}/*` (HTTP + WebSocket), activity tracking, idle/TTL reaper, auth | source stores, providers, agents |
| `provider-emulator` | Owns emulator sessions: slot accounting, creates/deletes session Pods and their per-session Secrets (rendered sing-box config), reports capabilities | Kubernetes API |
| `agent` | Runs inside a session: boots the device, installs and launches the APK under Frida, serves the screen, DevTools proxy, clipboard, network control, status events | ADB, Frida, sing-box clash API |

The **api is stateless**. Providers are the source of truth for sessions; the
emulator provider stores everything in Pod labels/annotations. Identities live
in signed cookies and APKs in a re-fillable cache (`storage`: filesystem or
S3), so api replicas are interchangeable. Sources are folders or S3 prefixes
the api lists itself (see "Artifact sources" below); uploads are files plus a
sidecar in a writable source, so they live wherever that source lives. Activity
timestamps are held in memory by the api and flushed to the provider
(`POST /sessions/{id}/touch`) at most every 30 s, so an api restart loses at
most 30 s of activity.

The api also has a SQL database (decisions.md #22). For now it is in-memory
SQLite only, so it holds nothing that must survive a restart; SQLite with
Litestream replication to S3 and PostgreSQL come later.

## Request flow: launching a session

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as api
  participant S as source (folder / S3)
  participant P as provider-emulator
  participant K as Kubernetes
  participant G as agent (session pod)

  B->>A: GET /api/artifacts
  A->>S: list *.apk + read changed .meta.json
  S-->>A: objects (key, ETag/mtime)
  A-->>B: visible artifacts (+ cached metadata/icons)
  B->>A: POST /api/sessions {source, artifactId, provider, location}
  A->>S: stat, then download this revision (if not cached)
  A->>A: parse APK (package, version, label, icon), cache
  A->>P: POST /sessions {artifactUrl, package, location, owner}
  P->>K: create Secret (sing-box config) + Pod
  P-->>A: {sessionId, agentUrl, state: provisioning}
  A-->>B: {sessionId}
  B->>A: GET /s/{provider}/{id}/status (SSE, proxied)
  G->>A: GET /internal/artifacts/{cache key} (APK)
  G-->>B: booting → installing → instrumenting → ready
  B->>A: /s/{provider}/{id}/display, /s/{provider}/{id}/devtools/... (proxied)
```

## Artifact sources

A source is a `storage.Store` — a directory or an S3 bucket/prefix — that the
api lists itself (`internal/source`, decisions.md #27). There is no source
service: anything that wants to publish builds writes files.

```
builds/app.apk
builds/app.apk.meta.json        # optional sidecar
uploads/3f9a1c02b7d4/my.apk     # portal upload
uploads/3f9a1c02b7d4/my.apk.meta.json
```

- **Artifacts.** Every `*.apk` at any depth; hidden entries and unreadable
  directories are skipped. The key is the artifact's identity inside the
  source; the UI API exposes it base64url-encoded.
- **Sidecar.** `<file>.apk.meta.json`, all fields optional, unknown ones
  ignored: `title`, `note`, `changelog`, `uploadedBy`, `uploadedAt`, `link`,
  `origin`, `tags`, `owner`, `visibility` (`public`|`private`). Invalid JSON
  is logged and ignored. Sidecars are memoised by their own revision.
- **Revisions.** ETag on S3, size + mtime on a filesystem, hashed. The APK
  cache key is `hash(source, key, revision)`, the provider gets
  `ArtifactRef = {source}/{key}@{revision}` and an `artifactUrl` pointing at
  that exact cache entry, so a replaced file never mixes with sessions
  started from the old one.
- **Watching.** Each replica lists each source every `pollInterval`
  (default 30 s) and after its own writes, keeps a fingerprint per source,
  queues uncached revisions for warm-up and pushes `event: artifacts` with a
  combined revision over `/api/v1/events`; the UI refetches.
- **Visibility.** `private` artifacts are listed and launchable only for the
  `owner` and admins. Visibility changes and deletes are for the owner and
  admins; ownerless files (dropped by a sync job) only for admins; sources
  marked `readOnly` refuse both.
- **Uploads.** `POST /api/v1/uploads` (multipart, `uploads.maxSize`,
  `uploads.enabled` default true) parses the APK first, writes the sidecar
  then the file to `{uploads.prefix}/{random}/{sanitized name}` in
  `uploads.source` (default: the first source) and seeds the cache.

## Session lifecycle

```
provisioning → booting → installing → instrumenting → ready → (stopping) → gone
                                   ↘ failed (reason) ↗
```

- **Activity** = user input, not traffic (decisions.md #14): the session tab
  tracks pointer/keyboard/wheel/touch input on itself and inside its
  same-origin screen and DevTools iframes, and sends
  `heartbeat {active}` every 30 s while visible. Mutating requests through
  the session proxy (clipboard, location, app actions) and Extend count too.
  An open but untouched tab does not keep a device alive.
- **Reaper** (in api, every 30 s): deletes a session when
  `now - lastActivity > idleTimeout` (default 30m) or
  `now - createdAt > maxTTL` (default 8h). "Extend" in the UI counts as
  activity.
- **Slots**: each provider reports capacity. The emulator provider's slot
  count is configured; one session per node is enforced with required pod
  anti-affinity, nodes are selected with nodeSelector/tolerations from Helm
  values. When no slot is free, launching is disabled in the UI.

## Emulator session internals

Session Pod (rendered by `provider-emulator`, golden-tested):

| Container | Image | Notes |
|-----------|-------|-------|
| `emulator` | `holtdroid-session` | privileged, `/dev/kvm` hostPath, `/dev/shm` memory emptyDir, ~3–4 CPU / 5–7 GiB. Runs `holtdroid agent` as PID 1 supervisor |
| `vpn` | upstream `sing-box` | `NET_ADMIN`, `/dev/net/tun`. Config from the per-session Secret |

Plus a Secret (sing-box config, may contain VPN credentials) with an
ownerReference to the Pod, so it is garbage-collected with it.

Inside `emulator`, the agent starts and supervises:

1. `Xvfb` → `emulator` (`-gpu swiftshader_indirect -no-snapshot -no-audio
   -no-boot-anim -fixed-scale`, x86_64 `google_apis` API 35 image, the `holtdroid` AVD
   baked into the image) → `x11vnc` on localhost, clipped to the device
   screen (`internal/agent/emulator`).
   Any of them exiting fails the session; a later failure (install, crash
   loop) leaves the device running for inspection.
2. Waits for `sys.boot_completed`, runs `adb root`, pushes and starts
   `frida-server` (same pinned version as the agent's devkit, decision #23).
3. Downloads the APK from the api, `adb install -r -g`.
4. Bundles `internal/agent/script/agent.js` with Frida's compiler and spawns
   the package under it:
   - forces `WebView.setWebContentsDebuggingEnabled(true)`: the setter is
     hooked to always pass `true`, and it is called from
     `Instrumentation.callApplicationOnCreate` and after every WebView
     constructor;
   - exports clipboard RPC (`getClip`, `setClip`) and registers an
     `OnPrimaryClipChangedListener` that sends changes to the agent.
   The app is in the foreground, so it is allowed to access the clipboard.
   Only the app's main process is instrumented.
5. Re-spawns on app crash/exit (five exits within a minute fail the
   session); `POST /app/restart|reinstall` drive this explicitly, reinstall
   uninstalls first so app data is cleared.

The provider configures the agent through environment variables
(`HOLTDROID_ARTIFACTURL`, `HOLTDROID_PACKAGE`, `HOLTDROID_LOCATION`,
`HOLTDROID_CLASHAPI` and `HOLTDROID_EMULATOR__DNSSERVER` when a VPN sidecar
runs; see `agent.Config` for the
rest, all with defaults matching the session image).

The pipeline only depends on two interfaces, `agent.Device` (adb) and
`agent.Instrumenter` (Frida), so it is unit-tested without a device.

Why the system image works for ARM-only APKs: Google's x86_64 images for
API 30 and 34+ (not 31–33, decision #25) ship `libndk_translation`, so ARM native libraries run translated while
ART itself stays x86_64 (Frida's Java hooks are unaffected).

### Screen

The agent serves noVNC static files under `/display/` and bridges its
WebSocket to `x11vnc` (`coder/websocket` ↔ TCP) — no websockify.
`GET /display/` redirects to `vnc.html?autoconnect=1&path=…` with the path
built from `X-Forwarded-Prefix`, because noVNC resolves its WebSocket path
against the host root. The
emulator provider advertises `display: novnc`. A future phone provider
advertises `display: scrcpy` and the UI swaps the renderer.

### DevTools

- WebView exposes a DevTools endpoint per process on an abstract UNIX socket
  `@webview_devtools_remote_<pid>` (Chrome uses `@chrome_devtools_remote`).
  The agent scans `/proc/net/unix` every 2 s, keeps an
  `adb forward tcp:<port> localabstract:<socket>` per socket and aggregates
  every socket's `/json/list` into `GET /devtools/targets`
  (`{socket, process, id, type, title, url}`). The process name and the
  fallback frontend revision come from the socket's `/json/version`
  (`Android-Package`, `WebKit-Version`).
- `WS /devtools/{socket}/page/{id}` reverse-proxies to the forwarded port
  with `Host: localhost` and without `Origin`, because the DevTools HTTP
  handler rejects other Host headers (DNS rebinding protection) and foreign
  origins.
- The DevTools frontend is not bundled in WebView. The agent proxies
  `https://chrome-devtools-frontend.appspot.com/serve_rev/@{rev}/…` under
  `/devtools-frontend/@{rev}/…` with an on-disk cache; `rev` comes from
  the target's `devtoolsFrontendUrl`.
- Everything is same-origin (`/s/{provider}/{id}/…` on the api host). This matters
  because forward-auth cookies (SameSite=Lax) are not sent on WebSockets
  opened from a cross-site iframe.
- The UI's target switcher sets the DevTools iframe `src` to
  `/s/{provider}/{id}/devtools-frontend/@{rev}/inspector.html?wss={host}/s/{provider}/{id}/devtools/{socket}/page/{target}`
  and reconnects automatically when the selected target disappears and a new
  one with the same URL and type appears (the selection is derived from the
  target list on every poll, so a re-created WebView is picked up).

### Clipboard

- Browser → device: the user clicks "Paste to device" (needs a user gesture
  for `navigator.clipboard.readText()`), the UI posts to `/clipboard`, the
  agent calls Frida `setClip`.
- Device → browser: listener events go out over SSE
  `/clipboard/events`. The UI calls `navigator.clipboard.writeText()` when the
  tab is focused and always shows the last value in a popover.
- Best-effort fallback: x11vnc/noVNC clipboard is also wired, so text works
  even if the Frida hook is broken.

### VPN

- The `vpn` sidecar shares the Pod network namespace. sing-box runs a `tun`
  inbound with `auto_route` and `route_exclude_address` for the cluster and
  LAN CIDRs (`vpn.bypassCIDRs`). Pod-to-api traffic and replies to proxied
  requests therefore bypass the tunnel, while all emulator egress (TCP, UDP,
  DNS) goes through it with no configuration inside Android. Loopback is
  never routed, so `adb reverse` and the SSH tunnels are unaffected.
- A location is `{id, label, outbound}` where `outbound` is any sing-box
  outbound or endpoint object, inline or as a secret reference resolving to
  its JSON (decision #28). `internal/vpn` renders them, tagged with the
  location id, plus `direct` (unless `vpn.direct: false`) behind a
  `selector` (`interrupt_exist_connections`). Holtdroid has no VPN vendor
  code.
- DNS: the emulator is started with `-dns-server <vpn.dns>`, so its queries
  enter the tun; the sidecar hijacks them and answers through a resolver
  that dials `vpn.dns` via the selector. Server names inside outbounds are
  resolved by the Pod's resolver (`local`), or by `vpn.resolver` when set —
  needed for `*.cluster.local` names, which sing-box's `local` sends to mDNS.
- The clash API listens on `127.0.0.1:9090`. `PUT /network/location` on
  the agent maps to `PUT /proxies/select {"name": "<location>"}`.
  Capabilities carry the offered locations and `defaultLocation`
  (`vpn.Config.DefaultLocation`); with `vpn.direct: false` there is no
  `direct` to pick. The UI preselects the last provider launched and the last
  location the user picked per provider (`localStorage`), else the default;
  quick launch uses the same choice without the dialog.
  `GET /network` reports the current selection and the external
  IP/country, looked up through the tunnel at `ipInfoURL` (default
  `https://ipinfo.io/json`, cached 30 s).
- Recommended deployment: the operator runs one shared sing-box **VPN
  gateway** holding one tunnel per location (WireGuard from any vendor, or
  anything sing-box speaks) with a SOCKS inbound whose username selects the
  location (`auth_user` route rules); each location's outbound is that SOCKS
  server with the location as username. One vendor key then serves any
  number of sessions without WireGuard peer collisions. Public docs:
  "Shared VPN gateway".

```mermaid
flowchart LR
  subgraph pod["Session Pod"]
    emu["emulator"] --> tun["sing-box sidecar<br/>tun + selector"]
  end
  tun -- "socks user=de" --> gw["VPN gateway<br/>(operator's sing-box)"]
  tun -. direct .-> internet[(Internet)]
  gw -- "WireGuard de" --> vde[(VPN server DE)]
  gw -- "WireGuard nl" --> vnl[(VPN server NL)]
```

## SSH access (planned)

Developers reach a device from their own machine over SSH, without VPNs or
kubectl:

```sh
# ADB from the laptop (Android Studio, scrcpy, adb install, chrome://inspect …)
ssh -N -p 2222 -L 5555:adb:5555 emulator-7f3a9c@android.example.com
adb connect localhost:5555

# make the laptop's dev servers reachable as localhost:3000 / :5000 on the device
ssh -N -p 2222 -R 3000:localhost:3000 -R 5000:localhost:5000 emulator-7f3a9c@android.example.com
```

The SSH username is the session **slug** (`{provider}-{id}`), shown with
ready-to-copy commands on the session page.

### One gateway, routed by username

There is a single `ssh-gateway` service with one TCP port, not an sshd per
device: one address and host key for everyone, nothing to expose per session,
and the "SSH server of a device" is the gateway acting on behalf of the
session named in the username. It is written on `golang.org/x/crypto/ssh` and
is **not a shell server**:

| SSH request | Behaviour |
|-------------|-----------|
| `session` channel (shell, exec, subsystem/sftp, pty) | Accepted only to print a short help text (the forwarding commands for this session), then closed with exit status 1. Nothing is ever executed. |
| `direct-tcpip` (`-L`) | Allowed when `allowADB` is on and the destination is the alias `adb:5555` (also `localhost:5555`). Every other destination is refused — the gateway must never become a proxy into the cluster. |
| `tcpip-forward` / `cancel-tcpip-forward` (`-R`) | Allowed when `allowReverse` is on and the port is inside `reversePorts` (default `1024-65535`). The requested bind address is ignored; the port is published on the **device's** loopback. |
| agent forwarding, X11, `streamlocal`, env, keepalive@openssh | Agent/X11/streamlocal refused, env ignored, keepalives answered. |

### Tunnels to the device

The gateway never talks to ADB or the device directly; the session's agent
does, through a tunnel endpoint on a **separate agent port** (`:8081`) that
the api's browser proxy cannot reach:

- **ADB (`-L`)** — per SSH channel the gateway opens
  `WS /tunnel/adb` on the agent and splices bytes. The agent connects it to
  the emulator's adbd (`localhost:5555` inside the pod).
- **Published ports (`-R`)** — per forward the gateway opens
  `WS /tunnel/reverse/{port}`. The agent runs `adb reverse tcp:{port}
  tcp:{local}` so the device's `localhost:{port}` lands on an agent listener,
  and multiplexes each incoming connection as a `hashicorp/yamux` stream over
  that WebSocket; the gateway turns each stream into a `forwarded-tcpip`
  channel to the SSH client. Closing the forward or the SSH connection runs
  `adb reverse --remove`.

Using `adb reverse` instead of the emulator's `10.0.2.2` alias keeps this
provider-agnostic: physical phones get the same feature for free.

### Keys: the browser is the source of truth

- Users manage public keys on an **SSH keys** page. The list lives in the
  browser (IndexedDB) — add, rename, remove — and is never stored on the
  server.
  Records are scoped to the signed-in user (an anonymous user who picks a
  new name starts with an empty list) and open tabs refresh each other
  through a `BroadcastChannel`. The UI validates keys as they are pasted
  (type, RSA size, private-key paste guard) and shows SHA256 fingerprints;
  the api repeats the validation authoritatively.
- The UI pushes the full list with `PUT /api/v1/ssh/keys` on app start, on
  every change and every 5 minutes while the app is open. The api validates
  the keys (parsed with `x/crypto/ssh`, RSA ≥ 2048, ed25519/ecdsa) and fans
  the list out to every gateway replica (A records of its headless Service)
  together with the user's identity.
- Gateways keep `{fingerprint → user, groups, admin}` **only in memory**, each
  user's set expiring after `keyTTL` (default 24h) unless refreshed. A gateway
  restart forgets everything; the next time the user opens the site, the keys
  are back. This matches the stateless rule — nothing to back up, nothing to
  migrate.
- The same public key registered by two users is rejected for the second one.

### Who may connect where

On login the gateway resolves the slug through the api's internal endpoint
(`GET /internal/sessions/{slug}` → provider, agent tunnel URL, owner) and
checks:

- `clientIsolation: false` (default) — any user with a registered key may use
  any running session;
- `clientIsolation: true` — only the session owner and `auth.adminGroups`.

Unknown slug, session not `ready`, or a forbidden user all fail the same way
("no such session") so slugs can't be probed.

### Activity and lifetime

Traffic through a tunnel counts as activity: the gateway reports
`POST /internal/sessions/{slug}/activity` at most every 30 s while bytes
flow (this is real use of the device even when no browser tab is open —
decision #14 still holds for idle *viewers*). When a session is deleted, its
tunnels are closed and SSH clients see the connection drop.

### Configuration

```yaml
# ssh-gateway
listen: ":2222"
hostKey: file:/run/secrets/ssh/host_ed25519   # stable across restarts and replicas
apiURL: http://holtdroid-api-internal:8081
allowADB: true
allowReverse: true
clientIsolation: false
reversePorts: "1024-65535"
keyTTL: 24h
maxTunnelsPerConnection: 32
```

```yaml
# api
ssh:
  enabled: true
  gatewayURL: http://holtdroid-ssh-gateway-headless:8080  # every A record gets the key updates
  publicHost: android.example.com                          # shown in the UI commands; default: publicURL's host
  publicPort: 2222
  allowADB: true            # mirror the gateway flags; the UI only uses them to pick
  allowReverse: true        # which commands to show
  clientIsolation: false
```

`PUT /api/v1/ssh/keys` validates the list (≤ 32 keys, no duplicates, no
`authorized_keys` options), resolves `gatewayURL`'s host and pushes the
normalized lines to every address. It succeeds when at least one replica
accepted them; a key another user holds fails the whole update with 422 and
the per-key `errors[].location` (`body.keys[i].publicKey`) the UI uses to
mark that row. `holtdroid dev` runs the gateway's key API in-process
(`--ssh-keys :8092`) so the UI can be exercised without the gateway.

Exposure is a plain TCP Service (LoadBalancer/NodePort) or an ingress TCP
route (Traefik `IngressRouteTCP` on a dedicated entrypoint).

## Security model

- Sign-in is `auth.mode`: `anonymous` (random names), `password`, `oidc`,
  `header` (trusted forward-auth proxy) or `none`. The first three use a
  signed JWT cookie (decisions.md #17). `/api/v1/auth*` and the static UI are
  public; everything else under `/api/` and `/s/` requires an identity.
  `allowedGroups` restricts `oidc`/`header`.
- Session pods are **privileged** (KVM, the emulator's networking). Run them in
  a dedicated namespace on nodes you are fine dedicating to this.
- Agents are reachable only from the api and the ssh-gateway (NetworkPolicy in
  the chart); every browser request goes through the api's proxy and auth.
  The agent's tunnel port is never proxied to browsers.
- The ssh-gateway executes nothing and forwards only to the session's ADB and
  to explicitly published device ports; see "SSH access".
- Session owners are recorded; any authenticated user can see sessions, only
  the owner or a member of `adminGroups` can stop them.
- Secrets are referenced, never stored in config files or the repo; see
  [contracts.md](contracts.md#configuration-and-secrets).

## Future: physical devices

A `provider-physical` service manages an inventory of rooted phones (Magisk,
wireless ADB). Slots are phones instead of nodes, one long-lived agent per
phone, `display: scrcpy` via ws-scrcpy, VPN via the WireGuard Android app
controlled by intents, and session end triggers a cleanup (uninstall, clear
data) instead of a Pod delete. Nothing in api, web or the contracts needs to
change for it; that is the bar every contract change must keep meeting.

## Future: Docker-only deployment

Kubernetes is not required by the design, only by the first provider. A
`provider-docker` service would implement the same Provider contract against
the Docker Engine API on one host:

| Concern | Kubernetes (`provider-emulator`) | Docker (`provider-docker`) |
|---------|-----------------------------------|----------------------------|
| Session state | Pod labels/annotations | Container labels (`holtdroid.session=…`) |
| Slots | Nodes with KVM, anti-affinity | Fixed `slots` per host (CPU/RAM budget) |
| VPN | `vpn` container in the Pod | sing-box container, emulator joins it with `network_mode: container:<vpn>` |
| Per-session secret | Secret with ownerReference | Config written to a per-session volume, removed with the session |
| Agent reachability | Pod IP | Container IP on a dedicated bridge network the api is attached to |
| Cleanup | Owner references | Delete everything carrying the session label |

The session image, the agent and everything above the Provider contract stay
the same. To keep the two providers from drifting, the session's container
set (images, env, devices, mounts, the sing-box config) should be described
once in a neutral `internal/session` spec that each provider renders into its
own objects. Several Docker hosts are simply several providers in the api's
`providers` list. Caveat: the provider needs the Docker socket, i.e. root on
that host — document it next to the privileged-pod warning.
