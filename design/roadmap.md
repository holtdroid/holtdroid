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
- [ ] Session image pre-pull and emulator provider values in the chart (with Phase 3)

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
- [ ] DevTools frontend in the portal against a real WebView page (needs Phase 3 to launch a real session from the UI)
- [x] Record findings and surprises in `decisions.md` (#25, #26)

## Phase 3 — Provider, source, api

- [ ] `internal/vpn`: `none`, `wireguard`, `nordvpn` (server recommendations, collision-free picking, `excludeServers`), sing-box rendering with golden tests; WireGuard MTU that fits the Pod network, emulator DNS through the tunnel (decision #26)
- [ ] `provider-emulator`: capacity from nodes + config, Pod/Secret rendering (golden tests), create/list/delete, state from annotations, `touch`
- [x] Artifact sources in the api (decision #27): filesystem/S3 stores, `.meta.json` sidecars, revisions keyed into the cache and `ArtifactRef`, polling + `event: artifacts`, uploads (`uploads.*`), public/private, delete by owner/admin, `readOnly` sources; UI upload dialog, drag & drop, changelog/tags, manage menu
- [ ] Slack sync job, independent of the api: reads channels, writes `{channel}/{file id}/{name}.apk` + sidecar into an S3/folder source; fake Slack server in tests
- [x] `internal/apk`: metadata + icon + ABIs with a fixture
- [x] `api`: registries, artifact merge, APK cache (LRU on disk, background warm-up), session create flow, `/s/{provider}/{id}` proxy, input-based activity + flush, reaper, UI API, SSE events, internal artifact endpoint
- [x] `provider/fake` (+ fake agent) for `holtdroid dev` and tests
- [ ] Conformance suite covers Provider and Agent; every implementation runs it (round-trip tests exist for fake)

## Phase 4 — Web UI

- [x] Generated OpenAPI clients for the UI API and the Agent API (`openapi-typescript` + `openapi-fetch`) wired into TanStack Query
- [x] Home: artifact list (icon, label, version, package, ABIs, uploader, date, note, source filter, search), launch dialog (provider, location, ABI warning), sessions panel (slots, owner, uptime, idle progress, location, open/extend/stop), live via SSE
- [x] Session page: start stepper, resizable split (display | DevTools), toolbar (target select, location select + IP badge, clipboard popover, restart/reinstall/stop), input-based heartbeat, toasts
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

## Phase 5 — Packaging and docs

- [ ] Helm chart: add provider-emulator, RBAC, NetworkPolicy, prepull DaemonSet, values for nodeSelector/tolerations/slots/resources
- [x] Release workflow: amd64 session image
- [ ] Docs site content: install with Helm, Slack app setup, VPN providers, secrets backends, forward-auth examples (Authelia, oauth2-proxy), architecture, publishing builds into a source, writing a provider, troubleshooting (KVM, ARM translation, Frida)
- [x] Docs deployed to GitHub Pages

## Phase 6 — First deployment

- [x] Deploy to the maintainer's cluster via Argo CD + the Helm chart (portal with fake devices; see status.md)
- [ ] Switch that deployment to `provider-emulator` + a Slack sync into an S3 source once Phase 3 lands
- [ ] Fix whatever reality finds; feed it back into docs

## Later

- [ ] Docker-only deployment: `provider-docker` (Docker Engine API, session state in container labels, VPN sidecar via `network_mode: container:`), `compose.yaml` with api + sources + provider-docker, docs page. Session container spec shared with `provider-emulator` (see architecture.md "Future: Docker-only deployment")
- [ ] `provider-physical` + phone agent (ws-scrcpy, wireless ADB, WireGuard app intents, cleanup between sessions)
- [ ] More sync jobs (GitHub Releases, CI artifacts) writing the source layout
- [ ] Listing cache for very large buckets (today every request lists the store)
- [ ] `.apks` / `.xapk` split APK support
- [ ] Logcat streaming panel
- [ ] Session recording / screenshots
