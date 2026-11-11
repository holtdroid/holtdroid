---
title: Emulator isolation
description: What the redroid session Pod can do on its node, what that risks, what Holtdroid enforces and what to add yourself.
sidebar:
  order: 2
---

The [emulator provider](/configuration/emulator/) runs Android with
[redroid](https://github.com/remote-android/redroid-doc): Android's init,
system services and apps run as ordinary Linux processes in a container, on
the node's own kernel. There is no virtual machine and no `/dev/kvm`. That is
what lets several sessions share a node and its GPU, and it is also the
whole security story: **a session is only as isolated as a container whose
root holds `CAP_SYS_ADMIN`**, which is not a kernel boundary.

## What a session Pod gets

Each session is one Pod in the provider's namespace (the chart's release
namespace) with three containers sharing a network namespace.

| Container | Runs as | Privileges                                                                                                                                                                                                                                                                                                                                               |
| --------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `android` | root    | Not privileged (default): all capabilities dropped except the 22 Android's init asks for, `SYS_ADMIN`, `NET_ADMIN`, `SYS_PTRACE` and `BPF` among them; Docker's default seccomp profile plus `userfaultfd`; AppArmor `Unconfined`; binder, loop, fuse, tun and the GPU's render node. `redroid.privileged: true` makes it a privileged container instead |
| `agent`   | root    | All capabilities dropped, `allowPrivilegeEscalation: false`; `NET_ADMIN` only when VPN locations are configured. Mounts the node's `/sys/fs/cgroup` read-only                                                                                                                                                                                            |
| `vpn`     | image's | Only with VPN locations: sing-box with `NET_ADMIN` and the node's `/dev/net/tun`                                                                                                                                                                                                                                                                         |

