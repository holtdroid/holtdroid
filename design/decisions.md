# Decision log

Newest at the bottom. To change a decision, add a new entry that names the
one it supersedes and mark the old one `Superseded by #N`. Keep entries short:
context, decision, consequences.

## 1. Enable WebView debugging with Frida, never by repackaging

**Context.** WebView DevTools are only exposed when the app calls
`WebView.setWebContentsDebuggingEnabled(true)` or is built `debuggable`. A
debuggable OS build (`ro.debuggable=1`) does not change that. Users must test
the exact APK they were given.

**Decision.** Use a rooted image (`google_apis`, `adb root`) and spawn the app
under Frida with a script that calls the method on the main thread before
any WebView exists.

**Consequences.** Apps with anti-Frida/root/emulator detection may refuse to
run; the physical-device provider is the escape hatch. frida-server and the
frida-go devkit versions must be pinned together.

## 2. x86_64 `google_apis` images with ARM translation on KVM

_The API level is superseded by #25._

**Context.** Test APKs are often ARM-only; emulating ARM fully is too slow and
nodes are x86_64.

**Decision.** `system-images;android-33;google_apis;x86_64` (API 30+ ship
`libndk_translation`) with KVM acceleration and SwiftShader rendering.

**Consequences.** Requires `/dev/kvm` and privileged pods. Some native
libraries misbehave under translation. Play Store images are excluded
because they cannot be rooted.

## 3. Go, one binary, several services

**Context.** Containers should be as small as possible, and the codebase
should lean on existing libraries. The best client libraries for this domain
(client-go, slack-go, OpenBao, Frida bindings, APK parsing) are in Go.

**Decision.** A single Go module and binary with subcommands per service,
one distroless image for everything except the session image.

**Consequences.** Services are deployed and scaled separately but released
together. Contract changes are compile-checked across services.

## 4. Services talk over versioned HTTP contracts

_The Source API is superseded by #27; Provider and Agent stand._

**Context.** Sources and device kinds must be addable (physical phones, other
artifact stores) without touching the core, possibly by third parties in
other languages.

**Decision.** Source, Provider and Agent are HTTP APIs defined with huma in
`internal/contract`, each with a Go interface, a `Register…` server helper and
(for Source/Provider) a Go client. The api only knows the interfaces.

**Consequences.** One extra network hop per call. Anyone can implement a
source or provider out of tree.

## 5. Stateless api, provider owns session state

**Decision.** No database. The emulator provider stores session state in Pod
labels/annotations; the api keeps only an in-memory activity map flushed via
`touch` every ≤30 s.

**Consequences.** Restarts are safe; worst case the idle timer of a session
is 30 s behind.

_The "no database" part is superseded by #22; session state stays with the
provider._

## 6. Everything same-origin through the api proxy

**Context.** DevTools runs in an iframe and opens a WebSocket. Forward-auth
cookies are usually `SameSite=Lax` and are not sent from cross-site
contexts; the DevTools HTTP server also rejects non-localhost `Host` headers.

**Decision.** The api proxies all agent traffic under `/s/{id}/`; the agent
proxies and caches the DevTools frontend and rewrites `Host` to `localhost`
for CDP.

**Consequences.** No adb or local Chrome needed on the user's machine.
The first open of a new DevTools revision fetches the frontend from Google.

## 7. Per-session VPN via a sing-box tun sidecar

**Context.** Each device needs its own switchable egress location, covering
TCP, UDP and DNS, without configuring Android.

**Decision.** A sing-box sidecar in the session Pod's network namespace with
`tun` + `auto_route`, cluster/LAN CIDRs excluded, one WireGuard endpoint per
location behind a selector switched through the clash API.

**Consequences.** Switching is instant with no Pod restart. With NordVPN a
single account key is shared, so the provider must never put two peers on
the same server (`excludeServers` for peers outside Holtdroid).
_Partly superseded by #28: locations are sing-box outbounds and vendors live
in an operator-run gateway._

## 8. Secrets by reference, pluggable resolvers

**Decision.** Secret config fields accept only `scheme:ref` strings resolved
by `internal/secrets` (`env`, `file`, `openbao`). Plain values are rejected.

**Consequences.** Works with Kubernetes Secrets, External Secrets Operator,
or direct OpenBao access, with no lock-in.

## 9. Auth delegated to a forward-auth proxy by default

Superseded by #17.

**Decision.** The default `header` auth provider trusts configurable user and
groups headers from a forward-auth proxy (Authelia, oauth2-proxy, …);
`none` exists for local development. Native OIDC is on the roadmap.

**Consequences.** Holtdroid must never be exposed without the proxy when
using `header`; the chart's NetworkPolicy and docs say so.

## 10. Frontend: React + shadcn/ui, generated API client; docs: Starlight

**Decision.** React, Vite, TanStack Router/Query, Tailwind v4, shadcn/ui; API
types generated from the api's OpenAPI. Public docs in Astro Starlight
(`docs/`), contributor docs in `design/`.

**Consequences.** No hand-written API types. UI is embedded in the api
binary, so there is no separate frontend deployment.

## 11. Repository conventions for agents live in AGENTS.md

**Decision.** Rules for any coding agent and for humans are in `AGENTS.md`;
`CLAUDE.md` only imports it. Explanations go to `design/`.

## 12. OpenBao over plain HTTP instead of its client library

**Context.** The resolver needs two calls: Kubernetes login and a KV v2 read.

**Decision.** `internal/secrets/openbao.go` uses `net/http` directly
(works against HashiCorp Vault too).

**Consequences.** One less heavy dependency tree; anything beyond KV v2 reads
would justify switching to `openbao/api`.

## 13. Frontend toolchain: Bun, TypeScript 7, oxlint/oxfmt

**Context.** Fast, modern tooling with few moving parts.

**Decision.** Bun for installs and scripts (hoisted linker — Astro's
prerender can't resolve native optional deps in Bun's isolated layout),
TypeScript 7's native `tsc` for type checking, oxlint (type-aware through
`oxlint-tsgolint`) and oxfmt for lint/format. `openapi-typescript` needs
TypeScript's JS API, which TS 7 does not ship, so `make openapi` runs it via
`bunx` with its own TypeScript 5.

**Consequences.** No ESLint/Prettier configs. If openapi-typescript gains
TS 7 support, drop the `bunx` pin.

## 14. Activity is user input, detected in the browser

**Context.** An open noVNC or DevTools connection produces constant traffic
even when nobody is looking, so traffic can't mean activity.

**Decision.** The session page listens for pointer/keyboard/wheel/touch input
on itself and inside its same-origin iframes (screen and DevTools) and sends
`heartbeat {active}` every 30 s while visible. Mutating requests through the
session proxy and Extend also count. Passive viewing does not.

**Consequences.** A forgotten tab no longer keeps a device alive. Input that
never reaches the page (e.g. a native client attached elsewhere) doesn't
count — none exists today.

## 15. Sessions are addressed as {provider}/{id}

**Decision.** UI API and proxy paths carry the provider name next to the
session ID instead of a global ID.

**Consequences.** The api resolves any session with one provider call and
holds no mapping; provider IDs only need to be unique per provider.

## 16. `holtdroid dev` with a directory source and fake devices

_The `dir` source service is superseded by #27; `holtdroid dev` now uses a
read-only filesystem source plus a temporary uploads source._

**Decision.** The `dir` source (also a real feature: serve APKs from a mounted
volume) and the `fake` provider, which implements the full Agent contract
with placeholder pages, run in-process behind `holtdroid dev`.

**Consequences.** UI and api work need no cluster, KVM or Slack, and the
api's tests use the same pieces.

## 17. Built-in sign-in with signed cookies; forward-auth is one mode of five

**Context.** Not every deployment has a forward-auth proxy; small teams just
want to tell sessions apart, others have an IdP.

**Decision.** `auth.mode` is `anonymous` (default, random `size-mood-animal`
names), `password` (shared password, then a random name), `oidc` (code flow +
PKCE, claims from ID token and userinfo), `header` (forward-auth) or `none`.
The first three keep the identity in an HttpOnly cookie holding an HS256 JWT
signed with `auth.sessionKey`; the OIDC state/nonce/PKCE verifier ride in a
short-lived signed cookie too. No server-side session store.

**Consequences.** Any replica can verify any cookie; restarts don't sign
people out as long as the key is shared and stable. Changing the key or the
mode signs everyone out. Without a key the api runs with a random one and
warns.

## 18. Pluggable artifact store: filesystem or S3

**Decision.** The APK cache sits on `internal/storage.Store` with a
filesystem and an S3 (minio-go) implementation. `meta.json` is written last
as the commit marker; eviction deletes it first. S3 eviction is by upload
time (no cheap touch).

**Consequences.** Several api replicas can share one warm cache through S3;
with the filesystem backend an `emptyDir` is fine because it's only a cache.

## 19. Continuous deployment by commit SHA

**Decision.** CI pushes `ghcr.io/holtdroid/holtdroid:<full sha>` for every
commit to `main`; deployments that follow `main` set `image.tag` to Argo CD's
`$ARGOCD_APP_REVISION`. The chart lives in this repo and accepts extra
manifests via `extraObjects`, so such an Application can stay single-source.

**Consequences.** No image-updater component and no bot commits. A freshly
synced commit can briefly wait for its image to finish building.

## 20. Generated avatars: DiceBear Voxel Art in the browser

**Decision.** `Identity.picture` comes from the IdP (`picture` claim or a
configured header) and is accepted only as an absolute http(s) URL. Without
one, the UI renders a DiceBear `voxel-art` avatar seeded by the username
(`@dicebear/core` + `@dicebear/styles`, style lazy-loaded as its own chunk).

**Consequences.** No avatar storage or image proxy on the server; every
user — including anonymous animal names — gets a stable, recognizable face.
The style is CC0, the library MIT.

## 21. SSH access through one gateway with browser-held keys

**Context.** Developers want ADB and their local dev servers on the device
from their own machine (`ssh android-slug@host`), with no shell access, and
without the server storing keys.

**Decision.** A single `ssh-gateway` (`x/crypto/ssh`) routes by username =
session slug instead of running an sshd per device. It only accepts
`direct-tcpip` to the device's ADB and `tcpip-forward` for publishing ports on
the device (via `adb reverse` in the agent, tunnelled over WebSocket +
yamux); `session` channels just print help. Public keys live in the user's
browser and are re-pushed by the UI; gateways hold them in memory with a TTL.
Flags: `allowADB` (default on), `allowReverse` (default on),
`clientIsolation` (default off — any key holder may use any session).

**Consequences.** One port and host key to expose; no key storage or
migration; a gateway restart only means users must open the site once before
reconnecting. Tunnels never reach anything but the session's own device.
`adb reverse` makes the feature work unchanged for physical phones.

## 22. A SQL database for the api: in-memory now, SQLite/Litestream or PostgreSQL later

**Context.** Upcoming features need queryable server-side data (history,
relations between users, sessions and artifacts) that labels, cookies and the
APK cache can't hold. Decision #5 ruled out a database.

**Decision.** Supersedes the "no database" part of #5. The api gets one
`database/sql` handle chosen by config: `memory` (SQLite `:memory:`, the
default), `sqlite` (a file, optionally replicated to S3 with Litestream
embedded as a library: restore on start, stream the WAL afterwards) and
`postgres` (pgx). SQLite is `modernc.org/sqlite` so the image stays cgo-free.
Schema migrations run with goose at startup; queries are generated by sqlc
(`internal/db`, generated code committed, CI checks it is current)
and written in the SQL subset both engines accept. Until the first release
only `memory` is implemented and there is no backward compatibility for the
schema or data: migrations are edited in place.

_The `sqlite` part is implemented by #102, which also makes migrations
append-only._

**Consequences.** With `memory` every restart and every replica starts empty,
so for now only losable data may go there; sessions, identities and the APK
cache keep their current homes. Litestream allows exactly one writer, so
`sqlite` + S3 means `replicas: 1` for the api (the chart must enforce it);
only `postgres` scales horizontally. sqlc and goose add a build-time and a
run-time dependency respectively, in exchange for no hand-written ORM layer.

## 23. Frida 17 pinned to frida-go; the script is bundled on the device host

**Context.** frida-go is cgo against `libfrida-core` and only compiles with
the devkit version it was written for (v1.1.0 fails against 17.23 and builds
against 17.15.5, the version its CI pins). Frida 17 no longer ships the Java
bridge inside GumJS: scripts must import `frida-java-bridge` and be bundled.

**Decision.** The session image pins one Frida version (`FRIDA_VERSION` in
`images/session.Dockerfile`) for both the devkit and `frida-server`, matching
frida-go's CI. The instrumentation scripts live in `frida/` (TypeScript,
`agent.ts` and `system.ts`, with their own `bun.lock` for
`frida-java-bridge`; `make lint` type-checks them with `@types/frida-gum`).
The session image build bundles them with Frida's own compiler
(`frida.NewCompiler().Build`, type checking off) through the hidden
`holtdroid agent compile-scripts`, built natively for the build machine
because Frida doesn't run under amd64 emulation on Apple Silicon; the image
ships only `agent.js` and `system.js`, so a script that doesn't bundle fails
the image build instead of a session. Only the session binary is built
with `-tags frida` and cgo; the distroless binary keeps `CGO_ENABLED=0` and
its `agent` subcommand refuses to start.

