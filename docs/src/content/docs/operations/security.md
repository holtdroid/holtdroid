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
- **Who can get in.** The default `anonymous` mode lets anyone who reaches the
  URL launch devices. Put it on a private network, or use `password`, `oidc`
  or `header` — see [Authentication](/holtdroid/configuration/authentication/).
  With `header` the api trusts the forward-auth proxy completely, so never
  expose it without that proxy.
- **The session key signs every identity.** Treat `auth.sessionKey` like a
  password: whoever has it can mint sessions for any user name.

## What the chart does for you

- The api's internal port (artifact downloads for agents) is a separate
  Service and is never routed by the ingress.
- Every service except the session's emulator container runs as non-root
  with a read-only root filesystem.
- Secrets are only referenced in config and resolved in memory; they are
  never logged.

## Reporting vulnerabilities

Please use GitHub's private vulnerability reporting on the repository rather
than public issues.
