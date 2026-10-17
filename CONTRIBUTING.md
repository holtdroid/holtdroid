# Contributing to Holtdroid

Thanks for helping. Holtdroid is small on purpose: one Go binary, a React UI
embedded in it, a Helm chart and a docs site. This page is the short version;
[`AGENTS.md`](AGENTS.md) holds the full rules, and they apply to humans and
coding agents alike.

## Before you start

- Read [`design/status.md`](design/status.md) and
  [`design/roadmap.md`](design/roadmap.md) to see what's being worked on.
  Pick something from the roadmap or open an issue first for anything larger
  than a fix, so we agree on the approach before you write it.
- A design question with a "why?" behind it belongs in
  [`design/decisions.md`](design/decisions.md). Changing an accepted decision
  means adding a new entry that supersedes it.

## Setup

The toolchain (Go, Bun, golangci-lint, Helm, sqlc) is pinned in
[`mise.toml`](mise.toml).

```sh
mise install
bun install && bun install --cwd frida
make dev        # api + sample APKs + simulated devices on http://localhost:8080
make web-dev    # Vite with hot reload on :5173, proxying to make dev
```

`make dev` needs no cluster, KVM or Slack: it runs the api against fake
devices that stream a recorded screen. Use it for everything above the
provider contract. Emulator sessions need an amd64 Kubernetes node with
`/dev/kvm` (see the docs' installation page).

## Making a change

- **Keep it small.** Prefer the standard library or a well-maintained
  library over new code, and no abstractions beyond the extension points in
  [`design/contracts.md`](design/contracts.md).
- **Comments:** almost none. Name things so the code explains itself; keep
  comments for genuinely surprising behaviour.
- **Tests** sit next to the code, table-driven. Provider and agent
  implementations get a round trip through `httptest` and the contract's Go
  client; api behaviour goes into the end-to-end harness in
  `internal/api/api_test.go`; rendered artifacts are golden files under
  `testdata/` (`go test ./... -update`). No test touches the network.
- **UI:** verify with types, lint and tests, not by clicking through a
  headless browser.
- **Generated code** is committed: `make openapi` after changing an API,
  `make sqlc` after changing `internal/db` queries or migrations.
- **Docs:** code and docs change together. User-facing behaviour goes into
  `docs/`, internal design into `design/`; tick the roadmap item you
  finished.
- **No backward compatibility before the first release.** Rename config
  keys, change APIs and rewrite migrations in place; don't add deprecation
  shims.
- **Secrets** are always references (`env:`, `file:`, `openbao:`) and never
  appear in logs or errors.

## Checks

```sh
make fmt     # gofumpt, goimports, oxfmt
make check   # everything CI runs: generated code, lint, tests, build, docs, helm lint
```

`make check` must pass before a pull request is reviewed.

## Commits and pull requests

- [Conventional Commits](https://www.conventionalcommits.org/), one line,
  no body: `feat(agent): forward all webview devtools sockets`.
- The pull request title says it all; the description can stay empty.
- One topic per pull request.

## Licence

Holtdroid is [Apache-2.0](LICENSE). By contributing you agree that your
contribution is licensed under it.
