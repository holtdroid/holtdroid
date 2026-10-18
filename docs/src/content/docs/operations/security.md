---
title: Security
description: Threat model and hardening notes for running Holtdroid.
sidebar:
  order: 1
---

## What you are running

- **Privileged session Pods.** The emulator needs `/dev/kvm` and the VPN
  sidecar needs `NET_ADMIN` and a TUN device. Treat nodes that host
  sessions as dedicated: use `nodeSelector`/`tolerations`, and run Holtdroid in
  its own namespace.
- **Untrusted code.** APKs are third-party binaries running in a rooted
  Android. They are contained by the emulator, but their network traffic is
  real: without a VPN (or on the `direct` location) it leaves from your
  nodes' network. Keep `vpn.bypassCIDRs` minimal, set `vpn.direct: false` if
  devices must never egress directly, and consider a NetworkPolicy that
  stops session Pods from reaching anything in-cluster except the api and
  the VPN gateway.
- **The VPN gateway** holds your VPN credentials and relays plain SOCKS
  inside the cluster. Only session Pods should reach it; see
  [Shared VPN gateway](/holtdroid/operations/vpn-gateway/).
- **The SSH gateway** (optional) lets a user's connected computers reach
  their own devices' ADB, which on emulators is a root shell without an
  authorization prompt, and publish ports on their loopback. It never runs
  commands or forwards anywhere else, and accepts only short-lived
  certificates the api signs with `sshGateway.caKey`. Anyone who runs a
  user's connect command within its 10 minutes enrolls a computer as that
  user, so the command is as sensitive as a password while it is fresh.
  Single computers can't be revoked yet; changing `caKey` revokes all of
  them. See [Connecting your computer](/holtdroid/concepts/ssh/).
- **ADB tools in the browser** (on by default) give a session's owner and
  admins a root shell on its emulator. `adb.ownerOnly: false` extends them to
  everyone who may open the session, `adb.browser: false` turns them off;
  see [ADB tools](/holtdroid/concepts/adb/).
- **Who can get in.** The default `anonymous` mode lets anyone who reaches the
  URL launch devices. Put it on a private network, or use `password`, `oidc`
  or `header` — see [Authentication](/holtdroid/configuration/authentication/).
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
- Every service except the session's emulator container runs as non-root
  with a read-only root filesystem.
- Secrets are only referenced in config and resolved in memory; they are
  never logged.

## Reporting vulnerabilities

Please use GitHub's private vulnerability reporting on the repository rather
than public issues.
