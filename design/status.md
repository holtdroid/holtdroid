# Status and handoff

Snapshot for whoever continues the work — human or agent. Update the
"Where things stand" and "Next steps" sections whenever a phase moves; the
rest changes rarely.

_Last updated: 2026-10-27._

## Where things stand

**Works today** (deployed at https://holtdroid.homelab.example, see "Maintainer's
deployment"):

- A replaced microphone on redroid (decision #146): the session page's
  Microphone card plays a line-up tone, beeps, pink noise, a file from the
  user's media library or the browser's microphone into every app's
  recordings. `Mic.java` was checked by hand on Android 11 and 15 (a scrcpy
  mic capture read the exact tone sent); the agent, the api and the card are
  covered by tests and were tried in a live session on Android 15 (tone,
  noise, file, off).
- A camera on redroid 13–15 (decision #155): holtdroid-redroid's own
  lazy camera HAL (branch `feat/camera-hal` there) gets frames from the
  agent's ffmpeg: a test card with a clock, black, an image or a video from
  the media library, or the browser's camera. Checked in a scratch Pod on
  k3s-3 with Android 15: Camera2 showed the agent's test card upright and
  switched to black live, a photo was saved, and the HAL exited 5 s after
  the camera closed. On the live deployment on 2026-10-27 Android 13, 14
  and 15 showed the test card, black and a library image in Camera2, and
  the agent's ffmpeg stopped when the camera closed. Android 13 and 14 keep
  the HAL running (their cameraserver crashes on a stopped lazy provider).
  `virtual_camera` (the recon) was dropped: ANGLE on anv hangs the GPU.

- The DNS tab (decision #133): the agent answers redroid sessions' DNS
  behind the sidecar with a live log, rewrites, a TTL limit and cache
  clearing; saved sets live in the api's database. The sidecar config was
  checked with sing-box 1.14.2 and a tun in Docker and the cache flush on
  Android 15 in a live session; the whole path not yet in a live session.
- The Routes tab (decisions #151, #153): the agent follows the device's
  connections through the sidecar's sing-box API service (the clash API
  every 250 ms on phones), live and in recordings; the
  api places servers with DB-IP Lite; CDN addresses show anycast and the
  Cloudflare site the agent asked for (decision #157); the tab flags far
  servers, connections that aren't reused, traffic past the VPN and plain
  HTTP, and the DNS tab places answers. The clash API path was checked in
  a live session; the API service against sing-box 1.14.2 in Docker.
- Sessions run redroid instead of the Android emulator (decision #82,
  Phase 8): `provider-emulator` starts Pods with an `android` container from
  `ghcr.io/holtdroid/holtdroid-redroid:<version>` next to the agent and the
  VPN sidecar, `slotsPerNode` per node. The launch dialog picks the screen
  (presets of popular budget phones with emulated cutouts) and the Android
  version (decision #84). Sessions are kept away from the rest of the
  cluster (decision #83): egress NetworkPolicy, an Android container
  without `privileged` whose devices come from the `session-devices` NRI
  plugin (decision #173), an unprivileged agent container, users' ADB on an allowlist (no Terminal tab by default), the
  node's sysctls protected from Android init. Network conditions (decision
  #93): named networks and scenarios such as a subway ride or a flapping
  link, `tc netem` on the VPN tun; the kernel side (netem, gemodel, ifb,
  matchall) was probed on k3s-3; verified in a live session on `core` on
2026-10-25 (`edge` ping 507 ms for 500 ± 150, `lte` download 8.6 Mbit/s of
10, `slow-upload` 15.6 Mbit/s of 20 with slow start). Regions (decision
  #132) moved the conditions into a Network tab and shape per path (CDN
  edge or servers) under an htb class; verified in a live session on `core`
  on 2026-10-26 (Bangladesh, servers in Frankfurt, VPN in Latvia: route
  measured at 7 ms to Cloudflare and 33 ms to Frankfurt, so 22 and 136 ms
  added; device ping 73 ms to 1.1.1.1, 80 ms to 8.8.8.8, 190 ms to 9.9.9.9
  for 191 expected). Verified on 2026-10-25 with a
  dev release of the chart on k3s-3: boot to ready in about 25 s, install,
  the app under Frida, DevTools target of a WebView page, screenshot, the
  metrics bar with the Pod's cgroup, VPN location switch (PL → UA with GPS
  and time zone following), the LAN, node ports and other namespaces
  unreachable from a root shell in Android. Before that, the
  emulator ran end to end on the maintainer's cluster
  (decisions #25, #26): ARM-only APKs under Frida,
  DevTools on the app's WebView, location switching through the shared VPN
  gateway, Slack, S3 and GitHub syncs filling sources. Sessions use
  `holtdroid-session:main` (`pullPolicy: Always`) so a push doesn't leave
  them waiting for the per-commit build; the session image build caches
  layers in `ghcr.io/holtdroid/holtdroid-session:buildcache`.
- Device controls checked on every redroid version (11–15) on 2026-10-26
  and fixed (decision #101): a real lock screen (PIN `0000` on 11), Wi-Fi
  and mobile data as virtual radios the app under test sees through Frida,
  battery level and charging in the status bar, brightness matching the
  shade, fake GPS on 11–14, the stream card no longer flagged when the
  device has no audio; the clock can't move on redroid (time zone only).
- Android 16 is offered (decision #171, 2026-10-29): holtdroid-redroid's
  `16` image boots on the nodes' 6.18 kernel through shims in the image
  (netbpfload's LTS check, `CAP_BPF` for netd, ashmem ioctls on memfd), and
  is the newest version, so the default. Checked on the live deployment on
  k3s-3: an ARM-only app under Frida, a DevTools target, scrcpy running,
  the device controls of decision #101. Rotation and the simulated Wi-Fi
  are unchecked: on 2026-10-29 no node had `mac80211_hwsim` loaded, so
  sessions on every version got mobile data only.
- A real Wi-Fi in redroid sessions (decision #105): the session nodes load
  `mac80211_hwsim radios=0` (homelab.nixos `modules/k3s/default.nix`),
  holtdroid-redroid ships the emulator's Wi-Fi stack and an access point in
  a router namespace, and the agent drives Android's own Wi-Fi. Status bar
  and quick settings show Wi-Fi; with Wi-Fi off and mobile data on they
  show Ethernet (the mobile uplink).
- WebView versions at launch (decision #88): the launch dialog offers a
  Chromium WebView build per milestone (catalog `webview.storage`, filled
  by `holtdroid-webview-sync` from Chromium's x86_64 snapshots, Chromium
  129 and later). The agent installs the chosen build over the built-in
  WebView, which holtdroid-redroid re-signs with Chromium's debug key. A
  spike on a live session on 2026-10-25: snapshot 158 installed in about
  2 s over the re-signed built-in 128 on Android 15, rendered pages, and
  DevTools listed the page. Snapshots report an all-zero frontend revision,
  so the catalog carries the Canary commit's. Quick launch uses the last choice, else the newest Stable build, else the newest (decision #121).
- Chromium browser builds (decision #91): `holtdroid-chromium-sync` in
  holtdroid-sync writes `ChromePublic.apk` per milestone (channels, newest
  10, every 2nd, every 5th past the newest 24) into an ordinary source.
  Live since 2026-10-25 as source `chromium` (18 builds: 130, even 136–148,
  149–158; 290–420 MB each). The api passes a build's `frontend` tag to
  the session (`CreateSession.Frontend`), so DevTools open the browser's
  tabs with the Canary commit's frontend. Chromium 157 and later need the
  Android 15 image with newer Mesa Vulkan drivers (decision #95); verified
  on k3s-1 and k3s-2 (Intel) with Chromium 158.
- The portal: APK list with parsed
  metadata/icons, launch dialog, sessions panel with slots and idle countdown,
  session page with screen/DevTools split, target switcher, clipboard, VPN
  location switcher, extend/stop, reaper, device controls (a phone body
  with side keys and system and navigation buttons, screenshot, device cards
  next to the screen: network with the VPN location, GPS, stream, clipboard,
  display with brightness, battery, language and keyboard layouts, date and
  time, SSH; decisions
  #31, #58, #94), screen over scrcpy with multi-touch
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
  Files and Terminal, and app and device cards next to the phone (deep
  links, permissions, force stop, clear data, doze, standby bucket; props,
  WebView provider, bug report zip and bugreportz). The
  agent's adb relays refuse `reboot:`/`unroot:`/`remount:`/`tcpip:`/`usb:`.
  The fake provider has a small adbd. Works on the real emulator.
- Holtdroid WebView (decision #62), a separate app in
  holtdroid/holtdroid-webview: presets of WebView settings, display modes,
  viewport framing, freeze, clear data, TLS/proxy/user agent, console and
  Eruda, GeckoView build, control over `am start`/`am broadcast`; releases
  from Conventional Commits, Renovate for dependencies. Docs under Tools.
- Server-side recordings (decision #96, Phase 4.12): the agent muxes the
  viewer's H.264 stream (or its own) into fMP4 segments and uploads them
  with events and logcat through the api into storage; the Recordings page
  plays them in a canvas scene (logcat, phone, app, time, device, network,
  load), renders MP4 downloads in the browser, keeps, shares by link
  without sign-in and enforces a per-user quota and retention. Replaced the
  browser recording. Covered by tests with the fake provider; not yet tried
  on a redroid session. Since decision #112 the agent also records the
  WebViews' network, console and WebSockets over its own CDP connections;
  the player shows them in tabs next to logcat, and the video download no
  longer has logcat. Tested with a fake CDP server and the fake provider;
  not yet tried against a real WebView.
- Pixel perfect (decisions #106, #109, Phase 4.13): a tab next to DevTools with
  per-user reference images (SVG, PNG, JPEG, WebP; small thumbnails for the list) in storage (1 GiB, deleted after 30 days
  unused), an overlay over the screen (opacity, difference, invert, drag),
  freeze frame, differences found in the browser (regions with guesses,
  video skipped by motion, ignored areas), the views of image diffs and a
  PNG report. In WebViews, behind an experimental switch that is off by
  default (decision #107), differences name their element
  with selector, CSS shift and styles and highlight it on the device, and
  video, canvas and frames are skipped. Native views read with uiautomator
  name differences everywhere else (decision #138), and frames imported from
  Figma by link bring their layers, so a difference names the layer and how
  far its view is off in dp (decision #139). Covered by api, agent and web
  unit tests against fakes; not yet tried on a redroid session or against
  the real Figma API. Figma tokens are saved encrypted with the account
  (decision #141); the Pixel perfect page manages references, the token and
  the tab's defaults. Frames import as PNG 4× with up to 20 components that
  can be hidden, the frame redrawn without them (decision #145). The tab has
  a toolbar and Layout / Components / Differences tabs, a work area in dp
  with column and baseline grids and guides, and presets (decision #147).
- Session load (decision #40), shown in the cards next to the phone since
  decision #94: the app card has fps, jank and CPU/PSS per process, the
  device card the device, storage, temperatures and the session Pod's
  CPU/memory/throttling; network is in the network card, the stream in the
  stream card.
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
- App data (Phase 4.10, decisions #49, #144): the app's data is saved when a
  session stops, if it was launched with "Save app data when the session
  ends" (off by default, remembered in the browser), and can be picked at launch (with or without its cache),
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
- SQL database in the api (goose + sqlc, `internal/db`): in-memory by
  default, or `database.type: sqlite`, a file that embedded Litestream
  restores from and streams to S3 (decision #102). It only records session
  events so far. Live since 2026-10-26: `sqlite` on the api's `emptyDir`,
  replicated to the `database` prefix of the `holtdroid` bucket.
- Phones without root (Phase 7, decision #67): `provider-physical` on the
  USB host with an inventory from its config, one in-process agent per
  session (scrcpy screen, audio, clipboard, installs, DevTools for
  debuggable builds), slots and sessions with `SlotCapabilities`, state file
  with resume after a restart, reset after each session. ADB (browser,
  logcat, tunnels) through the filtering proxy with `adb.shell` (decision
  #68). VPN locations over the USB cable through Holtdroid Tunnel and a
  per-session sing-box on the host (decision #69). Image
  `ghcr.io/holtdroid/holtdroid-physical` with adb, scrcpy-server, sing-box
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
  DenyList, a real Wi-Fi network joined through su with all traffic tproxy'd
  through the tunnel (no VpnService, no tun — anti-VPN apps like 1xbet accept
  it; needs a `wifi` SSID, else it falls back to the VpnService tunnel with a
  Frida VPN→Wi-Fi relabel; the kernel-route tun stays behind the off-by-default
  `transparentTunnel` flag), and a calls lockdown
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
  (`ghcr.io/holtdroid/holtdroid:<sha>` per commit), docs site on GitHub Pages.

**Not built yet**:

- Traffic inspection proxy (Phase 4.7) and MCP server (Phase 4.8).
- PostgreSQL for the api's database (Phase 4.6), and the features waiting
  for a persistent one: the `computers` table and revocation (4.11).
- The rest of Phase 7 for phones: the layer-3 root hardening, cleanup
  verification and quarantine (threat model in
  architecture.md "Physical devices"); Docker-only provider — "Later".

## Next steps, in order

1. Recordings: watch a recording of a real redroid session end to end
   (viewer tap and own stream, rotation, logcat volume, a session stopped
   mid-upload) and the video download of a long one.
2. Redroid (Phase 8): try clipboard, audio, app data and the ADB tabs by
   hand in the browser on the live deployment (sessions run on k3s-3 since
   2026-10-25), then the
   wallpaper, and the next isolation steps of decision #83 (a token on
   frida-server, a non-root adbd for users; the container dropped
   `privileged` in decision #173).
3. Phones: try the ADB proxy over SSH on the real phone, a check after the
   cleanup, then the layer-3 root hardening.
4. The conformance suite (`internal/contract/conformance`) for Provider and
   Agent — the last open item of Phases 1 and 3.
5. Planned, each starting with a decisions.md entry: Phase 4.7 traffic
   inspection proxy, Phase 4.8 MCP server. Both optional and off by
   default; each adds its own audit events and metrics (decision #44).
6. The rest of Phase 4.11 (decision #64): the SYN-driven automatic port mode,
   Windows, and revocation once the database persists.
7. Whatever more use of real sessions turns up (Phase 6).

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
  sessions are shut down; a bounded number of parallel devices (first 4,
  one per node; since decision #82 several per node).
  (architecture.md "Session lifecycle")
- **Extensible**: other artifact sources, physical rooted phones later, Docker
  without Kubernetes later, secrets not tied to OpenBao. (contracts.md,
  architecture.md "Future: …")
- **Open source, not homelab-specific.** Apache-2.0, public docs site.
- **Stateless api**; session state as labels on what the provider runs.
  (decisions #5, #17, #18)
- Optional **user directory** (`auth.mode: users`): invite links with a
  preset role or an approval queue, passkeys instead of passwords, recovery
  links, admin-managed roles and limits, optional email-domain rules, OIDC as
  a second sign-in. (decision #103)
- **Database**: `memory` (default, SQLite in-memory) or `sqlite` (a file,
  Litestream to S3, one api replica); PostgreSQL later; goose + sqlc.
  Migrations are **append-only**; otherwise no backward compatibility before
  the first release. (decisions #22, #102)
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
  `main` deploys to holtdroid.homelab.example**. Run `make check` first.
- Don't verify UI by launching headless browsers or Storybook; rely on types,
  lint, tests and `holtdroid dev` + curl.
- Never print secrets (tokens, keys, decrypted values) in chat or logs.
- Write almost no code comments; reasons go to `decisions.md`.

## Gotchas already paid for

- **Redroid shares the node's kernel**: Frida spawn gating there stopped
  every new process of the node (sshd, runc, probes) until a power cycle,
  twice on `core` and on `k3s-3`. Never enable spawn gating, and treat
  anything that runs as root in Android as root on the node. For risky
  redroid experiments use a k3s node with a watchdog that dumps stacks and
  reboots through sysrq (see the side-session notes of 2026-10-20), never
  `core`.
- **A spawn-gating incident leaves stopped processes behind.** After the
  2026-10-20 incident k3s-3's kube-proxy sat unhealthy for five days: its
  `iptables -S KUBE-PROXY-CANARY` child was still `SIGSTOP`ped, so no new
  Service got rules on that node (ClusterIPs with same-node backends timed
  out, remote ones still worked). `ps -eo stat,pid,args | awk '$1 ~ /^T/'`
  finds them; `kill -CONT` lets kube-proxy continue. Check
  `curl localhost:10256/healthz` on a node after any such incident.
- **Unprivileged sessions run out of memory once frida-server starts**
  (2026-10-29, first live session after decision #173): the Android
  container hits its 3 GiB limit, the kernel OOM-kills zygote, and the
  agent fails with "Unable to connect to remote frida-server". Privileged
  sessions on the same images peak below the limit. The chart defaults to
  `redroid.privileged: true` until this is found and fixed.
- **Android init rewrites node sysctls** when the container is privileged
  (`redroid.privileged: true`) and `/proc/sys` is writable: `kernel.modprobe` becomes empty (module
  autoloading stops), `sysrq` 0, `unprivileged_bpf_disabled` 0,
  `kptr_restrict`, `perf_event_paranoid`, hung-task and VM watermark
  settings. holtdroid-redroid's init wrapper now makes `/proc/sys` read-only
  except `/proc/sys/net`; after booting an older image on a node, restore
  them by hand (k3s-3's baseline is in the side-session notes).
- **`adb root` races**: right after `adb root` the next `adb shell` may still
  land on the old non-root adbd, so frida-server started then runs as shell
  with no capabilities and can't attach. The agent's `Root` waits for
  `id -u` to be 0.
- **The node kernel has no legacy iptables**: Android's `iptables` (legacy)
  finds no tables, so nothing inside redroid can filter the Pod's traffic;
  policy routing (`ip rule`) works.

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
| URL | `holtdroid.homelab.example` stands for the real hostname, which is only in AGENTS.local.md |
| Argo CD Application | `homelab.k8s/argocd/holtdroid.yaml` — chart from this repo's `deploy` branch (moved to each `main` commit by the release workflow once its image is pushed), `image.tag=$ARGOCD_APP_REVISION`, values inline |
| Current setup | `auth.mode: users` (passkeys and invite links, sign-ups limited to three email domains, no SSO; the old hostname redirects to the new one), sources `uploads` (writable, uploads go there) and `slack` (read-only) as prefixes of the bucket `holtdroid` on the homelab S3 gateway `https://s3.homelab.example` (versitygw, region `eu-north-1`, path style); `api.persistence` is off (the old PVC's one upload was copied to S3), `database.type: sqlite` restored from and replicated to the bucket's `database` prefix, `providers.emulator` on `core` (tolerating `dedicated=nas`) and `k3s-1..3`, locations `direct` + the six gateway ones (password via `VPN_GATEWAY_PASSWORD` from `secret/vpn` in the `ExternalSecret`; the `no` id must stay quoted in the values) |
| Secrets (OpenBao KV, mount `secret/`) | `holtdroid` → `session_key`, `s3_access_key`/`s3_secret_key` (versitygw IAM user `holtdroid`, inline policy on bucket `holtdroid`, issued by hand on the gateway's IAM server); `oidc/holtdroid` → `client_secret` (+ digest for Authelia); both seeded by `nixos/scripts/openbao-bootstrap.sh`; delivered by an `ExternalSecret` in `extraObjects` |
| Slack sync | Argo CD Application `homelab.k8s/argocd/holtdroid-slack-sync.yaml` (chart `deploy/helm/holtdroid-sync` from holtdroid/holtdroid-sync `main`, `job: slack`, image `ghcr.io/holtdroid/holtdroid-sync`), writes `slack/` in the bucket and announces new builds with launch links to holtdroid.homelab.example in `test-chanel-jonas` through shoutrrr. `secret/holtdroid-slack-sync` → `s3_access_key`/`s3_secret_key` (IAM user `holtdroid-slack-sync`), `slack_bot_token`, `slack_channels` (comma-separated IDs, mapped to `HOLTDROID_SLACK_SYNC_SLACK__CHANNELS`) and `notify_url` (the shoutrrr Slack URL, same as the S3 sync's) |
| GitHub sync | Argo CD Application `homelab.k8s/argocd/holtdroid-github-sync.yaml` (chart `deploy/helm/holtdroid-sync` from holtdroid/holtdroid-sync `main`, `job: github`, image `ghcr.io/holtdroid/holtdroid-sync`): the newest 3 releases of `holtdroid/holtdroid-webview` (CanIAndroidWebView dropped on 2026-10-19) → `holtdroid/github/` → source `github`, every 15 minutes, unauthenticated GitHub API. New builds are announced in `test-chanel-jonas` (`notify_url` in `secret/holtdroid-github-sync`, plus `s3_access_key`/`s3_secret_key` of IAM user `holtdroid-github-sync`). First copy: 3 APKs on 2026-10-17. Gecko builds are skipped (`include: ["!*gecko*"]`), decision #86 |
| WebView sync | Argo CD Application `homelab.k8s/argocd/holtdroid-webview-sync.yaml` (chart `deploy/helm/holtdroid-sync`, `job: webview`): Chromium's x86_64 WebView snapshots for the milestones on a channel, the newest 6 and every 5th → `holtdroid/webview/` (about 420 MB each), every 6 hours; the api reads the prefix as `webview.storage`. `secret/holtdroid-webview-sync` → `s3_access_key`/`s3_secret_key` (IAM user `holtdroid-webview-sync`, inline policy on bucket `holtdroid`) |
| Chromium sync | Argo CD Application `homelab.k8s/argocd/holtdroid-chromium-sync.yaml` (chart `deploy/helm/holtdroid-sync`, `job: chromium`, memory limit 1Gi: parsing ChromePublic.apk peaks at about 300 MB): Chromium browser builds for the milestones on a channel, the newest 10, every 2nd, every 5th past the newest 24, plus 148 → `holtdroid/chromium/`, every 6 hours; the api lists it as the read-only source `chromium`. `secret/holtdroid-chromium-sync` → `s3_access_key`/`s3_secret_key` (IAM user `holtdroid-chromium-sync`, inline policy on bucket `holtdroid`) |
| VPN gateway | The homelab's existing `vpn-gateway` in namespace `downloads` (`homelab.k8s/infrastructure/downloads`, image built from there into zot) is the shared gateway of decision #28. Service `vpn-socks.downloads.svc.cluster.local:1080`; SOCKS users `holtdroid-<cc>` for every NordVPN endpoint of the gateway (`bd`, `kz`, `lv`, `no`, `pl`, `ua`) route to `nord-<cc>`; AirVPN is not offered (its failover moves between NL and LV); one password for all of them in OpenBao `secret/vpn` → `socks_holtdroid_password` (seeded by `openbao-bootstrap.sh`). The provider config needs `vpn.resolver: 10.43.0.10` and `udp_over_tcp: true`. NordVPN account: 6 of 10 connections used by the gateway (ua, pl, kz, no, lv, bd); Finland was tried and dropped: with seven tunnels open one of them (Finland or Bangladesh) kept failing, likely the account limit together with the maintainer's own devices. Bangladesh and Kazakhstan egress IPs are placed elsewhere by ipinfo.io (the agent's default `ipInfoURL`: SG and DE) while ip-api/ipwho.is say BD and KZ; Bangladesh is a Nord virtual location |
| Nodes for sessions | All four: `core` (the NAS, taint `dedicated=nas:NoSchedule`, 4 slots) and `k3s-1..3` (3 slots each), filled in the order of `providers.emulator.fillOrder`: two on core, one on each k3s node, two more on core, then the rest (decision #85). Root in a redroid session can reach its node, core included (decisions #83, #173); a session-devices DaemonSet runs on every session node. The VPN gateway Pods are allowed by an `extraEgress` rule |
| Storage classes | `longhorn`, `local-path`, `nas-hdd` |
| Ingress / DNS | Traefik; Ingress annotation `external-dns.alpha.kubernetes.io/target: "10.10.4.25"` creates the DNS record |
| Registries | `ghcr.io/holtdroid/*` (public, from CI); the cluster also has `registry.homelab.example` (zot, needs the `zot-pull-secret` pattern from `homelab.k8s/infrastructure/downloads/secrets.yaml`) |
| SSH gateway | `sshGateway.enabled` in the Application, host key `secret/holtdroid` → `ssh_host_key` (seeded by `openbao-bootstrap.sh`, `SSH_HOST_KEY` in the `ExternalSecret`), `IngressRouteTCP holtdroid-ssh` on Traefik's `ssh` entrypoint (a non-default port on purpose, see AGENTS.local.md; `sshGateway.publicPort`, the Service stays on 2222); that port allowed on the ingress VIP by the node firewall (`homelab.nixos/modules/k3s/default.nix`), and the UniFi WAN port forward `homelab-holtdroid-ssh` (the same port to 10.10.4.25, created through the Network API with `secret/unifi` `api_key`, not declared in any repo) |

Verifying a deploy (needs the maintainer's kubeconfig):

```sh
export KUBECONFIG=~/.kube/homelab.yaml
kubectl -n argocd annotate application holtdroid argocd.argoproj.io/refresh=hard --overwrite
kubectl -n argocd get application holtdroid -o jsonpath='{.status.sync.revision} {.status.sync.status} {.status.health.status}{"\n"}'
kubectl -n holtdroid get pods
kubectl -n holtdroid logs deploy/holtdroid-api
curl -s https://holtdroid.homelab.example/api/v1/auth
```

A new commit can sit in `ImagePullBackOff` for a few minutes until its image
is built — check `gh run list` before debugging.
