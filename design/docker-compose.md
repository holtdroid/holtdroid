# Help wanted: Docker Compose on Linux and macOS

Today real devices need Kubernetes. We'd love Holtdroid to also start with
one `docker compose up` on a Linux box or a Mac, and we'd welcome help
building it. This page is the brief: what to build, what we already know,
and where the hard parts are. Open an issue before you start so we can
agree on the approach, and pick any step on its own: each one is useful by
itself.

## What it is

A new provider, `provider-docker`, implementing the existing Provider
contract (`internal/contract`, [contracts.md](contracts.md)) against the
Docker Engine API on one host. Everything above the contract stays as it
is: the api, the agent, the session image, the UI. The plan is already
sketched in [architecture.md](architecture.md) ("Future: Docker-only
deployment") and listed under "Later" in [roadmap.md](roadmap.md).

| Concern | `provider-emulator` (Kubernetes) | `provider-docker` |
|---------|----------------------------------|-------------------|
| Session state | Pod labels and annotations | Container labels (`holtdroid.session=…`) |
| Slots | `slotsPerNode` on matching nodes | Fixed `slots` per host |
| Devices, capabilities, seccomp | `session-devices` NRI plugin | `device_cgroup_rules`, `cap_add`, `security_opt` set directly on the container |
| VPN | `vpn` container in the Pod | sing-box container; redroid and the agent join it with `network_mode: container:<vpn>` |
| Per-session secret | Secret with an ownerReference | Per-session volume, removed with the session |
| Agent reachability | Pod IP | Container IP on a bridge network the api is attached to |
| Cleanup | Owner references | Remove everything carrying the session label |

Docker is easier than Kubernetes in one important way: binder's device
major is dynamic and per-mount, which Kubernetes can't allow without
`privileged` (decisions #83 and #173). Docker takes a device cgroup rule
directly, so no NRI plugin is needed.

## Steps

### 1. Linux x86_64

The useful core, and doable with the existing images.

- `internal/provider/docker` with the contract round-trip tests every
  provider has (`internal/contract/contract_test.go`), Docker faked with an
  `httptest` server.
- A neutral session spec (`internal/session`: images, env, devices, mounts,
  the sing-box config) that both providers render, so they can't drift.
  Today it lives in `internal/provider/emulator/pod.go`.
- A `holtdroid provider-docker` subcommand, a `compose.yaml` with the api
  and the provider, and a docs page under `docs/src/content/docs/start/`
  in all three languages.
- Host requirements to document: a kernel with binder
  (`CONFIG_ANDROID_BINDERFS`), a Mesa-supported `/dev/dri` render node for
  the GPU, and the provider needs the Docker socket, which means root on
  the host. As on Kubernetes, root inside a redroid session is root on the
  host ([emulator security](../docs/src/content/docs/operations/emulator-security.md)).

### 2. Check macOS before building for it

On a Mac Docker always runs inside a Linux VM, and that VM's kernel decides
everything. Before anyone builds arm64 images, confirm by hand that upstream
redroid boots on arm64 in:

- Docker Desktop (we think its kernel has no binder, but nobody has checked);
- OrbStack (reported to run redroid);
- Colima or Lima with an Ubuntu kernel.

Write the results into this page. If only some of them work, the docs say
which ones to use.

### 3. arm64 images (Apple Silicon, arm64 Linux)

The heaviest part, mostly CI.

- `holtdroid-redroid` ([holtdroid/holtdroid-redroid](https://github.com/holtdroid/holtdroid-redroid))
  builds `linux/amd64` only and assumes x86: the NDK toolchain path and the
  ARM translation (`libndk_translation`) from the emulator system image. On
  arm64 the translation goes away: ARM apps run natively, x86-only APKs
  don't run at all.
- The session image (`images/session.Dockerfile`) needs an arm64 build too.
  Frida works natively on arm64; it only fails under Rosetta (decision #26).
- No GPU in a Mac VM: rendering falls back to software, so WebGL is slow.

## Windows

WSL2's kernel ships without binder, so Windows needs a custom WSL kernel.
Out of scope until macOS works.
