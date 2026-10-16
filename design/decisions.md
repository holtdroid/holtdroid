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
frida-go's CI. The instrumentation script lives in `internal/agent/script`
(`agent.js` + a `bun.lock` for `frida-java-bridge`); the image installs its
`node_modules` and the agent bundles it once at start with Frida's own
compiler (`frida.NewCompiler().Build`). Only the session binary is built
with `-tags frida` and cgo; the distroless binary keeps `CGO_ENABLED=0` and
its `agent` subcommand refuses to start.

**Consequences.** Upgrading Frida means bumping frida-go and the pinned
version together and re-checking on a device. frida-go treats any script
message containing `frida:rpc` as an RPC reply, so clipboard text travels as
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