The full capability and device lists, and how `holtdroid session-devices`
(an [NRI](https://github.com/containerd/nri) plugin run as a DaemonSet on
the session nodes) hands the `android` container its devices and seccomp
profile, are in [Session devices](/configuration/emulator/#session-devices).

Inside Android, the agent switches adbd to root, frida-server runs as root
to instrument the app and enable WebView debugging, and Android's own daemons
(init, zygote, netd, vold) run as root as on any device. Android in redroid
is a userdebug build.

## What that risks

- **Root in Android is close to root on the node.** The `android`
  container keeps `CAP_SYS_ADMIN` in the node's user namespace, because
  init and zygote mount filesystems all the time. A process that reaches
  root inside Android can use it to step out of the container's view, for
  example by mounting a fresh `/proc` and changing node-wide settings.
  Treat anyone with root in a session as having root on its node.
- **Who gets that root.** frida-server, the agent's adb and Android's
  daemons have it by design. Users have it through ADB with
  `redroid.shell: full` (the root Terminal tab, the `holtdroid` client's
  ADB). An app under test doesn't get root by itself, but an exploit in it,
  or in a library it bundles, that escalates inside Android reaches the
  node.
- **The kernel is shared.** Binder, binderfs, loop devices, BPF, FUSE,
  `userfaultfd` and the GPU driver are all reachable from Android. A bug in
  any of them is a bug in the node's kernel.
- **Sessions on one node can reach each other.** Root in one session can
  open another session's loop devices, and, through the same `CAP_SYS_ADMIN`
  path, its binder.
- **Real network traffic.** Apps talk to the internet from your nodes, or
  from the VPN location the user picked. Without the egress policy they
  could also reach the LAN, the nodes and other Pods.
- **`redroid.privileged: true` is worse.** A privileged container gets
  every capability and device, no seccomp and no AppArmor. Android then
  also rewrites node sysctls at boot unless the image stops it (it does,
  see below). Use it only on runtimes without NRI.

## What Holtdroid enforces

These are in the provider's Pod spec, the chart or the images, and apply
without configuration:

- **No privileged Android container** (unless `redroid.privileged: true`):
  no kernel modules, clock, kernel log, raw I/O, `MKNOD` or `PERFMON`; host
  devices limited to the list above; `/sys` read-only except the virtual
  block devices' queues; `/dev/kmsg` pointed at `/dev/null`.
- **Seccomp.** Docker's default profile for the container's capabilities,
  plus `userfaultfd`, set by `session-devices`. The Pod itself asks for
  `RuntimeDefault`, so a session created while the plugin isn't running is
  still confined (and fails to boot without its devices).
- **The plugin's reach is narrow.** `session-devices` runs as root without
  capabilities and changes only the `android` container of Pods in the
  provider's namespace that carry the `holtdroid/devices` annotation.
- **Node sysctls stay untouched.** holtdroid-redroid's init wrapper
  remounts `/proc/sys` read-only except `/proc/sys/net`, which belongs to
  the Pod's network namespace.
- **No Kubernetes credentials in the Pod.** `automountServiceAccountToken`
  and service links are off; the agent has no capabilities beyond
  `NET_ADMIN` for the VPN tunnel's shaping.
- **Network policy** (`providers.emulator.networkPolicy`, on by default):
  only the api reaches the agent, and only the ssh-gateway its tunnel port.
  Egress from session Pods is limited to cluster DNS, the api and the
  internet with `privateRanges` (10/8, 172.16/12, 192.168/16, 100.64/10,
  169.254/16) carved out, so even root inside Android can't reach the LAN,
  node IPs or other Pods. In-cluster exceptions, such as a
  [VPN gateway](/operations/vpn-gateway/), go into `extraEgress`.
- **Users' ADB is filtered** (`redroid.shell: allowlist`, the default):
  the browser tabs and the `holtdroid` client run only the commands behind
  the Logcat, Files, App and Device tools, and there is no Terminal tab.
  `adb.ownerOnly` (on by default) keeps it to the session's owner and
  admins.
- **Sessions are short-lived.** `/data` is an `emptyDir` limited to
  `redroid.dataSize` and is gone with the Pod; the reaper deletes sessions
  after `sessions.idleTimeout` (30 minutes) without activity and after
  `sessions.maxTTL` (8 hours) in any case.

None of this changes the first risk above: these measures shrink what a
session can touch, they don't make its root harmless.

## What you should add

Holtdroid can't enforce these from inside the cluster; they depend on your
nodes and policies.

- **Dedicated session nodes.** Run nothing else there: no databases, no
  other tenants' Pods, no control plane. Taint them and match the taint in
  `providers.emulator.tolerations`, and pick them with `nodeSelector`:

  ```sh
  kubectl label node session-1 holtdroid/sessions=true
  kubectl taint node session-1 holtdroid/sessions=true:NoSchedule
  ```

  ```yaml
  providers:
    emulator:
      nodeSelector: { holtdroid/sessions: "true" }
      tolerations:
        - { key: holtdroid/sessions, operator: Equal, value: "true", effect: NoSchedule }
  ```

  Treat the nodes' kubelet credentials and anything mounted on them as
  reachable from a session.

- **A CNI that enforces NetworkPolicy.** The egress rules do nothing on a
  CNI that ignores NetworkPolicy (plain flannel, for one). Check from a
  session's Terminal (with `redroid.shell: full` on a test deployment)
  that a node IP and your LAN router don't answer.
- **A patched kernel.** The kernel is the boundary between sessions and
  the node; keep the session nodes on current stable or LTS releases.
- **Who may launch.** Let only people you'd trust with root on the session
  nodes open sessions (`allowedGroups`, the `users` mode's roles), keep
  `redroid.shell: allowlist` (or `off`), and leave the SSH gateway off if
  nobody needs ADB from their computer.
- **Untrusted APKs on their own nodes.** An APK you didn't build is code
  running one privilege escalation away from the node. If you test such
  builds, give them a separate node pool (a second Holtdroid install with
  its own `nodeSelector`), not the nodes your team's sessions share.
- **Egress through a VPN.** With VPN locations and `vpn.direct: false`, apps
  never leave from your nodes' own address. Keep `vpn.bypassCIDRs` short.
- **Pod Security admission.** Session Pods don't pass the `baseline` level
  (added capabilities, hostPath volumes, AppArmor `Unconfined`), so the
  namespace Holtdroid runs in needs `privileged`. Keep that namespace for
  Holtdroid alone.

### AppArmor

The provider sets `appArmorProfile: Unconfined` on the `android`
container, and there is no setting to change it. The runtime's default
profile (`docker-default`, `cri-containerd.apparmor.d`) denies `mount`,
which Android's init, vold and APEX activation can't boot without.

A profile of your own could still narrow what root inside Android does on
the node, for example deny writes under `/proc/sys` other than `net`,
`/sys/kernel` and `/sys/fs/cgroup` outside the container's own cgroup, and
allow only the mount types Android uses (binderfs, cgroup2, proc, tmpfs,
ext4 and erofs from loop devices for APEX, fuse). Holtdroid ships no such
profile and hasn't tested one. Attaching it today would take:

1. loading the profile on every session node (`apparmor_parser`, for
   example from a DaemonSet or your node configuration);
2. replacing the container's `appArmorProfile` with
   `{ type: Localhost, localhostProfile: <name> }` at admission, with a
   mutating policy (Kyverno, Gatekeeper's mutation) on Pods in Holtdroid's
   namespace that have a container named `android`, since the provider
   writes the Pod spec itself.

A session that fails to boot under the profile shows it in the node's
audit log (`apparmor="DENIED"`). If you write a profile that boots every
Android version, please share it upstream.

## See also

- [Security](/operations/security/), the threat model of the whole portal.
- [Emulator provider](/configuration/emulator/): node requirements, Pod
  layout and session devices.
- [ADB tools](/concepts/adb/) and [Connecting your computer](/concepts/ssh/),
  the ways users reach a session's adbd.
