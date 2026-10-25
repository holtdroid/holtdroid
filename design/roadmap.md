# Roadmap

Work top to bottom; phases are ordered by risk (the riskiest technical
unknowns are proven before building the platform around them). Tick items
when they are merged with tests. Add items when you discover work; do not
silently drop any.

## Phase 0 — Design (this directory)

- [x] Architecture, contracts, decisions, agent rules

## Phase 1 — Scaffold

- [x] Go module `github.com/holtdroid/holtdroid`, `cmd/holtdroid` with cobra subcommands (`api`, `provider-fake`, `agent`, `dev`, `openapi`; `source-dir` was removed by decision #27)
- [x] `internal/contract`: Provider/Agent interfaces (Source removed by decision #27), huma registration, Go clients, round-trip tests
- [ ] `internal/contract/conformance`: reusable suite for third-party implementations
- [x] `internal/secrets` (env, file, openbao) with tests
- [x] `internal/auth` with tests (all modes: see Phase 1.5)
- [x] Config loading (koanf, YAML + `HOLTDROID_` env) shared helper
- [x] `web/`: Vite + React + TS 7 strict + Tailwind v4 + shadcn/ui + TanStack Router/Query, embedded via `embed`
- [x] `docs/`: Astro Starlight site (start, concepts, configuration, operations, extending) with mermaid
- [x] `Makefile`, `mise.toml`, `golangci-lint` v2 config, oxlint/oxfmt configs, `.gitignore`
- [x] `.editorconfig`
- [x] CI workflow (`make openapi` drift check, lint, test, build, docs) and GitHub Pages docs deploy
- [x] `helm lint` in CI
- [x] `CONTRIBUTING.md`, `SECURITY.md`

## Phase 1.5 — Sign-in, storage, delivery

- [x] Sign-in modes: anonymous (random animal names), shared password, OIDC (PKCE + userinfo), header, none — signed JWT cookie, stateless
- [x] Login screen, user menu, sign-out / new name in the UI
- [x] `internal/storage`: filesystem and S3 (minio-go) backends; APK cache on top of it
- [x] `images/Dockerfile` (distroless, multi-arch) and release workflow: `ghcr.io/holtdroid/holtdroid:<sha>` on every push to `main`, chart to OCI on tags
- [x] Helm chart `deploy/helm/holtdroid` (api with a data PVC for the `local` source and uploads, provider-fake, ingress, extraObjects)
- [x] Live deployment tracking `main` (Argo CD, android.homelab.example)
- [x] Session image pre-pull and emulator provider values in the chart (with Phase 3)

## Phase 2 — Session prototype (highest risk)

Goal: one hand-written Pod on a KVM node proves the device side end to end.

- [x] `images/session.Dockerfile`: Ubuntu, emulator + platform-tools + `system-images;android-35;google_apis;x86_64` (pinned zips, no cmdline-tools), baked AVD, frida-server, scrcpy-server and agent devkit pinned together (decision #23)
- [x] `internal/agent/emulator`: process supervision (headless emulator), boot wait, `adb root`, frida-server start
- [x] APK install from a URL; spawn under frida-go with the instrumentation script (WebView debugging + clipboard RPC)
- [x] `internal/agent`: status SSE, screen bridge (`/display/scrcpy`)
- [x] DevTools: socket discovery, adb forwards, aggregated targets, CDP WS proxy with `Host: localhost`, frontend proxy + cache
- [x] Clipboard endpoints + SSE
- [x] Agent side of the VPN: `/network` (external IP via `ipInfoURL`) + location switch via the clash API
- [x] `vpn` sidecar with a static WireGuard config in the hand-written Pod
- [x] Manual check on a real cluster: ARM-only APK runs (`arm64-v8a` in `ro.product.cpu.abilist`), WebView DevTools socket appears, CDP `Runtime.evaluate` and the frontend work through the agent, clipboard both ways, external IP changes with location
- [x] DevTools frontend in the portal against a real WebView page (needs Phase 3 to launch a real session from the UI)
- [x] Record findings and surprises in `decisions.md` (#25, #26)

## Phase 3 — Provider, source, api

- [x] `internal/vpn` (decision #28): locations as sing-box outbounds/endpoints (inline or secret ref), optional `direct`, selector + clash API, tun with `bypassCIDRs`, device DNS hijacked through the tunnel (`vpn.dns`, emulator `-dns-server`), `vpn.resolver` for `*.cluster.local`; golden tests checked with `sing-box check` 1.14.2; docs page "Shared VPN gateway" (one sing-box with a tunnel per location, SOCKS user = location)
- [x] `provider-emulator`: capacity from nodes + config, Pod/Secret rendering (golden tests), create/list/delete, state from annotations, `touch`; `vpn` config → capabilities `Offered()`, `vpn.Render` into the per-session Secret, `HOLTDROID_CLASHAPI` + `HOLTDROID_EMULATOR__DNSSERVER` when enabled, `Validate()` at startup
- [x] Artifact sources in the api (decision #27): filesystem/S3 stores, `.meta.json` sidecars, revisions keyed into the cache and `ArtifactRef`, polling + `event: artifacts`, uploads (`uploads.*`), public/private, delete by owner/admin, `readOnly` sources; UI upload dialog, drag & drop, changelog/tags, manage menu; temporary uploads deleted `uploads.temporaryTTL` after their last use (decision #42)
- [x] Slack sync job, independent of the api (decision #30, [holtdroid/holtdroid-sync](https://github.com/holtdroid/holtdroid-sync), job `slack`): channels, thread replies and forwards → `{channel}/{file id}/{name}.apk` + sidecar in an S3/folder source; optional reaction and thread reply with APK info and a launch link; fake Slack server in tests
- [x] Launch links `/?source=…&launch=…` open the launch dialog (`GET /api/v1/artifacts/{source}/{id}`)
- [x] Builds from S3 buckets ([holtdroid/holtdroid-sync](https://github.com/holtdroid/holtdroid-sync), job `s3`): copy mode and credentials broker, AWS IAM Identity Center device login with refresh and notifications through shoutrrr; `include` rules on sources and `s3.credentialsURL` in the api
- [x] Builds from GitHub releases ([holtdroid/holtdroid-sync](https://github.com/holtdroid/holtdroid-sync), job `github`): `.apk` assets of the newest releases → `{owner}/{repo}/{tag}/{asset}` with the release notes as changelog, `include` rules, announcements through shoutrrr
- [x] Chromium browser builds per milestone ([holtdroid/holtdroid-sync](https://github.com/holtdroid/holtdroid-sync), job `chromium`, decision #91): `ChromePublic.apk` from the x86_64 snapshots, channels + newest 10 + every 2nd, every 5th past the newest 24, pruned as they fall out
- [x] DevTools for Chromium browser builds from a source: the build's `frontend` tag reaches the agent as `CreateSession.Frontend`, the fallback for the app's own sockets
- [x] `internal/apk`: metadata + icon (densest bitmap or composed adaptive icon, re-rendered at 256 px, untrusted-input limits) + ABIs with a fixture; `x.apk.icon.png` sidecars override the extracted icon
- [x] `api`: registries, artifact merge, APK cache (LRU on disk, background warm-up), session create flow, `/s/{provider}/{id}` proxy, input-based activity + flush, reaper, UI API, SSE events, internal artifact endpoint
- [x] `provider/fake` (+ fake agent) for `holtdroid dev` and tests
- [ ] Conformance suite covers Provider and Agent; every implementation runs it (round-trip tests exist for fake)

## Phase 4 — Web UI

- [x] Generated OpenAPI clients for the UI API and the Agent API (`openapi-typescript` + `openapi-fetch`) wired into TanStack Query
- [x] Home: apps grouped by package as cards (latest version, build and version counts, sources, launch of the latest build), `/apps/$pkg` with the artifact list of one app (icon, label, version, package, ABIs, uploader, date, note, source filter, search), launch dialog (provider and location preselected from the last launch in `localStorage` — location per provider — falling back to the first free provider and its `defaultLocation`, ABI warning), quick-launch button that launches with those preselected settings without the dialog, sessions panel (slots, owner, uptime, idle progress, location, open/extend/stop), live via SSE
- [x] Session page: start stepper, resizable split (display | DevTools) that follows the screen's aspect by default (toggle on the divider, at most 70% for the screen), toolbar (target select, location select + IP badge, clipboard popover, restart/reinstall/stop), input-based heartbeat, toasts
- [x] Device controls (decision #31): rail next to the screen (lock/unlock, volume, rotate, back/home/recents, notifications, screenshot) and a non-modal settings sheet (airplane, Wi-Fi, mobile data, battery saver/charging/level, dark theme, font and display size, emulated network conditions, system language, time zone, clock presets ±5 s…±1 y and an exact moment in the user's time zone); `/v1/device` in the Agent API
- [x] Device controls in the rail (decision #58): network (airplane on click, VPN location), battery (saver on click, 65% at boot), display (theme cycle with "match the portal"), language and region (keyboard layouts as extra system languages, faked GPS through `geo fix`), date and time (clock shift stepper); amber dot and reset for changed sections
- [x] Device controls verified on the real emulator (2026-10-17): `cmd alarm set-time`/`set-timezone`, `date +%s%N`, battery saver after `dumpsys battery unplug`, airplane mode, `adb emu network speed/delay`, rotation, lock/unlock, notifications, locale switch through `app_process` (decision #59)
- [x] Screen over scrcpy instead of noVNC (decision #34): agent bridge `/display/scrcpy` (scrcpy-server 3.3.3 per connection), headless emulator without Xvfb/x11vnc/noVNC, canvas renderer with `@yume-chan/scrcpy` + WebCodecs (multi-touch, wheel, keyboard as text/key codes, Ctrl/Cmd+V paste), fake provider replays a recording over the same protocol
- [x] More from scrcpy and Tango (decision #36): clipboard through a control-only scrcpy server with autosync instead of Frida, every server as the shell user, stream options (H.264/H.265/AV1 checked against the device's encoders, resolution, frame rate, bitrate) in a "Stream and keyboard" popover, device audio (`/display/audio`, Opus, WebCodecs + `@yume-chan/pcm-player`), virtual USB keyboard (UHID) next to text input, screenshots from the decoded frame, key frame on tab return, rail keys/notifications/quick settings over the control socket
- [x] App lifecycle and versions (decision #35): no automatic restart after the app is closed (`appRunning`, "Start app"), launcher starts instrumented through spawn gating, version switcher on the session page (builds of the same package, keep data or clean install) through `POST /api/v1/sessions/{provider}/{id}/install` → provider → agent
- [x] Origin links from sidecars accept only absolute `http(s)` URLs (api and UI), with a tooltip on the button
- [x] Metrics bar at the bottom of the session page (decision #40): device CPU and memory, app CPU/PSS per process (WebView renderers included), app fps and jank from `gfxinfo`, network, `/data`, device and node temperatures, the emulator container's CPU/memory/throttling from cgroup v2, and the browser's stream fps/bitrate; `GET /v1/metrics` in the Agent API, sampled only while watched
- [x] GPS map (decision #97): MapLibre map of keyless OpenFreeMap tiles in the GPS panel, proxied by the api (`map.*`, `/api/v1/map/tiles/…`); clicking or dragging the marker overrides the position
- [x] GPS routes (decision #98): walk, run or drive along points clicked on the map, in straight lines, optionally in a loop; the agent moves the test providers every second (`PATCH /v1/device` `route`, `stopRoute`)
- [x] GPS routes along roads (decision #99): "Follow roads" asks Valhalla through the api (`routing.url`, `POST /api/v1/map/route`) and sends its path as the route
- [x] Realistic GPS route speed (decision #100): speeding up and slowing down, slower turns, a slow drift around the cruising speed, the current speed in the panel

## Phase 4.5 — SSH access (ADB and published ports)

Design: architecture.md "SSH access". Can start against the fake provider
(fake adb = echo server, fake reverse = synthetic device connections) before
the real agent exists.

- [x] Agent tunnel port `:8081`: `WS /tunnel/adb`, `WS /tunnel/reverse/{port}` (yamux, `adb reverse` add/remove); fake agent implementation
- [x] `Session.tunnelUrl` in the Provider contract; api internal `GET /internal/sessions/{slug}` and `POST …/activity`
- [x] `ssh-gateway` subcommand on `x/crypto/ssh`: host key from a secret ref, public-key auth against in-memory keys, slug routing, help text instead of shells, `direct-tcpip` only to `adb:5555`, `tcpip-forward` within `reversePorts`, flags `allowADB` / `allowReverse` / `clientIsolation`, `keyTTL`, per-connection tunnel limit
- [x] api: `GET /api/v1/ssh`, `PUT /api/v1/ssh/keys` (validation, duplicate-claim check, fan-out to all gateway replicas); gateway key API contract + in-memory `sshgateway.Keys` (TTL, claims), served in-process by `holtdroid dev`
- [x] UI: SSH keys page (IndexedDB per user, add/rename/remove with undo, live validation and fingerprints, sync status, periodic sync)
- [x] UI: "SSH" popover on the session page (decision #38): live tunnel status from the agent's `GET /v1/tunnels`, port list in `localStorage` (default 80, 443, 3000-3010; ranges and `device:local`), one copyable command for all ports plus optional ADB
- [x] Chart: ssh-gateway Deployment + headless Service + TCP exposure (LoadBalancer/NodePort or Traefik `IngressRouteTCP`), NetworkPolicy gateway → agent tunnel port
- [x] Tests: gateway refuses exec/shell/sftp/agent forwarding, refuses any `-L` target except adb, isolation on/off, key expiry and fan-out, end-to-end `-L`/`-R` against the fake agent with `x/crypto/ssh` as the client
- [x] Verify on the real emulator (2026-10-17, through `kubectl port-forward` to the gateway): `adb connect` through the tunnel gives `device` straight away (`ro.adb.secure=0`, root shell), `-R 3000` and `-R 80` answer on the device's `127.0.0.1`, `GET /v1/tunnels` shows both and the ADB client
- [x] Docs page "SSH access"
- [x] SSH keys page: the caller's open tunnels by device, a green count on the header's key button (`GET /api/v1/ssh/tunnels`); published ports probed and coloured, click copies the localhost URL (decision #52)
- [x] `user-{pseudonym}@host` publishes `-R` ports on all of the user's sessions, following new and ended ones by polling the api every 5 s; UI switch "All my devices" (decision #50). Later: push session changes to the gateway instead of polling
- [x] Banner with the logo after a verified login, a bare "Not found." for missing or forbidden sessions, OpenSSH's version string (decision #47)
- [x] Unknown keys from the terminal (decision #46): the gateway has the client prove the key, prints a portal link with a one-time code and waits; the `/ssh` page confirms and adds the key (`sshGateway.keyRequests`, on by default). `sshGateway.skipHostKeyCheck` (off by default) puts `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null` into the UI's commands
- [x] homelab (2026-10-17): gateway with its host key (`secret/holtdroid` `ssh_host_key`), Traefik `ssh` entrypoint and `IngressRouteTCP`, the rule for the entrypoint's port on the ingress VIP's node firewall, and the UniFi WAN port forward `homelab-holtdroid-ssh`; the gateway is reachable from the WAN address on a non-default port (`sshGateway.publicPort`; the Service stays on 2222) so scanners of the usual SSH ports don't find it
- [x] Auto-reconnect (decision #61): UI switch **Reconnect** wraps the command in a `while` loop with a 1 s pause, `ServerAliveInterval` and `ExitOnForwardFailure`; the gateway disconnects clients that stop answering keepalives (`keepaliveInterval`, 15 s)

## Phase 4.55 — ADB in the browser

Design: decision #51, architecture.md "ADB in the browser".

- [x] Agent `WS /adb` on the main port (fake agent too); api proxy rule with `adb.browser` / `adb.ownerOnly`, `X-Holtdroid-User` from the identity, `GET /api/v1/adb`, audit `adb.connect` / `adb.disconnect`
- [x] adb packet relay in the agent for `/adb` and `/tunnel/adb` that refuses `reboot:`, `unroot:`, `remount:`, `tcpip:`, `usb:`, `sideload:`, `*-verity:`; `/v1/tunnels` tells browser and SSH clients apart
- [x] Fake adbd in the fake provider: shell v1/v2 with a pty, exec, sync v1, binary logcat with a generator and `am crash`, `pm`/`am`/`dumpsys`/`settings`/`cmd`/`bugreportz`, a small file system
- [x] UI: one Tango connection per session page; tabs next to DevTools: Logcat, Files, Terminal, App, Device; crash toast; screen recording from the rail (framed phone or the whole tab under a details strip, MP4 streamed to disk, auto-record — decisions #66, #74; replaced by server recordings, #96)
- [x] Tests: `internal/adbproto`, the relay's filter, the fake adbd, the proxy end to end with audit; `bun test` for the dumpsys parsers
- [x] Device audio on by default; vibrations (`/v1/vibrations` from `dumpsys vibrator_manager`, fake agent every 45 s) as a toast plus a synthesized buzz (decision #54)
- [x] Screen off / locked badge over the device screen (`/v1/screen` from `dumpsys power` and the keyguard state)
- [x] Phone body around the screen with a volume rocker (media volume slider and Android mute through the agent, amber while muted; device audio on/off in the stream card) and a power key (lock modes, wake and unlock) on its side, corner arcs with navigation and rotation, network, stream, clipboard, display (with brightness) and SSH cards with quick-settings-style shades (decision #94)
- [ ] Display shape: the agent reads rounded corners (`roundedCorners`, API 31+, radius and center per corner) and the cutout (`DisplayCutout` insets, bounding rects, path; API 28+, emulated cutout overlays included) from `dumpsys display` once per boot and serves them in physical pixels for the natural orientation through `/v1/screen`; unknown output or older Android falls back to a plain rectangle; fake agent serves a sample shape; `bun test`/Go tests on captured `dumpsys` from the emulator and a phone. UI scales it to the stream size and current rotation, clips the canvas to the real shape and uses it for the recording's device frame instead of guessed corners
- [x] Verify on the real emulator (2026-10-17, by the maintainer on the live deployment): several adbd connections at once (agent, SSH, tabs), logcat under load, pushes over 1 MiB, bugreportz streaming, the WebView provider switch

## Phase 4.6 — Database

Design: decisions.md #22. No backward compatibility before the first release.

- [x] `internal/db`: `database.type` config (`memory` default), `modernc.org/sqlite` in-memory, goose migrations embedded and run at startup, `sqlc` config + generated queries, `make sqlc` and a drift check in `make check` and CI
- [x] Wire it into the api and `holtdroid dev`; first table `session_events` (created/stopped/reaped, actor, artifact, reason), write-only for now; tests through `internal/api/api_test.go`
- [ ] Read side for `session_events` (history in the UI) once there is a use for it
- [ ] Later: `sqlite` file driver with embedded Litestream (restore on start, replicate to the `storage` S3 settings or its own), chart enforces `replicas: 1`
- [ ] Later: `postgres` driver (pgx), queries kept to the subset both engines accept, CI runs the db tests against both
- [ ] Public docs: storage/architecture pages stop saying "no database" once anything persistent ships; configuration page for `database`

## Phase 4.11 — Connect client

Design: decision #64. Replaces the key-based parts of Phase 4.5.

- [x] api as SSH user CA (`sshGateway.caKey`, a secret ref): enrollment codes, refresh tokens with rotation, `POST /api/v1/connect/enroll`, `POST /api/v1/connect/refresh` → certificate; gateway trusts the CA public key instead of the key store
- [x] The `holtdroid` client (`cmd/holtdroid-connect`): key generation, enrollment, certificate refresh, reconnect, `holtdroid-control` subsystem (hello, local listening ports, sessions, settings)
- [x] Manual port mode in the client and the portal; settings changed from the portal through the gateway replica holding the connection
- [x] ADB per device on stable local ports, `adb connect`/`disconnect` when `adb` is on `PATH`
- [x] TUI (bubbletea): sections on the left (Overview, Devices, Ports, Log, Settings), published ports with toggles, version and paths, installing the `holtdroid` command, mouse clicks and wheel; status lines without a terminal (`--plain`)
- [x] Slim TUI (decision #75): no device tools in the client; Devices opens a session or `chrome://inspect` in the browser, **Launch a device** opens the portal
- [x] Publish modes on the client (decision #65): manual, dev servers, everything; `--publish-mode`, the TUI's Mode line with a warning, shown on the Computers page; adb server, emulators and other clients never published automatically
- [x] `GET /tunnel.sh` and the client binaries in the api image (darwin/linux, amd64/arm64), sha256 and host key rendered into the script
- [ ] Automatic port mode: agent iptables `LOG` for SYNs to unused loopback ports, port requests to the client, deny list, portal warning
- [x] Portal: "Computers" page (hostname, OS, ports, ADB) for connected computers; remove the SSH keys page, key requests, `skipHostKeyCheck`, `clientIsolation`, the reconnect loop
- [ ] Offline computers with last seen and the mode switch, once there is a database and an automatic mode
- [ ] Verify on the real emulator through the live gateway
- [ ] With a persistent database (Phase 4.6): `computers` table, rotation generation, reuse detection, revoke that drops the computer's connections
- [ ] Later: `connect.ps1` and a Windows build
- [x] Docs: rewrite "SSH access" around the client

## Phase 4.7 — Traffic inspection proxy (optional)

Inspect and edit the HTTP(S) traffic of the app under test, per session.
Off by default on every level: `proxy.enabled` in config (feature flag, hides
the UI entirely when false), and per session a toggle the user picks in the
launch dialog. The UI remembers the user's last choice in `localStorage` and
preselects it. Needs a decision entry before code (engine, CA handling,
licensing).

- [ ] Decide the engine (decisions.md): candidates `lqqyt2423/go-mitmproxy` (MIT, Go, mitmproxy-like flow model, addons, own web UI), `elazarl/goproxy` (BSD, library only, we'd build the UI), whistle (Node, rich rule UI, would be a separate sidecar image), Bettercap (GPL-3, a network attack/recon framework — ARP/Wi-Fi/BLE spoofing we don't need; its HTTP proxy module alone doesn't justify the size and the licence; likely rejected). Leaning: go-mitmproxy embedded in the agent, whistle as an optional sidecar later
- [ ] Per-session CA generated by the agent at boot (never shared between sessions), installed into the system trust store via `adb root` (Android 14+: the APEX conscrypt store, see decision #25 image); download link for the CA in the UI
- [ ] Routing: proxy listens inside the session Pod, device traffic pointed at it with `settings put global http_proxy` so it toggles **live without restarting the device or the app**; upstream goes through the existing sing-box VPN, so location switching keeps working
- [ ] Agent API: `GET/PUT /proxy` (enabled, state), flows list + SSE stream, flow detail (headers, bodies with size cap), replay, simple rewrite/breakpoint rules; fake agent implementation; contracts.md updated
- [ ] UI: launch-dialog toggle (persisted in `localStorage`), toolbar switch on the session page, "Network" panel next to DevTools (flows table, detail, filter, HAR export)
- [ ] Apps that don't trust user/system CAs (network security config, pinning): document the limits; optional Frida-based trust hook reusing the existing instrumentation, behind its own flag, for testing your own builds
- [ ] Tests: CA generation, toggle on/off round-trip, flows over a real `httptest` TLS server through the proxy, golden test for the rendered proxy settings
- [ ] Docs page "Traffic inspection"

## Phase 4.8 — MCP server for AI agents (optional)

Let a user connect their own AI agent (Claude Code, Cursor, …) to Holtdroid:
list builds, launch and stop devices, attach to sessions, drive the screen,
use DevTools and publish ports. Off by default (`mcp.enabled`); when off,
nothing is mounted and the UI shows nothing. Needs a decision entry first.

- [ ] Decide the shape (decisions.md). Proposal: a remote MCP endpoint in the api (`/mcp`, Streamable HTTP, official `modelcontextprotocol/go-sdk`) for platform tools, plus a local `holtdroid mcp` stdio command for things that need the user's machine (adb/port tunnels via the SSH gateway)
- [ ] Auth for non-browser clients: personal access tokens (signed, scoped, expiring, stateless like the cookie — decision #17), issued and revoked from the UI; MCP OAuth flow against the existing OIDC mode as a follow-up
- [ ] Platform tools: `artifacts_list`, `session_launch` (artifact, location, proxy on/off), `sessions_list`, `session_status`, `session_stop`, `session_extend`, `location_set`, `clipboard_get/set`, `proxy_toggle`, `proxy_flows`; all through the existing UI API rules (limits, ownership, admin)
- [ ] Device tools via [mobile-mcp](https://github.com/mobile-next/mobile-mcp): either run it next to the agent in the session image and proxy its MCP through `/s/{provider}/{id}/mcp/mobile`, or have `holtdroid mcp` spawn it locally against `adb` tunnelled through the SSH gateway (Phase 4.5). Pick one in the decision (in-session avoids local Node/adb on the user's machine)
- [ ] DevTools tools via [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) pointed at the agent's CDP proxy (`--browserUrl`), one per selected WebView target; same in-session vs local choice
- [ ] Port publishing tools: `port_reverse` / `port_forward` wrapping the SSH gateway tunnels (needs Phase 4.5)
- [ ] Activity: MCP calls count as session activity, so an agent-driven session isn't reaped mid-run
- [ ] UI: "Connect your AI agent" page with tokens and copyable client configs
- [ ] Tests: MCP round-trip with the go-sdk client against `holtdroid dev` (fake provider), token scopes and expiry
- [ ] Docs page "AI agents (MCP)"

## Phase 4.9 — Audit log and telemetry

Make Holtdroid easy to plug into monitoring and log aggregation (Loki,
ELK, Datadog, …) and answer "who did what, when". Stays stateless: events
leave the process; the api only keeps a bounded, losable list of recent
ones for the admin page.

- [x] Audit events with a stable, versioned schema emitted as JSON lines through a dedicated `slog` logger (`"log":"audit"`), separate from debug logs, so collectors can route them: sign-in/out, session launch/stop/reap/extend, location switch, proxy on/off, clipboard writes (no content), artifact upload/delete/visibility, SSH key sync, SSH connect/disconnect and every tunnel opened (`-L`/`-R`, port), MCP token issue/revoke and tool calls. Actor, session, provider, client IP, user agent, result (decision #44; proxy and MCP events land with Phases 4.7 and 4.8)
- [x] Optional sinks besides stdout: OTLP logs, webhook (batched, retried); config `audit.*`, off except stdout by default
- [x] Metrics: Prometheus `/metrics` on a separate port (sessions active/launched/failed, slots, launch duration, APK cache hits, session-proxy and SSH connections; traffic-proxy and MCP metrics land with Phases 4.7 and 4.8), from api, provider, agent and ssh-gateway; `PodMonitor` in the chart behind a flag (decision #44)
- [x] Tracing: OpenTelemetry (`go.opentelemetry.io/otel`) across api → provider → agent with W3C trace context on the contract clients; exporter off by default
- [x] `session_events` (Phase 4.6) fed from the same audit events instead of a parallel path
- [x] Tests: audit event per action in `internal/api/api_test.go`, schema golden file; docs page "Monitoring and audit"
- [x] Audit log page for admins: bounded `audit.store` in the api (memory, optional JSON lines file; chart: data volume, tmpfs or none), ssh-gateway events forwarded to it, filters, live mode, JSON lines export (decision #48)
- [x] Inventory page for admins: every provider's slots with model, Android, battery, memory, storage and sensors (phones over adb, emulator nodes from the Node object plus a `node-info` DaemonSet reading `/proc` and `/sys`), maintenance holds per slot and per provider kept by the providers, `provider.maintenance` audit event (decision #79)

## Phase 4.10 — App data

Save an app's private data when a session stops and start the next session
of the same app from it (decision #49).

- [x] Agent: `/v1/app-data/export` (tar of `/data/data` and `/data/user_de`, zstd, cache optional within `maxCacheSize`/`maxSize`) and restore before the first start with uid remapping and the app's SELinux context; `CreateSession.appData`
- [x] api: save on Stop and on reap, save on demand, `appData.storage` (default: the shared store under `app-data/`, safe from cache eviction), retention by count per user and app and by age since last use, private to the owner, `appData.export` switch, audit events and metrics
- [x] UI: App data page (list, download, delete), save choice and cache checkbox in the launch dialog, quick launch menu on hover with the last choice remembered, "Save app data now" on the session page
- [x] Tests: api end to end with the fake provider, agent export/restore with a fake device, archive filter, pod golden
- [x] `restoring` session state with `Session.appData`, shown as its own step while the device starts
- [x] Launch queue: `queue: true` waits in a per-provider line while every slot is busy, the launch page shows it and leaving the page gives up the place (decision #57)
- [x] Launch target: **Any** provider by default (first free in `providers[]` order), or a provider and optionally one of its devices, busy ones included (they wait in line); `CreateSession.slot`; flags next to VPN locations (decision #76)
- [ ] Android Keystore keys of the app (keystore2), so apps that encrypt with them survive a restore
- [ ] External app storage (`/sdcard/Android/data/{pkg}`)

## Phase 4.12 — Server-side recordings

Record sessions on the server with what surrounds the screen, watch them in
the portal and download them as a video (decision #96).

- [x] Agent: `internal/recording` muxes the scrcpy H.264 stream into fragmented MP4 segments without re-encoding, taps the newest viewer's stream or runs its own; events (device info, WebView, status, metrics, device state, network) and logcat with recording times; thumbnail; uploads in order with retries; `/v1/recording`, `CreateSession.recording`, `StatusEvent.recording`; the fake provider records its looping screen
- [x] api: recordings in storage without a database (meta, state, keep and share markers), upload endpoint with a per-recording secret, retention by age unless kept, per-user quota that deletes the oldest unkept recordings first, share links without sign-in, logcat as one text file, audit events
- [x] UI: Recordings page (preview, keep, share, delete, storage), player with the scene (logcat, phone, app, time, device, network, load), timeline, speeds, Record in the session rail, the launch dialog's Record switch, video download rendered in the browser with a progress timeline, public `/r/{token}` page
- [x] Tests: recorder (segments start with key frames, epochs, chunks, quota), api end to end with the fake provider (record, share, keep, retention, quota, on demand, upload secret), web timeline helpers
- [ ] Sound in recordings, sharing one audio capture with viewers
- [x] Logcat in the player as selectable HTML with level and text filters, click to seek, hold while selecting; stats as HTML cards in an Android look, the video download keeps the canvas scene in the same style
- [ ] Logcat filter for the app's own processes in the player

## Phase 5 — Packaging and docs

- [x] Helm chart: add provider-emulator, RBAC, NetworkPolicy, prepull DaemonSet, values for nodeSelector/tolerations/slots/resources
- [x] Release workflow: amd64 session image
- [x] Docs site content: install with Helm, Slack app setup, VPN providers, secrets backends, forward-auth examples (Authelia, oauth2-proxy), architecture, publishing builds into a source, writing a provider, troubleshooting (KVM, ARM translation, Frida)
- [x] Docs deployed to GitHub Pages
- [x] WebView test browser with presets, unlocked DevTools and adb control ([holtdroid/holtdroid-webview](https://github.com/holtdroid/holtdroid-webview), decision #62), documented under Tools

## Phase 6 — First deployment

- [x] Deploy to the maintainer's cluster via Argo CD + the Helm chart (portal with fake devices; see status.md)
- [x] Switch that deployment to `provider-emulator` + a Slack sync into an S3 source (2026-10-17; S3 and GitHub syncs too)
- [x] A shared VPN gateway for that deployment: the homelab `vpn-gateway` (namespace `downloads`) got SOCKS users `holtdroid-{bd,kz,lv,no,pl,ua}` (all its NordVPN endpoints; Bangladesh was added for Holtdroid) (see status.md)
- [x] Wire those locations into the deployment's `provider-emulator` values (outbounds with the password from `secret/vpn` → `socks_holtdroid_password`, `vpn.resolver`, `vpn.direct` as the maintainer wants)
- [ ] Fix whatever reality finds; feed it back into docs

## Phase 7 — Physical phones

Design: architecture.md "Physical devices" (threat model and
mitigations). A phone outlives its sessions, so protecting it is part of the
feature, not a follow-up. Record the final choices in decisions.md.

- [x] `provider-physical` without root (decision #67): inventory of USB phones from the config (serial, label, model from `getprop`), slots = phones with `SlotCapabilities`, one in-process agent per session, sessions and pending resets in a state file and resumed after a restart, reset after a session (uninstall, device settings, adb forwards)
- [x] Phone agent without root: scrcpy screen, audio and clipboard, install and other builds, DevTools for debuggable builds, launcher instead of Frida, phone boot that follows `adb get-state`; the session page reads `session.capabilities` (DevTools hint, no ADB, no app data save)
- [x] `images/physical.Dockerfile`: `ghcr.io/holtdroid/holtdroid-physical:<sha>` with adb (platform-tools), scrcpy-server, sing-box and the Holtdroid Tunnel APK pinned by checksum, distroless, non-root, `HOME` (adb keys) and the state file in `/var/lib/holtdroid` (decision #70)
- [x] Helm chart (decision #78): `providers.physical` pinned to the phones' node on its host network, privileged with `/dev/bus/usb`, a host directory for the state and adb's key, one Service for agents and tunnels, the api's `providers` entry
- [ ] `quarantined` state for phones that failed verification
- [x] Root mode per phone (decision #80, through Magisk `su`): Frida (DevTools for release builds), system language and clock, battery, app data, fake GPS and timezone that follow the VPN location, hide root from the app (Magisk DenyList), a transparent sing-box tun with an egress health-gate, and a calls lockdown; chosen by a `root` flag. Still open: the network-speed profile (the A05 kernel has no `sch_netem`)
- [x] VPN on phones over USB (decision #69): Holtdroid Tunnel (VpnService, own repository) to `adb reverse` to a per-session sing-box on the host with the `vpn` locations; radios off, tunnel re-checked every poll
- [x] Filtering ADB proxy on `/tunnel/adb` and `/adb` for phones (decision #68): device side of the adb protocol in the agent (`agent.ADBProxy`), every `OPEN` service checked and replayed through `host:transport:<serial>` with classic flow control; always refuse `reboot:` (any mode), `root:`, `unroot:`, `remount:`, `tcpip:`, `usb:`, `sideload:`, `*-verity:`, `reverse:`, forwards to frida-server (27042/27043); `adb.shell: full | allowlist | off` (phones default to `allowlist`); table-driven tests per service string, end-to-end with `adbproto.Client` and a real `adb` server (skipped without platform-tools) against the fake device
- [ ] Device-owner app (DPC): provisioning script, user restrictions (accounts, factory reset, safe boot, users/profiles, OEM unlock), allowed accessibility services and IMEs, enterprise FRP with the operator's account, reset-password token and `resetPasswordWithToken`; never `testOnly`, never `DISALLOW_DEBUGGING_FEATURES`
- [ ] Root kept from users: Magisk denies su to the shell uid, frida-server started by a Magisk boot script with token auth and reachable only through the agent; root watchdog re-asserts `adb_enabled`, USB functions and Developer options
- [x] Cleanup before and after sessions against a baseline recorded when the phone is first seen free (decision #71): uninstall new packages, `install-existing` removed ones, clear launcher apps' data, close recents, wipe `/sdcard`, restore changed settings, radios off and Wi-Fi networks forgotten with VPN, park after a session (battery saver, lowest brightness, screen off); no battery simulation on phones
- [x] Device owner in Holtdroid Tunnel (decision #77): restrictions (accounts, reset, users, calls/SMS, Wi-Fi/Bluetooth/VPN config, unknown sources), keyguard off + PIN reset token, always-on VPN with lockdown, system updates postponed and updaters hidden, dialer/SOS hidden, soft kiosk (lock task with home and recents, Settings/dialer/stores left out), adb watchdog; the agent drives it per session
- [ ] Verification after cleanup (no accounts, admins, users; device owner and watchdog alive; OEM unlock off; adb reachable); failure → `quarantined`, admin action to re-check or release
- [ ] Evaluate an ephemeral secondary user per session instead of in-place cleanup
- [ ] Host: USB hub with per-port power (`uhubctl`) for remote power-cycling, `fastboot reboot` for phones stuck in the bootloader; no wireless ADB in production
- [ ] Docs: phone preparation (OEM unlock off, Magisk, DPC provisioning, FRP account), `adb.shell` policy and residual risks for operators

## Phase 8 — Redroid sessions (decision #82)

Goal: several Android devices per node instead of one emulator per node.

- [x] Image `ghcr.io/holtdroid/holtdroid-redroid` (own repository): redroid 15 with Codec2 software encoders on gralloc BLOBs, `libndk_translation`, a cgroup init wrapper for privileged pods
- [x] `provider-emulator` renders redroid Pods (`android` + `agent` + `vpn`), `slotsPerNode` and per-node `slots`, slot ids `<node>-<n>`, Android and agent resources; AVD, VirtualGL and the emulator console removed
- [x] Agent: adb over TCP with reconnects, `adb root`, frida-server reached at `127.0.0.1:27042`, launches from the device found by polling instead of spawn gating (gating stops every process of the node), GPS and battery without a console, the Pod's cgroup in the metrics bar, GPS and time zone that follow the VPN location
- [x] VPN without `auto_route`: policy routing added by the agent inside Android, root traffic direct, the agent's IP check through the sidecar's mixed inbound
- [x] Session image slimmed to the agent, adb, frida-server and scrcpy-server; the pre-pull DaemonSet pulls the redroid image as an image volume
- [x] Verified on a k3s node in a scratch namespace: boot in about 6 s, install, the app under Frida, VPN egress through the gateway
- [x] Isolation on dedicated session nodes (decision #83): egress NetworkPolicy (DNS, the api and the internet only; LAN, nodes and other Pods unreachable from Android), the agent container unprivileged, users' ADB behind `redroid.shell` (allowlist by default, no Terminal tab), Android init kept off the node's sysctls
- [x] Screens picked at launch (presets of popular budget phones; `redroid.screens`) with emulated display cutouts; Android version picked at launch (`redroid.versions`, one image tag per version)
- [x] Verified on the live deployment on 2026-10-25 (sessions on k3s-3: boot, install, Frida, DevTools target, screenshot, metrics, location switch, egress policy); clipboard, audio, app data and the ADB tabs still to be tried by hand in the browser
- [x] WebView versions at launch (decision #88): holtdroid-redroid re-signs the built-in WebView with Chromium's debug key, `holtdroid-webview-sync` keeps x86_64 Chromium snapshot builds per milestone in a catalog, the api offers them (`webview.storage`, `GET /api/v1/webviews`), the agent installs the chosen one before the app, DevTools fall back to the Canary commit's frontend
- [x] Network conditions through `tc netem` on the tun (decision #93): named networks and scenarios over time (`internal/netem`), `ifb` for downloads, offered with VPN locations
- [ ] The session wallpaper on redroid: find why attaching to `system_server` after the install breaks frida-server
- [ ] A session's root that can't reach the node: user namespaces were tried and dropped (decision #83); next candidates are a per-session binder allowlist from a node helper, token-authenticated frida-server and a non-root adbd for users

## Later

- [ ] Speed and bearing on the faked GPS location (not settable through `cmd location`)
- [ ] Docker-only deployment: `provider-docker` (Docker Engine API, session state in container labels, VPN sidecar via `network_mode: container:`), `compose.yaml` with api + sources + provider-docker, docs page. Session container spec shared with `provider-emulator` (see architecture.md "Future: Docker-only deployment")
- [ ] More sync jobs (CI artifacts) writing the source layout
- [ ] Listing cache for very large buckets (today every request lists the store)
- [ ] `.apks` / `.xapk` split APK support
- [ ] DevTools capture via `mxschmitt/playwright-go` (`ConnectOverCDP` to the agent's CDP proxy): page snapshots, screenshots, HAR and traces of WebViews, exposed in the UI and as MCP tools. Check first whether plain CDP from Go covers it — playwright-go downloads a Node driver, which the distroless image doesn't have
