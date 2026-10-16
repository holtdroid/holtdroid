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
