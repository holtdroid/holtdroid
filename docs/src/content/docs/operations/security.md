---
title: Security
description: Threat model and hardening notes for running Holtdroid.
sidebar:
  order: 1
---

## What you are running

- **Session Pods on the node's kernel.** Android runs in a redroid
  container on the node's own kernel, and the VPN sidecar needs `NET_ADMIN`
  and a TUN device. The Android container isn't privileged: it gets only
  the devices Android needs and a fixed set of capabilities (no kernel
  modules, clock, kernel log or raw I/O), under Docker's default seccomp
  profile plus `userfaultfd` ([Session devices](/configuration/emulator/#session-devices)).
  It still holds `CAP_SYS_ADMIN` on the node's kernel, which Android's init
  and zygote need, so root inside a session can still reach the node, by
  mounting a fresh `/proc` and changing node-wide settings for one: treat it
  as root on the node. The agent's adbd runs as root, and so does the ADB
  shell users get in the browser and over SSH. Dedicate nodes to
  sessions (`nodeSelector`/`tolerations`), run Holtdroid in its own
  namespace, and let only people you trust with those nodes open sessions
  (`allowedGroups`), or turn the ADB tools off (`adb.browser: false`, no
  SSH gateway).
- **Untrusted code.** APKs are third-party binaries running in a rooted
  Android. Apps don't get root themselves, but their network traffic is
  real: without a VPN (or on the `direct` location) it leaves from your
  nodes' network. Keep `vpn.bypassCIDRs` minimal, set `vpn.direct: false` if
  devices must never egress directly, and consider a NetworkPolicy that
  stops session Pods from reaching anything in-cluster except the api and
  the VPN gateway.
- **The VPN gateway** holds your VPN credentials and relays plain SOCKS
  inside the cluster. Only session Pods should reach it; see
  [Shared VPN gateway](/operations/vpn-gateway/).
- **The SSH gateway** (optional) lets a user's connected computers reach
  their own devices' ADB, which on redroid is a root shell on the node's
  kernel without an authorization prompt, and publish ports on their loopback. It never runs
  commands or forwards anywhere else, and accepts only short-lived
  certificates the api signs with `sshGateway.caKey`. Anyone who runs a
  user's connect command within its 10 minutes enrolls a computer as that
  user, so the command is as sensitive as a password while it is fresh.
  Single computers can't be revoked yet; changing `caKey` revokes all of
  them. Each computer also gets 15-minute bearer tokens for the portal's
  API with its user's rights. A computer in the client's **Dev servers** (the
  default) or **Everything** publish mode exposes its local services to every device
  of its user without asking per port. Leave `sshGateway.insecureTLS` off unless the
  portal has a self-signed certificate. See
  [Connecting your computer](/concepts/ssh/).
- **ADB tools in the browser** (on by default) give a session's owner and
  admins ADB on its device. On emulators that ADB is root on the node's
  kernel, so by default it only runs the commands behind the Logcat and Files
  tabs and the app and device cards (`redroid.shell: allowlist`); `redroid.shell: full`
  adds a root Terminal and should stay off unless the session nodes hold
  nothing else. `adb.ownerOnly: false` extends the tools to everyone who may
  open the session, `adb.browser: false` turns them off; see
  [ADB tools](/concepts/adb/).
- **APK downloads** (on for everyone by default): anyone who can see a
  build can save it to their computer. Set `downloads.adminOnly: true` when
  builds must not leave the portal; see
  [Downloads](/sources/overview/#downloads).
- **The GPS map** makes the api fetch tiles from `map.url` (OpenFreeMap by
  default) for signed-in users. Only the path is forwarded, with the api's
  own User-Agent and no cookies; set `map.url: ""` if the api must not reach
  the internet. GPS routes along roads send the clicked points to
  `routing.url` (the public FOSSGIS Valhalla by default) the same way; set
  `routing.url: ""` to keep them in.
- **Who can get in.** The default `anonymous` mode lets anyone who reaches the
  URL launch devices. Put it on a private network, or use `password`, `oidc`
  or `header` — see [Authentication](/configuration/authentication/).
  With `header` the api trusts the forward-auth proxy completely, so never
  expose it without that proxy.
- **The session key signs every identity.** Treat `auth.sessionKey` like a
  password: whoever has it can mint sessions for any user name.

## What the chart does for you

- The api's internal port (artifact downloads for agents, session lookups
  for the SSH gateway) is a separate Service and is never routed by the
  ingress.
- Session agents accept connections only from the api, and on their tunnel
  port only from the SSH gateway (NetworkPolicy).
- Every service except the session's `android` and `agent` containers runs as non-root
  with a read-only root filesystem.
- Secrets are only referenced in config and resolved in memory; they are
  never logged.

## Reporting vulnerabilities

Please use GitHub's private vulnerability reporting on the repository rather
than public issues.
