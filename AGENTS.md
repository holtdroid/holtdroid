# Holtdroid — instructions for coding agents

This file is the single source of rules for any AI coding agent (Claude Code,
Codex, Cursor, Copilot, …) and for human contributors. `CLAUDE.md` only
imports it. Read it fully before changing anything.

## Read first

1. [`design/status.md`](design/status.md) — where the work stands, what to
   do next, the maintainer's requirements and working agreements, gotchas,
   and the live deployment. Update it when you finish a phase.
2. [`design/README.md`](design/README.md) — index of the design docs.
3. [`design/architecture.md`](design/architecture.md) — components, data
   flow, session lifecycle.
4. [`design/contracts.md`](design/contracts.md) — the HTTP contracts between
   services. These are the extension points; do not bypass them.
5. [`design/roadmap.md`](design/roadmap.md) — what is done, what is next.
   Pick work from here and tick it off when finished.
6. [`design/decisions.md`](design/decisions.md) — why things are the way
   they are. Do not relitigate an accepted decision silently: add a new entry
   that supersedes it.

If an `AGENTS.local.md` exists next to this file, read it too: it holds
machine-specific notes (local paths, how to deploy to the maintainer's
cluster) and is deliberately not committed.

If the code and the design docs disagree, the docs are wrong or the code is
— fix one of them in the same change. Never leave them diverged.

## What the project is

A self-hosted, Kubernetes-native web portal that launches Android devices on
demand for testing APKs pulled from artifact sources (Slack first), and gives
the user — in one browser tab — the screen, Chrome DevTools for the app's
WebViews (enabled at runtime, APK untouched), clipboard sync and a per-session
VPN location switcher. Sessions are bounded in number and reaped when idle.

It is open source (Apache-2.0) and must stay **infrastructure-agnostic**: no
hard dependency on a specific auth proxy, secret store, VPN vendor, registry
or cluster layout. The maintainer's homelab is just the first deployment.

## Repository layout

```
cmd/holtdroid/            main + cobra subcommands (api, provider-fake, provider-emulator, agent, dev)
internal/
  contract/               shared request/response types + huma operations for Provider/Agent/SSH-gateway APIs
  api/                    BFF: UI REST API, registries, APK cache, session proxy, activity, reaper
  source/                 artifact sources: *.apk + .meta.json sidecars in a storage.Store (folder or S3), listed by the api
  provider/               provider implementations: provider/fake (simulated devices for dev/tests), provider/emulator
  agent/                  device agent: adb, frida, devtools proxy, clipboard, vnc bridge, ssh tunnels; agent/emulator
  sshgateway/             SSH gateway (planned): ADB and published-port tunnels, no shells
  vpn/                    VPN providers (nordvpn, wireguard, none) + sing-box config rendering
  secrets/                secret resolvers: env:, file:, openbao:
  storage/                object store for sources and the APK cache: filesystem, s3
  db/                     api SQL database: goose migrations, sqlc queries (generated code committed)
  auth/                   sign-in modes: anonymous, password, oidc (signed JWT cookie), header, none
  apk/                    APK metadata (package, version, label, icon)
web/                      React + Vite + TanStack Router/Query + shadcn/ui (embedded into the api binary)
docs/                     public documentation site (Astro Starlight)
design/                   internal design docs for contributors and agents (this is not the public site)
deploy/helm/holtdroid/    Helm chart
images/                   Dockerfile (distroless holtdroid) and session.Dockerfile (emulator + agent)
.github/workflows/        CI, release, docs
```

Directories that do not exist yet are planned — create them exactly there.

## Tech stack (decided, see decisions.md)

