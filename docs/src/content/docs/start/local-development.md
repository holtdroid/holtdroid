---
title: Local development
description: Toolchain and day-to-day commands for working on Holtdroid.
sidebar:
  order: 3
---

The toolchain is pinned in `mise.toml`: Go, Bun, golangci-lint and Helm.

```sh
mise install
bun install
```

| Command        | What it does                                                 |
| -------------- | ------------------------------------------------------------ |
| `make check`   | Everything CI runs                                           |
| `make test`    | `go test -race ./...`                                        |
| `make lint`    | golangci-lint, `tsc`, oxlint, oxfmt check                    |
| `make fmt`     | Format Go and TypeScript                                     |
| `make openapi` | Regenerate the UI's API clients from the Go contracts        |
| `make build`   | Build the UI and `bin/holtdroid` with it embedded            |
| `make docs`    | Build this site into `docs/dist`                             |
| `make dev`     | Run `holtdroid dev` on `:8080`                               |
| `make web-dev` | Run the Vite dev server, proxying `/api` and `/s` to `:8080` |

## Running without a cluster

`holtdroid dev` starts the portal with anonymous sign-in, a read-only
artifact source named `local` that lists the APKs in a directory, a writable
`uploads` source for the Upload button, and a `fake` device
provider whose devices boot in a few seconds, stream a short recorded screen
and serve a placeholder DevTools page. Nothing else is needed:

```sh
make dev                     # or: go run ./cmd/holtdroid dev --apks ~/Downloads
make web-dev                 # in a second terminal, then open http://localhost:5173
```

Useful flags: `--apks <dir>`, `--uploads <dir>` (default: a temporary
directory), `--slots 4`, `--step-delay 2s`, `--idle-timeout 30m`,
`--cache <dir>`, `--no-direct` and `--default-location de` (fake VPN
locations).

It also runs the SSH gateway on `--ssh :2222` with a temporary host key, so
the session page's SSH commands work against fake devices. Their ADB is an
echo server and their published ports are local listeners. Add a key on the
SSH keys page, then e.g. `ssh -N -p 2222 -o StrictHostKeyChecking=no
-R 3000:localhost:3000 fake-<id>@localhost`.

Frontend tooling runs on Bun. Type checking uses TypeScript 7 (the native
compiler); linting and formatting use oxlint and oxfmt.

Contributor-facing design notes live in
[`design/`](https://github.com/kriakiku/holtdroid/tree/main/design), and the
rules for humans and coding agents in
[`AGENTS.md`](https://github.com/kriakiku/holtdroid/blob/main/AGENTS.md).
