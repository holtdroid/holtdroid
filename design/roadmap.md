# Roadmap

Work top to bottom; phases are ordered by risk (the riskiest technical
unknowns are proven before building the platform around them). Tick items
when they are merged with tests. Add items when you discover work; do not
silently drop any.

## Phase 0 — Design (this directory)

- [x] Architecture, contracts, decisions, agent rules

## Phase 1 — Scaffold

- [x] Go module `github.com/kriakiku/holtdroid`, `cmd/holtdroid` with cobra subcommands (`api`, `provider-fake`, `agent`, `dev`, `openapi`; `source-dir` was removed by decision #27)
- [x] `internal/contract`: Provider/Agent interfaces (Source removed by decision #27), huma registration, Go clients, round-trip tests
- [ ] `internal/contract/conformance`: reusable suite for third-party implementations
- [x] `internal/secrets` (env, file, openbao) with tests
- [x] `internal/auth` with tests (all modes: see Phase 1.5)
- [x] Config loading (koanf, YAML + `HOLTDROID_` env) shared helper
- [x] `web/`: Vite + React + TS 7 strict + Tailwind v4 + shadcn/ui + TanStack Router/Query, embedded via `embed`
- [x] `docs/`: Astro Starlight site (start, concepts, configuration, operations, extending) with mermaid
- [x] `Makefile`, `mise.toml`, `golangci-lint` v2 config, oxlint/oxfmt configs, `.gitignore`
- [ ] `.editorconfig`
- [x] CI workflow (`make openapi` drift check, lint, test, build, docs) and GitHub Pages docs deploy
- [x] `helm lint` in CI
- [ ] `CONTRIBUTING.md`, `SECURITY.md`

## Phase 1.5 — Sign-in, storage, delivery

- [x] Sign-in modes: anonymous (random animal names), shared password, OIDC (PKCE + userinfo), header, none — signed JWT cookie, stateless
- [x] Login screen, user menu, sign-out / new name in the UI
- [x] `internal/storage`: filesystem and S3 (minio-go) backends; APK cache on top of it
- [x] `images/Dockerfile` (distroless, multi-arch) and release workflow: `ghcr.io/kriakiku/holtdroid:<sha>` on every push to `main`, chart to OCI on tags
- [x] Helm chart `deploy/helm/holtdroid` (api with a data PVC for the `local` source and uploads, provider-fake, ingress, extraObjects)
- [x] Live deployment tracking `main` (Argo CD, android.homelab.example)
- [x] Session image pre-pull and emulator provider values in the chart (with Phase 3)

## Phase 2 — Session prototype (highest risk)

Goal: one hand-written Pod on a KVM node proves the device side end to end.

- [x] `images/session.Dockerfile`: Ubuntu, emulator + platform-tools + `system-images;android-35;google_apis;x86_64` (pinned zips, no cmdline-tools), baked AVD, Xvfb, x11vnc, noVNC static, frida-server and agent devkit pinned together (decision #23)
- [x] `internal/agent/emulator`: process supervision (Xvfb → emulator → x11vnc), boot wait, `adb root`, frida-server start
- [x] APK install from a URL; spawn under frida-go with the instrumentation script (WebView debugging + clipboard RPC)
- [x] `internal/agent`: status SSE, noVNC bridge (`/display/websockify`)
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
- [x] Artifact sources in the api (decision #27): filesystem/S3 stores, `.meta.json` sidecars, revisions keyed into the cache and `ArtifactRef`, polling + `event: artifacts`, uploads (`uploads.*`), public/private, delete by owner/admin, `readOnly` sources; UI upload dialog, drag & drop, changelog/tags, manage menu
- [x] Slack sync job, independent of the api (decision #30, [kriakiku/holtdroid-slack-sync](https://github.com/kriakiku/holtdroid-slack-sync)): channels, thread replies and forwards → `{channel}/{file id}/{name}.apk` + sidecar in an S3/folder source; optional reaction and thread reply with APK info and a launch link; fake Slack server in tests
- [x] Launch links `/?source=…&launch=…` open the launch dialog (`GET /api/v1/artifacts/{source}/{id}`)
- [x] `internal/apk`: metadata + icon + ABIs with a fixture
- [x] `api`: registries, artifact merge, APK cache (LRU on disk, background warm-up), session create flow, `/s/{provider}/{id}` proxy, input-based activity + flush, reaper, UI API, SSE events, internal artifact endpoint
- [x] `provider/fake` (+ fake agent) for `holtdroid dev` and tests
- [ ] Conformance suite covers Provider and Agent; every implementation runs it (round-trip tests exist for fake)

## Phase 4 — Web UI

- [x] Generated OpenAPI clients for the UI API and the Agent API (`openapi-typescript` + `openapi-fetch`) wired into TanStack Query
- [x] Home: artifact list (icon, label, version, package, ABIs, uploader, date, note, source filter, search), launch dialog (provider and location preselected from the last launch in `localStorage` — location per provider — falling back to the first free provider and its `defaultLocation`, ABI warning), quick-launch button that launches with those preselected settings without the dialog, sessions panel (slots, owner, uptime, idle progress, location, open/extend/stop), live via SSE
- [x] Session page: start stepper, resizable split (display | DevTools), toolbar (target select, location select + IP badge, clipboard popover, restart/reinstall/stop), input-based heartbeat, toasts
- [x] Device controls (decision #31): rail next to the screen (lock/unlock, volume, rotate, back/home/recents, notifications, screenshot) and a non-modal settings sheet (airplane, Wi-Fi, mobile data, battery saver/charging/level, dark theme, font and display size, emulated network speed, system language, time zone, clock presets ±5 s…±1 y and an exact moment in the user's time zone); `/v1/device` in the Agent API; rotated screens are turned back in the browser
- [ ] Verify device controls on the real emulator: rotation compensation in noVNC, `cmd alarm set-time`/`set-timezone`, locale switch through `system_server`, `date +%s%N`, battery saver after `dumpsys battery unplug`, `adb emu network speed/delay`
- [ ] Display renderer abstraction (today the agent serves `/display/` and the UI just frames it; revisit when `scrcpy` lands)

## Phase 4.5 — SSH access (ADB and published ports)

Design: architecture.md "SSH access". Can start against the fake provider
(fake adb = echo server, fake reverse = synthetic device connections) before
the real agent exists.

- [ ] Agent tunnel port `:8081`: `WS /tunnel/adb`, `WS /tunnel/reverse/{port}` (yamux, `adb reverse` add/remove); fake agent implementation
- [ ] `Session.tunnelUrl` in the Provider contract; api internal `GET /internal/sessions/{slug}` and `POST …/activity`
- [ ] `ssh-gateway` subcommand on `x/crypto/ssh`: host key from a secret ref, public-key auth against in-memory keys, slug routing, help text instead of shells, `direct-tcpip` only to `adb:5555`, `tcpip-forward` within `reversePorts`, flags `allowADB` / `allowReverse` / `clientIsolation`, `keyTTL`, per-connection tunnel limit
- [x] api: `GET /api/v1/ssh`, `PUT /api/v1/ssh/keys` (validation, duplicate-claim check, fan-out to all gateway replicas); gateway key API contract + in-memory `sshgateway.Keys` (TTL, claims), served in-process by `holtdroid dev`
- [x] UI: SSH keys page (IndexedDB per user, add/rename/remove with undo, live validation and fingerprints, sync status, periodic sync)
- [ ] UI: "Connect via SSH" popover on the session page with copyable `-L`/`-R` commands
- [ ] Chart: ssh-gateway Deployment + headless Service + TCP exposure (LoadBalancer/NodePort or Traefik `IngressRouteTCP`), NetworkPolicy gateway → agent tunnel port
- [ ] Tests: gateway refuses exec/shell/sftp/agent forwarding, refuses any `-L` target except adb, isolation on/off, key expiry and fan-out, end-to-end `-L`/`-R` against the fake agent with `x/crypto/ssh` as the client
- [ ] Verify on the real emulator: `adb connect` through the tunnel (adbd auth on `google_apis` images), `-R 3000` reachable as `http://localhost:3000` in the app/WebView
- [ ] Docs page "SSH access" (a planned-feature page exists — update it to match what ships); homelab: Traefik TCP entrypoint on `:2222` for android.homelab.example

## Phase 4.6 — Database

Design: decisions.md #22. No backward compatibility before the first release.

- [x] `internal/db`: `database.type` config (`memory` default), `modernc.org/sqlite` in-memory, goose migrations embedded and run at startup, `sqlc` config + generated queries, `make sqlc` and a drift check in `make check` and CI
- [x] Wire it into the api and `holtdroid dev`; first table `session_events` (created/stopped/reaped, actor, artifact, reason), write-only for now; tests through `internal/api/api_test.go`
- [ ] Read side for `session_events` (history in the UI) once there is a use for it
- [ ] Later: `sqlite` file driver with embedded Litestream (restore on start, replicate to the `storage` S3 settings or its own), chart enforces `replicas: 1`
- [ ] Later: `postgres` driver (pgx), queries kept to the subset both engines accept, CI runs the db tests against both
- [ ] Public docs: storage/architecture pages stop saying "no database" once anything persistent ships; configuration page for `database`

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
leave the process, the api doesn't keep them.

- [ ] Audit events with a stable, versioned schema emitted as JSON lines through a dedicated `slog` logger (`"log":"audit"`), separate from debug logs, so collectors can route them: sign-in/out, session launch/stop/reap/extend, location switch, proxy on/off, clipboard writes (no content), artifact upload/delete/visibility, SSH key sync, SSH connect/disconnect and every tunnel opened (`-L`/`-R`, port), MCP token issue/revoke and tool calls. Actor, session, provider, client IP, user agent, result
- [ ] Optional sinks besides stdout: OTLP logs, webhook (batched, retried); config `audit.*`, off except stdout by default
- [ ] Metrics: Prometheus `/metrics` on a separate port (sessions active/launched/failed, slots, launch duration, APK cache hits, proxy/SSH/MCP connections), from api, provider, agent and ssh-gateway; `ServiceMonitor` in the chart behind a flag
- [ ] Tracing: OpenTelemetry (`go.opentelemetry.io/otel`) across api → provider → agent with W3C trace context on the contract clients; exporter off by default
- [ ] `session_events` (Phase 4.6) fed from the same audit events instead of a parallel path
- [ ] Tests: audit event per action in `internal/api/api_test.go`, schema golden file; docs page "Monitoring and audit"

## Phase 5 — Packaging and docs

- [x] Helm chart: add provider-emulator, RBAC, NetworkPolicy, prepull DaemonSet, values for nodeSelector/tolerations/slots/resources
- [x] Release workflow: amd64 session image
- [ ] Docs site content: install with Helm, Slack app setup, VPN providers, secrets backends, forward-auth examples (Authelia, oauth2-proxy), architecture, publishing builds into a source, writing a provider, troubleshooting (KVM, ARM translation, Frida)
- [x] Docs deployed to GitHub Pages

## Phase 6 — First deployment

- [x] Deploy to the maintainer's cluster via Argo CD + the Helm chart (portal with fake devices; see status.md)
- [ ] Switch that deployment to `provider-emulator` + a Slack sync into an S3 source once Phase 3 lands
- [x] A shared VPN gateway for that deployment: the homelab `vpn-gateway` (namespace `downloads`) got SOCKS users `holtdroid-{bd,kz,lv,no,pl,ua}` (all its NordVPN endpoints; Bangladesh was added for Holtdroid) (see status.md)
- [x] Wire those locations into the deployment's `provider-emulator` values (outbounds with the password from `secret/vpn` → `socks_holtdroid_password`, `vpn.resolver`, `vpn.direct` as the maintainer wants)
- [ ] Fix whatever reality finds; feed it back into docs

## Later

- [ ] Docker-only deployment: `provider-docker` (Docker Engine API, session state in container labels, VPN sidecar via `network_mode: container:`), `compose.yaml` with api + sources + provider-docker, docs page. Session container spec shared with `provider-emulator` (see architecture.md "Future: Docker-only deployment")
- [ ] `provider-physical` + phone agent (ws-scrcpy, wireless ADB, WireGuard app intents, cleanup between sessions)
- [ ] More sync jobs (GitHub Releases, CI artifacts) writing the source layout
- [ ] Listing cache for very large buckets (today every request lists the store)
- [ ] `.apks` / `.xapk` split APK support
- [ ] Logcat streaming panel
- [ ] Session recording / screenshots
- [ ] DevTools capture via `mxschmitt/playwright-go` (`ConnectOverCDP` to the agent's CDP proxy): page snapshots, screenshots, HAR and traces of WebViews, exposed in the UI and as MCP tools. Check first whether plain CDP from Go covers it — playwright-go downloads a Node driver, which the distroless image doesn't have