- **Backend:** Go, one module, one binary with subcommands. Prefer
  well-maintained libraries over hand-written code:
  - `danielgtaylor/huma/v2` — HTTP APIs with generated OpenAPI 3.1 (Go 1.27:
    promoted fields may be set directly in struct literals; `modernize`
    enforces it);
  - `spf13/cobra` — CLI;
  - `knadh/koanf/v2` — configuration;
  - `k8s.io/client-go`;
  - `slack-go/slack` (for the planned Slack sync job, not the api);
  - `golang-jwt/jwt/v5`, `coreos/go-oidc/v3`, `golang.org/x/oauth2` — sign-in;
  - `minio/minio-go/v7` — S3 (tests use `johannesboyne/gofakes3`);
  - `shogo82148/androidbinary` — APK parsing;
  - the `adb` CLI from platform-tools (decisions.md #24);
  - `frida/frida-go` (cgo, agent only, behind the `frida` build tag;
    Frida pinned to the version frida-go is tested against — decisions.md #23);
  - `coder/websocket`;
  - `net/http/httputil.ReverseProxy`;
  - `golang.org/x/sync` (`errgroup`, `singleflight`);
  - `golang.org/x/crypto/ssh` and `hashicorp/yamux` — SSH gateway and tunnels (planned);
  - `database/sql` with `modernc.org/sqlite` (in-memory, later file +
    `benbjohnson/litestream` replication to S3) and `jackc/pgx/v5` (later),
    `pressly/goose` for migrations, `sqlc` for queries (decisions.md #22;
    only in-memory SQLite exists so far);
  - `log/slog` for logging.

  OpenBao is reached with plain `net/http` (two endpoints), not its client
  library — see decisions.md #12.

  Before writing a utility, check whether one of these (or the standard
  library) already does it.
- **Frontend:** React 19, Vite, TanStack Router + Query, Tailwind v4,
  shadcn/ui (`web/src/components/ui` is generated by the shadcn CLI — add
  components with `bunx --bun shadcn@latest add <name>`, don't hand-edit them
  beyond fixes). Bun is the package manager and runtime for all frontend
  tooling (workspaces `docs`, `web`, hoisted linker).
- **Frontend types:** TypeScript 7 (the native compiler, `tsc`) in strict
  mode. API types for both the portal API and the device agent API are
  generated from OpenAPI (`make openapi` → `web/src/api/schema.d.ts`,
  `web/src/api/agent.d.ts`) and called through `openapi-fetch` — never
  hand-write API types. openapi-typescript needs TypeScript's JS API, which
  TS 7 doesn't ship, so it runs through `bunx` with its own TS 5.
- **Frontend lint/format:** oxlint (type-aware via `oxlint-tsgolint`) and
  oxfmt; configs in `.oxlintrc.json` and `.oxfmtrc.json`. Follow the React
  Compiler-era rules oxlint enforces: no setState in effects, no ref access or
  impure calls during render — derive state during render or use
  `useEffectEvent`.
- **Docs site:** Astro Starlight in `docs/`.
- **Deployment:** Helm chart; images on `ghcr.io/kriakiku/holtdroid` and
  `ghcr.io/kriakiku/holtdroid-session`.

## Hard rules

- Keep the codebase small. Use a library or the standard library instead of
  writing a framework. No speculative abstractions beyond the extension points
  listed in `design/contracts.md`.
- Every cross-service call goes through a contract in `internal/contract`.
  The api never talks to Kubernetes, Slack or ADB directly — that is the
  job of the provider, the agent and independent sync jobs that write into
  sources (folders or S3, decisions.md #27).
- **Before the first release (`v*` tag) there is no backward compatibility.**
  Config keys, HTTP APIs, contracts, the database schema and stored data may
  change freely: rewrite goose migrations in place instead of stacking
  compat ones, drop old fields instead of deprecating them. Still keep the
  docs in sync with the code.
- The api's database is **in-memory SQLite only** for now (decisions.md
  #22): it is empty after every restart and per replica. Use it only for data
  that may be lost; anything that must survive a restart still follows the
  rule below until persistent backends (SQLite + Litestream, PostgreSQL) land.
- The api is stateless and must stay that way: no persistent database, nothing only in
  memory or on local disk that a restart or a second replica would miss.
  Session state lives in the provider (emulator: Pod labels/annotations),
  identities in signed cookies (`auth.sessionKey`), activity is flushed to
  providers, APKs are a re-fillable cache in `storage`, uploads are files
  plus a `.meta.json` sidecar in a source (folder/S3). Restarting or
  rescheduling any service must not lose sessions or sign people out.
- Secrets are always referenced, never inlined: config values like
  `env:SLACK_BOT_TOKEN`, `file:/run/secrets/slack`,
  `openbao:secret/holtdroid#slack_bot_token` go through `internal/secrets`.
  Never log a resolved secret; never add one to an error message.
- No vendor lock-in in defaults: auth defaults to `anonymous`, storage to
  `filesystem`, VPN to `none`, secrets to `env`.
- The APK is never modified. Anything that requires repackaging is out of
  scope.
- Code comments: almost none. Write self-explanatory code; reserve comments
  for genuinely non-obvious behaviour (a workaround for a specific upstream
  bug, a protocol quirk). The *why* of a design belongs in
  `design/decisions.md`, not in comments.
- Images: run as non-root wherever possible (the emulator container is the
  documented exception), pin base images by digest, build `linux/amd64`
  (and `linux/arm64` where it makes sense — not for the session image).

## Commands

The toolchain is pinned in `mise.toml` (Go, Bun, golangci-lint, Helm). Run
`mise install` once; inside tool calls prefix commands with `mise exec --`
if the shell doesn't activate mise.

```sh
make check        # everything CI runs: openapi, golangci-lint, tsc, oxlint, oxfmt --check, go test -race, build, docs
make test         # go test -race ./...
make lint         # golangci-lint + tsc + oxlint + oxfmt --check
make fmt          # golangci-lint fmt (gofumpt, goimports) + oxfmt
make openapi      # regenerate web/src/api/*.d.ts from the Go contracts — commit the result
make sqlc         # regenerate internal/db queries from migrations/ + queries.sql — commit the result
make build        # web + bin/holtdroid with the UI embedded
make docs         # docs site into docs/dist
make dev          # holtdroid dev: api + APKs from internal/apk/testdata + fake devices, anonymous sign-in, on :8080
make image       # local linux/amd64 image (images/Dockerfile)
make web-dev      # Vite dev server proxying /api and /s to :8080
```

`holtdroid dev` needs no cluster: the read-only `local` source lists APKs
from a directory (`--apks`), uploads go to a temporary `uploads` source and
the `fake` provider simulates devices whose agents
serve placeholder screen/DevTools pages. Use it for all UI work.

Before calling a task done: `make check` passes and the relevant roadmap item
is ticked.

## Testing expectations

- Unit tests next to the code (`_test.go`), table-driven.
- Contract tests: every Provider/Agent implementation gets a round-trip
  test through a real `httptest.Server` and the contract's Go client (see
  `internal/contract/contract_test.go`). Once `internal/contract/conformance`
  exists (roadmap), new implementations run it instead.
- api behaviour is tested end to end in `internal/api/api_test.go` with a
  filesystem source, the `fake` provider and a controllable clock — extend that
  harness rather than mocking the api's internals.
- External APIs (Slack, NordVPN, OpenBao, Kubernetes) are faked:
  `httptest` servers and `client-go`'s fake clientset. No test hits the
  network.
- Rendered artifacts (Pod specs, sing-box configs) are covered by golden
  files in `testdata/`, updated with `go test ./... -update`.
- UI verification is done through types, lint and unit tests — do not spin up
  headless browsers or Storybook to "check" UI.

## Releases and the live deployment

Every push to `main` builds `ghcr.io/kriakiku/holtdroid:<full commit sha>`
(`.github/workflows/release.yml`). The maintainer's cluster runs an Argo CD
Application that tracks `main` and uses the synced commit as the image tag, so
**every commit to `main` is deployed** to https://android.homelab.example within a few
minutes (OIDC via Authelia, directory source, fake provider). Keep `main`
green: run `make check` before pushing. Tags `vX.Y.Z` also publish the chart
to `oci://ghcr.io/kriakiku/charts/holtdroid`.

## Git

- Conventional Commits, **one line only** (`feat(agent): forward all webview devtools sockets`).
  No body, no trailers, no `Co-Authored-By`, no "Generated with" lines.
- PR description is empty; the title says it all.
- Agents never commit or push unless the human explicitly asks in the
  current conversation. Pushing to `main` deploys (see above).

## Updating these docs

When you finish a roadmap item, tick it in `design/roadmap.md`. When you make
a decision a future contributor would ask "why?" about, add it to
`design/decisions.md`. When a contract changes, update
`design/contracts.md` in the same change. Keep this file about *rules*; put
explanations in `design/`.