**Consequences.** Upgrading Frida means bumping frida-go and the pinned
version together and re-checking on a device. frida-go treats any script
message containing `frida:rpc` as an RPC reply, so clipboard text travelled (until #36) as
the message's binary payload, never in its JSON, and RPC functions return
`{error}` objects instead of throwing (frida-go drops the error status).

## 24. The agent drives adb through its CLI

**Context.** `electricbubble/gadb` speaks the adb server protocol but has no
`localabstract:` forwards, no `adb root`, no install and no contexts.

**Decision.** `internal/agent.ADB` runs the platform-tools `adb` binary with
`exec.CommandContext`; the agent depends on a small `Device` interface so the
pipeline is tested with a fake.

**Consequences.** One process per adb call (the DevTools scan runs one every
2 s, which is cheap). The `adb` binary must be in the session image, which it
is anyway for the emulator.

## 25. Android 15 (API 35) system image

**Context.** Decision #2 assumed every x86_64 image from API 30 ships ARM
translation. The first device run proved otherwise: `android-33` r17 has
`ro.product.cpu.abilist=x86_64` and `ro.dalvik.vm.native.bridge=0`, so
ARM-only APKs fail with `INSTALL_FAILED_NO_MATCHING_ABIS`. Reading
`build.prop` of every `google_apis;x86_64` image: API 30 translates
(`arm64-v8a`, `armeabi-v7a`), 31–32 list `arm64-v8a` without a bridge, 33
has nothing, 34+ ship `libndk_translation.so` again (`x86_64,arm64-v8a`).

**Decision.** Supersedes the API level of #2. The session image uses
`system-images;android-35;google_apis;x86_64`. Before changing the system
image, check its `build.prop` for `ro.dalvik.vm.native.bridge` and the ABI
list.

**Consequences.** 32-bit-only ARM apps (`armeabi-v7a` without `arm64-v8a`)
don't run; API 30 would be the only image for them. Android 15 ships
WebView/Chrome 124, which works with the DevTools frontend from
chrome-devtools-frontend.appspot.com.

## 26. Findings from the first device run (Phase 2)

Session Pod on `k3s-1`: Android boots in ~35 s, the ARM-only test APK
(46 MB) is installed and running under Frida ~60 s after the Pod starts.
Verified: the hooked app opens `@webview_devtools_remote_<pid>`; targets,
the CDP WebSocket through the agent and the cached frontend work (exercised
with Chrome's `@chrome_devtools_remote` page); clipboard both ways, including
non-ASCII text; noVNC through the agent; location switching changes the
egress IP of the agent and of the emulator's traffic.

- `frida-server -D` keeps `adb shell` open unless its stdio is redirected.
- Frida wrappers received in a hook must be `Java.retain`ed to be used later;
  JS strings are not converted to `CharSequence` for overload resolution.
- The emulator window in Xvfb is scaled to fit and has a toolbar. The AVD
  sets `window.x/y=0` (`emulator-user.ini`), the emulator runs with
  `-fixed-scale`, and x11vnc clips to the device size (`-clip 720x1280+0+0`),
  so the browser shows exactly the device screen.
- A failure after boot (install, crash loop) keeps the device running so it
  can be inspected; only a dead emulator ends it.
- sing-box sidecar: the WireGuard MTU must fit the Pod network (flannel
  VXLAN, MTU 1450), 1280 works, the default 1420 fails with `sendmmsg:
  message too long`. The selector uses `interrupt_exist_connections`, so the
  agent drops idle HTTP connections after a switch. The sidecar needs
  `NET_ADMIN` and `/dev/net/tun` (hostPath), not privileged.
- DNS from the emulator goes through slirp to the Pod's resolver, which is in
  the excluded cluster range, so lookups bypass the tunnel. Rendering
  (`internal/vpn`) should give the emulator a resolver behind the tunnel
  (sing-box DNS on the tun address, or `-dns-server`).
- `holtdroid agent` can't run under Rosetta on Apple Silicon (Frida uses
  `eventfd`); test the session image on a real amd64 node.

## 27. Sources are folders or S3 prefixes the api lists itself

Supersedes the Source API of #4 and the `dir` service of #16.

**Context.** Every new origin of builds (Slack, CI, releases) would have
been a Holtdroid service to write, test, release and keep compatible. Most
of them only need to copy files somewhere. Users also want to upload their
own builds, keep some private and delete them, and replaced files must not
be served from a stale cache.

**Decision.** A source is a `storage.Store` (filesystem or S3) that the api
lists directly (`internal/source`): every `*.apk` is an artifact, an
optional `<file>.apk.meta.json` sidecar carries title, note, changelog,
uploader, link, origin, tags, owner and visibility. Integrations such as a
Slack sync are independent jobs that write that layout. Each file has a
revision (ETag, else size + mtime); the APK cache and session
`ArtifactRef` (`{source}/{key}@{rev}`) are keyed by it, and the api polls
every source (`pollInterval`) and pushes `event: artifacts` when a
fingerprint changes. Uploads (`uploads.enabled`, default on) go into a
writable source under `{prefix}/{random}/{name}` with a sidecar naming the
uploader as owner; owner and admins may change visibility and delete,
admins may delete ownerless files; `readOnly` sources refuse both. Private
artifacts are visible to the owner and admins only. The UI API exposes
artifact IDs as base64url of the key, so keys with slashes survive proxies
that reject `%2F`.

**Consequences.** No `source-*` services and no Source contract; one fewer
hop. Uploads make the uploads source stateful: the chart mounts a PVC at
`/var/lib/holtdroid` (RWO → one api replica, rolled with `maxSurge: 0`); S3 sources lift
that. Listing reads the store on every request (sidecars are memoised by
revision); very large buckets would need a listing cache. Other replicas
see uploads at their next poll.

## 28. VPN locations are plain sing-box outbounds; vendors live in a shared gateway

Supersedes the WireGuard-per-location part of #7 and the planned `nordvpn`
and `wireguard` VPN providers.

**Context.** Vendor integrations (NordVPN server picking, per-vendor key
handling) would be Holtdroid code to write and keep working for every VPN
service. WireGuard credentials are usually one key per account; the same key
on the same server from several session Pods makes their handshakes fight,
and picking a distinct server per session only shifts the problem. A single
shared sing-box that all devices use, switched by source IP, would break as
Pod IPs change and would mix sessions' traffic in one place that has to know
about sessions.

**Decision.** Every session keeps its own sing-box sidecar (tun, selector,
clash API — switching stays local and instant, and `adb reverse`/SSH tunnels
over loopback are untouched). A location is `{id, label, outbound}`, where
`outbound` is any sing-box outbound or endpoint object (inline, or a secret
reference whose value is the JSON) that `internal/vpn` tags and puts behind
the selector, plus an optional `direct`. Holtdroid has no vendor code. The
recommended setup, documented for operators, is one shared sing-box gateway
they run themselves: it holds one WireGuard (or any) tunnel per location and
offers a SOCKS inbound where the username selects the location
(`auth_user` route rules), so every sidecar's outbound is
`socks://<location>@gateway`. Device DNS is forced through the tunnel: the
emulator gets `-dns-server` (`vpn.dns`) and the sidecar hijacks DNS from the
tun into a resolver that dials through the selector.

String fields inside an inline outbound may themselves be secret references
(`password: env:VPN_GATEWAY_PASSWORD`); they are resolved when a session's
config is rendered, so a shared gateway password never sits in values files.

**Consequences.** Any number of sessions share one key per location without
collisions; they also share that location's egress IP. Adding a VPN vendor
is a gateway config change, not a release. The gateway is the operator's to
run and protect (NetworkPolicy; the SOCKS hop is unencrypted inside the
cluster). sing-box's `local` DNS server sends `*.local` names — every
`*.cluster.local` Service — to mDNS, so outbounds naming in-cluster hosts
need `vpn.resolver` set to the cluster DNS IP (found in the end-to-end
check against sing-box 1.14.2, which also confirmed the rendered config,
switching through the clash API, per-username routing on a gateway and DNS
hijacking).

## 29. Emulator slots are nodes; sessions are pinned and their state comes from the Pod

**Context.** Phase 3 needs slot accounting that survives provider restarts
and an answer to "what state is this session in" without a database or a
channel from the agent to the provider.

**Decision.** `provider-emulator` lists Nodes (cluster-scoped read, so the
chart needs a ClusterRole) that match `nodeSelector` — a label selector
string, because config keys can't contain the dots of label keys — and whose
taints `tolerations` cover. Each such node is a slot; Create picks the first
free one under a mutex and pins the Pod to it with required node affinity,
so the slot is known before scheduling and two sessions never race for a
node. Pod anti-affinity stays as a second guard. State is mapped from the Pod
phase and the `emulator` container (running → `booting`, readiness probe on
the agent's `/v1/health` → `ready`). While a Pod is running but not ready,
the provider asks its agent for the current stage (`GET /v1/state`, 2 s
timeout, in parallel for a listing), so `installing`, `instrumenting` and a
failure after boot show up on the home page; an unreachable agent leaves it
at `booting`. `agentUrl` is the Pod IP, no per-session Service.

The provider runs as a single replica (the chart fixes `replicas: 1` and
rolls with `maxSurge: 0`) instead of claiming nodes with Leases: it serves a
few requests an hour, sessions live on as Pods while it restarts, and the
api tolerates a provider being briefly unreachable.

**Consequences.** The node mutex is local, so a second replica could
double-book a node; anti-affinity would turn that into a Pending Pod that the
reaper removes. A Pod that can't be scheduled stays `provisioning` until the
reaper removes it.

## 30. Sync jobs live in their own repositories

**Context.** Decision #27 made integrations independent jobs that write the
source layout. The Slack sync was planned as a subcommand of the
`holtdroid` binary.

**Decision.** Each sync job is its own repository, image and chart
(superseded by #43: they now share one), starting with
holtdroid-slack-sync.
It talks to Holtdroid only through the file layout and the launch link
(`/?source=…&launch=…`, contracts.md "Artifact sources"). It copies the few
packages it shares with Holtdroid (`storage`, `secrets`, `config`, `apk`)
instead of importing them, because those are `internal/`. The job is
stateless like the api: the target listing is its state, and its own Slack
reaction marks a message as announced.

**Consequences.** Holtdroid no longer depends on `slack-go`, and its releases
don't move with Slack's API. A change to the layout, the sidecar or the
launch link has to be mirrored in the sync repos, and their copied packages
can drift from upstream: port fixes both ways.

## 31. Device controls go through adb shell; the language through system_server

_The language part is superseded by #59._

**Context.** Testers need the hardware buttons, rotation, radios, battery,
display, language, time zone and clock of the device, from the browser and
without a reboot or a modified APK.

**Decision.** The agent exposes them as `/v1/device` in the Agent API and
implements them with stock shell commands over adb (`input keyevent`,
`settings`, `svc`, `cmd connectivity|power|uimode|alarm|statusbar`,
`dumpsys battery`, `wm density`, `screencap`) and the emulator console for
network speed and latency (`adb emu network …`). Android has no shell command
for the system language, so the agent attaches Frida to `system_server`
(`frida/system.ts`) and calls
`LocalePicker.updateLocales`, the call the Settings app makes; it applies at
once and persists. The clock is set to real time + offset with
`cmd alarm set-time` after turning `auto_time` off, and its offset is read by
comparing `date +%s%N` with the agent's clock. Enabling battery saver unplugs
the emulated charger first, because Android turns the saver off while
charging. Rotation locks auto-rotate and sets `user_rotation`; the noVNC
picture stays in the panel's native orientation, so the UI rotates the
screen iframe back (the browser maps input through the CSS transform, noVNC
is unaware).

**Consequences.** No extra on-device tooling; every setting is a plain shell
string that tests pin down. Inputs that reach the shell are constrained by
the contract's patterns and enums. The network profile is remembered by the
agent, not read back from the emulator. When scrcpy replaces noVNC the
rotation compensation goes away: scrcpy streams the rotated display as is.

## 32. The provider restarts the prepull DaemonSet when the session tag moves

**Context.** The live deployment runs sessions from `holtdroid-session:main`
with `pullPolicy: Always`, because the per-commit tag appears minutes after
Argo rolls out. The prepull DaemonSet only pulls when its pods are created,
so after a push the first session on each node downloaded the changed layers
itself, and a stop during that pull hung until it finished.

**Decision.** With `prepull.refresh` on (default) and a pull policy of
`Always`, provider-emulator asks the registry for the tag's digest every
`interval` (5m) and writes it into the DaemonSet's pod template annotation
`holtdroid/session-image-digest`, which rolls the pods and makes every node
pull. The registry is reached with plain `net/http` — one `HEAD` of the
manifest plus the anonymous bearer-token handshake — rather than a registry
client library, as with OpenBao (#12). Its RBAC is `get`/`patch` on that one
DaemonSet. Argo CD doesn't own the annotation, so it isn't reverted.

**Consequences.** Private registries that need credentials aren't supported
by the refresh (it logs a warning and the prepull stays as it is). Pinned
tags and `IfNotPresent` turn it into a no-op.

## 33. Deployments that follow every commit track a `deploy` branch

**Context.** The live Argo CD Application tracked `main` and used the synced
commit as the image tag. It rolled out a commit minutes before CI had pushed
its image; the single provider replica rolls with `maxSurge: 0` (#29), so
it was gone and the new one sat in `ImagePullBackOff` until the build
finished, and sessions couldn't be listed or started meanwhile.

**Decision.** The release workflow moves a `deploy` branch to the commit
after the `holtdroid` image is pushed, only forward (an older run that
finishes late doesn't move it back). Deployments that follow every commit
track `deploy`; the session image keeps its own `:main` tag (it builds much
longer and is pulled per session). #29 stays as is.

**Consequences.** A commit reaches the cluster a few minutes later than
before, and only with an existing image; the provider still has a short
restart gap while its new Pod pulls the small image. `main` stays the branch
everyone works on.

## 34. The screen is a scrcpy stream, not noVNC

**Context.** The screen went Xvfb → emulator window → x11vnc → noVNC in an
iframe. Browser touch became X11 mouse clicks on the emulator window: one
pointer, no pinch, VNC tiles instead of video, and a rotated device showed a
sideways picture that the UI had to turn back with CSS (#31).

**Decision.** The agent bridges scrcpy (architecture.md "Screen"): one
`scrcpy-server` per WebSocket on `/display/scrcpy`, started over `adb shell`
in forward-tunnel mode, its video socket streamed to the browser and the
browser's control messages written to its control socket. The browser
parses and decodes with Tango's `@yume-chan/scrcpy` and
`@yume-chan/scrcpy-decoder-webcodecs` onto a canvas and serializes touch,
scroll, key and clipboard messages with the same library. The server
version is pinned to what the library supports (3.3.3; the server refuses a
client of another version) and bumped together with it. The emulator runs
`-no-window`; Xvfb, x11vnc and noVNC are gone from the image.
`capabilities.display` keeps the extension point with `scrcpy` as its only
value; the fake provider replays a short H.264 recording over the same
protocol so the UI works without a device. This supersedes the noVNC parts
of #26 and the rotation compensation of #31.

**Consequences.** Real multi-touch, H.264 at up to 60 fps for less traffic,
rotation and resizing handled by the stream, the same renderer for a future
phone provider. The browser needs WebCodecs (current Chrome, Edge, Firefox,
Safari). Every viewer of a session runs its own encoder on the device. Text
typed through IME composition isn't forwarded yet. The UI and the agents it
streams from must speak the same protocol, so the `deploy` branch (#33) now
also waits for the session image: a commit rolls out once both images exist.

## 35. The app stays closed until the user starts it; builds can be swapped in place

**Context.** The agent re-spawned the app whenever it exited, so closing it
to test a cold start or a restore path was impossible, and a crash loop
ended the session. Testing a
storage migration meant a new session per version.

**Decision.** The agent no longer restarts the app: `appRunning` in the
status turns false and the device stays `ready`. The user starts it again
with "Start app" (`POST /v1/app/restart`) or from the launcher. The icon
is not put on the home screen: adb installs don't trigger the launcher's
"add icon on install" (`--install-reason 4` was tried), and writing into the
launcher's database was too fragile to keep. To keep DevTools and
the clipboard working for launcher starts, the agent turns on Frida spawn
gating: the app's main process is instrumented before it resumes, all other
processes resume immediately; a start that races an explicit restart or
install is left to the explicit one, which force-stops it. Another build of
the same package is installed in place through the provider
(`POST /v1/sessions/{id}/install`, which then records the new artifact ref on
the Pod) and the agent (`POST /v1/install`, synchronous so errors reach the
user), either over the current build with `-r -d` (data kept, downgrades
allowed on the debuggable emulator image) or after `pm uninstall`. A failed
install keeps or restores the previous build. The api checks ownership,
visibility and that the package matches; the proxy refuses `/v1/install` so
browsers can't make an agent download arbitrary URLs.

**Consequences.** A crash shows as a closed app instead of a failed session.
Every process start on the device waits for one round trip to the agent.
If the agent's container restarts, it installs the build the session was
created with again (its env), while the Pod's annotation names the last one
installed.

## 36. The clipboard, audio and stream options go through scrcpy

**Context.** The clipboard went through the Frida script: an RPC to set it
and a listener in the app to report changes. It only worked while the app ran
under Frida, which a physical phone won't have. The screen ran at fixed H.264
settings, typed text was limited to what scrcpy can inject as text (Latin
characters), the screenshot waited for `adb screencap`, and there was no
audio. scrcpy and Tango already cover all of that.

**Decision.** The agent keeps a control-only scrcpy server with
`clipboard_autosync=true` running from boot and implements the clipboard
endpoints on top of it; the Frida script only enables WebView debugging.
Every scrcpy server runs as the shell user (`su 2000` when adbd is root):
started as root it calls the clipboard service as `com.android.shell`, which
fails the package check, and the service clears the clipboard. `/display/scrcpy`
takes the codec (H.264, H.265, AV1), maximum size, frame rate and bitrate as
query parameters; the agent checks the device's encoders once and closes the
socket with 4001 for a missing one. `/display/audio` streams Opus from an
audio-only server, decoded with WebCodecs and played with
`@yume-chan/pcm-player`. The UI adds a virtual USB keyboard (UHID,
descriptor from `@yume-chan/aoa`) next to text input, takes screenshots
from the decoder's last frame, asks for a key frame when the tab becomes
visible again, and sends key buttons, notifications and quick settings over
the control socket while the screen is connected. Display power and
`start app` messages are left out: the emulator has no panel to turn off, and
starting the app has to go through Frida.

**Consequences.** The clipboard works with the app closed and on devices
without Frida. Its text is capped by scrcpy's 256 KiB message limit, and the
first value after an agent restart is only known after the next change.
Audio is one more encoder per listener and starts only from a click (on by default since decision #54). In the
USB keyboard mode, layouts are set up on the device; the text mode stays the
default because it works without that. H.265 and AV1 trade device CPU
(software encoders on the emulator) for bandwidth, and H.265 decoding
depends on the browser and OS.

## 37. Builds from S3: copies or a credentials broker, both behind include rules

**Context.** Teams already publish builds to S3 buckets, often in AWS
accounts that only allow short-lived IAM Identity Center sessions approved
in a browser. The maintainer wants both options: reading the bucket
directly, and copying builds so they survive the end of a session. Only
some of the keys in such a bucket matter.

**Decision.** A separate job,
holtdroid-s3-sync
(decision #30; now the `s3` job of holtdroid-sync, #43), has two modes.

- *Copy* mirrors the matching APKs into a folder or S3 source, with
  sidecars and icons.
- *Broker* serves temporary credentials in the ECS container credentials
  format.

The job signs in with the OAuth device authorization flow. It posts the
link through shoutrrr (any chat, push or mail service, at most one
code per `notify.remind`) and to its log, and keeps the session alive with refresh tokens
in a 0600 cache file. The api gains two generic pieces and nothing
AWS-specific:

- `include` rules on any source (`internal/rules`, gitignore syntax);
- `s3.credentialsURL` on S3 stores, a minio-go credentials provider that
  fetches and refreshes the ECS document.

**Consequences.** The api still has no AWS SDK, SSO code or Slack. Any
credentials service that speaks the ECS format plugs in. A broker-backed
source lists nothing while nobody has approved a login; copies stay. The
token cache is the job's only state and holds credentials, so it lives on a
private volume.

## 38. SSH tunnels: status from the agent, a port list in the browser, privileged ports allowed

**Context.** Using the gateway from decision #21 means typing a `-R` per
port, and nobody could tell from the portal whether a tunnel was up. The
maintainer wants the session page to show which ports are being forwarded,
an editor for the set of ports one usually forwards, kept in the browser,
and a single command for all of them. The default set is 80, 443 and
3000–3010.

**Decision.**

- The agent is the one place that sees every tunnel into its device, whichever
  gateway replica opened it. It records them (with the SSH user the gateway
  passes in `X-Holtdroid-User`) and streams them as `GET /v1/tunnels` (SSE)
  on the normal Agent API, which the UI reaches through the api proxy. The
  gateway and the api stay stateless, and nothing new is stored.
- The port list is UI state in `localStorage`: ports, ranges, and
  `device:local` pairs, the same for every session. The UI expands it into
  one `ssh -N … -R p:localhost:p …` command, optionally with the ADB `-L`.
  Nothing on the server knows about the list.
- `reversePorts` defaults to `1-65535` instead of `1024-65535`. The port is
  bound on the device's loopback by adbd, which runs as root on emulators,
  so 80 and 443 can't collide with anything outside the device. Where adbd
  can't bind a port (a physical phone), the agent's `adb reverse` fails and
  the client sees a failed forward.
- An interactive login (`ssh` without `-N`) prints the help and holds the
  tunnels until Ctrl+C, instead of exiting at once. Commands still never
  run. Login failures explain themselves once every offered key failed,
  through a keyboard-interactive step that asks nothing: a banner would
  print on the first refused key even when a later one logs in.
- Spliced streams half-close where both ends can (TCP, SSH channels, yamux
  streams), and the other direction then gets 30 s before both are closed.
  That keeps `printf … | nc` style requests working without leaving
  half-open streams around forever. The ADB WebSocket closes outright.

**Consequences.** The status is live and correct with several gateway
replicas. Who connected is visible to everyone who can see the session, as
sessions already are. The default command opens 13 tunnels, inside the
default `maxTunnelsPerConnection` of 32, which the api mirrors so the UI
can warn. A list stays in one browser, like SSH keys do.

## 39. Session containers get no CPU limit

**Context.** Sessions felt sluggish over both noVNC and scrcpy. The
emulator renders with SwiftShader (`-gpu swiftshader_indirect`), so the
"GPU" is host CPU threads on top of the four guest vCPUs, all inside a
`cpu: 4` limit. Scrolling Settings 30 times on a k3s node (i5-8500T) under
that limit gave 23–45 % janky frames and a GPU p90 of 4950 ms; without the
limit, 3–7 % janky frames and a GPU p90 of about 25 ms. `-gpu swangle`
was worse (47 %). Host GPU rendering on the nodes' iGPUs doesn't work
headless: gfxstream needs a GLX display for GLES, and EGL-on-EGL renders
black because its shaders target desktop GL.

**Decision.** The default session resources keep the CPU request (3) and
the memory limit but drop the CPU limit. One session runs per node, so the
emulator may use the whole node.

**Consequences.** A busy session can take every core of its node, which
only matters if other workloads share session nodes; operators who need a
cap set `resources.limits.cpu` themselves. Host GPU rendering stays open
(it would need an X server on the iGPU inside the session image).

## 40. Session metrics come from the agent, sampled only while watched

**Context.** Testers want to see the load while they use an app: is the
device, the app or the node the bottleneck, does the app drop frames.
Kubernetes metrics (metrics-server, kubelet, Prometheus) would make the api
talk to the cluster and tie the feature to one infrastructure, and they say
nothing about the guest or the app.

**Decision.** The agent serves `GET /v1/metrics` (SSE) and measures what it
can reach itself: the guest through one `adb shell` script per sample
(`/proc/stat`, `/proc/meminfo`, `df /data`, `/proc/net/dev`, the app's and
WebView renderers' `/proc/<pid>/stat` and `smaps_rollup`, frame counters
from `dumpsys gfxinfo`, `dumpsys thermalservice`) and the session Pod
through the node's cgroup v2 tree (mounted read-only, the Pod found by its
uid) and `/sys/class/thermal`. Rates come from the difference between two
samples.
Sampling runs every 2 s while at least one browser listens and stops with
the last one; the UI unsubscribes in hidden tabs. Stream fps and bitrate
are counted in the browser. Fields a device can't measure are absent, so a
physical phone later reports the same shape without `host`.

Since redroid (decision #82) Android shares the node's kernel, and
`/proc/stat`, `/proc/cpuinfo` and `/proc/meminfo` aren't namespaced: the
guest sees the whole node. Whenever the Pod's cgroup is readable, the
device's cores, CPU and memory therefore come from the Pod instead: cores
are its CPU limit rounded up, CPU is its usage as a percent of that limit,
memory is its working set of its memory limit (the node's memory without
one), and the app's per-process CPU is rescaled from the node's cores to
the limit. The Pod also holds the agent and the VPN sidecar, which is
accepted: they are small next to Android, and lxcfs or matching the
`android` container's own cgroup would need either a node dependency or the
container id, which the Pod can't see. `/data` is still `df` of the
emptyDir, so its total is the node's disk. (Superseded by #111: the
`android` container's cgroup, and `/data` against the emptyDir's limit.)

**Consequences.** A watched session spends one adb round trip and two
`dumpsys` calls every 2 s. An emulator's temperatures are made up by its
thermal HAL; the UI says so and shows the node's zones next to them. GPU
load isn't reported: with SwiftShader it is CPU time (decision #39), and
fps/jank describe the effect better.

## 41. Sessions render on the node's GPU through VirtualGL

**Context.** Decision #39 left host GPU rendering open. Every session node
has an integrated GPU (`/dev/dri`). The emulator's `-gpu host` on Linux needs
a GLX display. Without one, its EGL-on-EGL path gets a GLES context from
Mesa, its desktop GL 3.3 shaders don't compile, and the screen is black.

**Decision.** `gpu: host` (provider and agent config, default) runs Xvfb as
the display and the emulator under VirtualGL (`vglrun -d /dev/dri/cardN`).
VirtualGL's EGL back end turns the emulator's GLX into EGL on the DRI device,
so Xvfb never touches the GPU and nothing needs DRM master or an Xorg
config. VirtualGL 3.1.5 is built in the session image with a three-line
patch: its EGL back end returns `EGL_TRUE` instead of `Success` from
`glXGetFBConfigAttrib` for the max pbuffer attributes, and the emulator
skips every config whose attribute query fails ("found 0 GLES 2.x
configs"). A container without `/dev/dri/card*` falls back to SwiftShader
with a warning. `gpu: software` keeps SwiftShader everywhere. Session Pods
are privileged and already see the node's devices, so no volume is added.

Measured on a k3s node (i5-8500T, UHD 630), 30 scrolls through Settings:
0.8–1 % janky frames and a p99 frame time of about 30 ms on the GPU,
against 2.8–3.5 % and 57 ms with SwiftShader, at roughly half the emulator's
CPU (150–220 % of a core against 320–370 %). On `core` (Ryzen 7 5825U,
radeonsi) every frame percentile is 16 ms (0.3 % janky) at about 65 % of a
core. scrcpy's encoder path (`screenrecord`) works unchanged.

**Consequences.** The session image gains Mesa, Xvfb and VirtualGL (an
extra layer that rarely changes). GPUs need a Mesa driver; NVIDIA's
proprietary driver would need its EGL libraries in the image. The patch is
dropped once VirtualGL ships the fix. Video encoding for scrcpy stays a
software encoder inside the guest.

## 42. Temporary uploads expire a while after their last use

**Context.** Uploads are mostly one-off builds for a quick check. Left alone
they pile up in the uploads source forever, and nobody cleans them by hand.

**Decision.** An upload is temporary unless the uploader unticks the box.
The sidecar records `temporary: true` and `lastUsedAt`. Launching it or
installing it into a session moves `lastUsedAt` forward. When a source poll
finds a temporary build in a writable source whose `max(uploadedAt,
lastUsedAt) + uploads.temporaryTTL` (default 7 days) has passed, it deletes
the build. The owner and admins can make a build permanent or temporary at
any time; making it temporary starts the countdown from that moment.
Permanent builds don't get their sidecar rewritten on launch.

**Consequences.** The state lives in the sidecar, so the api stays
stateless, and several replicas may race to delete the same build, which is
harmless. Each launch of a temporary build rewrites its sidecar, which
changes the library fingerprint and refreshes open lists. Sync jobs can mark
their own builds temporary the same way. Running sessions keep working after
a deletion because they use the cached copy.

## 43. Sync jobs share one repository

**Context.** Decision #30 gave each sync job its own repository, image and
chart. With three of them (Slack, S3, GitHub releases) about 2,000 lines
were copied three times: the APK parser and icon renderer, storage, secrets,
config, include rules, the sidecar writing order, pruning, announcements,
the main boilerplate, the chart and CI. Fixes had to be ported by hand.

**Decision.** All sync jobs live in
[holtdroid/holtdroid-sync](https://github.com/holtdroid/holtdroid-sync): one
Go module with a binary per job (`holtdroid-{slack,s3,github}-sync`), shared
packages for the source layout (`layout`), announcements and the main loop,
one image `ghcr.io/holtdroid/holtdroid-sync` with every binary, and one chart
where `job` picks the binary. The rest of #30 stands: the jobs don't import
Holtdroid's module and talk to it only through the source layout and launch
links. A separate base module imported by per-job repositories was rejected:
every shared fix would need a tag and three dependency bumps.

**Consequences.** A shared fix is one change. Jobs are released together; a
job that didn't change still gets a new image tag. Holtdroid keeps its own
copy of the shared packages, so the two copies are still synced by hand.
The old per-job repositories were deleted; their history is not carried over.

## 44. Audit log and telemetry leave the process

**Context.** Operators want to answer "who did what, when" and to plug
Holtdroid into the monitoring they already run (Prometheus, Loki, ELK,
Datadog, an OpenTelemetry Collector). The api is stateless and its database
is in memory, so nothing it keeps would survive a restart anyway.

**Decision.**

- `internal/audit` defines one event (`schema: 1`: time, service, action,
  result `ok`/`denied`/`failed`, actor, admin, provider, session, artifact,
  client IP, raw `X-Forwarded-For`, user agent, reason, string details).
  The api and the ssh-gateway emit it for every state-changing action.
  Sinks: JSON lines through a dedicated `slog` JSON handler on **stdout**
  (regular logs stay on stderr) with `"log":"audit"`, on by default;
  OTLP logs through the OpenTelemetry SDK's batch processor; a webhook that
  POSTs JSON arrays in batches, retries with backoff and then drops and
  counts. Emitting never blocks a request on delivery.
- The api's `session_events` table is written by the same `emit` call
  instead of a separate path; the table columns follow the event
  (`action`, `result`).
- The client IP is the peer address; `X-Forwarded-For` is recorded raw
  rather than trusted, so no "trusted proxies" setting is needed.
- Clipboard content is never recorded. Clipboard sync inside the scrcpy
  stream (decision #36) is invisible to the api and not audited; only writes
  through the agent's REST endpoint are.
- `internal/telemetry`: Prometheus metrics with `client_golang` on the
  default registry, served on `telemetry.metrics.listen`, separate from
  every API port. Request counts per huma operation come from a middleware
  on every huma API; domain metrics (sessions, slots, launches, launch
  duration, cache hits, SSH connections and tunnels) are package-level
  collectors. Launch duration is measured by the replica that launched the
  session, the first time it sees the session `ready`.
- Tracing is OpenTelemetry with `otelhttp` on every server and contract
  client, W3C trace context propagation, OTLP/HTTP export. Off by default;
  without an endpoint the exporter follows the standard `OTEL_*` variables.
- The chart uses a `PodMonitor` instead of a `ServiceMonitor`: session pods
  have no Service, and per-replica components are scraped individually
  without adding metrics ports to every Service.

**Consequences.** Audit durability is the destination's job: stdout is
synchronous, the OTLP and webhook sinks lose at most their buffers on a
crash. The event schema is a public contract; incompatible changes bump
`schema`. Proxy (Phase 4.7) and MCP (Phase 4.8) events are added with those
features. Prometheus histograms of streaming operations (SSE, the screen)
measure stream lifetime, not latency.

## 45. Cleartext HTTP to loopback is always allowed in the app

**Context.** Published ports (SSH `-R`) appear on the device's loopback, and
developers point the app's WebView at `http://localhost:<port>`. Apps
targeting API 28+ forbid cleartext traffic by default, and Android, unlike
iOS, has no localhost exception, so the WebView fails with
`ERR_CLEARTEXT_NOT_PERMITTED` before connecting. The APK is never modified,
so its network security config can't be changed.

**Decision.** `frida/agent.ts` hooks
`NetworkSecurityPolicy.isCleartextTrafficPermitted(String)` to return `true`
for `localhost`, `127.0.0.1` and `::1` and defers to the app's policy for
every other host. Chromium (WebView) and OkHttp ask this per-host overload.

**Consequences.** Loopback cleartext can't be tested as forbidden in a
session; every real host behaves as the app ships.

## 46. Unknown SSH keys are added through a link the gateway prints

**Context.** Someone running the ssh command for the first time has no key
in the portal yet, gets "Permission denied" and has to find the SSH keys
page, copy the `.pub` file and come back. The gateway sees the public keys a
client offers, but a key offered without a signature proves nothing: public
keys are public. A plain "someone is knocking with key X, add it?" prompt in
the UI would let anyone get their key onto another user's account with one
careless click.

**Decision.** With `keyRequests` on (default) the gateway accepts the first
unknown key a client offers so the client signs with it
(`VerifiedPublicKeyCallback`), then returns partial success. OpenSSH can't
offer keys again once it ran out of them, which is why the proof happens in
the first round rather than after all keys failed; after partial success it
starts the list over, so a registered key further down still logs in. If
every key fails and no registered key was refused for another reason, the
keyboard-interactive step prints `{portalURL}/ssh?request={code}` (a random
code bound to that key) with the fingerprint and waits up to
`keyRequestTimeout` for the key to reach the gateway. The portal page shows
fingerprint, session and client IP, warns against links from someone else,
and adds the key to the browser's list like a pasted one. Nothing new is
stored on the server: codes live in the replica's memory while the
connection waits, and the key travels through the ordinary
`PUT /api/v1/ssh/keys`.

`skipHostKeyCheck` (off by default) only changes the commands the UI shows:
`-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`. It removes
the first-connect prompt and the changed-host-key error for gateways
without a fixed `hostKey`, and also removes protection against a
man-in-the-middle. The docs say so.

**Consequences.** Like any device-code flow it can be phished: whoever
convinces a user to confirm a link gets their key on that user's account.
The confirmation shows the fingerprint and warns, and a code only works
while its connection waits. Clients without keyboard-interactive
(`BatchMode=yes`) or with it turned off see only "Permission denied", as
before. Each waiting connection holds a goroutine for up to
`keyRequestTimeout`, which is why there is the cap of 64 per replica.

## 47. The SSH gateway names itself only to signed-in users

**Context.** The gateway listens on a public port. Its version string
(`SSH-2.0-holtdroid`), "No running session …" and the portal hints told
anyone with any key what was behind the port, and a scanner could tell
missing slugs from existing ones once it had the slug's format.

**Decision.** The server announces itself as `SSH-2.0-OpenSSH_9.9`. The
slug is resolved before the key is looked at; a missing, not-ready or
forbidden session answers "Not found." and nothing else, and the portal
link and hints appear only for an existing session. A failure to reach the
api reads "Temporarily unavailable". After a key is verified for a session,
the gateway sends an SSH banner (`SSH_MSG_USERAUTH_BANNER`, still allowed
before authentication completes) with the logo, the session and the user;
it reaches `ssh -N`, which never opens a channel to print to.

**Consequences.** The key exchange and algorithm lists still look like Go's
`x/crypto/ssh` to a fingerprinting tool (HASSH); hiding that is out of
scope. Every connection costs one session lookup on the api, even from
scanners. A legitimate user with `clientIsolation` on gets "Not found." for
someone else's session, like for a missing one. OpenSSH hides banners at
`LogLevel` below `INFO` (`-q`).

## 48. A bounded audit store for the admin page

**Context.** Decision #44 sends audit events out of the process and keeps
nothing. A homelab without Loki or ELK then has no way to answer "who
stopped my session" short of grepping pod logs, and those are gone after the
next deploy. The api is stateless (decision #22: in-memory data must be
fine to lose), so whatever it keeps can only be a convenience.

**Decision.** This partly supersedes #44's "nothing is kept".

- `audit.store` (api only, on by default): an in-memory list of the most
  recent events, bounded by `maxEvents` (10 000, about 5 MiB) and `maxAge`
  (30 days). With `path` it is mirrored to a JSON lines file: appended per
  event, read back on start (unparsable lines skipped), rewritten through a
  temp file and rename once it holds twice as many lines as events kept.
  Not the in-memory SQLite: it is empty after every restart, and the file
  needs no schema. Queries scan the list newest first; at this size that is
  cheaper than keeping indexes.
- The ssh-gateway forwards its events with `audit.forward` to
  `POST /internal/audit/events` on the api's internal port through
  `contract.SSHSessions`, reusing the webhook's batching sink, so the page
  covers SSH too. The api stores them without re-emitting: the gateway's own
  sinks already have them.
- Admin-only UI API `/api/v1/admin/audit` (info), `/events` (filters,
  `before` cursor) and `/export` (JSON lines, audited as `audit.export`).
- The chart chooses where the file lives (`audit.store.persistence`): the
  api data volume (default), a separate volume (by default a tmpfs
  `emptyDir`), or nowhere.

**Consequences.** Each api replica keeps its own events and the gateway's
batches land on whichever replica the Service picks, so with several
replicas the page is partial; the docs say to use the sinks for anything
complete or durable. A crash loses at most the line being written. The
file on a ReadWriteOnce data volume needs no new constraint: that volume
already pins the api to one replica. Like the rest of the internal port,
`/internal/audit/events` is unauthenticated: anything that can reach that
port can add events to the page (not to stdout or the sinks), which is one
more reason to keep the port off the ingress and the record of truth in
the sinks.

## 49. App data is saved when a session stops and restored on request

**Context.** Every session starts from a fresh install, so testers log in
and click through onboarding again each time. They want to carry the app's
state (sign-in, settings, WebView cookies and storage) to the next session
of the same app, to pick among their last few states, to download them, and
to optionally keep the cache too. The api is stateless, and the APK is never
modified.

**Decision.**

- **Agent:** `POST /v1/app-data/export` stops the app (`am force-stop`) and
  streams `tar --numeric-owner` of the top-level entries of
  `/data/data/{pkg}` and `/data/user_de/0/{pkg}` (no `lib`) through
  `adb exec-out`, compressed with zstd (`klauspost/compress`; toybox tar
  has no zstd, and zstd beats gzip on both speed and size here). The tar is
  parsed while it streams, so a truncated one fails instead of being stored.
  `cache/` and `code_cache/` are included only when asked and when they fit
  `maxCacheSize` and `maxSize` (measured with `du` first); data alone over
  `maxSize` is refused.
- **Restore** happens after installing the APK and before the app first
  starts: the agent empties the app's directories (keeping `lib` and the
  cache directories installd created), rewrites the archive, `adb push`es it
  and extracts it with `tar -x` in `adb shell`, then relabels the restored entries with
  `chcon -hR` using the SELinux context of the app's data directory. The
  rewrite is what makes it portable: the app usually gets another uid on
  another device (verified on the session image: 10209 → 10210 after a
  reinstall), so owners are mapped from the archive's uid to the new one
  (and the `uid + 10000` cache gid with them), and `restorecon` gives app
  data no MLS categories (`s0` instead of `s0:c210,…`), which the app may
  not be able to write. Piping into `adb exec-in` was dropped: adbd kills
  the command once its stdin closes, so tar's exit status is lost. The rewrite also drops anything outside the two
  directories, other than regular files, directories and symlinks, or below
  a symlink, because extraction runs as root. A failed restore fails the
  session rather than starting the app on half its data.
- **api:** stopping a `ready` session (the Stop button or the reaper) saves
  first; a failed save is logged and audited and the session is stopped
  anyway. A save in another replica's hands (the agent answers 423) makes
  the reaper skip the session for one pass. Users can also save on demand
  from the session page, which restarts the app. Saves go to
  `appData.storage` (default: the shared `storage` under `app-data/`, which
  the APK cache's eviction leaves alone) as
  `{sha256(user)}/{package}/{id}.tar.zst` plus `{id}.json` written last.
  The id is a timestamp plus 96 random bits, so the internal download URL
  handed to the agent can't be guessed. Retention: per user and app the
  `appData.keep` most recently used stay (default 6), and any save unused for
  `appData.maxAge` (default 7 days) is deleted when the next save prunes or
  by an hourly sweep, which also removes archives whose JSON was never
  written. Launching with a save moves its `lastUsedAt`.
- **Privacy:** saves are visible, usable, downloadable and deletable only by
  the user they belong to, admins included. A session's save belongs to
  its owner even when an admin stops it. The agent's export is refused
  through the session proxy, which any signed-in user may use.
  `appData.export: false` hides downloads (403).
- **UI:** an App data page next to SSH keys; the launch dialog offers "Fresh
  install" (the default) or one of the app's saves, and a cache checkbox
  when the server keeps caches and the save has one. The quick launch
  button opens a menu on hover (fresh, data, data and cache); a plain click
  uses the last choice from `localStorage` (default: data, the newest save,
  fresh when there is none).
- Off by default (`appData.enabled: false`).

**Consequences.** Data the app encrypted with Android Keystore keys doesn't
survive another device: keystore2 keeps the keys outside the app's
directories, and copying them is out of scope. Such apps may sign the user
out or fail to read their files after a restore. A save from a newer build
may break an older one (database downgrades); the launch dialog warns when
the versionCode is higher. External storage (`/sdcard/Android/data`) is
not saved. Stopping a session takes as long as the save, bounded by
`appData.timeout`. A session that dies on its own (node loss, OOM) has no
save.

## 50. One SSH connection can serve all of a user's sessions

**Context.** Developers often run several devices at once and want their dev
server on all of them. With one SSH user per session that is one `ssh` per
device, restarted whenever a device is replaced.

**Decision.** The SSH user name `user-{pseudonym}` stands for all sessions
the user owns. The pseudonym is the first 10 bytes of
HMAC-SHA256(`auth.sessionKey`, login) in base32, so the name neither reveals
the login nor can be computed from it without the key (in the `header` and
`none` modes there is no key and it is a plain hash). The api derives it and
pushes it with the user's keys, so the gateway needs no secret. The gateway
polls `GET /internal/users/{handle}/sessions` every 5 s and keeps one
`Reverse` tunnel per port and ready session; the agent API is unchanged.
`-R` is acknowledged before any device has the port, since devices come and
go; failures show per device in the portal instead. Only `-R` is offered:
ADB has to pick one device. Activity is counted per session so one open
connection doesn't keep every device from being reaped. `user` is reserved
as a provider name.

**Consequences.** A new device gets the ports up to 5 s after it is ready;
pushing session events to the gateway would remove that delay and is left
for later. A port already published on a device by another connection is
skipped there and retried every 30 s. The handle changes if
`auth.sessionKey` changes.

## 51. ADB in the browser through the session proxy

**Context.** ADB reaches users only through the SSH gateway (decision #21),
which needs a key, an `ssh` client and a local `adb`. Tango
(`@yume-chan/adb`, already the source of the screen code, decision #34)
speaks the adb protocol in the browser, and `@yume-chan/android-bin` adds
logcat, demo mode, bugreports and settings on top. With a byte stream to
adbd the portal gets logcat, a file manager, a terminal and app tools with
almost no Go code, one feature at a time.

**Decision.**

- The agent serves `WS /adb` on its main port: the same relay as
  `/tunnel/adb`, but reached through the api's session proxy, which sets
  `X-Holtdroid-User` from the signed-in identity (and strips a client's own).
  `/v1/tunnels` lists both kinds with `client: ssh | browser`.
- The whole adb protocol runs in the browser. The page opens one connection
  once the device is first ready and keeps it, and the logcat collected in
  it, while the app restarts or another build is installed. Tools are tabs
  next to DevTools: Logcat (follows main, system and crash, filtered to the
  app by its uid, crash toast), Files (sync protocol), Terminal (shell v2
  pty in xterm.js), App (deep links, runtime permissions, force stop, clear
  data, doze, standby bucket) and Device (props, WebView provider switch,
  demo mode, a client-side bug report zip and Android's own bugreport).
  Screen recording records the decoded canvas with `MediaRecorder`; it needs
  no adb. A "whole page" mode records the portal tab itself through
  `getDisplayMedia` with `preferCurrentTab` (DevTools, console and tab
  sound included), at the cost of the browser's share prompt each time.
- Both relays parse adb packets and answer OPENs of services that restart
  adbd or the device or move adb elsewhere (`reboot:`, `unroot:`,
  `remount:`, `tcpip:`, `usb:`, `sideload:`, `*-verity:`) with CLSE: any of
  them would cut the agent off its own device. This is the first piece of
  the filtering proxy Phase 7 needs for phones.
- Config `adb.browser` (default on) and `adb.ownerOnly` (default off, like
  `clientIsolation`); `GET /api/v1/adb` tells the UI. The api audits
  `adb.connect` (with denials) and `adb.disconnect` with the duration.
- The fake provider implements a small adbd (shell v1/v2 with a pty, exec,
  sync v1, binary logcat, `pm`/`am`/`dumpsys`/`settings`/`bugreportz`), so
  `holtdroid dev` exercises all of it.

Rejected: an agent endpoint per feature (logcat SSE, a files API). It is
easier to filter, but every tool would need its own contract, Go code and
fake, and the browser would still lack a terminal.

**Consequences.** Whoever may open a session in the portal gets a root
shell on an emulator from the browser, as they already could over SSH;
`adb.ownerOnly` narrows that, `adb.browser: false` turns it off. A
"terminal off" switch is not offered: `exec:` and `shell:` run arbitrary
commands either way, so it would only hide a tab until the Phase 7 filter
checks every service. Each open session page holds one adbd connection, so
adbd on emulators serves the agent, SSH users and every tab at once. The
RSA key Tango needs lives in the browser's IndexedDB; emulators don't ask
for it (`ro.adb.secure=0`).

## 52. Published ports are probed through their own tunnel

**Context.** The SSH popover listed published ports but not whether the
developer's server behind each one was running, which is the usual reason a
WebView shows an error.

**Decision.** The agent decides, with no HTTP request and no access to the
developer's machine: it opens a stream into the port's yamux session, as a
device connection would. The gateway then opens a `forwarded-tcpip` channel
to the client; if the client's `ssh` can't connect to its local port, the
channel open fails and the gateway closes the stream at once. A stream that
stays open for 2 s, or gets data, means a server is there. Data coming back
on a real device connection marks the port up as well. Probes run only while
someone watches `/v1/tunnels?probe=true` (the UI does while the SSH popover
is open), every 5 s; a port that is down is retried after 5, 10, 20, 40 and
then every 60 s.

**Consequences.** OpenSSH prints `connect_to localhost port N: failed.` for
every refused probe, so with the popover open the publisher's terminal gets
a line per dead port at that backoff; the default port list publishes 13
ports, most of them usually dead. A server that accepts and closes a
connection without sending anything looks down. A probe costs the live
server one idle connection for 2 s.

## 53. The portal restyles the DevTools frontend through its design tokens

**Context.** The DevTools frontend in the session page is Chrome's own,
with its fonts and blue accents, next to a gray portal. It is served from
the session path on the portal's origin by the agent's frontend cache, so
the portal can reach into the iframe's document and localStorage.

**Decision.**

- After each load of the iframe the portal adds a `<style>` to its document
  that overrides the reference palette (`--ref-palette-primary*`,
  `secondary*`, `neutral*`, `neutral-variant*`) with grays of the same tone
  (`lab(T 0 0)`), the font tokens (`--default-font-family`, monospace) with
  the portal's Geist and Tailwind's mono stack, and the blue-tinted dark
  surfaces. Under the dark theme (`.-theme-with-dark-background`, older
  revisions without the dash) the gray tones below 40 are pulled down along
  `T³/1600` (panels, tone 15 → lab 2; toolbars, 25 → 10; continuous at 40),
  so DevTools lands on the portal's near-black background and cards instead
  of mid-gray; text tones (40 and up) are unchanged. Custom properties inherit into DevTools' shadow roots, so a
  stylesheet on `:root` reaches every panel. The frontend files are not
  rewritten: the agent keeps serving them byte for byte.
- Before the iframe loads, the portal writes DevTools' hosted-mode settings
  to localStorage: `ui-theme` is `systemPreferred` and
  `screencast-enabled` is off. Chrome reports the iframe owner's
  `color-scheme` (set by next-themes) as the frame's
  `prefers-color-scheme`, so DevTools switches with the portal theme live;
  an explicit `dark`/`default` would make it ignore that and re-apply its
  own class over any change from outside. Both new and old setting names are written,
  since the frontend revision follows the device's WebView.
- Both are per-browser switches in the DevTools panel (`holtdroid:devtools`
  in localStorage), restyling on by default.

**Consequences.** The overrides use DevTools' internal token names, which
are not an API: a frontend revision that renames them falls back to stock
DevTools colors, nothing breaks. Chart and syntax colors (tertiary, error,
token colors) stay DevTools' own.

## 54. Device audio on by default, vibrations as a toast and a buzz

**Context.** Device audio started only from a click (decision #36), so
sounds of the app under test went unheard unless someone remembered the
switch. An emulator's vibrations aren't visible or audible at all, while
apps use them for notifications and calls.

**Decision.** The audio switch is a stream setting (`audio`, on by
default, kept in localStorage). The page connects once the screen is live
and the page has a user activation (`navigator.userActivation`), so the
`AudioContext` is allowed to run, and reconnects every 3 s after a drop
until the switch is turned off or the device reports it can't capture.
For vibrations the agent polls `dumpsys vibrator_manager` once a second
while someone watches `/v1/vibrations`, reads the current vibration and
the recent history, keys entries by their create time and reports the
ones that are new since the previous poll, leaving touch feedback out.
This needs no Frida, so it works with the app closed and on devices
without it. The page shows a toast with the package, usage and length,
and, with the audio switch on, plays a buzz synthesized with Web Audio
(a low-passed 165 Hz sawtooth with a 23 Hz rattle), 150 ms to 3 s long.

**Consequences.** One more audio encoder per open session page.
Vibrations arrive up to a second late; a repeating pattern (a ringtone) is
reported once, with no length. The dumpsys text format is Android 14+;
older devices report nothing. A reload starts the audio only after the
first click on the page.

## 55. The VPN sidecar resolves IPv4 only

**Context.** The sidecar's tun has an IPv6 address, so Android resolves
`AAAA` records and connects to IPv6 first. Typical locations (SOCKS to a
gateway whose WireGuard tunnels are IPv4-only) reject IPv6 destinations,
but by then the tun has already accepted the TCP connection, so the app
sees a reset instead of an unreachable network and never falls back to
IPv4: every dual-stack host failed.

**Decision.** The sidecar's DNS uses `strategy: ipv4_only`: hijacked `AAAA`
queries get an empty answer, so the device only ever connects over IPv4.
The tun keeps its IPv6 address, so IPv6 to literal addresses still goes
into the tunnel instead of leaking around it.

**Consequences.** No IPv6 through any location, even one that could carry
it. Apps that connect to IPv6 literals still fail on IPv4-only locations.

## 56. Lock shows the lock screen; the home screen rotates

**Context.** The emulator boots with the lock screen disabled
(`locksettings get-disabled` is true), so the lock button only turned the
screen off and waking showed the app again. The rotate buttons set
`user_rotation`, but the Pixel launcher is portrait-only by default
(`SCREEN_ORIENTATION_NOSENSOR`), so on the home screen they did nothing.

**Decision.** There are two actions: `screen-off` presses the power button
(`KEYCODE_SLEEP`), `lock` enables the lock screen, sleeps and wakes the
device, so it lands on the keyguard. The rail button runs the one picked in
its hover popup, remembered in the browser. At boot the emulator agent turns
on the launcher's "Allow home screen rotation" (`pref_allowRotation` in its
shared preferences, written as root with the launcher stopped).

**Consequences.** After the first `lock` the lock screen stays enabled, so a
screen timeout also lands on it, as on a real phone; `unlock` dismisses it.
`lock` takes about a second. Apps that fix their orientation still don't
rotate, as on a real device.

## 57. Launches wait in line while every slot is busy

**Context.** With every slot taken a launch failed with 409, and people
retried by hand until someone's session ended.

**Decision.** `POST /api/v1/sessions` takes `queue: true`. The api keeps a
FIFO line per provider in memory: only the front of the line polls the
provider's capacity (every 2 s) and creates the session, then hands the turn
on. A launch without `queue` gets 409 while anyone is waiting, so it can't
jump the line. The request itself is the place in line: the browser opens the
launch page, which holds the request open, and closing or leaving the page
aborts it, which drops the place. Once a slot is taken the session is created
even if the request goes away, so no half-made Pod is left behind; the reaper
collects it if nobody comes back.

**Consequences.** The line is per api replica and lost on a restart (the
browser's request fails and the page shows the error). Two replicas don't
share an order, only the provider's capacity. Proxies in front of the api
must not cut long-running requests.

## 58. Device settings live in the rail as one button per section

**Context.** The settings sheet covered half the screen and hid the device
behind it, every switch was equally far away, and nothing showed that a
device was in airplane mode or had its clock moved.

**Decision.** The sheet is gone. The rail under the screen buttons has one
button per section: network, battery, display, language and region, date and
time. A click does the most common thing (airplane mode, battery saver, the
next display theme); hovering opens a popup with the rest of the section,
which stays open once you click inside it. The VPN location moved there from
the header. A section whose settings differ from the defaults gets an amber
dot and a reset button. The defaults are airplane off, Wi-Fi and mobile data
on, full speed, on battery at 65% (set at boot), saver off, light theme, 100%
font and display size, `en-US`, the emulator's GPS position and real time.
The time zone counts as a choice, not a change.

Keyboard layouts are extra entries in the system language list
(`LocalePicker.updateLocales` with several tags), because the on-screen
keyboards and Android's physical layout picker follow it. The list is a
browser preference, applied to each session as it opens; without one the
browser's Keyboard API guesses the current layout, and English is always
there. The browsers don't list all of a user's layouts, only the active
one. The display theme can follow the portal's theme, which is also a
browser preference. The GPS position is faked with the emulator console's
`geo fix`, remembered by the agent like the network profile.

**Consequences.** Opening a session with layouts other than English changes
the device's language list, which is what the user picked. Apps that read
the location need location access as usual. Devices without an emulator
console (phones) report `canFakeGeo: false` and the UI hides the GPS part.

## 59. The system language goes through app_process, not Frida in system_server

_On phones without root see #73._

**Context.** Changing keyboard layouts attached Frida to `system_server`
(#31). On the emulator that once crashed `system_server` with a SIGSEGV in
ART while another thread delivered an exception; Android restarted the whole
system and the call came back as `DeadSystemException`.

**Decision.** The session image builds `images/session/Locales.java` into a
1 KB dex (`javac`, then `d8` from the pinned r8 jar). The agent pushes it to
the device and runs `app_process` as root with the tags; it calls the same
`LocalePicker.updateLocales` through reflection, so it applies at once and
persists. Frida stays in `system_server` only for the wallpaper, drawn once
per install — and rooted phones skip even that (`NoWallpaper`), because the
Frida detach from `system_server` crashes it on some phones (Samsung A05:
"attempting to detach while still running code" → a soft reboot), so the
cosmetic wallpaper is not worth the risk there.

**Consequences.** A failure kills a throwaway process, not the system. The
image build needs a JDK stage. Devices without root would fail the
`WRITE_SETTINGS` check of the call and need another way.

## 60. Sessions are their owner's by default over SSH and ADB

**Context.** Decisions #21 and #51 left `clientIsolation` and `adb.ownerOnly`
off, so any signed-in user with a key or a session page had a root shell on
every emulator. The SSH gateway is now reachable from the internet, and the
portal is meant for people who don't share devices by default.

**Decision.** `sshGateway.clientIsolation` and `adb.ownerOnly` default to
`true`: only a session's owner and `auth.adminGroups` may tunnel to it or
open its ADB tools. Everyone else still sees the screen and DevTools.
Supersedes the defaults in #21 and #51.

**Consequences.** Helping on someone else's device over ADB needs an admin
or both flags turned off; the UI already hides the ADB tabs and says
"You can reach your own sessions only." when they apply.

## 61. SSH tunnels reconnect through a shell loop and gateway keepalives

**Context.** A laptop going to sleep or switching networks kills the `ssh -N`
command, and the user had to notice and run it again. Worse, a silently
dropped connection kept its published ports on the device: the agent refuses
a port already held, so a fresh connection got everything except the ports.

**Decision.** The SSH button wraps the command in
`while true; do ssh … ; sleep 1 || break; done` (switch **Reconnect**, on by
default, stored in the browser), with `ServerAliveInterval=10`,
`ServerAliveCountMax=3` and `ExitOnForwardFailure=yes`. The gateway sends
`keepalive@openssh.com` every `keepaliveInterval` (15 s) and disconnects a
client that doesn't answer within two intervals. No `autossh` and no
client-side tool: plain `ssh` and a POSIX loop are already everywhere.

**Consequences.** After a drop the tunnels are back within a second of the
network returning; a port the dead connection held fails the forward and the
loop retries until the gateway releases it (at most ~30 s). Stopping takes
Ctrl+C twice in bash (once for `ssh`, once for `sleep`). The loop is for
bash and zsh; fish, nushell and PowerShell users turn the switch off and loop
their own way. A port the gateway always refuses (outside `reversePorts`, over
`maxTunnelsPerConnection`) makes the loop retry every second with the error
on screen.

## 62. A WebView test browser in its own repository

**Context.** Testing a web page inside a WebView meant finding some app that
embeds one, and every such app picks its own WebView settings (TLS, user
agent, viewport, permissions) with no way to change them or to see the page
under a different setup.

**Decision.** [holtdroid/holtdroid-webview](https://github.com/holtdroid/holtdroid-webview)
is a separate Android app (Kotlin, Compose), released on its own: a start
screen with presets of WebView settings, remote debugging on by default, a
GeckoView build next to the plain one, and live control through
`am start`/`am broadcast` with one key per setting. It knows nothing about
Holtdroid's APIs: a session runs it like any uploaded APK and finds its
WebView through the usual DevTools socket. Releases are tagged from
Conventional Commits on every push, and Renovate merges dependency updates,
which then ship as patch releases.

**Consequences.** The portal needs no code for it, and the app is useful
without Holtdroid. Its user documentation lives on this site
(`docs/tools/webview.md`) so there is one place to read; the app links to it.
The GeckoView build is about 100 MB per ABI, so it is a separate APK.

## 63. Vector launcher icons are rendered through SVG

**Context.** Apps with `minSdk` 26 often ship only an adaptive icon whose
foreground is a VectorDrawable (Android Studio's template does), and the icon
extractor only composed bitmap layers, so such APKs, Holtdroid WebView among
them, showed a placeholder.

**Decision.** `internal/apk` translates a VectorDrawable (paths, groups with
transforms, fill and stroke colours, alpha, fill type, caps and joins) into
SVG and rasterises it with `srwiley/oksvg` and `rasterx`, small pure-Go
packages that handle SVG path data with arcs and strokes. They see few
commits, but their scope is finished; `tdewolff/canvas`, the maintained
alternative, pulls GUI toolkits and font stacks into the module. Gradients,
clip paths and theme attributes are skipped. Cached entries record
`apk.ParserVersion`; an entry from an older parser is a cache miss and is
parsed again under the same key, so better extraction reaches APKs that are
already cached.

**Consequences.** Upgrading the parser re-downloads each cached APK once, on
its next use. Bump `apk.ParserVersion` whenever extraction gets better.
holtdroid-sync carries the same `internal/apk` copy and gets the same change.

## 64. Tunnels through a connect client with SSH certificates

**Context.** SSH access (decisions #21, #38, #46, #50, #61) needs a key on
the SSH keys page, a hand-picked port list kept in one browser and a shell
loop around `ssh`. The gateway forgets keys on restart until a browser
re-pushes them, ADB reaches only one device per connection, and the port
list can't follow what the developer actually runs. Doing more in a bash
script (dynamic ports, a TUI, two-way control, token rotation) would be
fragile and would leave out Windows.

**Decision.**

- **Client.** `holtdroid` (source in `cmd/holtdroid-connect`, so it isn't
  confused with the server binary), a small Go binary in this module (no
  client-go, no frida). The api serves it from its own image together with
  `GET /tunnel.sh`, a POSIX bootstrap that detects OS and architecture,
  downloads the matching binary (its sha256 is rendered into the script)
  and runs it. Client and server ship from the same commit, so there is no
  separate repository and no version skew. It uses `x/crypto/ssh` instead
  of the system `ssh`. In a terminal it is a full-screen bubbletea UI
  (sections on the left: Overview, Devices, Ports, Log, Settings; device
  tools were dropped from it later, see #75), and
  Settings can link `holtdroid` onto the user's `PATH`; without a terminal
  or with `--plain` it prints status lines. Ports of programs that look like
  dev servers come first in the UI and on the Computers page; the rest
  (system services, desktop apps) is one step away. The client updates
  itself from the portal it connects to, so it never drifts from the
  gateway: builds are compared by SHA-256 rather than version (a local
  build is `dev`), and the user picks update, skip (with a warning) or
  automatic updates. For launching, stopping and restarting devices the
  client uses the portal's existing API rather than new gateway messages:
  each refresh also issues a short access token (the certificate's
  lifetime) that the authenticator accepts as `Authorization: Bearer`, so
  every permission check stays where it is. `ssh.insecureTLS` (off by
  default) lets development portals with self-signed certificates work. The types it shares with the api and the gateway
  live in `internal/contract/control`, which has no dependencies, so the
  client doesn't pull in huma or OpenTelemetry (about 8 MB per build).
- **Enrollment.** The portal shows `curl -fsSL {portal}/tunnel.sh | sh -s --
  {code}`. The code is single-use and lives 10 minutes, because the command
  ends up in shell history and `ps`. The client generates its own ed25519 key
  under the user's config directory (it never reads `~/.ssh`) and trades the
  code, its public key, hostname and OS for a refresh token, a certificate
  and the gateway's host keys, which it then requires (no trust on first
  use). Codes and tokens are JWTs signed with a key derived from the CA key;
  a code is spent in the memory of the api replica that took it, so with
  several replicas it is single-use per replica within its 10 minutes.
- **SSH certificates.** The api is an SSH user CA: for a valid refresh token
  it issues a 15-minute OpenSSH certificate whose principal is the user's
  `user-{pseudonym}` handle and whose key id names the computer. The gateway
  trusts only the CA public key, which it fetches from the api, so it keeps
  no keys: a gateway restart only drops connections, which clients re-open.
  Each refresh also rotates the refresh token, which is bound to the
  computer's key fingerprint. The login is only ever the user's
  `user-{pseudonym}` handle (decision #50): per-session slugs are gone, and
  so is `clientIsolation`, since a computer reaches only its owner's
  sessions.
- **Revocation.** Without a persistent database the tokens are stateless and
  signed; a single computer can't be revoked, only all of them by rotating
  the CA key, and a stolen refresh token works until it expires. With a
  persistent database (Phase 4.6) a `computers` table keeps the rotation
  generation: a replayed old token revokes the computer, and a revoke makes
  the gateways drop that key id's connections while the certificate runs out.
- **Control channel.** The client opens one `holtdroid-control` subsystem
  channel with JSON lines both ways: the client sends its hostname, version
  and the TCP ports listening on its loopback; the gateway sends the user's
  sessions and the computer's settings changes made in the portal. Settings
  (mode, chosen ports) live on the client; the portal changes them through
  the api and the gateway replica that holds the connection, and can't
  change them while the computer is offline.
- **Port modes.** *Manual*: the ports picked in the TUI or the portal, out of
  the ones the client sees listening, are published on every ready device.
  *Automatic*: the agent logs SYNs to loopback ports nothing listens on in the
  device (iptables `LOG`, read from the kernel log) and asks for the port;
  the client publishes it only if something listens on it locally and the
  port isn't on its deny list (22, 2375, 2376 and others by default). The
  first connection is refused, later ones go through. The portal warns that
  any page in a WebView can then reach the developer's local services.
- **ADB per device.** The client knows all of the user's sessions, so ADB is
  addressed per session: each device gets a local port that stays the same
  for the session (from 15555 up), and the client runs `adb connect` /
  `adb disconnect` when `adb` is on `PATH`.
- Browser-held keys, the SSH keys page, key requests, `skipHostKeyCheck` and
  the reconnect loop go away; the client reconnects on its own. Supersedes
  #21 (keys), #46, #61 and the port list of #38.

**Consequences.** Users run one command per computer instead of managing
keys, and see every device, its ADB port and published ports in one place.
The api image carries the client binaries for darwin/linux on amd64/arm64.
A plain `ssh` client no longer works without a certificate from the
client. Automatic mode is a deliberate trade of safety for convenience and
stays off by default per computer.

## 65. Publish modes from the computer's own listeners

**Context.** Picking every dev server port by hand is tedious, and the
SYN-driven automatic mode of #64 needs agent work (iptables `LOG`, port
requests). The client already sees which ports listen on the computer and
which process owns each.

**Decision.** The client has three publish modes, saved per portal on the
computer and switched in the TUI or with `--publish-mode`: *manual* (only
pinned ports), *dev* (also every listener whose process looks like a dev
server, the same list as the Ports grouping) and *all* (also every other
loopback listener). Pinned ports stay published in every mode. The
automatic modes skip the adb server (5037) and processes named `adb*`,
`qemu-system*`, `emulator*` and `holtdroid*`: publishing them would hand a
device the host's adb or another client's device ADB. The client's own
listeners are never in its port list. The TUI confirms before switching to
an automatic mode. The portal shows the mode and the pinned ports
(`Computer.mode`, `Computer.pinned`) but doesn't switch it, and a port the
mode publishes can't be unpublished on its own; switching to manual is the
way out. A refused port is logged once, not on every port scan.

**Consequences.** One switch publishes whatever dev server starts next,
at the cost of exposing it to every device of the user without a prompt.
The SYN-driven mode of #64 stays planned for ports that aren't listening
yet.

## 66. Screen recordings are a canvas scene encoded to an OPFS file

Superseded by #96; the OPFS file lives on in its video download.

**Context.** The rail recorded either the screen canvas or the whole tab
with `MediaRecorder`, kept every chunk in memory until the end and patched
the WebM duration afterwards. Long recordings filled the memory, the screen
mode had no context about the device or the app, and the page mode showed
the whole portal.

**Decision.** Every recording draws a scene on its own canvas
(`web/src/lib/composer.ts`): a phone frame around the scrcpy canvas that
follows rotation, and in the *Screen and details* mode the logo, app and
device blocks and the tool panel. The panel comes from `getDisplayMedia`
of the current tab narrowed to the tool tabs' container with
`RestrictionTarget` (or `CropTarget`), so DevTools and Logcat are shown as
they are, without rebuilding them on the canvas. Frames are drawn on a
worker timer so a background tab keeps recording. The canvas is encoded
with WebCodecs through `mediabunny` into fragmented MP4 and streamed to a
file in the origin private file system; the file is downloaded on stop and
removed a little later. A Web Lock marks a file as being recorded, so
another tab doesn't treat it as left over. The WebGL screen renderer keeps
its drawing buffer (`enableCapture`) so the canvas can be copied.

**Consequences.** Memory stays flat whatever the length, and a recording
cut off by a closed tab is still playable and offered for download on the
next session page. Fixed scene sizes (1920×1080 or 1080×1920) make window
resizes and rotation a layout question instead of an encoder one. The panel
needs Chromium's element or region capture and a share prompt per
recording; elsewhere the scene has no panel. Device audio is recorded only
as tab audio in the details mode.

## 67. Phones start without root, with the agents inside provider-physical

**Context.** Phase 7 planned only rooted phones (Magisk, frida-server).
Many test phones can't or shouldn't be rooted, and some apps refuse rooted
devices, so a phone has to work without root too. A phone also outlives
its sessions, unlike an emulator Pod.

**Decision.** `provider-physical` runs on the host the phones are plugged
into and keeps an inventory from its config (`phones[]` by serial; other
phones on the host are ignored). Every session runs the ordinary device
agent (`agent.New`) inside the provider's process against one phone, served
under `/agents/{id}/` like the fake provider's agents, so nothing above the
Provider contract changes. Without root the agent gets a `Launcher` instead
of Frida (the launcher intent through `monkey`, processes followed with
`pidof`) and `agent/phone` instead of the emulator boot (wait, wake, follow
`adb get-state`). Debuggable builds turn WebView debugging on by
themselves and their DevTools sockets are reachable from the shell user, so
DevTools work for them; release builds need Frida, which needs root. Since
phones differ, slots and sessions carry `SlotCapabilities` (model, Android,
ABIs, root, DevTools scope, ADB, app data) and the UI reads them from the
session. Sessions and pending resets are written to a state file; on start
the provider runs their agents again with `Resume` (download, no install,
no restore), so a restart doesn't end sessions. Ending a session uninstalls
the app, resets what the portal's device settings change and drops adb
forwards; the phone stays busy until that is done.

**Consequences.** Root mode comes later as another `Instrumenter` and boot
for the same provider, chosen per phone. Phones got browser ADB and ADB
tunnels through the filtering proxy of decision #68. App data, VPN locations, the system language and clock,
network emulation and fake GPS are off on phones without root. The
provider is stateful on its host, like Pod annotations are for the emulator
provider; a phone left mid-reset by a crash is reset again on the next
start.

## 68. ADB on phones goes through a device-side proxy with a shell policy

**Context.** The agent's ADB relay (decision #51) splices adb packets to
adbd over TCP and only refuses a few services. A phone has no adbd on TCP,
only USB through the host adb server, and it outlives its sessions, so a
user's `adb shell` must not be able to damage it (architecture.md
"Physical devices").

**Decision.** With `ADBServer` set and no `ADBAddr`, the agent's
`/tunnel/adb` and `/adb` reach `agent.ADBProxy` instead of adbd. It speaks
the device side of the protocol: CNXN without AUTH (the api or the SSH
gateway authenticated the user), a banner built from the host adb server's
`host-serial:<serial>:features` (without `delayed_ack`, since the proxy
speaks the classic one-WRTE-per-OKAY flow control) and `getprop`. Every
OPEN is checked, and an allowed service becomes its own smart-socket
connection to the host adb server (`host:transport:<serial>`, then the
service); WRTEs go into it and are acknowledged once written, and its output
comes back one WRTE at a time. On top of the relay's refusal list it refuses
`root:`, `reverse:` (the reverse forward would end on the provider's host,
not the user's computer; publishing ports covers that) and forwards to
frida-server's ports. Shell services (`shell:`, `shell,v2,…:`, `exec:`,
`abb:`, `abb_exec:`) follow `adb.shell`: `full`, `allowlist` (one command
from a fixed list, split the way `sh` would and refused on any operator,
substitution or redirect) or `off`. Services that carry no command (`sync:`,
`jdwp:`, forwards, `framebuffer:`) pass with every setting; anything else
needs `full`. Phones default to `allowlist` and report `adb: true` in their
`SlotCapabilities`. The emulator keeps the raw relay: its device is
disposable.

**Consequences.** IDE installs, logcat, push/pull, debuggers and Chrome's
remote inspection work on phones by default; an interactive shell, the
portal's Terminal and most App/Device tools need `full`. The allowlist is
fixed in code, not configurable, until someone needs more. `adb reverse`
is refused on phones. The session page doesn't know the shell policy yet,
so it still shows tools that the policy will refuse (superseded for the
Terminal tab and Files' Delete and New folder by #163).

## 69. Phone VPN goes over the USB cable through Holtdroid Tunnel

**Context.** The plan for phones was the WireGuard Android app driven by
intents, with the VPN credentials on the phone and the phone's own Wi-Fi
as the way out. The maintainer wants phones to switch locations exactly as
emulators do and to get both ADB and the internet through the USB cable.
Stock Android can't take a network from a host over USB without root.

**Decision.** A separate app,
[Holtdroid Tunnel](https://github.com/holtdroid/holtdroid-tunnel), is a
VpnService that sends every app's traffic to a SOCKS5 proxy on the phone's
loopback, with UDP as sing's UDP-over-TCP; `adb reverse` maps that port to
the host. `provider-physical` runs one sing-box per session with a `mixed`
inbound and the clash API on random loopback ports, rendered by
`vpn.Config.RenderProxy` from the same `vpn` config as the emulator sidecar
(bypass CIDRs become a direct route instead of a tun exclusion). The agent
gets that clash API, so location switching is unchanged, and asks ipinfo
through the mixed inbound so the egress IP is the phone's, not the host's.
`agent/phone` installs the app when it is missing or another version,
grants the consent with `appops set … ACTIVATE_VPN allow`, turns Wi-Fi and
mobile data off, maps the port, starts the tunnel and re-checks it on every
poll. Rendered configs hold resolved secrets, so they live in a private
temporary directory for the life of the process, never in the state file.

**Consequences.** No VPN credentials on the phone, one network path, and
the same locations for every kind of device. The app under test can see a
VPN (`TRANSPORT_VPN`); a transparent path needs root and comes with root
mode. The tunnel stays installed between sessions and is stopped by the
reset. A resumed session starts again at its first location. Its control
receiver needs `DUMP`, which only the shell has, so the app under test
can't stop it; a user with `adb.shell: full` can, and the agent restarts
it. A device-owner app can later pin it as always-on VPN with lockdown.

## 70. provider-physical ships as its own image with its tools pinned

**Context.** The provider needs adb, the scrcpy server it pushes, sing-box
for VPN locations and the Holtdroid Tunnel APK, all on the USB host. The
api image is distroless static and multi-arch; the session image carries
an emulator. Neither fits.

**Decision.** `images/physical.Dockerfile` builds
`ghcr.io/holtdroid/holtdroid-physical` for linux/amd64 only (platform-tools
for Linux is x86_64): the holtdroid binary without the UI, `adb` from the
same platform-tools zip as the session image, scrcpy-server, sing-box and
the tunnel APK, each pinned by version and checksum, on distroless `cc`
(adb is a glibc binary). It runs as 65532 with `HOME` and the working
directory in `/var/lib/holtdroid`, so the state file and adb's key land on
one volume. `tunnel.apk` defaults to the APK in the image, and its version
is read from the APK when `tunnel.version` is empty, so bumping the tunnel
is one Dockerfile change. The release workflow builds it on every push and
the deploy branch waits for it.

**Consequences.** USB access without root needs a host udev rule and a
supplementary group; root in the container is the documented fallback.
Losing the volume makes the host a new adb key, and every phone asks again
to allow debugging. A host with its own adb server running must stop it,
since only one server can own a phone.

## 71. Phones are cleaned against a baseline before and after every session

**Context.** A phone keeps whatever a user leaves on it: apps, files, Wi-Fi
networks, settings, browser history. The maintainer wants every session to
start from the same phone and phones to rest in a low-power state between
sessions, without root.

**Decision.** The provider records a baseline the first time it sees a
phone free (packages of user 0 and `settings list` of every namespace) and
keeps it in its state file. `phone.Clean` runs at the start of every new
session (not a resumed one) and after every session: kill apps, uninstall
packages not in the baseline, `install-existing` missing ones, `pm clear`
every launcher app except Settings, the home app and the tunnel,
force-stop apps in recents, wipe `/sdcard` except `Android/`, undo the
portal's device settings, put back every changed baseline setting except
volatile ones (counters, timestamps, Phenotype flags, `android_id`) and
the ones the cleanup sets itself, delete settings added since the baseline
(a proxy left by a user would otherwise survive), Bluetooth/NFC/location off, and with VPN
locations forget every Wi-Fi network and turn Wi-Fi and data off. After a
session it parks the phone (battery saver, brightness 1, `stayon` off,
screen off); before one it wakes it at its baseline brightness. Battery
level and charging are emulator-only (`DeviceState.canSimulateBattery`);
the agent decides emulator-only controls from `EmulatorConsole`, since the
adb wrapper has an `emu` method on phones too.

**Consequences.** Every session starts from the baseline, so the phone has
to be prepared before it is first seen; re-recording means editing the
state file. A cleanup takes tens of seconds and the phone stays busy
meanwhile. Shell can't remove tasks from recents or clear the clipboard,
so stopped apps may still show there. Clearing every launcher app's data
resets their first-run screens. PINs, accounts, calls and Settings need
the device owner (Holtdroid Tunnel, next).

## 72. A phone session keeps its audio captured; mic and camera privacy toggles stay on

**Context.** A test phone lives in the maintainer's flat. Sound should reach
only the browser, and the microphone and camera must not pick up the room.
There is no root, so audio routing and fake cameras are out of reach.

**Decision.** scrcpy's `output` audio source (without `audio_dup`) stops
playback on the device while it captures. With `ScrcpyConfig.KeepAudio`,
which `provider-physical` sets, the agent runs one capture for the whole
session (`audioHub`) and fans it out to every `/display/audio` viewer,
replaying the codec id and Opus config packet to each new one, instead of a
server per viewer. Parking a phone mutes streams 1–5. The cleanup and every
session poll deny the app under test the microphone and camera through
appops (`RECORD_AUDIO`/`CAMERA` → ignore), so it gets silence and no
picture. It does **not** use the device-wide `sensor_privacy` microphone
toggle: on some phones (the Galaxy A05) enabling it makes
`AudioFlinger::createRecord` hang until audioserver aborts, which crashes
any app that touches audio (seen with 1xbet). Cleanup also clears a stuck
`sensor_privacy` mute an older build may have left.

**Consequences.** The phone is silent as long as the session's capture
runs; between sessions it is muted. The per-app appops block is set by
root/adb, so a user can't lift it from a system prompt, but it covers only
the app under test, not every app on the device; for a dedicated test phone
that is enough. Phones without a camera keep working hardware; a fake
picture needs root.

## 73. Phones suspend risky apps and set the app's language instead of the system's

**Context.** Trying phones without root showed that a user could open
Settings and set a PIN, that the language control failed (decision #59's
`WRITE_SETTINGS` check holds on a phone even with the app-op granted) while
the browser's keyboard layouts kept being applied as system languages,
that the battery simulation still showed, and that the ADB tools' read-only
calls were refused under `allowlist`. A PIN on the phone was considered and
rejected: it guards only some settings, puts an emergency call button on
the lock screen and would have to be typed by the agent.

**Decision.** The cleanup keeps `phone.suspend` packages suspended with
`pm suspend` (Settings, contacts, messages, SOS, stores and accounts,
updaters, camera); shell may do that and suspended apps can't be opened.
Android refuses the default dialer, launcher and installer, and we leave
core services (GMS, telephony) alone because suspending them breaks
WebView and calls in apps. On phones the agent sets the language with
`cmd locale set-app-locales` for the app under test and reports
`languageScope: app`; the UI calls it "App language" and drops keyboard
layouts there. `allowlist` also lets `settings get` and the session page's
read-only `dumpsys` calls through; `dumpsys` with other arguments stays
refused, since `battery set` or `deviceidle force-idle` change the device.

**Consequences.** Settings is out of reach for users and for anyone at the
phone until it is unsuspended by adb. The device owner is still needed to
block the power menu and the camera hardware, and to undo a PIN set before
the phone was first cleaned.

## 74. Recordings are the framed phone or the whole tab under a strip

Supersedes the scene layout of #66; the encoding and the OPFS file stay.
Superseded by #96: sessions are recorded on the server.

**Context.** The *Screen and details* scene rebuilt a dashboard on the
canvas and cut the tool panel out of the tab with `RestrictionTarget`. It
only worked in Chromium, needed a share prompt anyway, and the panel was
squeezed next to the phone. The phone frame drew a camera, buttons and
glare, and the fixed 1080×1920 canvas left a lot of empty space around a
phone of another shape.

**Decision.** Two scenes in `web/src/lib/composer.ts`. `PhoneScene` draws
a plain rounded frame around the scrcpy canvas; the video size follows the
framed phone in the orientation it had when recording started (long side
1920), and later rotations turn the frame inside it. Recording waits for
the first decoded frame: until then the scrcpy canvas keeps the browser's
default 300×150 and would give the video a 2:1 shape. `TabScene` draws the
current tab from `getDisplayMedia`, uncropped, under a 56-unit strip with
the logo, app, device details and timer; the video size is the tab's size
at the start (width clamped to 1280–2560) plus the strip, and the tab is
fitted without stretching when the window is resized. Auto-record in tab
mode only offers a toast, because `getDisplayMedia` needs a click.

**Consequences.** Element and region capture are no longer needed, so tab
recording works wherever `getDisplayMedia` does. The tool panel is shown
at the size the user sees it. A phone that rotates after the start is drawn
smaller, because the encoder keeps one size per file.

## 75. The client's UI opens the browser instead of managing devices

Supersedes the device tools of #64.

**Context.** The TUI had grown a second session page: logcat, a shell,
device and app details over its own adb connection, a build picker to
launch devices, and restart, reinstall and stop through the portal's API.
All of it already exists on the session page, and keeping two versions
in step costs more than it gives.

**Decision.** The TUI keeps what only the client can do: published ports,
local ADB ports, updates and the `holtdroid` command. Devices lists the
running devices; Enter opens a session page in the browser and `w` opens
`chrome://inspect` (unavailable with ADB off). **Launch a device** opens
the portal. The client no longer calls the portal's REST API.

**Consequences.** `internal/connect` has no adb client of its own and no
API calls besides enrollment and refresh. The access token from #64 is
still issued with every refresh but the client doesn't use it.

## 76. Launches pick any provider by default, or one device

Extends #57.

**Context.** The launch dialog asked for a provider and the provider picked
its first free slot. With an emulator pool and phones side by side people
want either "whatever is free" or one specific phone or node.

**Decision.** `provider` is optional on `POST /api/v1/sessions`. Without it
the api walks `providers[]` in config order and takes the first free slot of
a provider that offers the requested location; restoring app data skips
slots whose capabilities say they can't. The api always resolves the slot
itself and passes it in `CreateSession.slot`; providers honour it (422 for
an unknown slot, 409 if busy). A chosen slot may be busy or offline: the
launch waits in line for that slot. Lines are per target (any, a provider,
a slot) and the front of a line keeps its place if another line takes the
slot first. VPN locations show a flag from `country-emoji`, matched on the
location's id or label.

**Consequences.** There is no global fairness between lines: an **Any**
launch and a launch for one provider can both wait for the same slot, and
whichever polls first gets it.

## 77. Holtdroid Tunnel is installed on every phone and drives the kiosk as device owner

**Context.** Holtdroid Tunnel v0.2 can be a phone's device owner (restrictions,
always-on VPN with lockdown, keyguard off and PIN reset, update postponing,
a lock-task kiosk per session) and draw the emulator's wallpaper. A device
owner can only be updated by an APK with the same signature.

**Decision.** The tunnel's releases are signed with a release key kept in
OpenBao (`secret/holtdroid-tunnel-signing`) and in the tunnel repository's
`SIGNING_*` secrets; v0.2.1 is the first signed one, and the physical image
pins it. `phone.App.Ensure` installs the app on every phone, also without
VPN locations, and replaces an older build signed with another key unless
the app is the device owner. The agent learns ownership from the app's
`STATUS`: as owner, the `Launcher` starts the app under test with
`SESSION_START` (features `system_info,notifications,home,overview`, so no
power menu) instead of `monkey`, and every cleanup ends with `SESSION_END`,
`CLEAR_PASSWORD` when a PIN is set, plus `LOCKDOWN --es skip
no_usb_file_transfer,disallow_microphone_toggle,disallow_camera_toggle`
when the restrictions aren't as wanted yet. On the A05 the toggle
restrictions turned microphone access back on and froze it there, so the
agent leaves the toggles free and blocks the sensors itself on every
cleanup and poll. Every `LOCKDOWN`, even an unchanged
one, the USB file transfer restriction, and on Samsung entering or leaving
lock task make the phone re-enumerate on USB. adb (libusb; platform-tools
r37 has no other Linux backend) only notices that through kernel hotplug
events, which reach the host's network namespace only, so the provider
runs on the host network. Kiosk calls whose reply is lost to such a
reconnect wait for the phone and check the result through `STATUS`. On
the host network a phone's sing-box doesn't bind outbounds to the default
interface (`auto_detect_interface` stays for the emulator's tun), or
cluster addresses such as the resolver become unreachable. The wallpaper goes through `WALLPAPER`
(`rows_b64`) whether or not the app is the owner. Provisioning stays a
manual `dpm set-device-owner` by the operator.

**Consequences.** Losing the signing key means a phone's device owner can't
be updated without `RELEASE` or a factory reset. Under the VPN lockdown a
phone between sessions has no network at all. The kiosk on One UI's
launcher is to be verified on the real phone.

## 78. The chart runs provider-physical on its node's host network

**Context.** In a pod network adb (libusb) never learns that a phone
re-enumerated on USB, which happens on every reboot, on Samsung around lock
task and on some device-owner policies, so the phone stays gone until adb
restarts. adb's key has to survive pod restarts, or every phone asks again
to allow debugging.

**Decision.** `providers.physical` is one Deployment pinned to the phones'
node (a `kubernetes.io/hostname` selector from `nodeName`, or
`nodeSelector`; never `spec.nodeName`, which skips the scheduler, so a
rollout's new pod failed on the old pod's ports and stayed behind as a
failed pod), `hostNetwork: true` with
`ClusterFirstWithHostNet`, privileged root (USB device nodes), `/dev/bus/usb`
and a `DirectoryOrCreate` host directory for the state file and `HOME`
(adb's key). It listens on node ports 18580 (API and agents) and 18581
(tunnels); a Service with both ports gives the api and the ssh-gateway
stable URLs, and the api's `providers` list gets it by itself. No
ServiceAccount token, no RBAC: the provider never talks to Kubernetes.

**Consequences.** The ports are open on the node's interfaces with no
authentication of their own, so the node's firewall must keep them to the
cluster (on the maintainer's nodes only `cni0` and `flannel.1` are
trusted). One provider per node, and nothing else may run an adb server
there. The state and key live on that node; moving the phones to another
node means copying the directory.

## 79. An Inventory page for admins, with maintenance holds kept by providers

**Context.** The maintainer wants one page listing every device of every
provider with its model, system and component temperatures, and a way to
take a device, or a whole provider, out of rotation while working on it.
Cordoning a node only works for emulators and needs kubectl; phones had no
such switch. The api is stateless and its database is in-memory only, so a
hold kept there would vanish on restart.

**Decision.** Two Provider API operations: `GET /v1/inventory` (slots with
their session, a `DeviceInfo` for Android devices the provider can ask, a
`HostInfo` for machines) and `PUT /v1/maintenance` (hold or release one slot,
or the whole provider without a slot). Holds are provider state, next to the
sessions: a ConfigMap for the emulator provider (created on the first hold;
its Role may create ConfigMaps and update only that one), the state file for
phones, memory for the fake provider. `contract.MaintenanceState` applies
them to capacity the same way everywhere: a held slot is `maintenance`, a
busy one stays `busy` with `maintenance` set until its session ends, a
slot's own hold wins over the provider's. Launches need a `free` slot, so
nothing else in the api changes. The api adds the admin-only
`/api/v1/admin/inventory` and two `PUT …/maintenance` endpoints, fills `by`
with the admin and emits `provider.maintenance`.

Kubernetes doesn't report temperatures, so the chart runs `holtdroid
node-info` as a DaemonSet on the session nodes: an unprivileged container
that reads the host-wide `/proc` and `/sys` (thermal zones and hwmon) and
serves them over a small Node API. The emulator provider finds those Pods by
label and merges their answers into what the Node object says. Phones are
inspected over adb without root; the emulators' own sensors are not shown,
since the emulator makes them up.

**Consequences.** One more DaemonSet per emulator deployment (a few MiB,
`nodeInfo.enabled: false` turns it off and the page shows Node data only).
The page polls; nothing is cached, so a provider's inventory must stay
cheap. A provider without maintenance support has to implement the two
operations; returning `ErrInvalid` from `SetMaintenance` is enough.

## 80. Root mode for phones runs through Magisk su (transitional), gated per phone

Extends #67 (which left root mode for later) and #73 (app-language only);
pairs with the device-owner work of #77.

**Context.** Some apps refuse rooted devices or a visible VpnService, and a
rooted phone (Magisk) can do what the non-root agent can't: instrument
release builds with Frida, set the system language and clock, simulate the
battery, fake GPS, hide root from the app under test and route traffic
transparently. The threat model (architecture.md "Physical devices", layer 3)
wants root kept from users via a token-authenticated frida-server and su
denied to the shell uid, but that needs a Magisk module in the tunnel repo.
To ship root mode now on the maintainer's own A05, the agent escalates
through Magisk's `su` directly, designed so the hardening can replace the
escalation later without touching the call sites.

**Decision.** A phone is marked `root: true` in the provider config. Its
session gets `cfg.Root`, `cfg.RootShell` and the Frida instrumenter (same as
the emulator) instead of the Launcher; `host.Agent` falls back to the
Launcher if the binary has no Frida. The phone agent escalates with
`su -c`, and for anything that touches netlink (tun, routes, iptables) with
`su -Z u:r:magisk:s0 -c` — plain `su` runs in the `u:r:shell:s0` SELinux
domain, which the kernel denies those to. `phone.prepareRoot` pushes and
starts frida-server (killing a stale one first); device controls, app-data
export/restore and the system language run as root through an su-wrapping
device/exec, so the emulator's code works unchanged.

Root mode adds, all reversed on cleanup:
- **Hide root**: the app under test is added to the Magisk DenyList
  (retried each poll, since it is installed after boot).
- **Calls lockdown**: mobile data off, the dialer and emergency apps
  disabled, keyguard off. It does not use airplane mode, so the real Wi-Fi
  stays up for the tproxy tunnel (and apps do not read airplane mode as "no
  network"). Android never lets emergency calls be blocked outright, so the
  real guarantee is a SIM-less phone out of cellular range; this only removes
  the on-screen vectors.
- **A real Wi-Fi network, traffic tproxy'd through the tunnel**
  (`phone.TproxyTunnel`, the default when a `wifi` SSID is set): the phone
  joins a real Wi-Fi AP through `su` (`cmd wifi connect-network`), so apps see
  a genuine, validated Wi-Fi network — no VpnService, no tun, nothing for an
  anti-VPN app to detect. The AP needs no internet of its own: iptables
  `TPROXY` (mangle `PREROUTING`/`OUTPUT`, an `fwmark` rule and a local route
  table) redirects every non-local packet to a sing-box `tproxy` inbound,
  which sends it to a socks outbound that adb reverse maps to the host's
  per-session sing-box; sing-box hijacks DNS and resolves it over the tunnel,
  so DNS does not leak the real location, and Android's own captive-portal
  probe goes through the tunnel too, which validates the Wi-Fi. This exists
  because a VpnService (the non-root path, and an earlier root attempt) is
  detectable below the Java layer — `1xbet`'s native anti-fraud (VMP) sees it
  and stalls — and a kernel-route tun still shows a `tun` interface. Only a
  real Wi-Fi plus a tproxy (no interface of its own) looks like an ordinary
  device, the way the emulator does (which routes transparently in its pod
  with no VpnService). The A05 kernel has `TPROXY` and policy routing, which
  this needs. Without a `wifi` SSID a rooted session falls back to the
  VpnService tunnel, and the Frida connectivity relabel (VPN→Wi-Fi,
  `WifiManager`, `NetworkInterface`) stays as a best-effort masking for that
  fallback. A kernel-route transparent tun (`phone.RootTunnel`, a static arm64
  sing-box tun, default route added by the agent, egress health-gated) hides
  the VPN more completely but registers no network agent, so
  `ConnectivityManager` reports nothing and DNS cannot resolve (Android 14
  dropped the `ndc resolver` seed and gives root no other way to configure a
  resolver without a network); the Frida agent can still present a synthetic
  validated Wi-Fi network so the app does not crash, but real traffic only
  works by IP. It is therefore left behind the off-by-default
  `transparentTunnel` config flag until the DNS gap is closed, and the
  VpnService tunnel is the default.
- **GPS and clock follow the VPN location**: each location carries
  `geo {lat,lng,radius}` (default 10km) and a `timezone`; on switch the GPS
  is faked to a random point in the radius (gps and network test providers,
  so the real position is not exposed) and the timezone is set quietly, not
  as a user override. A per-session override checkbox pins a manual position
  (`geoOverride`) and is not persisted.

**Consequences.** `su` is granted to the shell uid, so a user with
`adb.shell: full` would inherit root; phones default to `allowlist`, and the
layer-3 hardening (token-auth frida-server, su denied to shell, root
watchdog) is still to come, as is the network-speed profile (the A05 kernel
has no `sch_netem`). The physical image is now built with Frida and carries
the arm64 frida-server, a static arm64 sing-box, the locales dex and the
Frida bundles. The Frida instrumenter caches one device handle for its
lifetime; when the phone re-enumerates on USB (reboot or replug) that handle
goes stale and every op fails with `FError: Device is gone`. Rather than
restart the provider pod, the instrumenter now drops the handle on a
gone-error, re-resolves it via `frida.DeviceByID` and retries the op once (at
`Spawn`, `Watch` and `callSystem`); the match is narrow so other errors still
propagate.

## 81. The project lives in the `holtdroid` GitHub organization

**Context.** Holtdroid had grown to four repositories under a personal
account (`holtdroid`, `holtdroid-sync`, `holtdroid-webview`,
`holtdroid-tunnel`), with more coming (a modified redroid image). Images,
the chart and the docs site carried the personal account's name, and
adding maintainers meant sharing a personal namespace.

**Decision.** All repositories moved to `github.com/holtdroid`. The Go
module is `github.com/holtdroid/holtdroid`, images and the chart are
published to `ghcr.io/holtdroid/*` (CI derives them from
`github.repository`), and the docs site is
`https://holtdroid.github.io/holtdroid/`. Android package names
(`io.github.kriakiku.holtdroid.*`) stay: changing an `applicationId` makes a
different app, and the tunnel app is a device owner on the phones.

**Consequences.** Old `ghcr.io/kriakiku/*` images and the old Pages URL get
no redirects; deployments switch to the new image paths. Git and web URLs
of the repositories redirect from the old owner.

## 82. Sessions run redroid containers instead of emulators, several per node

**Context.** Emulator sessions (#2, #25, #41) need a whole node each: about
7 GB of RSS and most of a core even idle, a multi-GB session image and
VirtualGL for the GPU. Only `core` was fast enough; the three k3s nodes were
dropped. [redroid](https://github.com/remote-android/redroid-doc) runs
Android as a container on the node's kernel. The image
`ghcr.io/holtdroid/holtdroid-redroid` (own repository) adds software video
encoders without DMA heaps, `libndk_translation` from the Android 15
emulator image and a cgroup wrapper for privileged pods. Measured on `core`
(Ryzen 7 5825U, Vega): boot in about 30 s, about 1 GB of memory and 0.05 of
a core per idle instance, a 720x1600 scrcpy stream at about 57 fps for about
one more core while the screen changes, WebGL through ANGLE on radeonsi, the
GPU shared evenly (about 220 fps of a heavy shader across the node).

**Decision.** Supersedes #2, #25 (the system image), #39 (one session per
node) and #41, and the slot model of #29. AVD support is removed: before the
first release one runtime is enough.

- `provider-emulator` keeps its name, contract and Kind (`emulator`, a
  virtual device) and starts redroid Pods. A Pod has three containers: `android`
  (the redroid image, privileged, `runAsUser`/`runAsGroup` 0, Pod
  `supplementalGroupsPolicy: Strict`, an `emptyDir` on `/data`, the node's
  `/dev/dri` with boot arguments for the render node, screen size, density
  and fps); `agent` (the session image, now only the agent with adb,
  frida-server, scrcpy-server and the Frida scripts) reaching Android's adbd
  on `127.0.0.1:5555` in the shared network namespace; and the VPN sidecar.
- Slots are per node: `slotsPerNode` (default 1) with a per-node override
  (`nodes.<name>.slots`); a slot id is `<node>-<n>`, the Pod gets labels for
  both and node affinity to its node; Pod anti-affinity is gone. `slots`
  still caps the total. Sessions request 1 core and 1.5 GiB with a 3 GiB
  memory limit and no CPU limit; `core` runs 6.
- The agent boots by connecting adb over TCP, waiting for
  `sys.boot_completed`, `adb root` (redroid is a userdebug build) and
  frida-server, which it reaches at `127.0.0.1:27042` in the shared network
  namespace rather than through adb. Frida's spawn gating is off: frida-server
  runs as root on the node's own kernel, and with gating enabled every new
  process of the node — runc, sshd, probes — stops with SIGSTOP until the
  node is rebooted (found on `core` and reproduced on a k3s node). Apps the
  user starts from the launcher are found by polling the process list every
  second and attached to instead. The session wallpaper is off as on rooted
  phones: the agent's attach to `system_server` right after the install fails
  ("unexpected crash while trying to allocate memory") and leaves
  frida-server unable to attach anything until it restarts. There is no
  emulator console: GPS goes through the location
  service's test providers and the battery through `dumpsys battery`, as on
  rooted phones (#80), but without `su`. Network speed profiles were not
  offered at first; #93 adds them as `tc netem` on the tunnel interface.
- VPN: Android's netd owns the Pod's policy routing and flushes foreign
  `ip rule`s when it starts, so sing-box can't use `auto_route`. The sidecar
  runs its tun without it (`default_interface: eth0`), and the agent adds,
  as root inside Android, a table that sends everything into the tun except
  cluster and private ranges, a rule for every uid but 0 (sing-box itself,
  the agent and Android's root daemons stay direct) and a rule for the tun's
  own /30 so the system stack's replies come back. It re-applies them on
  every poll in case netd rewrote them.
- adbd listens on every address of the Pod: the session NetworkPolicy
  (only the api and provider on the agent port, the ssh-gateway on the
  tunnel port) is what keeps it private. The node kernel has no legacy
  iptables, so nothing inside Android can filter it.
- The agent container is privileged too, so the metrics bar reads the Pod's
  cgroup (Android, agent and VPN together) from the node's hierarchy.
- Root inside a session is root on the node. The Android container is
  privileged and shares the node's kernel, so anything running as root in
  Android — frida-server, the agent's adb shell, and the root ADB shell users
  get in the browser and over SSH — can stop or signal the node's processes
  through kernel interfaces that aren't namespaced, write the node's sysctls,
  load BPF programs and reach the node's devices. On the emulator the same
  root stayed inside the guest kernel. Until sessions run in user namespaces,
  session nodes must be dedicated to sessions and everyone who may open a
  session is trusted with them.

**Consequences.** Several sessions share a node's CPU, memory and iGPU;
heavy WebGL in one session slows the others. Android 11 to 15 (16: see #84); no WebGPU in WebView (`Vulkan not
supported with in process gpu`, as on the emulator); ARM code runs only as
`.so` libraries inside app processes (no ARM executables: registering
binfmt_misc would change the host); no hardware video encoder; the screen
size is fixed at boot (density can change); network conditions only with a VPN tun (#93); no
session wallpaper. Nodes need binder
(`CONFIG_ANDROID_BINDERFS`) and, for the GPU, a Mesa-supported `/dev/dri`
render node. The k3s nodes become usable again.

## 83. Sessions stay privileged on dedicated nodes; the rest of the cluster is kept out of their reach

**Context.** #82 left "root in a session is root on the node" as a known
hole and user namespaces as the planned fix. Two weeks of prototyping showed
what `hostUsers: false` costs for Android 15: init's `setpriority` needs a
seccomp shim, APEX activation (loop devices + dm-verity) has to be replaced
by a custom `apexservice`, and netd refuses to start without eBPF, which a
user namespace cannot load while the node keeps `unprivileged_bpf_disabled=2`
— and the stock loader rejects non-LTS kernels on top. Every piece is a patch
on Android internals that an Android or kernel bump can undo. Meanwhile the
maintainer is adding a node that runs nothing but sessions.

Replacing `privileged: true` with explicit capabilities was tried too: a Pod
with every capability, `seccomp`/AppArmor unconfined and the render node
and `/dev/fuse` as hostPath char devices mounts binderfs fine but cannot
open its binder nodes — the devices cgroup (runc's eBPF program) only admits
the default device list plus devices the CRI was told about, and binder's
major number is dynamic and per-mount. Kubernetes has no way to allow "any
char device" short of `privileged`, and a device plugin can only hand out
fixed host nodes, not a binderfs each session mounts for itself. VM
runtimes (Kata, KubeVirt) would give a kernel boundary but cannot share the
node's iGPU between VMs, which WebGL and the stream need; gVisor has no
binder at all.

A privileged redroid also rewrote the node's sysctls at boot:
`kernel.modprobe` (to an empty string), `kernel.sysrq`,
`kernel.unprivileged_bpf_disabled` (to 0, by netbpfload),
`kernel.kptr_restrict`, `kernel.perf_event_paranoid`,
`kernel.sched_schedstats`, the hung-task settings, `vm.mmap_min_addr` and
the watermark factors — measured on k3s-3 by diffing `sysctl -a` around a
boot. Privileged redroid booted with working networking (netd's BPF maps
present) on the node's mainline 6.18 kernel, so the LTS-kernel requirement
of the user-namespace path does not apply here.

**Decision.** The Android container stays privileged, and session nodes are
dedicated to sessions (tainted, selected with `nodeSelector`/`tolerations`;
the NAS node runs none). Everything else that keeps a compromised session
from reaching further is in place:

- **Egress NetworkPolicy** on session Pods (`networkPolicy.egress`, on by
  default): cluster DNS, the api (APK and app-data downloads) and the
  internet with the private ranges carved out (10/8, 172.16/12, 192.168/16,
  100.64/10, 169.254/16, configurable). Verified on kube-router from a root
  shell inside Android: the LAN router, node IPs (ssh, kubelet, the API
  server VIP and ClusterIP), the api Pod of another namespace and the VPN
  gateway were unreachable while public hosts and DNS worked. Anything
  in-cluster a sidecar must reach is added in `extraEgress`; the VPN gateway
  needs a `namespaceSelector`+`podSelector` rule (an `ipBlock` with the
  Service CIDR doesn't match because the policy is evaluated after DNAT).
- **The agent container is not privileged** (all capabilities dropped,
  `allowPrivilegeEscalation: false`). It kept the Pod-wide metrics by
  mounting the node's `/sys/fs/cgroup` read-only at `/host/cgroup` and
  finding the Pod's cgroup by uid (`HOLTDROID_HOSTCGROUP`,
  `HOLTDROID_PODUID`), instead of a host cgroup namespace.
- **Users' ADB is restricted** (`redroid.shell`, default `allowlist`): the
  relay in front of adbd applies the phones' shell policy (#68) to the
  browser tabs and the `holtdroid` client, so only the commands behind
  Logcat, Files, App and Device run, and the Terminal tab is not offered
  (`SlotCapabilities.Shell`). `full` restores the root Terminal for clusters
  that accept it. The agent's own adb is untouched.
- **Android init can't rewrite the node's sysctls**: holtdroid-redroid's
  init wrapper remounts `/proc/sys` read-only except `/proc/sys/net`, which
  is per network namespace and netd's.
- **Prototyping privileged redroid only on a k3s node under a hardware
  watchdog**, never on the NAS node (status.md "Gotchas").

What remains true: frida-server and Android's own daemons run as root on the
node's kernel, so a vulnerability in the app under test that reaches root
in Android reaches the session node. Candidates for narrowing that further
without user namespaces: a node helper that pre-creates each slot's binder
devices so the container can drop `privileged`, a token on frida-server, a
non-root adbd for users while the agent keeps root. They are on the roadmap,
not in this change.

**Consequences.** Session nodes are a hard boundary and must stay dedicated.
The shared VPN gateway needs an `extraEgress` rule in every deployment.
Users lose the root Terminal by default; admins who want it back accept that
it is a root shell on the node. The user-namespace branch of
holtdroid-redroid was deleted; its findings are in the maintainer's notes.

## 84. Screens and Android versions are picked at launch

_The "Android 16 is not offered" part is superseded by #171._

**Context.** #82 fixed one screen (720×1600 at 320 dpi) and one Android
version per provider. Testers want to see an app on the kinds of phones
their users have — a cheap 720p phone with a notch, a 1080p phone with a
punch hole — and sometimes on an older Android. redroid takes the screen as
boot arguments and ships Android's `DisplayCutoutEmulation` overlays
(`corner`, `double`, `hole`, `tall`, `waterfall`); several redroid base
images exist per Android major version.

**Decision.**

- `Capabilities` gains `Screens` (`Display`: id, label, width, height, dpi,
  cutout) and `Versions`; `CreateSession` gains `Screen` and `Android`; the
  launch dialog offers both when a provider has more than one, remembers
  the choice per provider like the location, and quick launch reuses it.
- The emulator provider's `redroid.screens` are presets of popular budget
  phones of 2023–2024 by default (HD+ 720×1600 at 280 dpi with a notch,
  the cheapest to stream, first; FHD+ variants at 420 dpi with a notch or a
  punch hole; 1.5K at 480 dpi; an 11″ tablet), overridable in config. The
  agent enables the screen's cutout overlay after boot with `cmd overlay`.
  The chosen screen's label is the session's `SlotCapabilities.Model`.
- `redroid.images` maps Android versions to images; the chart renders it
  from `redroid.image.repository` and `redroid.versions`, so holtdroid-redroid
  publishes one tag per Android major version (`15`, `14`, …) and the
  pre-pull DaemonSet pulls each as an image volume. The newest is the
  default. Android 16 is not offered. Tried on k3s-3 (kernel 6.18) on
  2026-10-25 with `redroid:16.0.0_64only` and the same patches: it boots
  without ashmem (memfd works) and has network and BPF maps, but netd
  aborts in `libnetd_updatable_init` (BpfHandler init fails; its message
  never reaches logd) and restarts every 5 s, so system_server never
  reaches `boot_completed`. netbpfload v0.47 logs "Android V+ only supports
  LTS kernels. Unsupported kernel version" on 6.18; a 6.12 LTS kernel on the
  session node is the first thing to try. The earlier claim that 16 needs
  ashmem was not verified.
- The agent's adb server listens on 5038 (`ANDROID_ADB_SERVER_PORT`): in
  the shared network namespace, Android 11's adbd (`ro.kernel.qemu=1`) also
  binds 127.0.0.1:5037 and aborts when the agent's server holds it.
- The Android container's CPU request drops from 1 to 0.5 core: idle
  sessions use 0.05, there is no CPU limit, and a smaller request fits more
  slots on a node without changing what a busy session may use.

**Consequences.** Bigger screens cost more CPU for the stream and more
bandwidth; the default stays HD+ (superseded by #160). A screen is fixed for the session (density
still changes in the Display controls). Each extra Android version is one
more ~1.5 GB image on every session node.

## 85. Sessions fill nodes in a configured order, core included

**Context.** #83 kept sessions off `core` because a privileged redroid is
root on its node and `core` is the NAS. The maintainer then chose to use
every node: `core` for 4 sessions (first 6, cut back so each can keep the
default 3 GiB memory limit next to the NAS), each k3s node for 3.

**Decision.** `fillOrder` (provider config, chart `providers.emulator.fillOrder`)
lists node names, one per slot, in the order free slots are handed out; the
provider returns its slots in that order and both the api and the provider
pick the first free one. The maintainer's deployment fills two slots on
`core`, then one on each k3s node, then the other two on `core`, then the
k3s nodes' remaining slots. Nodes need no label: with an empty
`nodeSelector` every node the provider tolerates is used, `core` through the
`dedicated=nas` toleration, and a node's slots come from `nodes.<name>.slots`
or `slotsPerNode`.

**Consequences.** `core` now runs privileged Android next to the NAS. What
reduces the risk is #83 (egress policy, the sysctl guard in the image,
no Terminal by default, spawn gating off) and a slot count on `core`
small enough that its sessions' memory limits (4 × 3 GiB) leave the NAS
room; it does not remove it: a vulnerability in an
app under test that reaches root in Android reaches `core`. A new node
joins the pool with `slotsPerNode` slots, ordered by name after the
`fillOrder` entries.

## 86. The WebView app moves to `io.github.holtdroid.webview`; the work S3 mirror and the Gecko copy go

**Context.** #81 moved the repositories to the `holtdroid` organization and
left the Android package names (`io.github.kriakiku.holtdroid.*`) alone,
because changing an `applicationId` makes a different app and the tunnel app
is a device owner on the phones. The WebView test browser is not a device
owner, so only it can follow. Separately, the copies of the work bucket's
builds (`holtdroid-s3-sync`, source `wnf-preprod`) and the 250 MB Gecko
build of the WebView app were no longer wanted.

**Decision.**

- The Holtdroid WebView app (holtdroid/holtdroid-webview) is renamed from
  `io.github.kriakiku.holtdroid.webview` to `io.github.holtdroid.webview`
  (namespace, applicationId, sources, docs). It installs next to the old
  app and does not inherit its presets; the first release with the new name
  is a minor version. The tunnel app keeps `io.github.kriakiku.holtdroid.tunnel`
  because it is the phones' device owner.
- The GitHub sync of the maintainer's deployment skips Gecko assets
  (`include: ["!*gecko*"]`), and its prune removes the copies it made.
- `holtdroid-s3-sync` is removed from the deployment together with the
  `wnf-preprod` source; the builds it copied are deleted from the bucket.
  The job itself stays in holtdroid-sync for other deployments.

**Consequences.** Old WebView releases in the GitHub source keep the old
package until three newer releases push them out. The Gecko build is still
published by the WebView repository's releases, only not mirrored.

## 87. The launch dialog is two steps of cards

**Context.** The dialog was a column of selects: provider, device, location,
app data, plus capability badges. With virtual devices that have a screen and
an Android version to pick, and sessions spread over several nodes, it was
long and said little.

**Decision.** Step one asks where to run, with a card per provider (what it is,
how many slots are free) and the virtual device preselected as the flexible
choice; it is skipped when there is only one provider. Step two depends on the
provider. A virtual device gets Android version cards (default the newest), a
screen picker with a preview of each phone including its emulated cutout,
location buttons and app data cards, and no choice of node: the provider's
fill order (#85) picks the slot. A real-phone provider gets a card per device
(model, Android, availability) with "any available device" preselected. The
capability badges (ABI, ADB, DevTools) are gone from the dialog. `Display`
gains a short `label` and a `like` field (phones with that screen) for the
cards. The sessions panel draws at most eight slot pills per provider, busy
ones first, then `+N` and the free/total count, so a provider with many slots
stays inside its block.

The session page draws the emulated cutout itself over the stream (a notch
or hole with a speaker and camera lens, a corner hole, double notches or
waterfall edges, sized in dp from the screen's density), because redroid
reports the cutout to apps as insets but does not render the black shape.
The overlay lets every pointer event through to the device and fades to 30%
while the pointer is over it, so the area under it stays visible and usable.
It is hidden while the device is rotated. `SlotCapabilities.Screen` carries
the screen to the UI.

**Consequences.** More clicks to reach Launch than before; the defaults
(newest Android, the default screen and location, a fresh install) let the
last step be one click. Quick launch is unchanged and uses the remembered
screen and Android version.

## 88. Sessions can start with a chosen WebView build

**Context.** A WebView bug often depends on the WebView version, not on the
Android version. Each redroid image ships one built-in WebView (125 on
Android 11 to 128 on Android 15). Testing with another version meant
installing one by hand, which isn't possible here, because the built-in
WebView is signed with AOSP's test key. Google's Trichrome WebView needs
a matching library and an account, and third-party mirrors offer one or two
versions without a history. Before the change, a spike on a live session
(2026-10-25) showed the following:

- Chromium's own snapshot builds have an x86_64 flavour
  (`AndroidDesktop_x64`, from Chromium 129 on). Their
  `chrome-android-desktop.zip` holds `SystemWebView.apk`: about 420 MB,
  `com.android.webview`, minSdk 29, targetSdk 36, signed with Chromium's
  public debug key.
- With the built-in WebView re-signed with that key, `adb install -r -d`
  of a snapshot succeeds in about 2 s. WebViewUpdateService makes the
  snapshot the provider, pages render, and DevTools lists the page.
- The snapshot reports a WebKit revision of all zeros, so the DevTools
  frontend has to come from somewhere else. Chromium Dash names the commit
  of each Canary release, and `chrome-devtools-frontend.appspot.com` serves
  a frontend for those commits.

**Decision.**

- holtdroid-redroid re-signs the built-in `webview.apk` with Chromium's
  public debug key at build time. Its contents are unchanged. The factory
  WebView stays the default. A snapshot installs as an update of it, and
  uninstalling the update goes back to the factory WebView.
- `holtdroid-webview-sync` (holtdroid-sync, `job: webview`) fills a WebView
  catalog. For each picked milestone it takes the newest snapshot at or
  before that milestone's last Canary release. The picked milestones are
  the ones on a channel now, the newest `latest`, every `every`-th and
  `extra`. The job downloads only the APK out of the zip with HTTP range
  requests. Each build is written as `chromium-<milestone>.apk` with a
  sidecar whose tags carry `version`, `milestone`, `minSdk`, `targetSdk`,
  `channel` and `frontend` (the Canary commit).
- The api reads the catalog from `webview.storage`. It is not a source:
  WebView builds are not apps and must not show up in the build list.
  `GET /api/v1/webviews` lists the catalog from the sidecars alone, without
  opening a 420 MB APK. `createSession` takes `webview` (a catalog id),
  keeps only providers with `Capabilities.WebView`, and passes
  `CreateSession.WebView {url, version, frontend}`. The agent downloads the
  build from `/internal/webview/{id}`, which streams from the catalog
  storage and leaves the APK cache alone.
- The agent installs the build before the app (status `installing`,
  "Installing WebView …"). A failed install fails the session. On resume it
  is skipped, because the update is already in Android's data. The DevTools
  scanner treats an all-zero revision as none and falls back to `frontend`.
- The emulator provider offers it (`holtdroid/webview` annotation,
  `HOLTDROID_WEBVIEW__*` env). The fake provider takes it for UI work.
  Phones refuse it: their WebView belongs to the phone and is signed by
  Google (phones take Google's own builds since decision #172).
- The launch dialog shows a WebView step when the provider has the
  capability and the catalog has builds for the chosen Android version
  (`minSdk`): "Built-in" plus one card per milestone with its channels.
  The choice is remembered per provider and reused by quick launch. The
  session header shows the installed version.

A second live test (2026-10-25, all five images) found that snapshots from
Chromium 149 on abort on Android 11, 12 and 13. The abort happens as soon
as an app creates a WebView, with
`libc++ Hardening assertion this->has_value() failed`, with or without
Frida. 148 and older work there, and Android 14 and 15 run every build.
Their manifests still say minSdk 29, so the sync job has `requirements`
rules (default `{from: 149, minSdk: 34}`) that write `requiresSdk`. The
api's `minSdk` is the higher of the two: the UI filters on it, and
`createSession` refuses a build the requested Android version can't run.

**Consequences.** Versions before Chromium 129 have no x86_64 snapshots;
for those, the built-in WebView (125 to 128) is the only option. A snapshot
is a main-branch build near the milestone's last Canary, not the shipped
Stable build, so it lacks fixes merged into the release branch and Google's
proprietary parts (no Safe Browsing, no Google services). Each build is
about 420 MB of storage (about 4.5 GB for the default selection) and adds a
few seconds to the launch. holtdroid-sync's APK parser gained a fallback
for manifests that androidbinary rejects (Chromium's optimised namespaces).
Holtdroid's own `internal/apk` doesn't need it, because the api never parses
WebView builds.

## 89. A catalog of real devices with cutout shapes and rounded corners

**Context.** #84 offered a few generic screens, and #87 painted the cutout
over the stream. People test against specific phones, and the five Android
cutout overlays only approximate real shapes; Android reports no corner
radius to apps at all.

**Decision.** The provider embeds `devices.json`, about fifty devices (brand,
model, size, density, corner radius in dp and a cutout shape), and appends it
to the generic screens. `contract.Display` gains `brand`, `radius` and a
`shape` (a circle, capsule, waterdrop or wide notch, in dp from the top
edge); the Android overlay that gives apps the insets is derived from the
shape (a centered circle or capsule is `hole`, a left one `corner`, a drop or
notch `tall`), and a screen that only names an overlay gets a stock shape.
The UI draws the shape, the camera inside it and the black rounded corners
over the stream. The launch dialog shows five screens as cards (the chosen
one always among them) and a "More devices" card that opens a wider dialog
with every screen, grouped by brand, with previews, brand chips and search.
Stars in that dialog mark favorites, kept in the browser's local storage:
they lead the dialog and take the first cards of the screen list from the
defaults. A catalog device without a known corner radius gets 12 to 14 dp, and the
previews round their corners a little more than real life so they read as
phones. The numbers are hand-collected approximations.
No outside dataset is copied: the closest open one, gmobile's display-panel
files, is GPL-3 and covers few Android phones, so it only served as a
cross-check of a few sizes. A Firebase Test Lab export would give exact
resolutions and densities for hundreds of devices (it needs a Google Cloud
project), and could replace the hand-written sizes later.

**Consequences.** Apps see the stock overlay's insets, not the exact cutout
of the chosen device; the drawn shape is exact only as far as the catalog is.
Rotation hides the overlay. The `providers` response grows by the catalog
(about 15 KB).

## 90. No direct network on request; faster releases

**Context.** `vpn.direct` could already hide the Direct location, but the
policy route that sends apps into the tunnel only fell through to the
Pod's own route when the tunnel went away, so "no direct" was not a
guarantee. Releases also took about ten minutes from push to deployment.

**Decision.** The route table that holds the tunnel's default route now ends
in an `unreachable` default (metric 1000), so apps lose the network instead
of leaking when the tunnel is down; the agent's own and root's traffic stays
direct as before. The maintainer's deployment sets `vpn.direct: false`, for
sessions and phones alike. The release workflow exported its build cache to
the GitHub Actions cache after the image was already pushed, which held the
job (and the deploy branch behind it) for another three minutes; the
`image` and `physical-image` builds now use registry caches like the session
image. The rest of the wait is the Go builds (about three minutes on cold
caches) and Argo CD's poll (two minutes, one more of jitter).

**Consequences.** A session whose VPN endpoint is down has no network until
it is back, which is the point. The first release after the change builds
without a cache.

## 91. Chromium browser builds from the snapshot bucket, thinned with age

**Context.** Reproducing a web bug often needs the browser version it was
reported on. Google Chrome APKs only come from Google Play (an account, an
unofficial API, split APKs plus the TrichromeLibrary static library) or
from mirrors that forbid scraping. Chromium's x86_64 snapshots, already used
for the WebView catalog (decision #88), also hold `ChromePublic.apk`: one
APK, `org.chromium.chrome`, back to Chromium 129. All 30 milestones are
about 12 GB and grow by about 5 GB a year.

**Decision.** A new job, `holtdroid-chromium-sync`, in holtdroid-sync
shares the WebView job's code (`internal/snapshotsync`, parametrized by the
APK inside the zip) and writes an ordinary read-only source. Selection
counts available milestones newest first: channels, the newest 10, every
2nd, and past the newest 24 every 5th instead (`milestones.older`, also
available to the WebView job, off there). Builds that fall out of the
selection are pruned after a complete pass.

**Consequences.** It is Chromium, not Chrome: no Google services. The
catalog stays around 18 to 22 builds (7 to 9 GB) for years. Snapshot builds
report an all-zero frontend revision, so the api passes any source build's
valid `frontend` tag as `CreateSession.Frontend`; the agent uses it for the
app's own DevTools sockets and the WebView catalog's for the rest. Phones
ignore it: the builds are x86_64.

## 92. Go and the UI are compiled on the runner, the images only copy them

**Context.** Every release compiled Go from scratch inside three Docker
builds (the plain binary for two architectures, the four `holtdroid` client
builds, and the cgo Frida build twice over for the session and phones
images), about three minutes on a cold cache that a source change always
invalidated. Docker layer caches can't help with that, and BuildKit cache
mounts don't survive between runners.

**Decision.** A `build` job in the release workflow compiles everything once
with restored caches: the Frida binary in the Go builder image (so it runs on
the phones image's Debian 12 glibc), the bundled Frida scripts, the web UI,
`holtdroid` for linux/amd64 (arm64 too on tags) and the client for four
platforms. The binaries go to the three image jobs as an artifact, and each
Dockerfile takes them with `--build-arg GO_SOURCE=prebuilt`; the default,
`build`, still compiles inside Docker so `make image` and local builds work as
before. The arm64 variant of the main image is now built for tags only: the
cluster is amd64 and a commit on `main` doesn't need a second architecture.
The workflow can also be started by hand from any branch (`gh workflow run
release.yml --ref <branch>`), which builds the images without pushing them
or moving the deploy branch.

**Consequences.** A release with warm caches takes about two minutes in CI
instead of six (measured: 123 s end to end on a dry run), then Argo CD's poll
and the rollout. Caches are scoped to the branch that made them, so the first
run after a change to `go.sum` or on a new branch is cold (about five
minutes). The `:main` image has no arm64 manifest; tags do.

## 93. Network conditions are tc netem on the VPN tun, driven by the agent

**Context.** Testers want slow, lossy and flaky networks: a named, realistic
choice rather than raw numbers, plus networks that change over time (a
subway ride, short dropouts). The emulator console (`adb emu network`, #31)
went away with redroid (#82), and redroid shares the node's kernel, so
Android has no link of its own to slow down. All app traffic already goes
through the VPN sidecar's tun.

**Decision.** `internal/netem` holds a catalog of profiles (round trip,
jitter, kbit/s down and up, loss, optional burst length) and scenarios
(steps over profiles and outages, each held for a random time in a range),
with names and descriptions; the agent offers it in `DeviceState` and the
UI only renders it. The agent shapes the tun with `tc` from iproute2 in the
session image: netem under a `prio` qdisc on the tun's egress for the
upload, its ingress redirected (matchall + mirred) to an ifb device with
netem for the download, half the round trip in each direction. Packets to
or from the tun's own /30 skip both (a u32 filter to an unshaped band, and
`action ok` before the redirect): sing-box's system stack NATs every TCP
packet back through the tun to its own listener, so without the filters TCP
crossed the tun twice and a download was capped at the upload rate (seen
live: 291 kbit/s on a 20 Mbit/s down, 300 kbit/s up link). The queue is
about half a second at the link's rate, with Gilbert-model losses for
bursts. Every change replaces the qdiscs, because `tc qdisc change` keeps a rate or slot the new link leaves
out. A scenario steps in a goroutine until the next change; a plain link is
re-checked every 10 s and re-applied if the tun lost it (a sidecar
restart). The agent clears the shaping when it starts. An outage is 100 %
loss, not a link down: Android keeps a connected network and requests hang,
like a dead cell; airplane mode and the radio toggles stay the way to a
disconnected network. Android's own `tc` can't be used (its binaries only
run under Android's init), so the agent container gets `NET_ADMIN` when VPN
locations are configured. That adds nothing an attacker in the Pod lacks:
Android is privileged in the same network namespace.

**Consequences.** Only sessions with VPN locations offer network
conditions, and only apps' traffic is shaped: root processes (the agent,
sing-box, Android's daemons) and `vpn.bypassCIDRs` skip the tun, so the
screen, DevTools and ADB stay fast. Session nodes need the `sch_netem`,
`ifb`, `act_mirred` and `cls_matchall` modules. Profile ids are no longer a
contract enum: the agent validates them against its catalog. Phones still
offer none (the A05 has no `sch_netem`); they would need shaping on the host
of their sing-box.

## 94. The hardware keys live on a drawn phone body, Mute is per tab

**Context.** Lock, wake, volume and the device audio switch were rail
buttons among a dozen others, and nothing on the screen said whether the
sound was off.

**Decision.** The screen is drawn inside a phone body with a volume rocker
and a power key on its right edge. A click on the rocker's halves presses
volume up or down, a click on the power key does the chosen lock mode;
hovering opens the rest (the media volume and Android's mute; wake and
unlock, locking now, and the lock mode the key uses).
The agent reports the media volume and its mute in `DeviceState`; muting
sets the lowest step rather than pressing `KEYCODE_VOLUME_MUTE`, which
toggles whichever stream Android picks and can't be set to a known state,
and the agent remembers the step to bring back. There is no separate mute
for the browser tab: it differed from switching the device audio off only
in staying connected, and three sound switches confused people. Whether the
device audio plays in the browser is a stream setting, so it lives in the
stream card, which is marked while it is off. The rocker turns amber, the
colour of a changed device control, while the device is muted. The keys stay on
the right in landscape too.

Notifications and quick settings slide out as a row of large buttons from a
handle above the phone, back, home and recent apps from one below it, in
the space the frame keeps there, instead of a popup from arcs in the
bezel's corners: the buttons sit right at the screen and are easy to hit.
Rotation moved into the display card. The bars keep a small gap to the frame and look like Android's: chips in a pill above, the three navigation glyphs in a pill on the device's bottom edge, which in landscape is the right or left side (a vertical bar, as Android puts it), while the top bar stays above the screen like the status bar.

The network (Wi-Fi, mobile data, airplane mode, the VPN location and the
emulated conditions) moved out of the rail into a card to the right of the
phone that shows the location, the external IP and the conditions; hovering
it opens a panel drawn like Android's quick settings shade, where every
location and condition is a row with its description instead of a select.

The stream and keyboard settings and clipboard sync became cards under the
network card with the same kind of shade (`shade.tsx` holds the shared
pieces). Only the codec and bitrate are remembered across sessions:
quality is picked in `p` (the short side) and never above 1080p, a
sharper screen is scaled down to it; the frame rate starts at 45 fps and
can go up to the device's refresh rate but not past 60 (the agent refuses
more: emulators encode in software and faster rarely helps a test). A frame
rate below the start is remembered, since it is usually about a slow
connection; quality and a faster frame rate last for one session. The agent
now reports the display's size and refresh rate. The stream's decode
numbers moved from the bottom bar into the stream card, and the device's
network traffic into the network card, which already shows the external IP
the bar used to repeat, and the clipboard
card keeps the last 10 synced texts to copy again or save. H.264 stays the default because it is the cheapest to encode on
emulators without hardware encoders; the saved codec falls back to the
cheapest decodable one.

Date and time moved into a card as well, with the time zone, which left
Language and region. The time zone follows the VPN location like the GPS:
the agent applies the location's zone at start and on every switch unless
the user picked one for the session, and the card can go back to the
location's. The card is marked while the clock is shifted, out of real
time or in a zone picked by hand; an exact moment unfolds inside its panel
instead of a dialog. The system language and the keyboard layouts got a
card too, a grid of flags where a click picks the language or toggles a
layout; the faked GPS became a card as well, so the rail is down to capture. Battery became a card
as well (saver, charging, charge level); like the rest of the device state
it lives on the device and nothing of it is remembered in the browser. Panels stay open
once clicked into, so typing and native date pickers don't close them.

Display left the rail for a card too, with the screen brightness and
adaptive brightness added (`screen_brightness`, `screen_brightness_mode`).
The stream is captured before the backlight, so the picture doesn't dim;
it isn't faked in the browser either, since a dimmed canvas would look like
a broken stream. Brightness is device state like the rest: redroid starts
fresh and a phone's cleanup puts its own brightness back, so nothing is
carried to the next session. The rail is left with capture and the faked
GPS. The SSH button left the page header for a card at the bottom of the
column, with the same tunnels, ADB commands and connect command in a shade.
Its font and display size are stepped sliders with a preview, and the panel
says that display size is Android's density setting rather than the screen
chosen at launch. All the cards' sliders are Android-style pills with the
icon inside the fill.

The App and Device tabs became cards too, in the same style: the app card holds restart, reinstall and saving app data (which left the header) with the ADB tools, the device card the device details, the WebView provider and bug reports; demo mode is gone. The metrics bar went the same way: the app's load moved into the app card and the device's, the storage, temperatures and the emulator container's into the device card, as tiles with meters and sparklines. The session's app, time left, Extend and Stop moved into the portal header in place of the logo, as on a recording's page. **Consequences.** The rail is gone: the screenshot button joined the notifications and quick settings above the phone, recording has its card, and vibration alerts come from the screen itself. A side key without a panel (volume on a device that doesn't report it) opens nothing on hover, and the keys widen with a transform so their panels don't shift. Small + and − marks and the power key's current action sit next to the keys, which widen on hover and sink on a press. The cards (158 px wide) stand on the left from the top of the panel, in one column that scrolls with a fade on the edge that has more, rather than extra columns (an estimated card height left gaps), and the phone moves aside; only one panel is open at a time, and one that was clicked into keeps others from opening on hover. A landscape screen turns the page split vertical, the screen above the tools, and the side keys follow the rotation to the top, bottom or left edge. The screen reports its insets (the card columns, the frame and the keys) as `data-inset-x`/`data-inset-y`, which the auto-fit reads for either split.

## 95. Newer Mesa Vulkan drivers in the Android 15 redroid image

**Context.** Chromium 157 and later draw only through ANGLE and Skia on
Vulkan, with no GL fallback. redroid ships Mesa 24.0.8 built with
`android-strict`, which advertises Vulkan 1.1 and hides
`VK_KHR_pipeline_library`, `dynamic_rendering`, `synchronization2` and the
AHardwareBuffer extension, so those builds abort with "GPU process isn't
usable" on every node (AMD on core, Intel on the k3s nodes). Flags such as
`--disable-features=SkiaGraphite,Vulkan` don't help.

**Decision.** holtdroid-redroid cross-compiles Mesa 26.2.5 with the Android
NDK and `-Dandroid-strict=false` (radv and anv, libdrm and expat linked
statically) and replaces `vulkan.radeon.so` and `vulkan.intel.so`; EGL and
GLES stay redroid's. It is switched on per image (`VULKAN=mesa`), so far only
for Android 15.

**Consequences.** On Intel UHD 630 ANGLE reports Vulkan 1.4, Chromium 158
and the built-in WebView render WebGL at 60 fps. radv on core is built the
same way but was first exercised by real sessions. The Android 15 image
build takes about 9 minutes instead of 1, and Mesa is now ours to update.
Chromium 157 and later still fail on Android 11 to 14 images.

## 96. Sessions are recorded on the server, rendered only when watched

Supersedes #66 and #74: the browser no longer records.

**Context.** Browser recordings needed the tab open the whole time, showed
only what the tab had (or a share prompt per recording for the whole tab),
and knew nothing the page didn't fetch. Testers wanted every session on
record with what was going on around the screen: the device, the WebView
version, the app's build, the load, the network with its emulated
conditions, the device clock's offset from real time, and logcat, and to
pass a recording to someone without an account.

**Decision.**

- **The agent records** (`internal/recording`). Video is the scrcpy H.264
  stream muxed as is into fragmented MP4 (`bluenviron/mediacommon`), no
  decoding or encoding: one init file per epoch (a new stream or a new
  config packet, e.g. after a rotation) and segments cut at the first key
  frame after 2 s. Redroid's software encoder sent a key frame only every
  minute or two (seen on 2026-10-25: a 140 s and a 50 s segment), so every
  stream asks scrcpy for one every 2 s (`i-frame-interval`, 1 s on the
  recording's own stream) and a segment also ends after 20 s or 16 MB
  without one; the manifest marks which segments start with a key frame,
  and the player decodes a run from such a segment on. The agent taps the newest viewer's H.264 stream
  (`videoHub`), so watching and recording share one encoder on the device;
  with no such viewer it runs its own stream (H.264, 1280 px, 30 fps,
  2 Mbit/s). Sound is a track of its own (`ainit-N.mp4`, `aseg-N.m4s`, `manifest.audio`):
  the Opus packets of the newest viewer who listens, or a capture for the
  recording alone when nobody does, which stops once the device says it
  can't (a device with no audio; Android 11 too until decision #140); phones feed the recording
  from the capture they keep for the whole session. Opus packets are all
  independent, so segments are cut by time (10 s) and each decodes by itself;
  the packets' own times pace the sound and the first one is placed by the
  recording's clock, since the audio and the video sockets of a viewer come
  from two scrcpy servers whose times don't share an origin. The player
  schedules decoded buffers on the Web Audio clock a few seconds ahead and
  starts again on every seek, and is silent at other speeds than 1×
  rather than change the pitch. Next to the video: events as gzipped JSON lines
  (`RecordingEvent`: device info and WebView version at start and after
  installs, `StatusEvent` changes, every metrics sample, the `DeviceState`
  after each change and every 30 s, the network after each switch) and
  logcat (`logcat -v threadtime`) as gzipped text, each line prefixed with
  the recording time, flushed every 10 s; a JPEG thumbnail from
  `screencap` after 5 s and at the end.
- **Touches are events too.** The agent already forwards the viewer's
  scrcpy control messages to the device, so it also reads them: touch
  down, move and up (position as 0–1 of the screen, moves kept at most every
  33 ms per finger) and the Back, Home and Recents keys, never text or other
  keys, which could be passwords. The buttons of the drawn phone body come
  in through `POST /v1/device/actions/{action}` (decision #94) and are
  recorded there, with volume, rotate and the shade. The player and the video draw them over the
  screen as circles, trails and a key label. Input that doesn't pass through
  the portal's screen (adb, SSH, the app itself) isn't seen.
- **Uploads go through the api**, not to storage directly, so session Pods
  hold no storage credentials. The api creates the recording (at launch,
  through `CreateSession.recording`, or on request through the agent's
  `POST /v1/recording`) and hands the agent an internal URL that carries a
  random secret whose SHA-256 is in the recording's meta. The agent PUTs
  each file once, in order, retrying for up to 10 minutes, the manifest
  last; a 4xx stops the recording. A session that dies mid-recording
  leaves everything uploaded so far, shown as cut off once its manifest is
  two minutes old.
- **Storage is objects, no database**: `meta/<user>/<id>.json` (written by
  the api at creation), `.state.json` (the manifest's summary, written only
  by the upload handler), `.keep` and `.share` markers, the files under
  `files/<user>/<id>/`, and `shares/<token>.json` pointing back. Writers
  never share an object, so replicas don't race; a user's recordings are
  listed without their files.
- **Modes.** `recordings.mode` is `always` (the default: every session is
  recorded and a recording can't be stopped, no matter what the launch asks),
  `auto` (recorded unless the launch says no, and stoppable) or `manual`.
  A server that must have a record of every session needs `always`; the
  others are for people running their own.
- **Markers** are pins on the timeline (an icon and a note) kept by the api
  next to the recording (`meta/<user>/<id>.markers.json`), not in the agent's
  files, so they can be added after the fact and edited. One set from the
  session page is stamped with the agent's own elapsed time (`GET
  /v1/recording`), which avoids any clock skew between browser and node.
  Share links show them read-only, and the video shows them as labels.
- **Recording files** (`.holtdroid`) are a ZIP of the recording's files plus
  a small `holtdroid.json`, written by the api straight from storage (Go's
  `archive/zip`: ZIP64 and data descriptors for free, no buffering, entries
  stored since video and logs are compressed already). A ZIP rather than a
  format of our own because every tool opens it and its central directory at
  the end is an index: the web client reads that, then slices out only the
  entries it plays from the `File` the user picked (`web/src/lib/recording/bundle.ts`),
  so even a multi-gigabyte file costs a few hundred kilobytes of memory. The
  player doesn't care where its files come from: `RecordingFiles` is either
  the server's URLs or a ZIP, and the `/open` page, which needs no sign-in,
  uploads nothing. The extension is `.holtdroid`.
- **The session page's card** replaced the rail's Record button: a click pins a
  marker, hovering shows the recording's numbers, keep-forever and share.
  Sharing keeps the recording.
- **Logcat as `.log`** is the logcat with ANSI colours by level, made on the
  server by line so a share link gets it too; the plain text stays.
- **Too short to keep.** A recording that ends under `recordings.minDuration`
  (20 s) is deleted with its last manifest, the one the agent uploads when it
  ends, so a session opened and closed at once leaves no empty recordings
  in the list; the periodic sweep catches ones whose agent never said it was
  done. A kept or shared recording and one with a marker stay, since someone
  wanted them.
- **Retention and quota**: recordings older than `recordings.maxAge` are
  deleted unless kept. The per-user `recordings.quota` is checked when a
  recording starts and on each manifest upload (usage cached a minute per
  replica): the oldest recordings that are neither kept nor running are
  deleted to make room; when that isn't enough the upload gets 507 and the
  agent stops, and a launch goes ahead without a recording.
- **Rendering happens in the browser**, from one summary of the data
  (`summary.ts`) in a Material You palette (`android.ts`): logcat on the
  left, the phone in the middle and app, device clock with its offset from
  real time, quick-settings tiles, device, network (VPN, throttling
  profile) and load with meters and sparklines on the right. The player page
  draws only the phone's frames on a canvas and everything else as HTML, so
  text can be selected and copied, logcat has level and text filters and a
  click on a time seeks. **Download video** draws the same summary and
  logcat on a canvas scene (`scene.ts`), frame by frame into an MP4, because a
  video can't hold page text. The scene is 1296 px tall and 30 fps (a design
  of 1080 logical pixels scaled by 1.2: a bit above 1080p, short of 1440p) with
  a header carrying the logo; its width follows the widest the screen got in
  the recording (2304 for portrait, up to about 3200 for a landscape phone or
  a tablet, whose middle column widens), and the phone's body tweens between
  sizes over 320 ms when the picture changes size. The output goes straight
  into a file the user picks (File System Access API, a stream that aborts
  instead of committing when the render is cancelled) or, where that is
  missing, into OPFS and a download at the end; only a few segments are kept
  in memory while rendering. Segments are
  decoded with WebCodecs through mediabunny, one `init + segment` run at a
  time, so a seek fetches only the segment it needs. Share links open the
  player without sign-in and don't offer the download. Sharing also keeps
  the recording, since a link that dies after a week surprises whoever got
  it; turning sharing off leaves it kept.

**Consequences.** The server spends no CPU on video; an hour of an app in
use is 0.2–2 GB in storage (the viewer's quality decides), events and
logcat a few MB. The recording follows the viewer's resolution and frame
rate, and a viewer who switches codec or quality starts a new epoch. A
second viewer joining takes the recording over at its first key frame;
when the newest viewer leaves while another is still watching, the
recording waits for the remaining stream's next key frame (up to the
encoder's I-frame interval). Downloads take as long as the browser needs
to decode, draw and encode every frame, typically several times real time.

## 97. The GPS map uses keyless OpenFreeMap tiles proxied by the api

**Context.** Picking a fake GPS position from a city list or typed
coordinates is clumsy; people want to click a point on a map. Most tile
services need an API key, and the openstreetmap.org tile servers forbid use
by distributed apps. Loading tiles straight from a third party would also
need the browser to reach it and would leak the user's cookies, IP and
viewport to it.

**Decision.** The GPS panel shows a MapLibre GL map (loaded lazily) of
[OpenFreeMap](https://openfreemap.org) vector tiles: free, no key, no
request limits. The api proxies everything under `map.url` at
`/api/v1/map/tiles/…` behind sign-in, sends only its own User-Agent (no
cookies or auth headers), passes the caching headers through and rewrites
`map.url` in JSON responses (style, TileJSON) to the proxy path, so any
server that keeps a MapLibre style, its tiles, sprites and glyphs under one
base URL works, a self-hosted one included. `GET /api/v1/map` tells the UI
the light and dark style; an empty `map.url` turns the map off. Clicking the
map or dragging the marker overrides the GPS like picking a city.

**Consequences.** The api needs outbound HTTPS to the tile server; nothing
is stored, the browser cache does the caching. Moving the position along a
route (walking, running, driving) and road routing are the next steps
(roadmap, Later).

## 98. GPS routes are driven by the agent

**Context.** Testing a delivery or fitness app needs a position that moves:
walking, running or driving along a path, not jumps between points.

**Decision.** `PATCH /v1/device` takes `route: {points, speed, loop}`. The
agent fakes the first point, then a goroutine computes where the route is
from the elapsed time every second (straight lines between the points,
great-circle distance, linear interpolation inside a leg) and sets only
`set-test-provider-location` on the gps and network test providers; a
failed tick falls back to registering the providers again. The route belongs
to the agent, not the browser, so it keeps going with the tab closed or
reconnecting; any other GPS change (`geo`, `resetGeo`, a new `route`,
`stopRoute`) stops it, and it is a session override like a manual position,
so VPN location switches don't move the device. The UI offers walking
(5 km/h), running (10 km/h) and driving (50 km/h), takes the points as clicks
on the GPS map, draws the line and polls the device state every second while
it moves. The fake provider computes the same position from its clock on
read.

**Consequences.** The faked `Location` carries no speed or bearing (as far
as we know, `cmd location` sets only the position, accuracy and time), so an
app that reads `getSpeed()` sees none while the position moves; Frida could
add them later. Routes follow straight lines, not roads: road routing
through a routing service proxied by the api is the next step. The route is
in the agent's memory only, like the rest of the session's GPS override.

## 99. GPS routes along roads come from Valhalla through the api

**Context.** Straight lines between clicked points (decision #98) cut
through buildings and rivers; apps that snap to roads or check the route
see a device that walks through walls.

**Decision.** `POST /api/v1/map/route` asks a
[Valhalla](https://github.com/valhalla/valhalla) server for a path through
the points: `pedestrian` costing for walking and running, `auto` for
driving. The default `routing.url` is the public FOSSGIS instance
(`valhalla1.openstreetmap.de`), free and keyless under fair use; Valhalla's
API is the same when self-hosted, and an empty `routing.url` turns it off.
The api decodes the legs' polyline6 shapes into one path, thins it to the
5000 points a route may have and returns its length; the UI shows it on the
map while planning ("Follow roads", on when routing is available) and sends
it as an ordinary `route`, so the agent and the contract don't change.
The api sends only the points and its own User-Agent. Up to 20 points per
request, the usual limit of public Valhalla servers.

**Consequences.** The device still moves at a constant speed, not at each
road's speed, and turns are as sharp as the shape. The public server limits
the path length (1500 km for driving) and the rate; heavy users should run
their own. The api needs outbound HTTPS to it, like the map tiles.

## 100. GPS routes speed up, slow down and drift

**Context.** A device that jumps to full speed, takes a right angle at 50
km/h and stops dead looks fake to any app that derives speed from its
positions, and decision #98 moved at exactly `speed` all the way.

**Decision.** `speed` is now the cruising speed. `contract.Motion` samples
the path every ~2 m (at most 20 000 samples) and sets a target speed per
sample: the cruising speed with a slow drift of two sine waves (±7% walking
to ±12% driving, wavelengths of about 20 and 47 seconds of travel), reduced
for the heading change over the 2.5 seconds of travel before and after the
sample (a right angle takes a car to about a quarter of its speed, a walker
to 85%). A forward and a backward pass limit the change between samples to
an acceleration of 0.25 + 0.1·speed m/s² (0.4 walking, 1.6 driving), from
and to a crawl at the ends of a route without loop; a loop makes the drift
periodic over its length and starts at cruising speed. The samples are
integrated into the time each is reached, so the position after t seconds is
still a pure function of the route and t, shared by the agent and the fake
provider. `DeviceState.route` adds `currentSpeed` and `duration`.

**Consequences.** A pass takes a little longer than length/speed (5% for a
car on a route with one corner, under 1% walking). The `Location` still has
no speed field (decision #98); the speed only shows in how fast the position
moves. Road speed limits and stops at junctions are not modelled.

## 101. Device controls on redroid: virtual radios, a fabricated lock screen, no clock

**Context.** Checked on every redroid version (11–15) on 2026-10-26: the
lock key put the screen to sleep and woke it straight into the app, because
redroid sets `config_disableLockscreenByDefault` and `locksettings
set-disabled false` doesn't override a config default; the Wi-Fi toggle did
nothing (no Wi-Fi HAL, only Ethernet) and `svc data` failed without a
`phone` service; `dumpsys battery` reported `present: false`, so the status
bar showed a question mark and ignored the level, and Android 11 and 12 have
no `dumpsys battery get`; the brightness was written linearly while the
shade's slider is on Android's HLG gamma curve (10% showed as about 40%);
`cmd alarm set-time` silently does nothing; fake GPS failed on Android
12–14 (the agent's adbd is uid 0, but only uid 2000 had the mock-location
app-op) and on Android 11 (`cmd location` has no providers command).

**Decision.**
- Lock: `cmd overlay fabricate` an overlay on `android` that turns
  `config_disableLockscreenByDefault` off (Android 12+, root may fabricate),
  enabled at boot: enabled with the first lock, its configuration change put
  the screen back to sleep. Android 11 has no fabricated overlays, so the
  agent sets the PIN `0000` and unlock types it and clears it.
- Wi-Fi and mobile data are the agent's own state on redroid, both on at
  start. The Frida script shows the Ethernet network to the app as Wi-Fi or
  mobile data (`debug.holtdroid.network`, readable by apps), and with no
  radio or in airplane mode an `ip rule` (`pref 8990`, every uid but root,
  `unreachable`) takes the network away. A real Wi-Fi would need
  `mac80211_hwsim` in the node's kernel, which is out of reach of a Pod.
- Battery: `present 1` with every simulated change and at boot, always
  after the level: a present battery at 0% unplugged makes Android shut
  down, which ends the redroid container, so a level of 0 is set as 1. State
  from the full `dumpsys battery`.
- Brightness: the percentage is the slider's (gamma) position, set with
  `cmd display set-brightness` and the slider's minimum (the display's
  current minimum since Android 12, the settings minimum on 11); the int
  setting is too coarse at the low end, so the agent reports the last
  percentage it set while the setting still matches it.
- Time: the clock can't move without `CAP_SYS_TIME` on the node, and moving
  it would move the node's clock, so `DeviceState.canSetTime` is false on
  redroid and the UI offers only the time zone.
- GPS: the mock-location app-op for uid 0 as well; on Android 11
  `images/session/Geo.java` (in the dex of decision #59, now `tools.dex`)
  calls `ILocationManager`'s test-provider methods as the shell uid.

- Android 12's SystemUI crashes in a loop (ScreenDecorations, a null
  rounded corner) with the `corner`, `hole` and `tall` cutout emulations,
  which left the screen black: the agent doesn't enable them on Android 12;
  the portal still draws the cutout on its frame.
- Android 15's SystemUI keeps the status bar height it measured at boot, so
  a cutout overlay enabled afterwards clipped the clock and icons: the agent
  restarts SystemUI after enabling one on Android 15 and newer.

**Consequences.** The status bar and quick settings of redroid still show
Ethernet; only the app under test sees Wi-Fi or mobile data. The
app-level view of the network is as good as the Frida hooks
(`NetworkCapabilities`, `NetworkInfo`, `WifiManager`, `WifiInfo`). On Android
11 a locked screen asks for `0000`. A shifted clock on redroid would have to
be faked per process (Frida in the app, which can't reach the WebView's
sandboxed renderer) and is not done.

## 102. A SQLite file replicated by embedded Litestream; append-only migrations

**Context.** Revoking a single connect computer, offline computers and
session history need data that survives an api restart (#22, roadmap 4.6,
4.11). #22 planned a `sqlite` driver with Litestream, and its migrations
were edited in place, which only works while every database starts empty.

**Decision.** Supersedes the "migrations are edited in place" part of #22.

- `database.type: sqlite` opens `database.path` (default
  `/var/lib/holtdroid/holtdroid.db`, the chart's api data volume) in WAL
  mode with `busy_timeout`, `synchronous(normal)` and immediate
  transactions. `memory` stays the default.
- `database.replica` has the shape of `storage.Config`: `s3` or
  `filesystem`. Litestream v0.5 runs as a library in the api: when the file
  is missing the database is restored from the replica before the
  migrations run, then the WAL is streamed to it. Litestream uses
  `modernc.org/sqlite` itself, so the binary stays cgo-free. It brings its
  own S3 client (aws-sdk-go-v2), so `credentialsURL` is rejected for the
  replica; static keys or the AWS default credentials work.
- The api syncs Litestream right after opening and before closing.
  Litestream connects lazily and holds a read transaction only after its
  first sync; without that, closing the api's last connection checkpoints
  WAL frames Litestream never saw, and a write just before shutdown is
  lost from the replica.
- One writer: the chart fails to render `sqlite` with `api.replicas > 1`
  and uses `maxSurge: 0` for it even without a ReadWriteOnce volume.
- **Migrations are append-only** from now on: a pushed goose migration is
  never edited, because deployments with `sqlite` have applied it. Schema
  changes are new migrations; before the first release they may still drop
  or reshape tables without compat shims. Resetting is deleting the file and
  the replica's prefix.
- Features keep working with `memory`; they lose their data on restart
  there. Live state that sessions or sign-ins depend on stays where #5
  puts it.

**Consequences.** With `sqlite` the api can't scale out; PostgreSQL (still
planned in #22) is the way to more replicas. `maxSurge: 0` doesn't wait for
the old pod to finish terminating, so its shutdown can overlap the new
pod's start: on a shared volume SQLite's locks keep the file consistent, but
with an `emptyDir` and S3 the new pod may restore before the old pod's final
sync and lose the last second of writes. Litestream's S3 lease would close
that gap but needs conditional writes that not every S3-compatible store
supports, so it isn't used. The aws-sdk-go-v2 modules join minio-go in the
api binary.

## 103. A users auth mode: a directory with passkeys and invite links

**Context.** The maintainer wanted to let people in without an identity
provider: invite links with a preset role or an approval queue, passkeys
instead of passwords, recovery when a passkey is lost, admin-managed roles and
per-user limits, and optional email-domain rules. The other modes either have
no accounts (anonymous, password) or take them from outside (oidc, header).

**Decision.**
- A new `auth.mode: users`, opt-in like every mode; `anonymous` stays the
  default. `internal/users` holds the directory in the api's database
  (`users`, `passkeys`, `invites`) and implements `auth.Directory`, the one
  hook `internal/auth` calls.
- The session cookie carries only the user id and is looked up on every
  request, so a deletion or a role change applies at once. An empty role
  means waiting for approval: signed in, 403 on everything but
  `/api/v1/auth*`. At least one admin always remains.
- Passkeys through `go-webauthn/webauthn`: discoverable credentials, so
  sign-in needs no username; the RP id is `publicURL`'s host. The two steps
  of a ceremony share the challenge through a five-minute signed cookie, not
  the database. The browser side uses `@simplewebauthn/browser`.
- Invite, recovery and first-admin links are random tokens of which only a
  SHA-256 is stored, so a link is shown once (invite links since #108 are
  kept). An invite has a role,
  single-use or reusable, an optional expiry and optional domains on top of
  `auth.users.allowedDomains`. A recovery link is single-use, lasts up to 30
  days and cancels earlier ones. While no admin exists the api logs a
  single-use admin link valid for 24 hours, replaced on every start.
- OIDC is an optional second sign-in in this mode: the provider's email finds
  the user; an unknown one signs up with `auth.users.oidcRole` (or admin when
  in `auth.adminGroups`). The directory, not the provider's groups, decides
  the role afterwards.
- Limits per user (devices at once, session TTL, recordings quota, app data
  save size) resolve user override → `auth.users.limits.<role>` → the
  server-wide setting; a user's 0 means no limit. `sessions.maxPerUser` is
  new and applies in every mode.

**Consequences.** The `users` mode breaks the rule that losing the database
signs no one out (#22, #102): with `memory` every restart forgets all
accounts, so the docs and a startup warning point to `sqlite`, which limits
the api to one replica until PostgreSQL. Domain rules check the address's
shape only: no mail is sent, so anyone holding a link can claim an address
in an allowed domain; email verification is a roadmap item. Deleting a user
doesn't stop their running devices yet. Logging the first-admin link is
deliberate: whoever reads the api's logs can already read its secrets. An
admin locked out with no other admin uses `holtdroid users recover` in the
api's container, which opens the SQLite file without a replica of its own and
leaves streaming to the running api; `users create` and `users session` add
passkey-less bot accounts and mint their cookies the same way, for whoever
can exec into the api anyway.

## 105. A real Wi-Fi in redroid sessions through mac80211_hwsim

Supersedes the Wi-Fi half of #101.

**Context.** #101 made Wi-Fi a virtual radio that only the app under test
saw: Android's status bar and quick settings showed Ethernet, and on
Android 11 the Wi-Fi tile flipped back off because the HAL failed
(`Failed to initialize legacy HAL: NOT_SUPPORTED`). redroid ships no Wi-Fi
HAL backend, no wpa_supplicant and no hostapd (Android 14 and 15 no HAL at
all); the Android emulator's vendor image of the same API level has them
all, for an nl80211 radio named `wlan0`.

`virt_wifi` was ruled out: all its devices share one wiphy in the host's
network namespace, which nl80211 hides from a Pod's. `mac80211_hwsim` fits:
`HWSIM_CMD_NEW_RADIO` needs only `CAP_NET_ADMIN` over the caller's network
namespace and puts the radio there, every namespace gets its own netgroup
and frames, dumps and deletes stay inside it, and radios die with their
namespace. Checked on k3s-1 on 2026-10-26: two Pods on the same channel
saw only their own access point, couldn't join or delete each other's,
and the node was left with no radios after they were deleted.

**Decision.**
- Session nodes load `mac80211_hwsim` with `radios=0` (the default adds two
  radios to the host).
- holtdroid-redroid copies the Wi-Fi HAL, `libwifi-hal.so`, wpa_supplicant
  (with its init stanza) and `mac80211_create_radios` from the emulator
  vendor image it already downloads for ARM translation, plus the
  libraries they need that redroid's vendor partition lacks. At
  `post-fs-data` a script creates two radios, moves the second into a
  private router namespace held by the Android container (the only
  container allowed to create one), and runs upstream hostapd (open
  `HoltdroidWifi`) and dnsmasq there, with nftables masquerading into the
  Pod namespace over a veth (`wifiup`). Android's own hostapd is the
  AIDL HAL on 14+ and crashes outside VINTF; Android's iptables needs
  legacy xtables, which the node kernel doesn't have, so hostapd and nft
  come from Alpine with their musl libraries.
- A static RRO sets `config_ethernet_iface_regex` to `eth1` (framework-res,
  and `com.android.connectivity.resources` where Ethernet lives in the
  Connectivity module): with the Pod's `eth0` adopted, Android never joins
  Wi-Fi, because Ethernet already satisfies every request. A fabricated
  overlay is refused for that resource.
- Mobile data is `eth1`, a second veth into the router namespace that
  Android takes for Ethernet and Frida shows the app as mobile data. The
  agent keeps its router end up only while Android's Wi-Fi is off and
  mobile data is on (checked every 2 s, so the shade's tile works too).
- With Ethernet hidden, netd sends every unmarked socket of the Pod
  namespace to Android's default network: the agent pins root (sing-box,
  adbd) and its own uid to the Pod's routes, forwards `wifiup` to the VPN
  tun, and keeps forwarding on through netd (`ndc ipfwd`), which owns
  `ip_forward`.
- The router namespace and `eth1` exist on every node; without the module
  the image creates no radios and keeps `eth1` up as plain Ethernet, so
  #101's virtual radios work as before.
- toybox's `nsenter -t PID` enters `/proc/0` on Android 14 (toybox 0.8.9);
  the scripts use `nsenter --net=/proc/PID/ns/net`.

**Consequences.** Android's Wi-Fi, status bar and quick settings are real
on Android 11–15 and Wi-Fi off really cuts the network. With Wi-Fi off and
mobile data on the status bar shows Ethernet; a cellular icon needs a
telephony stack. The node's kernel gains a test driver that any
`CAP_NET_ADMIN` holder on it can use in its own namespace; sessions already
are root on their node (#83), so it goes only on session nodes.

## 106. Pixel perfect: references in storage, the comparison in the browser

**Context.** Testers check builds against design mockups. The PerfectPixel
browser extension does that for web pages: an image over the page, opacity,
position, an inverted mode. On a phone screen streamed into the portal they
wanted the same next to DevTools, plus what the extension can't do: find the
differences, say what each one is, keep a transient element still long
enough to check it, and send a report. Many of the apps put an interface over
a video, which differs from any mockup everywhere the video plays.

**Decision.**

- **References are images in storage, per user, without a database**:
  `pixel-perfect/<user hash>/<id>.json` (name, the app it was added for, size,
  placement, ignored areas; written only by the api), `<id>.img` and
  `<id>.used`, which the api rewrites when the image is opened, at most once
  an hour. One listing of the user's prefix gives sizes and last uses, so the
  quota and retention read no objects, and writers never share an object.
  `pixelPerfect.storage` puts them elsewhere, like recordings and app data.
  The image URL counts as a use; the list's thumbnails (decision #109) don't,
  or opening the tab would keep every reference forever.
- **Quota and retention**: `pixelPerfect.quota` (1 GiB) per user, overridable
  per role and per user like the other limits (`referencesQuota`, a new
  `users` column); an upload that doesn't fit gets 507 and nothing is
  deleted to make room, since references are named by hand, unlike
  recordings. A reference unused for `pixelPerfect.maxAge` (30 days) is
  deleted by a sweep. On by default: the images are small, and without a
  storage of its own the feature still works (on the chart's cache volume
  they don't survive a restart; the docs say so).
- **Placement in the reference's own pixels**, with scale 1 meaning "the
  screen's width, but no taller than the screen", top-aligned. A mockup at 1×
  or 3× and a stream at any size then line up the same, and the placement
  saved with a reference fits other devices of the same shape. Ignored areas
  are fractions of the reference for the same reason.
- **The overlay is HTML over the screen's canvas**: an `<img>` with CSS
  opacity and `mix-blend-mode: difference` (the "negative") or `filter:
  invert`, click-through unless Move or Draw is on, so the device stays
  usable. Freeze frame shows the decoder's last frame (`snapshot()`) as an
  image over the live canvas.
- **The comparison runs in the browser** (`web/src/lib/pixel-perfect`): the
  agent and the api stay out of it, and it needs the overlay's placement
  anyway. The screen is a lossless `screencap` (or the frozen frame, which
  comes from the stream); pixels are compared with pixelmatch (YIQ distance,
  anti-aliasing detection) after compositing the reference over the screen,
  so transparent parts and ignored areas compare equal. Differing pixels are
  binned into 8 px cells, cells with at least two of them are joined across
  two-cell gaps into regions, and regions under ten pixels are dropped as
  noise. Each region is classified by cheap tests: moving the reference up
  to 8 px around it (a shift when that removes two thirds of the misses),
  luma spread on either side (missing or extra), and colour edges in both
  (same shapes, another colour).
- **Video under the interface is skipped by motion, not by recognising
  video**: four frames 140 ms apart, 16 px cells where enough luma changed,
  grown by a cell, are left out. It needs no knowledge of the app and also
  skips animations and live maps. Manual ignored areas, saved with the
  reference, cover a paused player. Freeze frame takes its three extra frames
  right after the frozen one, so a frozen comparison skips motion too.
- **The views are the ones code review sites use for image diffs**: side by
  side, swipe, onion skin and difference, with a magnified crop per region.
  The report is a PNG drawn on a canvas (logo, reference, difference,
  screen, the list of regions), like the recordings' video scene.

**Consequences.** Analysis of a 1080×2400 screen takes a few hundred
milliseconds on the main thread; frames over 4.5 megapixels are scaled down.
A frozen frame carries the stream's compression, so precise checks want a
high stream quality or a live comparison. Motion detection can't tell a
still frame of a video from the interface; that is what ignored areas are
for. The api doesn't check that an image decodes beyond its header.

## 107. Pixel perfect reads WebView pages through their own DevTools connection

Extends #106.

**Context.** Differences found by pixels say where, not what: "a box at
240, 1180 moved 3 px down" leaves the tester to find the element and its
styles in DevTools by hand. Most apps tested here draw their screens in a
WebView, which the portal can already inspect, and a paused video in one
isn't caught by the motion mask.

**Decision.**

- **The browser opens its own CDP connection** to each page target through
  the agent's existing `/devtools/{socket}/page/{id}` proxy, next to the
  DevTools frontend's (Chrome has allowed several clients per target since
  version 63). No new agent or api endpoint.
- **One snapshot instead of live lookups**: a `Runtime.evaluate` collects
  every visible element (up to 3000) with its box, a selector, its own text
  and a fixed set of computed styles, plus `devicePixelRatio` and the visual
  viewport; `Page.captureScreenshot` adds a picture of the page. A frozen
  frame takes the snapshot when it freezes, so the analysis can name a toast
  that is already gone. `DOM.getNodeForLocation` per region would need the
  page as it was.
- **The WebView is placed by finding its screenshot in the device's**, not
  by asking Android where the view is: the screenshot scaled to
  `devicePixelRatio × scale` device pixels is searched for over the screen,
  first both scaled down, then pixel-exactly around the best spot, scored by
  the share of samples that disagree, so a native bar drawn over part of the
  page still matches. That handles status bars, toolbars, cut-outs and
  WebViews that don't fill the screen, and tells which of several pages is
  the one on the screen; one that doesn't match (score ≥ 0.3) is ignored.
- **A region belongs to the element maximising** (share of the region inside
  the element) × (share of the element inside the region), which prefers the
  tight element over its containers and a whole button over its label.
- **Media elements become ignored areas**: `video`, `canvas`, `iframe`,
  `embed` and `object` boxes, on by default, so a paused player or a map
  drawn on a canvas no longer counts as a difference.
- **Highlighting on the device** uses `Overlay.highlightNode` on a
  connection kept open for it, finding the node again by its index in
  `querySelectorAll("*")` and checking its tag, so a changed page highlights
  nothing rather than the wrong element. Selecting the node in the DevTools
  tab isn't possible from another client; the selector can be copied instead.

- **Off by default, marked experimental**: a switch in the tab, remembered
  per browser. Without it nothing connects to the page and the comparison
  is the pixel one of #106 alone, until this has been tried on real apps.

**Consequences.** It works only where DevTools works: debuggable WebViews,
or any WebView under Frida. Elements inside cross-origin frames and shadow
roots aren't listed. A page that changed between its screenshot and the
device's (an animation) can fail to match and then simply isn't used. The
snapshot costs a few hundred milliseconds per open page, at most four pages.

## 108. Invite links are kept so admins can copy them again

**Status:** accepted. Supersedes the invite part of #103.

**Context.** An invite link was shown only right after it was created; an
admin who closed the dialog before sending it had to revoke it and make a
new one.

**Decision.** `invites.token` keeps the token of invite links, and
`GET /api/v1/admin/invites` returns each one's `link`; the Users page has a
copy button on every link still valid. Recovery and first-admin links are
still stored only as a hash and shown once.

**Consequences.** Anyone who reads the database can sign up with an open
invite, which an admin could already hand out anyway; recovery links, which
take over an existing account, stay unreadable. Invites created before the
migration have no stored link.

## 109. Pixel perfect takes SVG and keeps small thumbnails

Extends #106.

**Context.** Mockups come from Figma, where a PNG export is a resampled
bitmap: scaled to the device's width it blurs and its edges fall between
pixels. The list of references downloaded every full image (often several
megabytes at 3×) just to show 48 px squares.

**Decision.**

- **SVG references.** The api accepts an SVG whose root is `<svg>` and takes
  its size from `width`/`height` (unitless or `px`) or the `viewBox`; one
  without a size is refused. It is stored as is and served with a sandboxing
  CSP (`sandbox; default-src 'none'`), since a script in an SVG would run if
  someone opened the image URL directly; inside `<img>` scripts never run.
  The browser draws an SVG at the size it is needed, on the screen and into
  the comparison, instead of scaling pixels. The tab recommends it: Export →
  SVG, or Copy as SVG, which the tab takes as pasted text.
- **Thumbnails** (`<id>.thumb`, `GET …/{id}/thumbnail`, immutable, not a
  use): 160 px wide, at most 320 px tall (the top of a tall frame), JPEG on
  white. The browser makes one when it uploads, since it renders SVG and
  decodes big images cheaply; the api checks it decodes and is small. For
  PNG, JPEG and WebP without one (other clients, older references) the api
  makes it itself, up to 24 megapixels, and keeps it; an SVG without one has
  none, since the api doesn't render SVG. This replaces `?preview` on the
  image URL. Thumbnails don't count against the quota.

**Consequences.** A Figma SVG with text kept as text depends on the browser
having its fonts; Figma outlines text by default. SVGs with `foreignObject`
taint the canvas, so their comparison fails with an error.

## 110. Gesture navigation on redroid by default

**Context.** redroid boots with Android's three-button navigation bar. The
phones people test on mostly use gestures, and apps lay out their bottom
edge differently under each (a thin gesture inset instead of a 48 dp bar),
so the default showed testers a layout few users see.

**Decision.** When the agent prepares a redroid device it turns on the
`com.android.internal.systemui.navbar.gestural` overlay with
`cmd overlay enable-exclusive`, unless a navbar overlay is already enabled,
so a restarted agent keeps what the user picked. Every redroid image
(Android 11–15) ships the overlays and Launcher3QuickStep, which handles the
home and back gestures. `DeviceState.navigation` reports it from
`settings get secure navigation_mode` (2 is gestures), and
`DeviceSettings.navigation` switches between the gestural and three-button
overlays; the display card offers both. Phones keep their own setting and
report nothing: vendors (Samsung) switch navigation their own way.

**Consequences.** The portal's own back, home and recents buttons keep
working under gestures, since they send key events. Switching restarts
the navigation bar for a moment.

## 111. Redroid's load is the `android` container, not the Pod

**Context.** Decision #40 read the whole session Pod's cgroup. Its limits
are the sum of its containers' limits only when every container has one;
the VPN sidecar has none and Android has no CPU limit by default, so the
Pod's `memory.max` and `cpu.max` were `max` and the device card fell back
to the node: 16 cores, 31 GB and the node's disk, next to 1.6 GB in use.

**Decision.** The agent picks the container cgroup under the Pod with the
most `memory.current`: Android, by far, next to the agent, sing-box and
pause. Its CPU limit (or the node's cores without one), working set and
memory limit (3 GiB by default) describe the device. CPU deltas are only
taken between samples of the same cgroup, so a restarted container skips
one sample. The provider passes `redroid.dataSize` as `HOLTDROID_DATALIMIT`;
with it the device's storage is `du -skx /data` (about 20 ms) of that limit
instead of `df`, which shows the node's disk under an emptyDir.

**Consequences.** Without a CPU limit in `emulator.resources` the device
still reports every core of the node, which is what Android may use.
Physical phones are unchanged: no Pod, no data limit.

## 112. Recordings keep the WebViews' DevTools traffic, recorded by the agent's own CDP client

**Context.** A recording showed the screen, the device and logcat, but not
what the app's WebViews did: which requests went out and what came back,
what the page logged, which WebSocket messages arrived. Testers asked to
look at that afterwards in step with the video, as in DevTools. Replaying
the recording into the real DevTools frontend (a fake CDP backend) would
give the familiar panels but only Network and Console would work: objects
couldn't be expanded, Elements and Sources would need snapshots of
everything, every seek back would reload the frontend, and the frontend's
protocol changes with each revision.

**Decision.**

- **The agent records** over CDP connections of its own
  (`internal/agent/cdprecord.go`), one per `page` target the DevTools scan
  finds while a recording runs, independent of whoever has DevTools open.
  It enables `Network` (post data up to 256 KB), `Runtime` and `Log`.
- **Requests** are written once they end, as one `DevToolsEntry` with the
  recording times they were sent, got headers and ended, the device clock
  when sent, headers, status, remote address, protocol, cache, HAR timings
  from `ResourceTiming`, and the body from `Network.getResponseBody` up to
  1 MB (cut beyond) except for images, media and fonts. Redirects are a
  request each. Requests still loading are written when the recording or
  the page ends, without an end.
- **Console**: `console.*` calls with each argument's text and, for objects,
  their JSON (`JSON.stringify` through `Runtime.callFunctionOn`, up to
  64 KB), format specifiers applied; uncaught exceptions with their stack;
  the browser's own messages (`Log.entryAdded`).
- **WebSockets and EventSource**: a socket's states and every frame, text up
  to 128 KB and binary up to 16 KB (base64). Video or another media stream
  is not wanted: a socket whose binary frames start like a media container
  or a picture (H.264 start codes, MP4 boxes, WebM, Ogg, JPEG, PNG, RIFF,
  FLV) three times, or that carries 1 MB or 60 binary frames in four
  seconds once it has run for two, is marked `stream`; its frames after
  that are only counted.
- Headers, cookies and bodies are recorded as they are; nothing is
  redacted. A share link shows them like the rest of the recording.
- Lines go into `devtools-N.jsonl.gz` chunks next to the events, at most
  32 MB of lines per 10 s flush; the rest is dropped with a `dropped` line.
  The api reads them back as one list (`/devtools`), like the events.
- **The player** puts logcat, Network, Console and WebSockets in tabs on the
  left. Each follows the timeline (a request is shown from when it was sent
  and is pending until it ended), filters, and opens a row in a lower pane:
  JSON as a tree (also JSON inside strings), forms as pairs, bytes as a hex
  dump, cURL, timing bars. Every value that reads as a time (Unix seconds,
  milliseconds, microseconds or nanoseconds between 2000 and 2100, seconds
  only under a key that names a time or within five years of the moment;
  ISO 8601 and HTTP dates) gets a chip with its distance from the device
  clock at that moment and, on hover, UTC, the device's and the viewer's
  zones and Unix values. **Download → Network (.har)** writes HAR 1.2 with
  bodies and Chrome's `_webSocketMessages`.
- **The video download leaves logcat and DevTools out** (supersedes that
  part of #96): it is the phone and the device panels, 1560×1296 for a phone
  held upright. Text that long belongs on the page, where it can be read
  and searched.

**Consequences.** A WebView that loads a lot of JSON adds megabytes per hour
to a recording; bodies count against the quota like the video. What happens
before the agent attaches to a page (its first two seconds, or the console
lines `Runtime.enable` replays) is stamped with the time of attaching.
Service workers and other non-page targets are not followed.

## 113. Dev servers are published by default

**Context.** Decision #65 made *manual* the default publish mode, so a new
computer published nothing until the user picked ports or switched modes.
The point of the client is that the dev servers are there on the device.

**Decision.** A computer with no saved mode starts in *dev*. A computer that
already saved a mode keeps it; `--publish-mode manual` or the TUI's Mode line
switches back. This supersedes the default in #65.

**Consequences.** A dev server is reachable from every device of the user as
soon as it listens, without a prompt (the exposure #65 accepted for the
automatic modes now applies out of the box).

## 114. The DevTools watch runs all the time and follows every target

Refines #112.

**Context.** The first version attached to `page` targets from the target
list every two seconds, and only once a recording had started. A recording
starts when the session is ready, after the app was launched, so a
WebSocket the app opened at start (the connection to its backend) had no
`webSocketCreated` for the recorder and its frames were dropped. Iframes in
their own process, workers and service workers were not followed at all,
and messages of common protocols were shown as plain text: Socket.IO's
`42["event",{…}]`, SignalR's records split by `\x1e`, JSON Lines.

**Decision.**

- The agent keeps a connection to every WebView process's browser target
  (`/devtools/browser`) for as long as it runs and calls
  `Target.setAutoAttach` with `flatten` and `waitForDebuggerOnStart`: every
  tab, iframe, worker, shared and service worker is attached, paused until
  its `Network`, `Runtime` and `Log` domains are on and it auto-attaches its
  own children, then resumed. Nothing a new target sends is missed. A
  WebView without a browser target falls back to following its pages from
  the target list.
- It tracks sockets and requests without a recording; lines are written
  only while one runs. A recording starts by writing every target and the
  sockets already open with their URLs; requests in flight are written when
  they end, their start clamped to the recording's. Frames of a socket it
  never saw open still get a socket, without a URL.
- Targets are lines of their own with a `type` and a `parent`; the player
  filters Network and Console by context and tags lines from iframes and
  workers. A worker's console is taken from the worker, and the copy Chrome
  passes to its page (`Log.entryAdded` from `worker`) is skipped.
- Message and body parsing finds Socket.IO and Engine.IO packets (with the
  event name), SignalR and Engine.IO polling records, Server-Sent Events and
  JSON Lines, each shown as a list of trees with time hints; Raw shows the
  text with record separators visible.

**Consequences.** Every WebView process has one more DevTools client for
the session's whole life; outside recordings it only keeps state, but
Chrome buffers response bodies for it (32 MB at most, 2 MB a resource).
Targets of a WebView that existed before the agent found its socket are
attached unpaused, so their first requests can still be missed.

## 115. Recording links carry the moment and what is open

**Context.** Testers pass recordings around to point at one request or one
message, and had to tell the other person where to look. Timestamps in
payloads were compared with the device clock when they arrived, so a value
that was "now" stayed "now" however far the video went on, which says
nothing about how stale it is at the moment being watched.

**Decision.** A copied link ends in a hash (`#t=46.2&tab=…&request=…`, or
`message`, `socket` and `frame`) that the player reads when it opens: it
seeks there, opens the tab and the item and scrolls to it. Item keys are the
line's target and request id, or its position in the recording's DevTools
lines, which only grow. The hash is not kept in the address bar while
playing. Time chips compare with the device clock at the player's
position; the hover adds the comparison with the moment of the line.
Binary frames that decode as UTF-8 text are shown and parsed as text.

**Consequences.** Links stay valid for the recording's life; a line dropped
for size shifts nothing, since positions count the lines that were written.
Android's WebView renders cross-origin iframes in the page's renderer
(`--site-per-process` in `webview-command-line` changes nothing, tried on
redroid with WebView 128), so an iframe never becomes a DevTools target of
its own; its traffic is recorded with the page's.

## 116. A page's iframes are listed as targets and selected in the frontend

**Context.** WebView renders cross-site iframes in the page's renderer
(decision #115), so they have no DevTools target. Testers debugging a game
inside a lobby page looked for the iframe in the target selector and found
only the page; the frontend's Console context menu, where the iframe is,
isn't obvious.

**Decision.** The agent adds, after each page in `GET /v1/devtools/targets`,
the page's frames from `Page.getFrameTree` (through the DevTools watch's
session, a second per poll at most), as `type: iframe` with the frame's id
and `page` naming the page target; `about:blank` frames are left out. The
session page connects to `page` for such an entry and keeps one frontend per
page, so moving between a page and its iframes doesn't reload DevTools. To
switch the Console, the page adds a module script from its own origin
(`/devtools-context.js`, the only kind the frontend's CSP allows) to the
frontend's document; it imports the frontend's own `core/sdk/sdk.js` and
`ui/legacy/legacy.js` (the same module instances), finds the default
execution context of the frame and sets it as the selected
`ExecutionContext`, then shows the Console, and posts back whether it found
one within 20 s. Navigation and reload of such an entry use
`Page.navigate` with its `frameId`.

**Consequences.** This leans on the frontend's internal module layout and
names (`TargetManager`, `RuntimeModel.ExecutionContext`, `Context`,
`ViewManager`), checked against the revision WebView 128 serves; a revision
that changes them makes the switch fail with a message, and the context menu
remains.

## 117. Iframes are found through the Console, sockets watched live, the recording page laid out like a session

Supersedes #116.

**Context.** Listing in-process iframes in the target selector and switching
the frontend's Console context by reaching into its modules (#116) worked
around something DevTools already offers, at the price of depending on the
frontend's internals. Testers also wanted the WebSocket traffic while the
session runs, not only in recordings, and to mark its moments on the
recording; and the recording page and its video put long panels where a
glance should do.

**Decision.**

- The target selector lists targets only and ends with a note on choosing an
  iframe in the Console's context menu (`top ▾`); the agent no longer reads
  frame trees and the frontend gets no script of ours.
- The agent's DevTools watch fans its socket lines (targets, socket
  states, frames) out to live watchers over `GET /v1/devtools/sockets` (SSE),
  starting with what is open; each line has the agent's clock and, while
  recording, the recording time and id. The session page shows them in a
  **WebSockets** tab in DevTools' look (the stage colours remapped to the
  portal's), keeping 5000 frames a socket in the browser. A frame's time
  pins a marker at its recording time through the session marker endpoint,
  which now takes `t` and `recording`.
- The recording page puts the session's dark cards (clock, app, device,
  network, load, each with details on hover) left of the phone and the
  tools, styled like the session's DevTools panel, on the right. The video
  opens with a three-second card of the app and the device and then shows
  only what changes in a 360 px column beside the phone; its sound is
  shifted by the opening card.
- The preview is a `screencap` taken when a finger goes down, the one
  nearest to the fifth second; without touches it stays the screen at the
  fifth second, and the end no longer replaces it.
- Times without a zone are read as UTC, and a time hint whose moment lies in
  the recording offers to go there. Requests without HTTP status (`blob:`,
  `data:`) show their scheme; requests copy as `fetch()` too. A shared
  recording opens inside the portal's shell for someone signed in.

**Consequences.** Live frames cost nothing while nobody watches; a watcher
that falls 1024 lines behind misses some. A screencap at touch-down takes a
few hundred milliseconds and can already show the press highlight.

## 118. The agent keeps the session's socket traffic for later watchers

**Context.** The live WebSockets tab (decision #117) started empty on every
page load: a reload, a second viewer or a session opened on another machine
lost what the app had already sent, often its most telling messages (the
connection to its backend at start).

**Decision.** The DevTools watch keeps every live socket line (targets,
socket states, frames) since the agent started, up to 16 MB counted by
payload, dropping the oldest first, and numbers each line (`seq`). A new
watcher gets the kept lines, then the targets and sockets as they are now
(unnumbered, so they correct whatever the oldest lines left out), then the
live lines; the tab skips numbers it already has, so reconnecting and
resuming after a pause add only what is new. The history lives in the
session Pod and ends with it, like the session; the api stays stateless.

**Consequences.** Lines are stamped and kept even when nobody watches, a
few microseconds a frame; frames of media streams are still not kept. A
restarted agent starts an empty history.

## 119. Redroid images run 32-bit x86 apps

**Context.** Google Chrome from APKMirror crashed at startup on Android 12
to 15 with `FATAL:webview_entry_point.cc` "WebView cannot be started with a
browser process type", also with frida-server stopped, and ran on
Android 11. Its x86 builds are 64/32 Monochrome: `use32bitAbi="true"`, the
browser in `lib/x86/libmonochrome.so` and only WebView in the 64-bit one.
holtdroid-redroid's Android 12–15 images were built on redroid's
`*_64only` bases (`zygote64` only), so Chrome ran as a 64-bit process with
the WebView library. The Android 11 image already used a base with 32-bit
ABIs. Newer Chrome on APKMirror is arm64 only and segfaults under ARM
translation.

**Decision.** holtdroid-redroid builds every version on redroid's base with
32-bit ABIs (`zygote64_32`). ARM translation stays the 64-bit
`libndk_translation` from the emulator images, so the image drops
`armeabi-v7a` and `armeabi` from the vendor and ODM ABI lists and
`ro.dalvik.vm.isa.arm`. Those bases don't switch Codec2 on by themselves,
so the image sets `ro.boot.use_redroid_c2=1` (not on Android 11, which
stays on OMX) and runs redroid's switch from its own init file.

**Consequences.** Google Chrome's x86 builds from APKMirror (the newest the
sync found is 138) run on every Android version with Google's proprietary
codecs: H.264 and AAC play, WebGL2 runs on Mesa in Chrome's 32-bit GPU
process. 64-bit apps, Chromium snapshots and their Vulkan included, are
unchanged. Every session starts a second zygote: about 40 MB PSS
(180 MB RSS, mostly shared). On Android 12 to 15 apps with only 32-bit ARM
libraries fail to install instead of crashing; Android 11's system
`build.prop` still lists `armeabi-v7a`.
Android 14 and later warn that an app with only 32-bit libraries "isn't
compatible with the latest version of Android" when it starts, which hit
Chrome versions whose newest patch APKMirror has only as `x86`. The agent
sets `debug.wm.disable_deprecated_abi_dialog` before it launches the app, on
every device.

## 121. Quick launch defaults to the newest stable Chromium WebView

**Context.** With a WebView catalog configured, a session started with the
Android image's built-in WebView unless someone picked a build, so most
launches tested an old Chromium.

**Decision.** Quick launch uses the build last launched with, including
Built-in, and otherwise the newest catalog build on the Stable channel that the
chosen Android version can run, or the newest build when none is on Stable. The
launch dialog restores no remembered choice (WebView, provider, location,
screen, Android) and preselects the newest stable build; what is chosen there
is still remembered for quick launch. The API is unchanged: a launch request
without `webview` still uses the built-in one.

**Consequences.** A launch installs a WebView by default (a few seconds
longer) once the catalog has loaded. Providers without the `webview`
capability and portals without a catalog behave as before.

## 123. The api serves the DevTools frontend, not the session's agent

**Context.** The agent fetched the DevTools frontend through the session
Pod's network, which is the session's VPN and can be throttled or cut on
purpose. A cold upstream takes seconds per file and a minute for a whole
open; the browser got 502s and a blank panel, and with offline emulation on
DevTools could never load.

**Decision.** `internal/frontend` (the cache moved out of the agent) runs in
the api. The proxy answers `GET /s/{provider}/{id}/devtools-frontend/@{rev}/…`
itself for an existing session, from `os.TempDir()/holtdroid/devtools-frontend`
(a re-fillable cache, like the APK cache). A revision is crawled in the
background from `inspector.html` with lower priority than the browser's own
requests, and a complete crawl is archived in the api's `storage`
(`devtools-frontend/@{rev}.tar.gz` in `devTools.storage`, the api's
`storage` by default, which is a cache volume in the chart and so gets an
S3 prefix in a deployment), where the next api process restores it from in
seconds. Crawls also start ahead of any session: for every
source artifact tagged with a `frontend` and for every WebView build in the
catalog. The agent and the physical provider lose
their `DevToolsFrontend` setting and route. `devTools.frontend` (api config)
set to empty keeps the old path: the request goes to the agent, which is how
the fake provider serves its placeholder (`holtdroid dev` sets it empty).

**Consequences.** Needs outbound HTTPS from the api only. The on-disk cache
is per api replica and lost on restart, but the archive in `storage` makes
a restart or a second replica warm again in seconds; only a revision nobody
has crawled yet is cold (about a minute against upstream).

## 124. Eviction keeps parsed metadata; unparsed APKs are indexed without being kept

**Context.** The APK cache (decision #63) deleted a whole entry on eviction and
warmed only the newest `cache.warm` APKs, so after a restart or on a bucket of
large builds the older apps stayed on "Reading package info…" until someone
launched them.

**Decision.** Eviction deletes only `app.apk`; `meta.json` and `icon.png`
stay, so `Lookup` still answers and the listing shows names and icons.
`Cache.Ensure` re-downloads when the APK is missing. Uncached artifacts beyond
the first `cache.warm` are downloaded in the background and parsed by
`Cache.Index`, which stores only metadata and icon. Validity is unchanged: the
key hashes source, file and revision (the ETag, a content hash on S3) and
`apk.ParserVersion` must match, otherwise the entry is parsed again.

**Consequences.** Metadata for deleted artifacts is a few KiB and is never
evicted. After an upgrade that bumps the parser, every APK is downloaded once
more in the background. `cache.maxSize` now counts only APKs.

## 125. Google WebView in a second catalog, made the WebView by the agent

**Context.** Chromium's WebView snapshots have no proprietary codecs, so
pages with H.264 or AAC media fail in every catalog build, although they
play in the images' built-in WebView. Google's Android System WebView has
the codecs and APKMirror carries standalone x86_64 APKs of it (no Trichrome
Library). It is `com.google.android.webview`, signed by Google, so it can't
update the built-in `com.android.webview`, and redroid lists only that one
as a WebView provider. holtdroid-webview-sync prunes every APK in its prefix
that it didn't choose, so the Google builds can't share it.

**Decision.** holtdroid-redroid adds a static overlay that lists
`com.google.android.webview` as a provider, not available by default.
`webview.catalogs` adds catalogs next to `webview.storage`; IDs of builds
in them are prefixed with the catalog's index, so the first catalog's IDs
don't change. A sidecar's `package` tag names the provider;
`WebViewInstall.package` carries it to the agent, which installs the build
and runs `cmd webviewupdate set-webview-implementation` when it isn't
`com.android.webview`. Quick launch's default (decision #121) ignores the
provider: it is the newest stable build of any catalog, Chromium or Google.

**Consequences.** Sessions can test pages with proprietary codecs in a
current WebView. Google builds follow APKMirror's uploads, so some
versions are missing. The holtdroid-apkmirror-sync job fills the catalog;
other deployments need a job of their own.

## 126. Redroid's home screen holds only the app; the browser's clipboard skips SystemUI's preview

**Context.** On redroid the first home screen showed QuickSearchBox's search
bar, Gallery and a hotseat of system apps but not the app under test, since
Launcher3 adds icons only for installs a user made through a store. Every
paste from the browser popped up SystemUI's clipboard preview on Android 13
and later, because scrcpy's set-clipboard is an ordinary clipboard change.
The session wallpaper is off on redroid (#82), so the default AOSP wallpaper
showed.

**Decision.**
- holtdroid-redroid builds two more static overlays: one on `android`
  replaces `drawable/default_wallpaper` with the logo on a dark background
  (`build/wallpaper.svg`), which the home and lock screens use while no
  wallpaper is set; one on `com.android.launcher3` turns
  `layout/search_container_workspace` into an empty view, so the first
  screen keeps an empty row instead of the search bar. Disabling
  QuickSearchBox only swaps the bar for Launcher3's own "Search" field.
- After the first install the agent waits for Launcher3's `launcher.db`,
  stops the launcher, deletes every item on the home screen, in the hotseat
  and in their folders, and adds the app's launcher activity at row 1 of
  the first screen (row 0 is the search bar's), then goes home. sqlite3 is
  part of redroid's userdebug images.
- On redroid's Android 13 and later the browser's text goes through
  `Clip.java` in the tools dex, run as uid 2000 (`com.android.shell`), with
  `com.android.systemui.SUPPRESS_CLIPBOARD_OVERLAY` in the clip's extras.
  SystemUI honours that extra only from the shell package; it exists for
  the Android Studio emulator's clipboard sync. scrcpy still reports the
  device's clipboard changes. `device_config put systemui
  clipboard_overlay_enabled false` was tried and did nothing on 13, 14 or 15.

**Consequences.** A paste from the browser costs two pushes and an
`app_process` start instead of one scrcpy message; when that fails the agent
logs it and uses scrcpy. Android 11 and 12 have no preview and keep scrcpy.
Phones keep scrcpy's set-clipboard and their own launcher. The home screen
edit relies on Launcher3's `favorites` schema, checked on 11 to 15; when it
fails the session only keeps the stock home screen. Android 12's lock screen
clock is drawn over the logo; Android 11 shows no lock screen without a PIN.

## 127. Android version badges are drawn for Holtdroid, not taken from Google

**Context.** The launch dialog's Android version cards showed a gradient
with a generic robot. Google's per-release badges (a shield with a space
scene and the version on a planet) would read better, but they are Google's
artwork and trademarks, and this repository is Apache-2.0. Removing the
ANDROID wordmark or replacing it with another name still leaves a derivative
of that artwork.

**Decision.** `AndroidBadge` in `web/src/components/launch/android-version.tsx`
is an own inline SVG in a similar composition: a gradient shield in the
release's colours, a dark panel with stars, the release's dessert drawn
from its code name, and the version on a disc kept inside the shield. A
version without an entry gets the grey shield without a dessert.

**Consequences.** A new Android release needs a colour pair and a dessert
drawing in the same file. No image files, no requests to third parties.

## 128. Audio capture gives remote_submix the speaker's volume; autoplay skips the click

**Context.** Sessions started with Android muted: about half a minute after
start the media volume dropped to 0 and the volume rocker turned amber. The
recording's audio capture (or a listener's) routes the media stream to
`remote_submix`, a device AudioService has no volume step for yet, so the
stream sits at 0 and is muted, and the capture hears nothing. Separately,
device audio in the browser waited for the first click even where the
browser allows autoplay for the portal.

**Decision.** After a scrcpy server with audio starts, the agent waits for
the media stream to reach `remote_submix` and, if that device has no step
yet, sets it to the speaker's (`volume_music`, 5 when unset). Once per agent:
a step set later, muting in the portal included, stays. The page asks the
browser whether an `AudioContext` may play (`navigator.getAutoplayPolicy`,
else whether a fresh context resumes within 300 ms) and connects device
audio without a click when it may; otherwise the stream card says "Click
anywhere for sound" until the first click.

**Consequences.** A device whose `dumpsys audio` doesn't list the stream's
devices keeps the old behaviour after 10 s of trying. Browsers that block
autoplay log a warning about the probing context.

## 129. App descriptions live in the shared store and anyone signed in edits them

**Context.** An app's builds say nothing about what the app is for or how to
test it (for example that Holtdroid WebView exists to open any URL in a
WebView). That is about the package, not a build, so the APK sidecars, which
belong to one file in one source, are the wrong place.

**Decision.** One plain-text description per package, stored as
`apps/<package>.json` in the api's `storage` next to the APK cache, not in
the database: it survives restarts with the default in-memory database and
needs no migration. `GET /api/v1/apps` lists them, `PUT /api/v1/apps/{package}`
sets or (empty) removes one; anyone signed in may edit, like a wiki, and
every change is an `app.update` audit event. The app page shows it above
the builds; the app's card shows the first two lines.

**Consequences.** No history beyond the audit log. If editing should be
limited to admins later, it's one check in the handler. Plain text only: no
Markdown, so nothing to sanitize.

## 130. Chrome and Chromium start without the welcome screens and as the default browser

**Context.** Every session of a browser build (the `chromium` source, Google
Chrome uploads) opened on Chrome's "Welcome to Chrome" flow: terms, sign-in,
notifications, default browser. With a fresh device per session that is the
same clicks every time, and links from other apps asked which browser to use.

**Decision.** After each install of the session's APK the agent writes
`chrome-command-line` with `--disable-fre --no-default-browser-check
--disable-search-engine-choice-screen` to both `/data/local/tmp` (read by
userdebug images and debuggable builds) and `/data/local` (read otherwise,
root-only, so phones go through `su`), and runs
`cmd role add-role-holder android.app.role.BROWSER <package>`. Both are
best effort and harmless for apps that aren't browsers: the file is only read
by Chrome and Chromium, and the role is refused for a package without a
browser activity. Runtime permissions were already granted by `install -g`.

**Consequences.** No APK change and no UI automation. The flags file stays on
the device for the whole session, so a second browser installed by hand
skips its welcome screens too. Per-site permission prompts (camera,
location) still come from the page and stay.

## 131. Sessions start unlocked

**Context.** With the lock screen overlay of decision #101 enabled at boot,
redroid on Android 12 and later boots onto the keyguard. The app was started
behind it, and the keyguard's own 10-second activity timeout put the screen
to sleep a few seconds after the session became ready, so every session
opened on a dark, locked device.

**Decision.** On a fresh session (not a resume) the agent runs the device
control `unlock` (wake and `wm dismiss-keyguard`, the PIN script on Android
11) right before it starts the app. The overlay stays enabled at boot, since
enabling it later is what put the screen to sleep with the first lock.

**Consequences.** A resumed agent leaves the screen as it was. Phones run the
plain wake and dismiss, which they already get from their own setup.

## 132. Network regions shape a path per CDN or server, minus the session's route

**Context.** Testers want to see an app the way its users in a given country
see it, Bangladesh being the first ask: not just a slow link, but the round
trips to the CDN edge serving that country and to servers far away, which
differ a lot (a cached image from Dhaka or Singapore, an API call to
Frankfurt). The conditions of decision #93 add one delay to all traffic, and
their panel in the network card had grown too large for a hover panel.

**Decision.** The conditions move into a **Network** tab next to DevTools;
the network card links there. `internal/netem` gains a catalog of regions
(a typical mobile link, the CDN edge and its round trip, a round trip to
each of seven server locations, rounded from public speed reports and
latency maps) and the agent takes a region on top of the access profile
(`DeviceSettings.networkRegion`). The tun's qdiscs become an `htb` class per
direction for the bandwidth, with a `netem` class under it per path: edge
(the IPv4 ranges Cloudflare, Fastly and Google publish, Google's without
Google Cloud's, kept in `internal/netem/cdn.txt`, plus DNS) and origin
(everything else). Hosts the user lists as backends are resolved by the
agent and matched first, so an API behind Cloudflare takes the servers'
path. `u32` filters, a few hundred, go through one `tc -batch`. Emulation
can only add delay and the session's route through its VPN location already
takes some, so the agent measures it through the sidecar's proxy (the
fastest of three requests on a kept-alive connection to Cloudflare's
`1.1.1.1` and to AWS's DynamoDB endpoint in the server's region), adds only
what's left of each path, again every minute and after a location change,
and reports region, route and added time per path. With the access profile
at no limits, the region's typical mobile link is used.

**Consequences.** A route already slower than the region can't be made
faster; the tab says so and a closer VPN location, or none, is the fix.
Backends are resolved with the agent's DNS, not the sidecar's, so
geo-DNS answers may differ from what the device gets. A CDN shares
addresses among its customers, so hosts next to a listed backend take the
servers' path too; telling them apart would need fake IPs per domain in
sing-box. IPv6 isn't classified (it takes the servers' path). Nodes now
also need `sch_htb`. `cdn.txt` is refreshed by hand from the three
providers' lists. Per-request latency of particular endpoints (server
think time, errors) is a different layer and not part of this.

## 133. The agent answers a session's DNS: a log, rewrites, a TTL limit and saved sets

**Context.** Testers wanted to see which names an app looks up and when, to
point an API at another server or make a host fail without touching the
APK, and to keep Android from answering out of its cache. The sidecar
hijacked DNS into sing-box's own resolver, which caches and logs nothing a
user can see; Android in redroid also used DNS over TLS to `vpn.dns`
(Private DNS is opportunistic by default), which no hijack sees.

**Decision.**
- sing-box no longer answers DNS: a route rule sends sniffed DNS unchanged
  (`override_address` 127.0.0.1:10053) through a `direct` outbound bound to
  `lo` to the agent, and a `direct` inbound on 127.0.0.1:10054 with
  `override_address: vpn.dns` routed to the selector carries the agent's
  own queries out through the location. Checked with sing-box 1.14.2 and a
  tun in Docker.
- The forwarder is `internal/agent/dns` on `golang.org/x/net/dns/dnsmessage`
  (already a dependency, no new library): it logs every query, answers
  rewrites (addresses, block as `0.0.0.0`, CNAME with the target's `A`
  records looked up upstream, NXDOMAIN) and `AAAA` itself, caps TTLs in the
  wire message in place (the `SOA` minimum too, for negative caching) and
  forwards the rest over UDP or TCP as it came. It keeps no cache: Android's
  is the only one, and the TTL limit decides what it keeps.
- Android's cache is cleared through `IDnsResolver.flushNetworkCache`, which
  has no shell command: `service call dnsresolver 11 i32 <netId>` as root.
  11 is its place in the stable AIDL (append-only, Android 11+). Checked on
  Android 15 in a live session: the next lookup went to the upstream again.
  Changing the rewrites clears it, so a rule applies at once.
- The agent turns Private DNS off at boot in these sessions.
- Saved sets are per-user rows of `dns_presets` in the api's database
  (validated with the agent's rules) and never load by themselves: a new
  session starts with an empty cache and no rewrites. With `database.type:
  memory` they are gone after a restart, which loses no session.
- Recordings get `dns` events: the settings at the start and after each
  change, every query and each cache clear.

**Consequences.** Every device lookup now takes a hop through the agent
(well under a millisecond; the upstream round trip dominates), and DNS
stops while the agent restarts. Only redroid sessions with a VPN sidecar
have it: physical phones resolve through their own sing-box
(`RenderProxy`), and sessions without a VPN go straight to the Pod's
resolver. Apps' own caches (Chromium's host cache in WebViews, about a
minute) and open connections aren't affected by a flush.

## 134. The session's route is measured all the time and shown against every network

**Context.** Every emulated network comes on top of the session's route
through its VPN location. Decision #132 measured that route only for a
region, and only to its server location. Without a region, "5G" behind a
VPN location far away adds 25 ms to a route that may already take 150, and
a 150 Mbit/s profile can't beat a tunnel that carries 20; the tab said
neither.

**Decision.** The agent measures the route from the start of the session
until it ends, whatever is emulated: round trips to Cloudflare's edge and
to all seven server locations every minute, through the sidecar's proxy as
before, and the bandwidth with a 10 MB download from `speed.cloudflare.com`
(cut off after 10 s) at the start and after a location change, retried each
minute until one works. `DeviceState.networkRoute` reports it; a region
takes its baselines from it and is re-applied when it moves by 10 ms or
more. The profiles keep adding their delay rather than subtracting the
route: a profile is the access link, a different leg from the route to
the servers, and subtracting it would make "5G" mean something else behind
every location. The tab instead shows the expected round trip to a CDN
edge per profile and marks a profile whose own round trip is shorter than
the route's, or whose bandwidth is above the route's, and a region or
server location the route is slower to than the region's users. Marked
choices stay selectable.

**Consequences.** A session's agent keeps eight probes a minute and a
10 MB download per location change going through its VPN location, which
counts against the location's traffic. The bandwidth test measures one TCP
connection to the nearest Cloudflare edge, slow start included, so it
reads a little low. Setting a region no longer waits for a measurement;
until the first one the region is applied without subtracting the route.

## 135. A region's backends are matched by the device's DNS answers and take wildcards

**Context.** Decision #132 resolved a region's backends with the agent's
own DNS. An app's API often spans many names (`api.`, `auth.`, regional
hosts), which the tester wants to write once as `*.example.com`, and a
backend whose DNS answers depend on where it is asked from may get other
addresses than the device. Testers also had to type the list again in
every session.

**Decision.** Backends may be `*.name` (every name below it, as DNS
rewrites match, decision #133). Since the agent answers the session's DNS,
it follows its own log: an A answer to a query whose name matches a backend
adds those addresses to the region, and the qdiscs are re-applied a second
later, coalescing a burst of lookups. Exact names are still resolved when
the region is set, so they are shaped before the first lookup. The
learned addresses are dropped when the region or its backends change.
`NetworkRegionState.addresses` lists what is matched. The UI saves the list
per app package in `localStorage` and sends it when a region is picked in
that app's next session; nothing is kept on the server.

**Consequences.** The first connections to a new address may leave before
its filter is in (about a second), on the CDN path. Addresses are kept for
the region's lifetime, not expired with the DNS TTL. A backend the app
reaches without DNS (a hard-coded IP, DNS over HTTPS) is matched only when
listed by address. The list follows the browser, not the account.

## 136. New sessions start from the last route measured through their location

**Context.** With decision #134 the Network tab said "Measuring…" for the
first 10–20 seconds after a session became ready, a region was applied
without subtracting the route until then, and every session downloaded
10 MB to measure a bandwidth that hardly changes. Region backends were kept
only in the browser (decision #135).

**Decision.** The agent measures the route from its start, while Android
boots, retrying every 3 seconds until a measurement works (the agent starts
before the sidecar's proxy listens), and publishes the round trips before
the bandwidth test. Every
5 minutes the api asks ready sessions' agents for their route
(`GET /v1/network` now carries it) and keeps the newest per provider and
location in its database. Creating a session passes the cached route in
`CreateSession.route`; the emulator provider hands it to the agent, which
starts from it and skips the bandwidth test while the cached one is younger
than six hours. Region backends are kept per user and app in the database
when it is `sqlite` (`/api/v1/network-backends/{package}`) and in
`localStorage` when it is `memory`, where they would be lost on the next
restart.

**Consequences.** The route cache is a cache: with `memory` it is gone
after a restart and the next session measures from scratch, so no feature
depends on it. A cached route can be up to 5 minutes plus its age old; the
agent replaces the round trips within seconds. Phones measure no route, so
they neither feed nor use the cache. Backends follow the account with
`sqlite` and the browser with `memory`.

## 137. A VPN location can be the default for chosen apps

**Context.** One deployment wants most sessions to start in one country
while an app built for another market should start in that market.
`vpn.default` is a single location for the whole provider.

**Decision.** A location lists the packages it is the default for
(`vpn.locations[].defaultFor`). The provider starts a session without a
chosen location in its package's location, or else in `vpn.default`; the
list rides in `Capabilities.locations[].defaultFor`, so the launch dialog
and quick launch preselect it ahead of the location remembered in the
browser. It is a list under the location rather than a package → location
map because koanf splits keys on dots, which package names contain.

**Consequences.** An app's configured location beats the last one used
with that provider; picking another one in the dialog still works for that
launch. A package may sit under one location only (validated).

## 138. Pixel perfect names differences by native views, read with uiautomator

Extends #106 and #107.

**Context.** #107 ties a difference to its element only inside a WebView.
Most screens are native Views or Compose, where a tester still had to find
"the box at 240, 1180" in the app's code by hand.

**Decision.**

- **The agent dumps the view tree with `uiautomator dump`** to a temporary
  file under `/data/local/tmp`, reads it and removes it, and serves the
  nodes flattened depth first at `GET /v1/device/ui` (class, resource id,
  text, content description, package, clickable, bounds in device pixels of
  the current rotation). It is the stock tool on every Android image,
  needs no root, no app change and no accessibility service of ours, and
  Compose exposes its semantics through it (resource ids only with
  `testTagsAsResourceId`, texts and descriptions always). Layout Inspector's
  protocol would give paddings and colours but needs a debuggable app.
- **It fails while the screen keeps animating** ("could not get idle
  state"): the agent answers 423 with uiautomator's message, and the tab
  says the views couldn't be read and compares by pixels as before.
- **A frozen frame reads the views when it freezes**, like the WebView
  snapshot, so a toast's view is named after it is gone.
- **Regions take the view that fits best**, by the same score as page
  elements (#107); a WebView's own element wins over the native WebView
  around it. Pointing at a difference outlines its view over the screen in
  the browser; Android has no overlay to draw it on the device.
- **On by default**: it costs one or two seconds, runs next to the
  screenshot, and doesn't touch the app.

**Consequences.** Views drawn without bounds (custom canvases, games) aren't
listed. uiautomator holds the UiAutomation connection while it dumps, so a
test framework using it at the same moment (Appium, Espresso's UiDevice)
can fail that call.

## 139. Pixel perfect imports frames from Figma with their layers

Extends #106 and #109.

**Context.** Testers exported frames from Figma by hand, and a reference was
only pixels: the tab could say where the screen differs, not what the design
asks for there.

**Decision.**

- **The api imports a frame by its link** (`POST /api/v1/pixel-perfect/figma`,
  Copy link to selection in Figma, or pasted into the tab): it reads the
  node with `GET /v1/files/{key}/nodes`, renders it with `GET /v1/images/{key}`
  as SVG with outlined text (or PNG at 3×), downloads the picture and a small
  PNG for the thumbnail, and stores them like an upload, so quota, retention
  and the comparison are unchanged. Plain `net/http` against two endpoints,
  like OpenBao (#12).
- **The api calls Figma, not the browser**: Figma's rendered images live on
  its storage without CORS, and a server token must not reach browsers.
  It is the user's own request for one file, not a sync of artifacts, so it
  doesn't belong in a sync job (#43).
- **Tokens**: `pixelPerfect.figma.token` (a secret reference) serves everyone;
  without it each user gives a personal access token, kept in their browser
  and sent only with an import or an update, never stored by the server.
- **Layers are kept next to the image** as `<id>.layers`: the visible layers
  under the frame (up to 4000), depth first, with boxes in the frame's units
  relative to its corner, the top solid fill and stroke, radius, opacity,
  font and auto layout padding and gap. Boxes are placed over the screen with
  the reference's own placement, so moving or scaling the mockup moves them.
- **A region takes the layer that fits it best**, and that layer takes the
  page element or native view whose box overlaps it most (IoU above 0.45) as
  its implementation; edges and sizes that differ by half a unit or more are
  listed in the design's units ("width 320 dp instead of 328").
- **Update from Figma** fetches the frame again in place and bumps a
  revision that is part of the image's URL and ETag, keeping the placement
  and ignored areas.

**Consequences.** Figma's units are dp only for a frame drawn at the phone's
width in dp; the tab says "px" for frames wider than 600. Rotated layers use
their bounding boxes. An import uses three Figma API calls (Tier 1 rate
limits), so a busy server token may need users' own tokens.

## 140. Android 11 sends its sound as AAC

**Context.** Device audio and the sound of recordings were missing on
Android 11. Capture itself works there (remote submix, shell in the
foreground), but redroid 11 lists `c2.android.opus.encoder` and fails to
create it (`Failed to initialize audio/opus, error 0xfffffffe`), so the
scrcpy server reports no audio. `c2.android.aac.encoder` works.

**Decision.** The agent reads `ro.build.version.sdk` once and starts audio
servers with `audio_codec=aac` on SDK 30 and below, Opus otherwise. The
browser takes the codec from the stream's codec id and configures
WebCodecs with `mp4a.40.2` and the AudioSpecificConfig of the config packet
as its description. Recordings keep the codec of the run: AAC goes into
fragmented MP4 as `mp4a` with the stream's sample rate as the time scale
and 1024-sample frames, and the manifest's `audio[].codec` says `aac`;
the player and the video export read it through mediabunny unchanged.

**Consequences.** A browser without an AAC decoder (some Firefox builds on
Linux) gets "can't play AAC" for Android 11 instead of sound. AAC frames
lean on the one before, so each 10 s segment, decoded by itself, starts
with one frame of decoder warm-up.

## 141. Figma tokens are kept with the account, encrypted

Extends #139.

**Context.** #139 kept a user's Figma token only in their browser, so it
had to be entered again in every browser, and the tab's small form was the
only place to manage it.

**Decision.**

- **The api keeps the token in its database** (`figma_tokens`, one per user)
  when the database is `sqlite` and `auth.sessionKey` is set, sealed with
  AES-GCM under a key derived from `auth.sessionKey` by HKDF-SHA256 (purpose
  `holtdroid figma-token`) with the user as associated data, so a row can't
  be moved to another user. No new key to configure: `auth.sessionKey` is
  already the secret every replica shares; `mode: header` now loads it too
  when it is set. The token never leaves the api again: the UI sees the
  Figma handle and the last four characters.
- **It is checked before it is kept** with Figma's `GET /v1/me`, which needs
  the Current user scope; the guide asks for it.
- **Otherwise the browser keeps it**, as before: with an in-memory database
  it would be gone on the next restart (the rule for `memory`), and without
  a session key there is nothing stable to encrypt with. The same endpoint
  then only checks the token.
- **Imports use** the token sent with the request (the browser's), then the
  account's, then `pixelPerfect.figma.token`. Deleting a user deletes theirs.
- **A Pixel perfect page** (`/pixel-perfect`) manages references outside a
  session, the token with a step-by-step guide (also on the Account page in
  the `users` mode) and the tab's defaults, which stay per browser.

**Consequences.** Rotating `auth.sessionKey` makes saved tokens unreadable;
the api treats them as missing and users save them again. The api now holds
user credentials for a third party, readable by whoever has both the
database and the session key.

## 142. A launch carries the device theme

**Context.** With the device theme set to follow the portal's, the session
page switched Android's dark theme as soon as the screen appeared, which is
the moment the agent starts the app. The `uiMode` change makes apps recreate
their activity in the middle of a cold start; Chrome then sometimes stays on
its splash screen for good.

**Decision.** The UI sends `darkMode` with `POST /api/v1/sessions` when the
theme follows the portal's; it travels in `CreateSession.darkMode` to the
agent (`HOLTDROID_DARKMODE` on emulators, the phone provider's agent config),
which sets it after installing the app and before starting it. A manual
theme sends nothing and the device keeps its own.

**Consequences.** On a fresh session the page finds the theme already
matching and changes nothing. Turning the theme by hand while an app is
starting can still interrupt its start, as on a real phone.

## 143. Chrome's DoH is off by policy, and DoH servers' names don't resolve

**Context.** The DNS log (decision #133) showed Chrome looking up
`chrome.cloudflare-dns.com` and then nothing for the pages it loaded:
redroid hands Android 1.1.1.1 as its DNS server, and Chrome's Secure DNS,
automatic by default, upgrades a system resolver on its provider list to
that provider's DoH. Rewrites didn't reach Chrome. Chromium has no
`DnsOverHttps` feature to turn off any more: the automatic mode is set
unconditionally in `default_dns_over_https_config_source.cc`. WebView never
configures DoH (only `//chrome` calls `ConfigureStubHostResolver`).

**Decision.**
- The agent's `chrome-command-line` (decision #130) also carries
  `--policy='{"DnsOverHttpsMode":"off"}'`; Chrome's tokenizer keeps the
  quoted JSON. The command-line policy provider exists on debuggable
  devices only and refuses Stable and Beta, so it covers Chromium builds,
  Dev and Canary.
- For the rest, the forwarder answers `NXDOMAIN` for the names of
  well-known DoH and DoT servers (Chrome's upgrade list from
  `doh_provider_entry.cc` plus the ones apps bundle most), logged as
  `blocked`. Chrome's automatic mode and most DoH libraries fall back to the
  system resolver when their server doesn't resolve. `allowEncrypted` in the
  DNS settings (the **Block DoH** switch) lets them through; a rewrite of
  the same name wins over the block.

**Consequences.** Secure DNS is off in every Chrome or Chromium session,
with or without a VPN. Handing Android a DNS address that isn't on Chrome's
list would stop the upgrade without flags or blocks, but that is a change
to the holtdroid-redroid image; it stays an option. DoH to an IP literal and
servers missing from the list still bypass the log.

## 144. App data is saved at the end of a session only when asked for

Supersedes the "stopping a session saves first" part of #49.

**Context.** Saving on every Stop and reap filled each user's saves with
states nobody wanted to keep (retention counts per app, so they pushed the
wanted ones out), and made every Stop wait for the export.

**Decision.** `POST /api/v1/sessions` takes `saveAppData`, passed to the
provider as `CreateSession.saveAppData` and kept on the `Session` (the
emulator in a Pod annotation, the physical provider in its state file), so
the api still knows it after a restart. Stop and the reaper save only for
such sessions; **Save app data now** works for every session. The launch
dialog's checkbox is off by default and remembered in the browser, and
`useLaunch` reads it, so quick launch and launch links follow it too.

**Consequences.** A user who never ticks the box gets saves only by hand.
The choice is per browser, not per account.

## 145. Figma frames come as PNG with components that can be hidden

Extends #139.

**Context.** Figma's SVG export turns corner smoothing (iOS-style
superellipses) into plain rounded corners and drops background blur, so an
SVG reference differs from the design exactly where testers look. A frame
also often holds a placeholder for live content (a video, a camera picture,
a map) that covers what the app shows there and spoils the overlay.

**Decision.**

- **PNG is the default**, rendered by Figma at up to 4× (lower for frames
  over 24 megapixels at 4×). A pixel or two of resampling to the screen's
  density matters less than Figma's own rendering. SVG stays an option.
- **Up to 20 components are rendered on their own**, in the same
  `/v1/images` call for all of them, at the frame's scale, placed by their
  `absoluteRenderBounds` so shadows come along. They are the frame's
  children, the largest splittable one replaced by its children while the
  count stays within 20. A node is splittable when drawing its children one
  by one gives the same picture: a frame, group, component or instance with
  no fill, stroke, effect, clipping, mask, opacity or blend mode of its own.
  A frame with more than 20 children keeps them, up to 60; beyond that there
  are no components. Rendering arbitrary sets of siblings isn't possible
  through the API, so grouping is limited to the file's own nesting.
- **The browser redraws the frame** from its background colour and the
  visible components in order, only when something is hidden; otherwise the
  overlay and the comparison use Figma's rendering of the whole frame. A
  frame is redrawable when its own fills are solid colours and no mask spans
  its children. Hidden components are kept with the reference
  (`hidden` in `PUT …/{id}`, unchanged when left out) and their places are
  skipped by the comparison unless the user turns that off.
- **Live content is only suggested**: parts with an image or video fill or a
  telling name are marked, and one button hides them; nothing is hidden by
  default.
- **Pictures are kept as `<id>.part-NN`**, served at
  `GET …/{id}/components/{n}` (immutable, with the revision in the URL) and
  counted towards the quota with the image.

**Consequences.** A redrawn frame can differ from Figma's rendering where
parts interact: background blur and blend modes across parts, or a part
that a hidden part's shadow fell on. An import takes one more Figma call
and a few more MB of storage. References imported before keep working
without components until updated from Figma.

## 146. The microphone is replaced through an AudioPolicy, fed by the agent

**Context.** redroid has no microphone: its stub audio HAL records silence,
so apps with voice input, speech recognition or calls can't be tested. The
maintainer asked for a test signal, a pre-recorded file and the browser's own
microphone. A virtual sound card (snd-aloop) would be a node kernel module
and a new audio HAL per Android version; a Frida hook on `AudioRecord` misses
native and WebView recordings.

**Decision.**

- `Mic.java` (in `tools.dex`, run by root through `app_process`) registers
  an `AudioPolicy` with one loop-back `AudioMix` that matches every capture
  preset (default, mic, camcorder, voice recognition and communication,
  unprocessed, performance), so every recording reads a remote submix. It
  plays what it gets on a `localabstract` socket into
  `createAudioTrackSource(mix)`: signed 16-bit stereo at 48 kHz. Remote
  submix is already there for scrcpy's capture. `registerAudioPolicyStatic`
  doesn't exist, so the helper calls `IAudioService.registerAudioPolicy`
  itself, its arguments filled by type (Android 15 added an
  `AttributionSource`). When the helper exits, binder death unregisters the
  policy and recordings are silent again. Checked on Android 11 and 15: a
  scrcpy `audio_source=mic` capture reads exactly the tone that was sent.
- The agent (`internal/agent/microphone.go`) runs one source at a time:
  ffmpeg (`-re`, in the session image) for the line-up tone (1 kHz at
  -18 dBFS, ffmpeg's default sine level), beeps (100 ms each second, for
  delay), pink noise and files on repeat; or the browser's samples from
  `WS /microphone/browser` (mono, duplicated to stereo). It is offered only
  on redroid; phones keep their own microphone, which is denied to the app
  under test (#72).
- Files come from a **media library** in the api, built like the Pixel
  perfect references (#106): `media/<user>/<id>.json|.bin` in the storage,
  `media.quota` (5 GiB) per user, per role and per user (`mediaQuota`, a
  `users` column), `media.maxFileSize` (1 GiB). Files are kept as uploaded,
  and ffmpeg resamples. `PUT /api/v1/sessions/{provider}/{id}/microphone`
  checks ownership and hands the agent an internal URL of the file; the
  proxy refuses `PUT /v1/microphone` from browsers, like `/v1/install`.
- No aspect ratio or quality settings: Android asks for the rate and
  channels it records at, and AudioFlinger converts from the mix.

**Consequences.** One ffmpeg (about 5% of a core for a signal, more for a
video file) and one helper per session while a source plays; nothing when
it is off. The browser's microphone costs about 100 KB/s up. The camera is
a separate problem: redroid has no camera HAL to feed (the recon on
Android 15's `virtual_camera` is in the status).

## 147. Pixel perfect lays references out in a work area, with grids and guides

Extends #106.

**Context.** The reference always filled the whole screen's width, while
designs are usually drawn without the system bars or for one part of the
screen, and testers want the layout grid and guides they have in Figma. The
tab had also grown into a column of six cards that was hard to follow.

**Decision.**

- **A work area per reference**: the whole screen, insets in dp, or a
  rectangle drawn as fractions of the screen. Insets in dp are the default
  way to describe it, since they fit every size and density; the tab can read
  them from the app's window in a uiautomator dump (#138). The reference is
  fitted to the area, its placement stays in the image's own pixels, and the
  comparison skips everything outside the area by adding it to the ignored
  mask, so the match counts only what is inside.
- **Grid and guides in dp from the area's corner**: columns with margin and
  gutter, baseline rows, and guides dragged from rulers or typed in. Moving
  the reference snaps its edges and centre to the area, the columns and the
  guides within 6 screen pixels. dp come from the device's density and the
  stream's size; without a known density a screen is taken as 360 dp wide.
- **Stored with the reference** (`layout` in `PUT …/{id}`, unchanged when
  left out) and as **presets per user** in `pixel-perfect/<user>/presets.json`
  in the references' storage, replaced as a whole by `PUT …/presets`. Storage
  rather than the database, so presets survive with `memory` like the
  references they go with.
- **The tab is rebuilt** around a toolbar (reference list in a popover, eye,
  opacity, blend, Freeze, settings, Find differences) and three tabs: Layout,
  Components (or Skip areas) and Differences. The comparison's switches move
  into a settings popover with one-line hints; Find differences opens the
  Differences tab.

**Consequences.** References keep working as before with the whole screen
as their area. A drawn area is in fractions of the screen, so it doesn't
carry over between screens of other proportions; insets do. Presets are
copied into a reference when applied, so changing a preset later doesn't move
references laid out with it.

## 148. Figma frames are always imported as PNG

Supersedes the SVG option of #139 and #145.

**Context.** Since #145 components are rendered as PNG and the frame is
redrawn from them, so an SVG frame would be mixed with PNG parts, and SVG
loses corner smoothing and background blur anyway. The choice only confused.

**Decision.** The import takes no format: the frame is always Figma's PNG at
the scale of #145. `format` is gone from the import request and from
`FigmaSource`; a reference imported as SVG becomes a PNG on its next
**Update from Figma**. Uploaded SVG files stay supported.

**Consequences.** A Figma reference is resampled to the screen's density
instead of drawn at it, a pixel or two at most, which the comparison's
anti-aliasing tolerance absorbs.

## 149. Figma components follow what the design means as one thing

Refines #145.

**Context.** #145 split the largest plain group while there was room for 20
parts, so a frame with few top-level parts was split down to the layers of a
40 dp timer (text, ring, border, background), and a grid of bet buttons came
apart into its cells. Cards with small icon images were all marked live.

**Decision.** A node is split only if, besides adding nothing of its own:

- it isn't a component instance, unless it covers at least half of the frame
  (a whole screen built as one instance);
- it covers at least 5% of the frame;
- it isn't a list or grid: at least three items, looking through plain
  frames and groups (rows), of which three quarters or more are instances
  of one component (`componentId`) or layers of one name.

The live hint needs an image or video fill over at least half of the part,
or a telling name.

**Consequences.** Frames are split into fewer, larger parts, sometimes fewer
than 20. A grid whose cells are different components still comes apart; the
eye on a whole grid hides all of it. Existing references are regrouped on
their next Update from Figma.

## 150. The api runs Litestream's compactions itself and stops them before closing

**Context.** `TestPersistence` failed now and then under `-race`.
Litestream v0.5.17's `Store.Close` closes its databases before it cancels
and waits for its compaction monitors. A snapshot started by a monitor (the
snapshot level runs as soon as the store opens) reads the database file in
a goroutine of its own while `DB.Close` sets that file to nil. The race
detector reports it, and the snapshot fails with "read database page N:
invalid argument". In production it happens at shutdown and loses that
snapshot.

**Decision.** Builds on #102. The store opens with
`CompactionMonitorEnabled: false`, and the api runs one loop per
compaction level and for snapshots, calling the store's own `CompactDB`
and `EnforceSnapshotRetention` on Litestream's schedule.
`db.DB.Close` stops the loops and waits for the compaction in flight to
finish before the final sync and `Store.Close`. The compaction is cancelled
only when the 30-second close timeout runs out.

**Consequences.** A short schedule loop lives in `internal/db/open.go`
instead of Litestream. It can go once Litestream stops its monitors before
it closes its databases. A slow upload at shutdown now delays the close, up
to the timeout, instead of failing.

## 151. A Routes tab follows the device's connections and places their servers

_Reading the clash API once a second is superseded by #153 (sing-box's API service on redroid, every 250 ms on phones); the rest stands._

**Context.** Testers asked where an app's requests actually go: which
servers a name leads to, in which country and network, through which VPN
location, and what makes a path slower than it needs to be — a server on
another continent than the session's exit, geo-DNS answering for the wrong
place, an app that opens a new connection for every request. The DevTools
network (decision #112) covers only WebViews, the DNS log (decision #133)
only names, and the route measurement (decision #134) only fixed probes.

**Decision.**
- The agent asks the VPN sidecar's clash API for its open connections
  every second (`internal/agent/conns`) and drops the agent's own (the
  `agent` and `dns-upstream` inbounds) and the DNS forwarding (the
  `dns-forwarder` outbound). A connection gets a line when it first shows,
  again at most every 10 s while its traffic grows, and when it is gone:
  `GET /v1/connections/events` (the open ones and the last 2000 closed
  first) and `connection` events in recordings, where the latest line of
  each wins. Each line has the sniffed name, the server's address and
  port, TCP or UDP, the outbound it left through and the bytes so far.
- The api places addresses with DB-IP Lite's country and ASN databases
  (MaxMind format, CC BY 4.0, read with `oschwald/maxminddb-golang`),
  downloaded into the api image at build time (`geoIP.country`,
  `geoIP.asn`; a missing file only leaves its fields empty), and marks the
  CDN edges of `internal/netem/cdn.txt` and private addresses:
  `POST /api/v1/ip-info`, and `POST /api/v1/shared/{token}/ip-info` for a
  recording opened through a share link. Lookups happen when the page
  shows them, so recordings carry no places and old ones get them too.
- The **Routes** tab, in sessions and in the player, groups connections by
  name and shows the path: the device, the location, its exit address and
  country, the servers. It flags a server on another continent than the
  exit (never a CDN edge: its anycast address says nothing about the site
  that answers), six or more TCP connections to one port within a minute
  (no reuse), traffic that left past the VPN location, and plain HTTP. A
  name's details list its servers, its DNS answers with their places and,
  in recordings, the median connect, TLS and waiting times of its WebView
  requests. The DNS tab places each `A` answer and marks a lookup whose
  answers are all on another continent than the exit.

**Considered.** A traceroute to each server: from inside the session it
stops at the tunnel (ICMP and TTL don't cross SOCKS or the WireGuard
exit), and the exit belongs to the VPN, so only an outside service (RIPE
Atlas, Globalping) could trace from there; left for later, off by default,
since it sends the app's hosts elsewhere. Timing every server through the
sidecar's proxy: a handshake through it mixes the tunnel's and the
server's round trips and adds traffic through the location for every new
address; the WebView's own timings and decision #134's probes say enough. A city
database for a map: 60 MB more in the image for a picture the country
already gives.

**Consequences.** A connection shorter than a second may be missed or
shown without its last bytes. Places are as current as the image (the
build takes this month's databases) and country-level; an address that
moved since the recording is shown where it is now. The tab exists only
where a sidecar reports connections; sessions without a VPN have none.

## 152. Pixel perfect works on recordings

Extends #96 and #106.

**Context.** Testers often find a layout problem after the fact, in a
recording, when the device is gone. The player draws each frame into a
canvas the size of the screen, the way a live session does.

**Decision.**

- **A screen source** abstracts where the picture comes from: a live session
  (stream snapshots, lossless screenshots, native views, WebView DevTools)
  or a recording (the frame at the playhead, decoded without the touches
  the player draws). The state, the overlay and the panel are shared; the
  panel hides what its source lacks: Freeze, native views, DevTools.
- **Comparing pauses playback** and uses the frame at the playhead; the
  motion mask takes the next frames by seeking the player and comes back.
- **Recordings keep the device's screen** (`screen` in their metadata, from
  the session's capabilities) so dp are exact; older recordings fall back
  to a 360 dp wide screen.
- **Only signed-in viewers** get the tab: references belong to a user, so a
  shared link opened without signing in plays as before.

**Consequences.** A recording's frames are lossy video, so comparisons are
noisier than with a screenshot; the stream quality while recording decides
how much.

## 153. Connections come from sing-box's API service as they open and close

**Context.** Decision #151 read the clash API's open connections once a
second, so a connection that opened and closed between two reads never
showed, and one that closed lost its last second of bytes. Short
connections are often the ones worth seeing: requests without keep-alive,
beacons, one-off calls, the very cases the **no reuse** flag looks for.

**Decision.** The redroid sidecar also runs sing-box's `api` service
(since 1.14, on `127.0.0.1:9091`, no dashboard, no secret: only the Pod
reaches it). The agent streams its `SubscribeConnections` gRPC method,
which sends each connection as it opens and as it closes with its close
time and final bytes, its traffic every second, and on every (re)connect
the open connections and the last 1000 closed ones. The few fields used
are read with `protowire` and a pass-through codec rather than generated
code or sing-box's own module. Reconnects don't repeat a connection the
agent already has. A destination that is a name (a proxy asked for one)
keeps the name and no address. Phones keep the clash API, read every
250 ms: their sing-box runs in the host's network, where each session
would need a port of its own for the service.

**Consequences.** Redroid sessions see every connection, however short,
with its exact times and bytes. Phones may still miss one shorter than a
quarter of a second. The agent depends on a sing-box API that is not
versioned apart from sing-box, pinned at 1.14.2 with the sidecar image;
checked against that version in Docker.

## 154. The Cache tab checks caching in the browser, from the requests' headers

**Context.** Testers want to know whether an app's requests are cached as
intended: that `Cache-Control` is set, that Cloudflare caches what it should
and nothing personal, and that no timestamp in the URL makes every request
new. Recordings already keep every request's headers, its cache source and
the device clock when it was sent (decision #112), but reading that out of
the Network tab request by request doesn't scale. The same question comes
up while the session runs, and the live stream (decision #117) had sockets
only.

**Decision.**

- The analysis is a pure function in the web app (`lib/recording/cache.ts`)
  over `DevToolsRequest`s: rules with a severity, grouped by URL (with the
  timestamp parts left out), each finding listing its requests and the bytes
  a cache could have saved. A timestamp is a URL part `detectStamp` reads as
  a time within an hour of the request's `wall` (the day's date within a day
  and a half); values that differ on every one of three or more requests
  count as cache-busters too. Cloudflare is read from `cf-cache-status`,
  other CDNs from `x-cache`/`x-cache-status`; `CDN-Cache-Control` and
  `Cloudflare-CDN-Cache-Control` set the shared lifetime. Nothing new is
  recorded, so old recordings and `.holtdroid` files get the tab too.
- The agent merges `Network.requestWillBeSentExtraInfo` and
  `responseReceivedExtraInfo` into the request's headers (kept for up to 512
  requests when they come first), since `responseReceived` leaves out
  `Set-Cookie` and the request headers the network stack adds, the ones
  Disable cache sets.
- The live stream carries finished requests without bodies and is renamed
  `GET /v1/devtools/live` (`WatchDevTools`). The agent keeps them in a
  history of their own, 8 MB, so a busy page can't push the socket traffic
  out of its 16 MB and the other way round; a watcher gets both merged in
  `seq` order. The session page's **Cache** tab keeps the newest 5000 and
  analyses them in batches every 300 ms.

**Consequences.** The rules are heuristics: a 10-digit id that happens to
match the time, or a parameter that is meant to differ, can be flagged. The
player analyses the requests up to the playhead again whenever one more
starts. A request served from the WebView's cache has no ExtraInfo, so its
headers are the ones Chromium kept. Live requests carry no bodies, so the
tab only reads headers; the Network tab of the live session's DevTools is
still the place for bodies.

## 155. redroid gets its own camera HAL, fed by the agent and started only on use

Supersedes the camera part of #146's consequences.

**Context.** The maintainer wanted a camera showing a test card, a file or
the browser's camera. redroid has no camera HAL; none of the images we
borrow from has a V4L2 one (so v4l2loopback alone doesn't help); Android
15's `virtual_camera` needs YUV rendering on the GPU, which hangs Intel's
anv through ANGLE (the recon in the status). It had to cost nothing while no
app uses the camera.

**Decision.**

- holtdroid-redroid builds `android.hardware.camera.provider-holtdroid`
  (`build/camera/hal.cpp`) with the NDK against the image's own libraries:
  the AIDL camera provider V1 (accepted by Android 13 to 15) generated with
  `aidl --lang=ndk` from AOSP's frozen interfaces, `camera_metadata` from
  AOSP, `stb_image_write` for JPEG. One LIMITED back camera (sensor at 90°)
  with 1920×1080, 1280×720, 640×480 and 320×240 streams of YUV and JPEG.
  Frames are written by the CPU through `AHardwareBuffer` locks, so no GPU,
  ANGLE or gralloc patch is needed.
- **Lazy on Android 15**: the provider registers with `registerLazyService`, starts once
  at boot so cameraserver enumerates it (`oneshot`, not `disabled`:
  cameraserver doesn't start declared AIDL providers itself), and
  `ro.camera.enableLazyHal` lets cameraserver drop it, so it exits a few
  seconds after the camera closes and init starts it again on the next
  open. Android 13 and 14's cameraserver crashes on a stopped lazy provider
  (a null dereference in `AidlProviderInfo::startProviderInterface`, hit by
  `dumpsys media.camera` and by opening the camera), so there
  `ro.camera.enableLazyHal` stays unset and the HAL stays up, idle.
- **Frames from the agent**: once a stream is configured the HAL connects to
  the abstract Unix socket `@holtdroid-camera` (the Pod's containers share
  it; Android's eBPF firewall refuses TCP from the cameraserver uid with
  `EPERM`), sends `<width> <height> <fps>` for the largest stream and reads
  I420 frames, which it scales into every buffer. Without the agent, or 2 s
  without a frame, it shows plain color bars. The agent (`camera.go`) runs
  one ffmpeg per connection: a test card (`smptehdbars` with the clock),
  black, a media file (images with `-loop 1`, videos on repeat) or the
  browser's JPEG frames from `WS /camera/browser`, scaled to cover, cropped
  at the center and turned a quarter counter-clockwise so the picture is
  upright in portrait. A source switch restarts ffmpeg on the same
  connection; only whole frames reach the HAL.
- The media library (#146) also takes images; the api refuses images for
  the microphone and sounds for the camera.

**Consequences.** Measured on k3s-3 with Camera2 at 1080p: the HAL about
0.1 core and ffmpeg about 0.27 core while a camera is open (a still image
about 0.05: ffmpeg scales it once a second and copies it in between),
nothing when it is closed; on 13 and 14 the idle HAL keeps about 16 MB. Android 11 and 12 (HIDL camera providers) and phones have no
Holtdroid camera. The browser's camera costs 3–7 Mbit/s up at 15 frames a
second.


## 156. Images and SVG tabs: pages report what they draw, the browser measures

**Context.** Testers want to see images an app downloads but doesn't show,
images far bigger than the place they are drawn, formats WebP beats, and
SVG icons that carry six decimals or ship twice. The recorded requests (and
the live stream, decision #154) say what was downloaded, not where a page
draws it, and images were recorded without their bodies.

**Decision.**

- The agent evaluates `internal/agent/imagescan.js` in every page and
  iframe once a second (`Runtime.evaluate`, by value). The script installs
  itself on the window the first time, so a navigation starts over, and
  returns only what changed since the last call: uses of `<img>`
  (`currentSrc`), CSS backgrounds (also `::before`/`::after`, rescanned at
  most every 3 s after a DOM or class/style change), SVG `<image>`, posters
  and image buttons, each with its box, `object-fit`/`background-size`,
  natural size and whether it is shown (rendered and in the viewport) or
  hidden, plus the markup of inline `<svg>` elements new since then (64 KB
  each, 1 MB a document). A use is reported again only when its size
  changes or it comes on screen the first time. The answer is an `images`
  `DevToolsEntry`, recorded and kept live with the requests.
- Image bodies are recorded up to 512 KB; one over that, on the wire or
  cached, gets `bodySkipped: size` rather than a cut file. Live, the agent
  hands out a body by target and request id (`GET /v1/devtools/body`) from
  `Network.getResponseBody` while the WebView keeps it.
- The analyses are pure functions in the web app (`lib/recording/images.ts`,
  `lib/recording/svgpaths.ts`), like the cache's. "Not shown" means no
  shown use within 10 s of the request finishing, decided only once 10 s of
  lines followed it. The size an image needs is the largest use's box (or
  its fitted image) times the screen's density. WebP sizes are measured by
  the viewer's browser (`createImageBitmap`, `OffscreenCanvas.convertToBlob`
  at quality 85), whole and at the needed size, once the tab is open; when
  that can't run, fixed ratios per format stand in and the finding says it
  is a guess. Path data is optimized with svgo's `convertPathData` in the
  browser, loaded on demand; the precision is chosen from the nearest
  `viewBox` or the path's extent (3 digits for a unit, none from 1000).

**Consequences.** One evaluation a second per page costs a little layout
work on the device, more on pages with thousands of elements whose classes
keep changing. Recordings with many images grow by their bodies. Images
drawn only in canvases, CSS masks or `border-image` aren't seen, so they
count as drawn nowhere. Same-process iframes are part of their parent's
DOM, which the script doesn't descend into (superseded by decision #158).
The SVG savings are before
compression, which takes off much of the repetition. Live, a body the
WebView already dropped (past its 32 MB of buffered responses) can't be
measured or searched.

## 157. CDN addresses show anycast and the site that answered, not a country

**Context.** The Routes tab (decision #151) placed every address with
DB-IP. An address of Cloudflare, Fastly or Google is anycast: hundreds of
sites announce it and the nearest answers, but the database lists where it
is registered. A tester in Lithuania saw a Cloudflare address in Canada
that answered in 8 ms.

**Decision.**
- `cdn.txt` marks each provider's section (`# section: cloudflare`), and
  `IPInfo.cdn` names the provider instead of a yes or no. The tab shows
  **anycast**, the provider and, when known, the site, never the
  registered country; the country summary leaves CDN addresses out.
- For each Cloudflare address the device reaches, the agent asks
  `/cdn-cgi/trace` once per address and VPN location, through the
  sidecar's proxy so it goes out where the device's traffic does: from
  the address itself, as `www.cloudflare.com` (any Cloudflare address
  serves it, and the site is picked by the route to the address, not the
  zone), and, when that fails, from the connection's own host. Two at a
  time, at most 300 a session. Cloudflare answers that path at the edge
  with `colo=VNO`; the request never reaches the app's servers. Asking
  each host first, as the change shipped, left most rows without a site:
  many zones don't answer it. The code goes on the address's connections
  as `edge` (live and in recordings).
- The player also reads the site from the WebView's response headers:
  `cf-ray` (Cloudflare), `x-amz-cf-pop` (CloudFront), the last cache in
  `x-served-by` (Fastly).
- Codes are named by a table in the web client taken from the names of
  Cloudflare's data centers on its status page; Fastly and CloudFront use
  the same airport codes.

**Consequences.** Native traffic to Fastly and Google gets no site (their
edges have no such endpoint and TLS hides the headers), only **anycast**.
The probe is one request per host and location through the location,
visible in the host's Cloudflare analytics. The site table is refreshed by
hand like `cdn.txt`. A site the table doesn't know shows its code.


## 158. Every frame's images are scanned, and on screen means the phone's screen

**Context.** Decision #156 evaluated the image scan in each target's main
document only. Android WebView keeps most iframes in the page's process,
so they are no target of their own, and their images, loaded through the
page's target, were flagged as drawn nowhere. Checking the viewport from
inside an iframe would also call an image on screen while the iframe
itself is scrolled away.

**Decision.** The agent keeps each target's default execution contexts
(`Runtime.executionContextCreated` with `auxData.isDefault`, dropped on
`executionContextDestroyed` and `executionContextsCleared`) and evaluates
`imagescan.js` in each by `contextId`, which reaches cross-origin frames the
page's script can't. Each `images` line carries the frame's id (`frame`), and
the analysis tells elements apart by target, frame and element number. The
script decides "shown" with an `IntersectionObserver` without a root, whose
implicit root is the top-level viewport, so an iframe's clipping and
position count; without one it falls back to the frame's own viewport.
A target without known contexts is scanned as before.

**Consequences.** An image is reported on screen a second after it gets
there, once the observer has called back. A page with many iframes costs
one evaluation per frame per second.


## 159. The image scan is a launch option, off by default, and can be turned on live

**Context.** The image scan of decisions #156 and #158 runs the agent's own
script in every frame of the app's pages: a global, a `MutationObserver`
and an `IntersectionObserver`. The APK stays untouched (decision #156 keeps
that rule), but the pages don't run quite as they would on a user's phone,
and a tester checking something else shouldn't have that by surprise.

**Decision.** The scan is off unless asked for. The launch dialog has
**Check how pages draw their images**, off by default and remembered in
`localStorage` like the other launch choices; it sends
`CreateSession.imageScan`, which the emulator provider passes as
`HOLTDROID_IMAGESCAN` (and an annotation), the physical provider in the
agent's config and the saved session, and the agent keeps in an atomic
flag. `GET`/`PUT /v1/devtools/images` read and change it while the session
runs. Turned off, the agent evaluates a stop script in each frame that
disconnects the observers and deletes the global. The Images and SVG tabs
stay; without the scan they check the files only and say what is missing,
with **Turn on** and the advice to reload the page in the app. When a
recording starts, the agent takes the script out and puts it back, so the
pages report everything again and the recording knows what was already on
screen. The analysis skips the timing checks for images that finished
loading more than 1.5 s before the first image line.

**Consequences.** A scan turned on live doesn't see how the page loaded
until it is reloaded. An agent restart forgets a scan turned on live; one
from the launch option comes back with it.


## 160. Classic 16:9 is the default screen

**Context.** #84 made HD+ the default as the cheapest to stream. Most
mobile layouts are drawn for a 360×640 CSS px viewport, and testers kept
switching to Classic 16:9 by hand.

**Decision.** Classic 16:9 (1080×1920 at 480 dpi) is first in the built-in
screens, so it is the default in the launch dialog and when a launch names
no screen. A screen the user picked before is still remembered.

**Consequences.** A default session streams 1080p instead of 720p: more CPU
in the session and more bandwidth in the browser.

## 161. Session agents listen on 18580 and 18581

**Context.** Android in a redroid session shares the Pod's network namespace
with the agent and the VPN sidecar. The agent listened on 8080 and 8081, so
publishing a dev server on 8080 failed (`adb reverse`: address already in
use) and the device's `localhost:8080` answered with the agent's 404.

**Decision.** The emulator provider's `agentPort` and `tunnelPort` default
to 18580 and 18581, the ports the physical provider already uses on its
node. The provider reads a session's ports from its Pod's named container
ports, and the chart's NetworkPolicy allows the named ports, so Pods started
before the change keep working.

**Consequences.** 8080 and 8081 are free on emulator sessions. The ports the
session's own programs hold (adb, Frida, the agent, the VPN sidecar's 7890
and 9090) still can't be published there; the docs list them.

## 162. Interactive guides are scenes drawn with the portal's own components

**Context.** The docs site explains configuration and concepts for the
people who run Holtdroid. Testers and developers need how-to pages that show
the portal itself, in plain words and in their language. Screenshots and
videos go stale with every UI change, and embedding the real pages would
drag in the api client, the router and Radix portals that open over the
whole docs page.

**Decision.** Guides are a section of the docs site
(`docs/src/content/docs/guides`, `ru/guides`, `uk/guides`) in English,
Russian and Ukrainian, through Starlight's locales; the other sections stay
English and show Starlight's fallback notice there. Each guide plays a
scenario (`docs/src/guides/scenarios/<id>.ts`) over a scene of the portal
(`docs/src/guides/portal`) drawn from one flat state with the web app's
shadcn primitives, its theme (`web/src/theme.css`) and its presentational
components (choice cards, Android version and screen cards, the WebView
choice, start progress, the shade cards and rows). Pages that fetch data or
open portals are redrawn there with the same classes. A step names a
`data-g` target, an action (click, hover, type, look) and the state after
it, with its caption in each language; the player moves a cursor to the
target, plays the click and applies the state. `<Hint>` in the text
highlights an element or jumps to a step. The guides' CSS is inlined into
the player's bundle, so Tailwind and the portal's variables load only on
guide pages.

**Consequences.** A UI change that a guide shows updates its scene, and the
scenario and pages when the flow changes. `make test` renders every step and
fails when its target is missing or a guide lacks one of the three pages, but
it can't tell that a redrawn page drifted from the real one. Translating the
rest of the docs is separate work.

## 163. Files deletes and creates folders only with a full shell

**Context.** The Files tab's Delete and New folder run `rm -rf` and
`mkdir -p` on paths the user picks. The default `allowlist` shell policy
(#68) refused both, so the buttons were there and always failed.

**Decision.** The allowlist stays read-only plus package operations: on
emulators adbd is root on the node's kernel, and a recursive delete of a
user-chosen path is not a read-only operation. The session page hides
Delete and New folder unless `SlotCapabilities.Shell` says the shell is
`full`, as it does with the Terminal tab.

**Consequences.** Under `allowlist` Files browses, downloads and uploads
(file transfer passes every policy); deleting and creating folders need
`full`.

## 164. Builds of one version for different ABIs launch as one

**Context.** The APKMirror sync stored only x86 Chrome builds, which redroid
needs (decision #119). On the Galaxy A05 they failed with
`INSTALL_FAILED_NO_MATCHING_ABIS`: the launch dialog only warned that the
device "may not run" the APK. Syncing ARM builds as well put two rows per
Chrome version on the app page, and nothing stopped picking the ARM one on
redroid, where Chrome segfaults under ARM translation, or the x86 one on a
phone. The emulator also listed only `x86_64` and `arm64-v8a`, so the 32-bit
x86 Chrome got the warning on redroid, where it runs.

**Decision.** Builds of the same source, package and title (or version name
when there is no title) whose ABIs don't overlap are variants of one build.
The app page shows them as one row with every ABI and a download per
variant. The launch dialog, quick launch and Switch version take the variant
whose ABI comes first in the device's list, so providers list the ABI they
run natively first: redroid now reports `x86_64, x86, arm64-v8a`. A build
that only runs through translation (ARM code on redroid) counts only when
no build of the app runs natively there: then it is a build for phones,
like Chrome 157, which APKMirror has only for ARM. Providers
and phones that run no variant are greyed out and Launch is disabled. The
api checks the same on its side: a launch only goes to providers and slots
that list one of the APK's ABIs (or report none), and installing another
build into a session needs one of the session's ABIs, so launch links and
API clients can't start an x86 build on an ARM phone either.

**Consequences.** Apps that ship only ARM code still launch on redroid
through translation. The translation rule lives in the UI; the api only
refuses ABIs a device can't run at all, so an API client can still start
an ARM Chrome on redroid. Two uploads of one version with overlapping ABIs stay separate
rows. A sync job that wants its x86 and ARM copies merged gives them the
same title. An app's page lists its rows by the highest version code
in each, not by upload date: the sync jobs date a build by its release, so a
new patch of an older milestone would otherwise sit above a newer one.

## 165. The docs site has Documentation and Guides as separate sections, in its own theme

**Context.** Seven groups of interactive guides and nine groups of reference
pages shared one sidebar, so neither was easy to scan. Starlight's default
look made the site read like a generic template rather than a product.

**Decision.** `starlight-sidebar-topics` splits the sidebar into two topics,
Documentation and Guides (`docs/src/topics.mjs`). The header overrides
Starlight's to add a row of section tabs, the sidebar override shows the
same sections on phones, and the page title override puts the sidebar group
and the page's `description` around the title. `docs/src/styles/theme.css`
sets the palette (warm neutrals, the logo's green as the accent), Geist,
a tinted sidebar and quieter navigation; the home page components share its
card style.

**Consequences.** Every page with a sidebar must belong to a topic: a new
top-level directory goes into `topics.mjs`, or the build fails. Every page
should have a `description`, since it is shown under the title. Starlight
upgrades can break the overrides of `Header`, `Sidebar` and `PageTitle`.

## 166. The docs home page is a landing page outside Starlight

**Context.** Starlight's splash template kept the home page inside the
docs' layout: the content column, the docs header and its type scale. Even
restyled (decision #165) it read like another docs page rather than the
front door of the project.

**Decision.** `docs/src/pages/index.astro` replaces `index.mdx` with a
standalone, dark landing page: its own navigation, a hero with the live
portal showcase (the interactive guides' scenes, playing on their own), a
bento grid of features drawn with CSS, the repositories and how they fit,
a get-started block and a footer. It shares only the logo, Geist, the
accent green and the topic links with the docs; its styles live in
`docs/src/styles/landing.css` and `docs/src/components/landing/`. This
supersedes the "home page components share its card style" part of #165.

**Consequences.** The landing page has no Starlight search, language or
theme switcher, and is English only. Its links into the docs are built
with `localized()` from `docs/src/topics.mjs`, so moving a docs page means
updating the landing page too; `make docs` doesn't check them.

## 167. The docs are dark only, laid out like the landing page

**Context.** After the landing page (decision #166) the docs' warm light
theme and header tabs (decision #165) looked like a different site.

**Decision.** The docs use the landing page's palette and are always dark:
`ThemeProvider` is overridden to set `data-theme="dark"` and `ThemeSelect`
renders nothing. The section switch moves from header tabs to a list with
icons at the top of the sidebar (Documentation, Guides, GitHub,
Repositories), the sidebar and the table of contents have no background or
border of their own, and code blocks use `github-dark-default` on the
landing page's card colour. This supersedes the header tabs and the light
palette of #165; the split into topics stays.

**Consequences.** Readers who prefer light pages can't switch. The guides'
portal scenes always render in their dark theme.

## 168. The docs draw their own sidebar list in a centred frame

**Context.** With the sidebar fixed to the left edge, wide screens left the
navigation far from the text, and Starlight's sidebar list has no icons and
opens every group.

**Decision.** Header, sidebar, content and table of contents sit in one
centred frame (`--hd-frame` in `docs/src/styles/theme.css`), the same width
as the landing page's navigation, so the logo stays in the same place
between the two. The `Sidebar` override renders its own list
(`docs/src/components/overrides/SidebarList.astro`) with an icon per
top-level group (`groupIcons` in `docs/src/topics.mjs`); groups start
collapsed and the one holding the current page opens.

**Consequences.** The list reuses Starlight's `SidebarPersister` and
`SidebarRestorePoint`, so it keeps the scroll and open groups across pages,
but a Starlight upgrade that changes them or the layout variables the frame
overrides can break the sidebar. A new top-level group needs an icon in
`groupIcons`, in the same position.

## 169. Diagrams stay in Mermaid, themed and animated by the docs

**Context.** The docs' five diagrams used Mermaid's stock dark theme, which
didn't match the site, and the session state diagram drew an edge from
every starting state to `failed`, which tangled it.

**Decision.** Keep Mermaid: the diagrams stay plain text next to the prose
and need no build tool. `astro.config.mjs` gives it the `base` theme with
the site's colours and Geist, `theme.css` rounds the boxes and runs a
dashed flow along the edges (off with reduced motion), and the state
diagram groups the starting states into one box with a single edge to
`failed`. D2 and React Flow would look better but need a binary in CI or a
client runtime for five diagrams.

**Consequences.** Mermaid class names (`.flowchart-link`, `.transition`,
`.messageLine0`) are what the animation hooks into; a Mermaid upgrade that
renames them stops the animation but leaves the diagrams readable.
Mermaid 12's default `neo` look adds a light drop shadow; the theme sets
`dropShadow: 'none'` and `theme.css` keeps its own dark one. Clicking a
diagram opens it full screen with zoom and pan (`MermaidZoom.astro`,
`@panzoom/panzoom`), since the wide ones are unreadable in the content
column.

## 170. The docs are served from holtdroid.github.io, built from this repository

**Context.** As a project site the docs lived under
`https://holtdroid.github.io/holtdroid/`. GitHub serves the root of
`holtdroid.github.io` only from a repository named `holtdroid.github.io`,
and moving the docs' sources there would split them from the code they
describe, which every change updates together (AGENTS.md).

**Decision.** The sources stay in `docs/`. The `docs` workflow builds them
with `base: /` and pushes the result to `holtdroid/holtdroid.github.io`
(branch `main`, no sources of its own) with a deploy key that can write
only to that repository (`PAGES_DEPLOY_KEY`). This repository's own Pages
site now serves a page that sends every `/holtdroid/…` URL to the same path
on the root, so old links keep working. This supersedes the docs URL in
decision #81.

**Consequences.** Publishing the docs needs the deploy key and its secret;
without them the workflow fails and the published site stays as it was.
Links inside the docs are root-relative (`/start/…`), and anything that
links to the docs from outside uses `https://holtdroid.github.io/`.

## 171. Android 16 runs on the nodes' mainline kernel through shims in its image

**Context.** #84 left Android 16 out: on k3s-3's 6.18 its netd aborted and
system_server never finished booting, and a 6.12 LTS kernel on the session
nodes was the next thing to try. A probe on 2026-10-29 found three places
where Android 16 relies on the Android Common Kernel, and two of them don't
depend on the kernel version, so pinning 6.12 alone would not have helped:
netbpfload refuses kernels outside its built-in list of LTS branches; netd
now creates a BPF map at startup, which needs `CAP_BPF` under the node's
`unprivileged_bpf_disabled=2`; and libcutils uses memfd for ashmem only
when the kernel answers ashmem's ioctls on a memfd (an ACK patch),
otherwise falling back to `/dev/ashmem`, which mainline dropped in 5.18.

**Decision.** holtdroid-redroid's `16` image patches all three with
`KERNEL_COMPAT=on` and the node stays as it is: netbpfload runs with a
`uname()` shim that reports 6.12 on newer kernels, netd's `capabilities`
gain `BPF`, and an `ioctl()` shim answers the ashmem ioctls on memfds the
way ACK does. Init exports the ashmem shim as `LD_PRELOAD` by an absolute
`/system/lib64` path, which APEX namespaces may load (Codec2's
`media.swcodec` needs it, and its service is defined inside the APEX);
vendor services, init's `exec` of vendor binaries and 32-bit services load
their own copy by name or from `/system/lib`. The shim removes
`LD_PRELOAD` from the environment when it loads. Every other patch of the
image (Codec2 on gralloc BLOBs, ARM translation from the API 36 emulator
image, Mesa Vulkan, the lazy camera HAL, Wi-Fi, overlays) carries over
unchanged.

**Consequences.** Sessions can be launched on Android 16 once `16` is in
`redroid.versions`; being the newest, it becomes the default there. The
shims follow Android, not the kernel: a newer Android 16 base or Android
17 may need the list of preloading services, the ioctl set or the
netbpfload service revisited, and a kernel with ACK's ashmem support or an
LTS version netbpfload knows makes them no-ops. Apps can still find the
shim in `/proc/self/maps`.

## 172. Phones take Google WebView builds for ARM

**Context.** Phones refused a WebView from the catalog (decision #88):
their Android checks a WebView provider's signature, so a Chromium snapshot
can't serve there. The catalog also holds Google WebView builds from
APKMirror, which are signed by Google, but only for x86_64, and the api
didn't know what processor a catalog build is for.

**Decision.** Catalog sidecars carry an `abis` tag, which the APKMirror job
reads from each APK's `lib/` entries and the api reports as `abis`.
`Capabilities.WebViewPackages` names the packages a provider takes; the
physical provider takes `com.google.android.webview` and sets
`Capabilities.WebView`. The api only sends a WebView to providers that list
its package and run one of its ABIs natively (the device's preferred ABI's
family), since WebView crashes under ARM translation; the launch dialog
offers the same builds. The agent installs it the same way as on redroid,
which on a phone is an update of its own Google WebView. The phone cleanup
uninstalls the update of every system WebView provider that has one, so the
phone gets its factory WebView back without the provider remembering what a
session installed. The APKMirror job syncs Google WebView a second time for
`arm64-v8a` under a prefix of its own, listed as one more catalog.

**Consequences.** Only versions newer than the phone's own WebView install;
an older one fails the session. A Play Store update of the phone's WebView
is removed by the next cleanup. Quick launch defaults to the newest stable
build only among those virtual devices take, so "any provider" doesn't end
up on a phone because of its WebView, and a phone keeps its built-in
WebView unless one was picked for it. Sidecars without `abis` are offered
to every provider, as before.

## 173. The Android container isn't privileged; an NRI plugin hands it its devices

**Context.** #83 kept `privileged: true` because the devices cgroup denied
binder: each container mounts its own binderfs, whose nodes get minors
nobody knows in advance, and a device plugin only hands out fixed host
nodes. Binder has one major per boot (it is in `/proc/devices`), so a
device cgroup rule `c <binder>:* rwm` is enough; Kubernetes can't say that,
but the runtime's NRI can. Tried on k3s-2 with every holtdroid-redroid
version (11–16): without `privileged`, Android also needs device nodes it
used to get from the host's `/dev` (ueventd creates none in a container),
a writable cgroup2, writable loop device queues under `/sys`, and init
services whose `capabilities` lines fit the bounding set.

**Decision.** The `android` container runs with all capabilities dropped
but the 22 that Android's init files ask for (no `SYS_MODULE`, `SYS_TIME`,
`SYS_RAWIO`, `SYSLOG`, `AUDIT_CONTROL`, `MKNOD`, `PERFMON`, …), seccomp
`RuntimeDefault`, AppArmor unconfined. `holtdroid session-devices`, an NRI
plugin run by the chart as a DaemonSet on session nodes (root without
capabilities, the NRI socket mounted), adds to the `android` container of
session Pods that carry `holtdroid/devices` in the provider's namespace:
`/dev/fuse`, `/dev/net/tun`, `/dev/loop-control`, `/dev/loop0..511` (an
Android 15 boot takes about 36, numbered across the node), the render node,
`/dev/kmsg` as `/dev/null` (Android's logging no longer fills the node's
kernel log), and rules for every binder and loop minor. holtdroid-redroid's
init wrapper mounts a fresh cgroup2 when the container has its own cgroup
namespace, makes `/sys/devices/virtual/block` writable under a read-only
`/sys`, and the image trims every init service's capabilities to the
container's set; logd runs with `ro.logd.kernel` and `ro.logd.auditd` off,
since it otherwise insists on `SYSLOG` and `AUDIT_CONTROL`.
`redroid.privileged: true` brings the old container back for runtimes
without NRI.

**Consequences.** A session can no longer open the node's disks, load
modules, set the clock, read the kernel log or touch host devices other
than its render node and loop devices, and the node's sysctls stayed
untouched over dozens of boots. It is not a kernel boundary: Android keeps
`CAP_SYS_ADMIN` in the node's user namespace (init and zygote mount all the
time), so root in a session can still reach the node, e.g. through a fresh
`/proc`. Session nodes stay dedicated and #83's other measures stay. Any
session's root can open another session's loop devices and, with `mknod`
(not granted, but reachable as above), another session's binder. Sessions
need containerd 2.0+ or CRI-O 1.26+ with NRI; a session created while the
plugin is down boots without devices and fails. The logcat of a session
no longer has the kernel's lines.
