# Status and handoff

Snapshot for whoever continues the work — human or agent. Update the
"Where things stand" and "Next steps" sections whenever a phase moves; the
rest changes rarely.

_Last updated: 2026-10-16._

## Where things stand

**Works today** (deployed at https://android.homelab.example, see "Maintainer's
deployment"):

- The portal end to end against **simulated** devices: APK list with parsed
  metadata/icons, launch dialog, sessions panel with slots and idle countdown,
  session page with screen/DevTools split, target switcher, clipboard, VPN
  location switcher, extend/stop, reaper.
- Sign-in: anonymous animal names, shared password, OIDC (PKCE + userinfo),
  forward-auth headers, none. Avatars from the IdP or DiceBear voxel-art.
- APK cache on filesystem or S3, keyed by file revision. Stateless api
  (restart test included).
- Artifact sources built into the api (decision #27): folders or S3
  prefixes with optional `.meta.json` sidecars (changelog, origin, tags,
  owner, visibility), change detection by ETag/mtime with polling and an
  `artifacts` SSE event, uploads from the UI (on by default) with
  public/private and delete for the owner and admins.
- In-memory SQLite database in the api (goose + sqlc, `internal/db`); it only
  records session events so far and is empty after a restart (decision #22).
- `provider-fake` (fake devices whose agent serves placeholder screen and
  DevTools pages).
- Single Go binary + embedded UI, distroless image, Helm chart, CI, release
  (`ghcr.io/kriakiku/holtdroid:<sha>` per commit), docs site on GitHub Pages.

**Session prototype works on the cluster** (Phase 2, decisions #25, #26):

- `images/session.Dockerfile` (`make session-image`, CI pushes
  `ghcr.io/kriakiku/holtdroid-session:<sha>`, Android 15 x86_64 with ARM
  translation) and `holtdroid agent` (`internal/agent`,
  `internal/agent/emulator`, Frida script in `internal/agent/script`).
  A hand-written Pod (agent + sing-box sidecar) booted, ran an ARM-only APK
  under Frida, exposed its WebView DevTools socket, served the screen,
  clipboard and location switching. The agent can't run under Rosetta on a
  Mac (Frida needs `eventfd`).

**Not built yet**:

- `provider-emulator`, `internal/vpn` — Phase 3.
- The Slack sync job (independent of the api, writes the source layout).
- SSH gateway — Phase 4.5 (designed in architecture.md "SSH access").
- Docker-only provider, physical phones — "Later".

## Next steps, in order

1. **Phase 3** — `internal/vpn` (golden sing-box configs),
   `provider-emulator` (Pods + per-session Secret, state in labels and
   annotations, anti-affinity, `touch`), and a Slack sync job that writes
   into an S3 source. The provider renders what the Phase 2 Pod proved: `emulator` container
   (privileged, `/dev/kvm` and `/dev/shm`, env `HOLTDROID_ARTIFACTURL`,
   `HOLTDROID_PACKAGE`, `HOLTDROID_LOCATION`, `HOLTDROID_CLASHAPI`) plus a
   `vpn` sing-box container (`NET_ADMIN`, `/dev/net/tun`, config Secret with
   WireGuard MTU 1280 and a `select` selector). See decision #26 for the
   details that bit. Then wire them into the chart and switch the
   maintainer's deployment from fake to emulator plus a Slack-fed source.
2. **Phase 4.5 — SSH gateway**, can run in parallel against the fake
   provider.
3. Remaining Phase 1/5 chores: `CONTRIBUTING.md`, `SECURITY.md`,
   `.editorconfig`, conformance package.

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
- **SSH access**: `ssh <slug>@host` for ADB (`-L`) and publishing local ports
  on the device (`-R`), no shells, keys kept in the browser and re-synced,
  flags `allowADB`=true, `allowReverse`=true, `clientIsolation`=false.
  (decision #21)
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
| URL | https://android.homelab.example |
| Argo CD Application | `homelab.k8s/argocd/holtdroid.yaml` — chart from this repo's `main`, `image.tag=$ARGOCD_APP_REVISION`, values inline |
| Current setup | `auth.mode: oidc` (Authelia client `holtdroid`, groups `admins`/`users`), the default `local` source and uploads on the api's Longhorn PVC `holtdroid-data` (`api.persistence`), `provider-fake` |
| Secrets (OpenBao KV, mount `secret/`) | `holtdroid` → `session_key`; `oidc/holtdroid` → `client_secret` (+ digest for Authelia); both seeded by `nixos/scripts/openbao-bootstrap.sh`; delivered by an `ExternalSecret` in `extraObjects` |
| Planned secrets | Slack: put `slack_bot_token` and `slack_channel_id` into `secret/holtdroid` by hand. NordVPN: reuse `secret/vpn` → `nordvpn_private_key`; that key is already used by the torrent `vpn-gateway` (servers `kyiv.ua`, `warsaw.pl`, `astana.kz`, `oslo.no`, `riga.lv` `.wg.nordhold.net`) — put those in `excludeServers` |
| Nodes for sessions | 4 × x86_64 with `/dev/kvm`: `core` (16 cores, 30 GiB, taint `dedicated=nas:NoSchedule`), `k3s-1..3` (6 cores, 31 GiB each). One session per node |
| Storage classes | `longhorn`, `local-path`, `nas-hdd` |
| Ingress / DNS | Traefik; Ingress annotation `external-dns.alpha.kubernetes.io/target: "10.10.4.25"` creates the DNS record |
| Registries | `ghcr.io/kriakiku/*` (public, from CI); the cluster also has `registry.homelab.example` (zot, needs the `zot-pull-secret` pattern from `homelab.k8s/infrastructure/downloads/secrets.yaml`) |
| SSH gateway (planned) | needs a Traefik TCP entrypoint `:2222` in `homelab.k8s/infrastructure/traefik` |

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
