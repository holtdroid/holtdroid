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

**Decision.** CI pushes `ghcr.io/kriakiku/holtdroid:<full sha>` for every
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
from `dumpsys gfxinfo`, `dumpsys thermalservice`) and its own container
through cgroup v2 and `/sys/class/thermal`, since it shares the container
with the emulator. Rates come from the difference between two samples.
Sampling runs every 2 s while at least one browser listens and stops with
the last one; the UI unsubscribes in hidden tabs. Stream fps and bitrate
are counted in the browser. Fields a device can't measure are absent, so a
physical phone later reports the same shape without `host`.

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
[kriakiku/holtdroid-sync](https://github.com/kriakiku/holtdroid-sync): one
Go module with a binary per job (`holtdroid-{slack,s3,github}-sync`), shared
packages for the source layout (`layout`), announcements and the main loop,
one image `ghcr.io/kriakiku/holtdroid-sync` with every binary, and one chart
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
  no adb.
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
  surfaces. Custom properties inherit into DevTools' shadow roots, so a
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

**Context.** Changing keyboard layouts attached Frida to `system_server`
(#31). On the emulator that once crashed `system_server` with a SIGSEGV in
ART while another thread delivered an exception; Android restarted the whole
system and the call came back as `DeadSystemException`.

**Decision.** The session image builds `images/session/Locales.java` into a
1 KB dex (`javac`, then `d8` from the pinned r8 jar). The agent pushes it to
the device and runs `app_process` as root with the tags; it calls the same
`LocalePicker.updateLocales` through reflection, so it applies at once and
persists. Frida stays in `system_server` only for the wallpaper, drawn once
per install.

**Consequences.** A failure kills a throwaway process, not the system. The
image build needs a JDK stage. Devices without root would fail the
`WRITE_SETTINGS` check of the call and need another way.
