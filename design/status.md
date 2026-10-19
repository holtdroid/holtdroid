# Status and handoff

Snapshot for whoever continues the work — human or agent. Update the
"Where things stand" and "Next steps" sections whenever a phase moves; the
rest changes rarely.

_Last updated: 2026-10-19._

## Where things stand

**Works today** (deployed at https://android.homelab.example, see "Maintainer's
deployment"):

- Real emulator sessions end to end on the maintainer's cluster
  (`provider-emulator`, decisions #25, #26): ARM-only APKs under Frida,
  DevTools on the app's WebView, location switching through the shared VPN
  gateway, Slack, S3 and GitHub syncs filling sources. Sessions use
  `holtdroid-session:main` (`pullPolicy: Always`) so a push doesn't leave
  them waiting for the per-commit build; the session image build caches
  layers in `ghcr.io/kriakiku/holtdroid-session:buildcache`.
- The portal: APK list with parsed
  metadata/icons, launch dialog, sessions panel with slots and idle countdown,
  session page with screen/DevTools split, target switcher, clipboard, VPN
  location switcher, extend/stop, reaper, device controls (buttons rail,
  screenshot, device controls in the rail: network with the VPN location,
  battery, display, language and region with keyboard layouts and a faked
  GPS position, date and time; decisions #31, #58), screen over scrcpy with multi-touch
  (decision #34); clipboard through scrcpy, device audio, codec and quality
  settings and a virtual USB keyboard (decision #36); a launch queue when
  every slot is busy (decision #57); launches go to any provider by default
  or to a chosen provider and device (decision #76).
- Computers over SSH (Phase 4.11, decision #64; replaced the key-based
  Phase 4.5 flow): `curl {portal}/tunnel.sh | sh -s -- {code}` downloads
  the `holtdroid` client, which enrolls the computer with a one-time code,
  logs in to the ssh-gateway with a 15-minute certificate from the api's CA
  (renewed in the background, refresh token rotated each time), publishes
  the ports picked on the Computers page (or with `--publish`) on every
  device of the user and gives each device's ADB a local port (15555 up,
  `adb connect` when adb is installed). The Computers page lists connected
  computers with their loopback listeners as toggles; the session popover
  shows live tunnels and the device's ADB port. The client is a full-screen
  TUI (Overview, Devices opening a session or chrome://inspect in the
  browser and a launch button that opens the portal, decision #75,
  Ports, Log, Settings with installing
  the `holtdroid` command and automatic updates); the client offers to
  update itself when the portal serves a different build; dev-server ports come first, other listeners are
  folded; publish modes manual, dev servers and everything (decision #65).
  Not yet: the SYN-driven automatic port mode, revoking single computers (needs the database),
  Windows. Covered by an end-to-end test (api + gateway + fake device +
  client); not yet tried against a real emulator.
- ADB in the browser (decision #51): one Tango connection per session page
  through the session proxy (`WS /adb`, `adb.browser`, `adb.ownerOnly`),
  with tabs next to DevTools for Logcat (app-only by uid, crash toast),
  Files, Terminal, App (deep links, permissions, force stop, clear data,
  doze, standby bucket) and Device (props, WebView provider, demo mode,
  bug report zip and bugreportz), plus screen recording in the rail
  (framed phone or whole tab with a details strip, MP4 streamed to OPFS, decisions #66, #74). The
  agent's adb relays refuse `reboot:`/`unroot:`/`remount:`/`tcpip:`/`usb:`.
  The fake provider has a small adbd. Works on the real emulator.
- Holtdroid WebView (decision #62), a separate app in
  kriakiku/holtdroid-webview: presets of WebView settings, display modes,
  viewport framing, freeze, clear data, TLS/proxy/user agent, console and
  Eruda, GeckoView build, control over `am start`/`am broadcast`; releases
  from Conventional Commits, Renovate for dependencies. Docs under Tools.
- A metrics bar at the bottom of the session page (decision #40): device,
  app (fps, jank, CPU/PSS per process), network, storage, temperatures,
  the emulator container's CPU/memory/throttling and the stream.
- Audit log and telemetry (Phase 4.9, decision #44): audit events (schema 1)
  from the api and the ssh-gateway as JSON lines on stdout, optionally OTLP
  logs and a batched webhook; `session_events` fed from the same call;
  Prometheus metrics on `telemetry.metrics.listen` for every service
  (sessions, slots, launches, launch duration, cache hits, SSH, per-operation
  request counts) with a `PodMonitor` in the chart; OpenTelemetry tracing
  across api → provider → agent. All off by default except stdout audit;
  not enabled on the maintainer's deployment yet.
- Audit log page for admins (decision #48): the api keeps up to
  `audit.store.maxEvents` / `maxAge` recent events in memory, mirrored to a
  JSON lines file on the data volume in the chart; the ssh-gateway forwards
  its events. Filters, live refresh, per-event detail, JSON lines export.
- App data (Phase 4.10, decision #49): the app's data is saved when a
  session stops and can be picked at launch (with or without its cache),
  downloaded and deleted on the App data page; quick launch remembers
  fresh/data/data+cache. Restore verified by hand on the session image
  (uid remap + `chcon`); off by default.
- Sign-in: anonymous animal names, shared password, OIDC (PKCE + userinfo),
  forward-auth headers, none. Avatars from the IdP or DiceBear voxel-art.
- APK cache on filesystem or S3, keyed by file revision. Stateless api
  (restart test included).
- Artifact sources built into the api (decision #27): folders or S3
  prefixes with optional `.meta.json` sidecars (changelog, origin, tags,
  owner, visibility), change detection by ETag/mtime with polling and an
  `artifacts` SSE event, uploads from the UI (on by default) with
  public/private and delete for the owner and admins.
- Inventory page for admins (decision #79): every slot of every provider
  with its session, phones' model, Android, build, battery, memory,
  storage and sensors over adb, the USB host and emulator nodes (Node
  object plus `holtdroid node-info` on each node: CPU, load, memory,
  thermal zones and hwmon); hold a slot or a whole provider for
  maintenance (ConfigMap for emulators, the state file for phones).
  Not tried on the cluster yet.
- In-memory SQLite database in the api (goose + sqlc, `internal/db`); it only
  records session events so far and is empty after a restart (decision #22).
- Phones without root (Phase 7, decision #67): `provider-physical` on the
  USB host with an inventory from its config, one in-process agent per
  session (scrcpy screen, audio, clipboard, installs, DevTools for
  debuggable builds), slots and sessions with `SlotCapabilities`, state file
  with resume after a restart, reset after each session. ADB (browser,
  logcat, tunnels) through the filtering proxy with `adb.shell` (decision
  #68). VPN locations over the USB cable through Holtdroid Tunnel and a
  per-session sing-box on the host (decision #69). Image
  `ghcr.io/kriakiku/holtdroid-physical` with adb, scrcpy-server, sing-box
  and the tunnel APK (decision #70). In the chart as `providers.physical`
  on the phones' node host network (decision #78), deployed on the
  maintainer's cluster with a Galaxy A05 on k3s-1 whose Holtdroid Tunnel is
  the device owner (decision #77). Not yet: the layer-3 root hardening, a
  check after the cleanup. Tried on a real phone (Samsung Galaxy
  A05, Android 14, no SIM) through `holtdroid-physical` in a scratch
  namespace on 2026-10-19: install, screen, DevTools of a debuggable app,
  VPN over USB with location switching on the fly (PL, UA, direct; the
  app's own traffic follows), reset after the session. The ADB proxy
  (browser) works on the phone; over SSH it is not tried yet. Phones are cleaned against
  a recorded baseline before and after every session and parked between
  them (decision #71); sound stays in the browser (routed to the session's
  capture, verified on the A05) and the microphone is blocked (decision
  #72); the device-owner lockdown and wallpaper in Holtdroid Tunnel wait for
  the maintainer's go-ahead in that session.
- Root mode for phones (decision #80, through Magisk `su`, `root: true` per
  phone): Frida so release builds get DevTools, the system language and
  clock, battery, app data, fake GPS and timezone that follow the VPN
  location (random point in a per-location radius; a non-persistent override
  pins a manual one), the app under test hidden from root via the Magisk
  DenyList, the VpnService tunnel with Frida relabelling its transport
  VPN→Wi-Fi so the app sees Wi-Fi while Android still gives it a real network
  with DNS (the kernel-route transparent tun is behind the off-by-default
  `transparentTunnel` flag — it hides the VPN fully but has no DNS yet), and
  a calls lockdown
  (airplane, dialer and emergency apps disabled, keyguard off). Verified on
  the A05 on 2026-10-19: root boot, root hidden, lockdown, the tun comes up
  and the gate keeps the system healthy with the egress down, GPS+timezone
  follow the location. The full tun egress wasn't reproducible in the scratch
  pod (the host sing-box there can't resolve cluster DNS). Still to come: the
  layer-3 hardening (token-auth frida-server, `su` denied to the shell uid,
  root watchdog) and the network-speed profile (the A05 kernel has no
  `sch_netem`). Blocking emergency calls outright is impossible on Android,
  so the real guarantee is SIM-less phones out of cellular range.
- `provider-fake` (fake devices whose agent streams a recorded screen and serves placeholder
  DevTools pages).
- Single Go binary + embedded UI, distroless image, Helm chart, CI, release
  (`ghcr.io/kriakiku/holtdroid:<sha>` per commit), docs site on GitHub Pages.

**Not built yet**:

- Traffic inspection proxy (Phase 4.7) and MCP server (Phase 4.8).
- A persistent database: only in-memory SQLite exists (Phase 4.6).
- The rest of Phase 7 for phones: the layer-3 root hardening, cleanup
  verification and quarantine (threat model in
  architecture.md "Physical devices"); Docker-only provider — "Later".

## Next steps, in order

1. Phones: try the ADB proxy over SSH on the real phone, a check after the
   cleanup, then the layer-3 root hardening.
2. The conformance suite (`internal/contract/conformance`) for Provider and
   Agent — the last open item of Phases 1 and 3.
3. Planned, each starting with a decisions.md entry: Phase 4.7 traffic
   inspection proxy, Phase 4.8 MCP server. Both optional and off by
   default; each adds its own audit events and metrics (decision #44).
4. The rest of Phase 4.11 (decision #64): the SYN-driven automatic port mode,
   Windows, and revocation once the database persists.
5. Whatever more use of real sessions turns up (Phase 6).

## Requirements from the maintainer

Collected from the design conversation; each is reflected in the docs listed.

- Test APKs arrive in a **Slack channel**; they are often **ARM-only**. A bot
  token with `channels:history`, `groups:history`, `files:read` is available.
  Slack is read by an **independent sync job** that writes into a folder/S3
  source, not by the api. (decision #27, contracts.md "Artifact sources")
- **Sources are a local folder or S3**, with an optional **meta file**
  (changelog, origin, …) next to each APK; **replaced files are detected**.
  Users can **upload** APKs (flag, default allowed), make them
  **public/private** and **delete their own**. (decision #27)
- **WebView debugging without modifying the APK**, DevTools in the browser
  next to the screen, no adb or local Chrome on the user's machine.
  (decisions #1, #6)
- One page per session with **clipboard sync**, **DevTools target
  switching**, **VPN location switching**. (architecture.md)
- Home page with **active sessions, owners and remaining lifetime**; idle
  sessions are shut down; up to **4 parallel devices**, one per node.
  (architecture.md "Session lifecycle")
- **Extensible**: other artifact sources, physical rooted phones later, Docker
  without Kubernetes later, secrets not tied to OpenBao. (contracts.md,
  architecture.md "Future: …")
- **Open source, not homelab-specific.** Apache-2.0, public docs site.
- **Stateless api**; session state as labels on what the provider runs.
  (decisions #5, #17, #18)
- **Database**: `memory` (default, SQLite in-memory), later SQLite with
  Litestream to S3 and PostgreSQL; goose + sqlc. Only in-memory until the
  first release, and **no backward compatibility before the first release**.
  (decision #22)
- Sign-in: **anonymous random animal names**, **shared password**, **OIDC**;
  avatars from the IdP or **DiceBear voxel-art**. (decisions #17, #20)
- **Computers**: one `curl … | sh` command per computer with a JWT-style
  code that links it to the account; the client generates its own key and
  sends its hostname; ports picked in the portal (later: in a TUI, or
  every port Android asks for, with a warning); ADB per device on its own
  port; tokens rotate in the background and, with a persistent database,
  can be revoked. No shells. (decision #64)
- Lean containers and a small codebase built on existing libraries; Go
  backend, Bun + TypeScript 7 + oxc tooling, shadcn/ui. (decisions #3, #13)

## Working agreements

- Talk to the maintainer in **Russian**; everything in the repo is English.
- Commits: one-line Conventional Commits, no body, no trailers (no
  `Co-Authored-By`, no "Generated with"). PR descriptions empty.
- The maintainer allowed the agent to commit and push to `main` — **a push to
  `main` deploys to android.homelab.example**. Run `make check` first.
- Don't verify UI by launching headless browsers or Storybook; rely on types,
  lint, tests and `holtdroid dev` + curl.
- Never print secrets (tokens, keys, decrypted values) in chat or logs.
- Write almost no code comments; reasons go to `decisions.md`.

## Gotchas already paid for

- **The agent can't run under Rosetta** on a Mac: Frida needs `eventfd`.
  Use `holtdroid dev` with the fake provider locally.

- **shadcn CLI** (v4.22) writes `import { cn } from "cn"` into new
  components and may overwrite `src/lib/utils.ts` with a self-referencing
  re-export. After `shadcn add`, fix imports to `@/lib/utils` and check
  `utils.ts`. It also tried to add an `cn` npm dependency — remove it.
- **Bun** must use the hoisted linker (`bunfig.toml`), otherwise Astro's
  prerender can't find native optional deps.
- **TypeScript 7** has no JS API: `openapi-typescript` runs via `bunx` with
  TS 5 (`web/package.json` → `openapi`). `astro check` doesn't work either.
- **Vite empties `web/dist`**; `web/public/.keep` is copied back so
  `//go:embed all:dist` compiles on a fresh checkout. Don't delete either
  `.keep`.
- **huma** doesn't read path params from embedded structs — declare them on
  the input struct itself. Set `huma.DefaultArrayNullable = false` (done in
  `internal/contract`) or TS types get `| null` arrays.
- **Go 1.27** allows setting promoted fields directly in struct literals and
  golangci's `modernize` (`embedlit`) insists on it.
- **Images must use a numeric user** (`USER 65532:65532`), otherwise
  `runAsNonRoot` fails with `CreateContainerConfigError`.
- **oxlint** enforces React-Compiler-era rules (no setState in effects, no
  ref reads or `Date.now()` during render). Derive state while rendering or
  use `useEffectEvent`.
- **Argo CD** `$ARGOCD_APP_REVISION` is used as the image tag; keep the
  Application single-source and put extra manifests into `extraObjects`.
- The fake provider keeps sessions in memory: restarting `provider-fake`
  loses them. That's expected; real providers keep state in the cluster.

## Maintainer's deployment

The first deployment runs in the maintainer's homelab k3s cluster. Its
GitOps repo and access recipes live outside this repository
(`~/Developer/homelab` on the maintainer's Mac: `k8s/` = Argo CD apps,
`nixos/` = hosts and OpenBao bootstrap; its `CLAUDE.md` explains kubectl,
sops and OpenBao access). An agent without that access can still do all
in-repo work; ask the maintainer for anything cluster-side.

| What | Where |
|------|-------|
| URL | `android.homelab.example` stands for the real hostname, which is only in AGENTS.local.md |
| Argo CD Application | `homelab.k8s/argocd/holtdroid.yaml` — chart from this repo's `deploy` branch (moved to each `main` commit by the release workflow once its image is pushed), `image.tag=$ARGOCD_APP_REVISION`, values inline |
| Current setup | `auth.mode: oidc` (Authelia client `holtdroid`, groups `admins`/`users`), sources `uploads` (writable, uploads go there) and `slack` (read-only) as prefixes of the bucket `holtdroid` on the homelab S3 gateway `https://s3.homelab.example` (versitygw, region `eu-north-1`, path style); `api.persistence` is off (the old PVC's one upload was copied to S3), `providers.emulator` on `core` (tolerating `dedicated=nas`) and `k3s-1..3`, locations `direct` + the six gateway ones (password via `VPN_GATEWAY_PASSWORD` from `secret/vpn` in the `ExternalSecret`; the `no` id must stay quoted in the values) |
| Secrets (OpenBao KV, mount `secret/`) | `holtdroid` → `session_key`, `s3_access_key`/`s3_secret_key` (versitygw IAM user `holtdroid`, inline policy on bucket `holtdroid`, issued by hand on the gateway's IAM server); `oidc/holtdroid` → `client_secret` (+ digest for Authelia); both seeded by `nixos/scripts/openbao-bootstrap.sh`; delivered by an `ExternalSecret` in `extraObjects` |
| Slack sync | Argo CD Application `homelab.k8s/argocd/holtdroid-slack-sync.yaml` (chart `deploy/helm/holtdroid-sync` from kriakiku/holtdroid-sync `main`, `job: slack`, image `ghcr.io/kriakiku/holtdroid-sync`), writes `slack/` in the bucket and announces new builds with launch links to android.homelab.example in `test-chanel-jonas` through shoutrrr. `secret/holtdroid-slack-sync` → `s3_access_key`/`s3_secret_key` (IAM user `holtdroid-slack-sync`), `slack_bot_token`, `slack_channels` (comma-separated IDs, mapped to `HOLTDROID_SLACK_SYNC_SLACK__CHANNELS`) and `notify_url` (the shoutrrr Slack URL, same as the S3 sync's) |
| S3 sync | Argo CD Application `homelab.k8s/argocd/holtdroid-s3-sync.yaml` (chart `deploy/helm/holtdroid-sync` from kriakiku/holtdroid-sync `main`, `job: s3`, image `ghcr.io/kriakiku/holtdroid-sync`), copy mode: `s3://wnf-common-preprod/wnf3/crr-17/web-view/builds/` (work AWS, eu-central-1) → `holtdroid/wnf-preprod/` → source `wnf-preprod`. AWS access is the maintainer's IAM Identity Center permission set `VideoFrontend` (account 418337671376, start URL `https://winfinity.awsapps.com/start#/`, SSO region eu-west-1); device-code login, refresh tokens on the job's longhorn PVC. The login link and new-build announcements go to `test-chanel-jonas` through shoutrrr (`notify_url` in `secret/holtdroid-s3-sync`, built from the Slack bot token; plus `s3_access_key`/`s3_secret_key` of IAM user `holtdroid-s3-sync`). First copy: 12 APKs on 2026-10-17 |
| GitHub sync | Argo CD Application `homelab.k8s/argocd/holtdroid-github-sync.yaml` (chart `deploy/helm/holtdroid-sync` from kriakiku/holtdroid-sync `main`, `job: github`, image `ghcr.io/kriakiku/holtdroid-sync`): the newest 3 releases of `kriakiku/holtdroid-webview` (CanIAndroidWebView dropped on 2026-10-19) → `holtdroid/github/` → source `github`, every 15 minutes, unauthenticated GitHub API. New builds are announced in `test-chanel-jonas` (`notify_url` in `secret/holtdroid-github-sync`, plus `s3_access_key`/`s3_secret_key` of IAM user `holtdroid-github-sync`). First copy: 3 APKs on 2026-10-17 |
| VPN gateway | The homelab's existing `vpn-gateway` in namespace `downloads` (`homelab.k8s/infrastructure/downloads`, image built from there into zot) is the shared gateway of decision #28. Service `vpn-socks.downloads.svc.cluster.local:1080`; SOCKS users `holtdroid-<cc>` for every NordVPN endpoint of the gateway (`bd`, `kz`, `lv`, `no`, `pl`, `ua`) route to `nord-<cc>`; AirVPN is not offered (its failover moves between NL and LV); one password for all of them in OpenBao `secret/vpn` → `socks_holtdroid_password` (seeded by `openbao-bootstrap.sh`). The provider config needs `vpn.resolver: 10.43.0.10` and `udp_over_tcp: true`. NordVPN account: 6 of 10 connections used by the gateway (ua, pl, kz, no, lv, bd); Finland was tried and dropped: with seven tunnels open one of them (Finland or Bangladesh) kept failing, likely the account limit together with the maintainer's own devices. Bangladesh and Kazakhstan egress IPs are placed elsewhere by ipinfo.io (the agent's default `ipInfoURL`: SG and DE) while ip-api/ipwho.is say BD and KZ; Bangladesh is a Nord virtual location |
| Nodes for sessions | 4 × x86_64 with `/dev/kvm`: `core` (16 cores, 30 GiB, taint `dedicated=nas:NoSchedule`), `k3s-1..3` (6 cores, 31 GiB each). One session per node |
| Storage classes | `longhorn`, `local-path`, `nas-hdd` |
| Ingress / DNS | Traefik; Ingress annotation `external-dns.alpha.kubernetes.io/target: "10.10.4.25"` creates the DNS record |
| Registries | `ghcr.io/kriakiku/*` (public, from CI); the cluster also has `registry.homelab.example` (zot, needs the `zot-pull-secret` pattern from `homelab.k8s/infrastructure/downloads/secrets.yaml`) |
| SSH gateway | `sshGateway.enabled` in the Application, host key `secret/holtdroid` → `ssh_host_key` (seeded by `openbao-bootstrap.sh`, `SSH_HOST_KEY` in the `ExternalSecret`), `IngressRouteTCP holtdroid-ssh` on Traefik's `ssh` entrypoint (a non-default port on purpose, see AGENTS.local.md; `sshGateway.publicPort`, the Service stays on 2222); that port allowed on the ingress VIP by the node firewall (`homelab.nixos/modules/k3s/default.nix`), and the UniFi WAN port forward `homelab-holtdroid-ssh` (the same port to 10.10.4.25, created through the Network API with `secret/unifi` `api_key`, not declared in any repo) |

Verifying a deploy (needs the maintainer's kubeconfig):

```sh
export KUBECONFIG=~/.kube/homelab.yaml
kubectl -n argocd annotate application holtdroid argocd.argoproj.io/refresh=hard --overwrite
kubectl -n argocd get application holtdroid -o jsonpath='{.status.sync.revision} {.status.sync.status} {.status.health.status}{"\n"}'
kubectl -n holtdroid get pods
kubectl -n holtdroid logs deploy/holtdroid-api
curl -s https://android.homelab.example/api/v1/auth
```

A new commit can sit in `ImagePullBackOff` for a few minutes until its image
is built — check `gh run list` before debugging.
