---
title: Troubleshooting
description: Common problems with KVM, ARM translation, Frida, DevTools and VPN.
sidebar:
  order: 2
---

## Session stuck in `provisioning`

- `kubectl -n holtdroid describe pod <session>`: usually the session image is
  still being pulled (several GB) or no node matches `nodeSelector`/
  `tolerations` with a free slot.
- Enable the pre-pull DaemonSet to avoid the pull on first use.

## Session fails in `booting`

- `ls -l /dev/kvm` on the node. Without KVM the emulator refuses to start.
- Nested virtualization (a VM as node) needs it enabled on the hypervisor.
- Check the emulator logs: `kubectl -n holtdroid logs <session> -c emulator`.

## App installs but crashes immediately

- ARM-only native libraries run through Android's ARM translation layer;
  a few libraries don't work under it.
- The app may detect root, an emulator or Frida and exit. The agent log shows
  the Frida spawn and the app's exit.

## DevTools shows no targets

- The app has not created a WebView yet; targets appear as soon as it does.
- If the app starts WebViews in a separate process, pick that process in the
  target selector.
- Check the agent's `/v1/devtools/targets` through the portal:
  `https://<portal>/s/<session>/v1/devtools/targets`.

## DevTools panel stays blank

The DevTools frontend is fetched from Google's frontend host the first time a
WebView revision is seen, then cached. Session Pods need outbound HTTPS for
that first fetch.

## VPN location doesn't change the IP

- `bypassCIDRs` must not contain the address range of the VPN servers.
- The sidecar logs `lookup ….cluster.local: … mdns: query timeout`: sing-box
  sends `*.local` names to mDNS. Set `vpn.resolver` to your cluster DNS IP
  (`kubectl -n kube-system get svc kube-dns`).
- A WireGuard tunnel that drops whenever another session starts: the same
  key is in use from several places (other session Pods, or a client outside
  Holtdroid on the same server). Move WireGuard into a
  [shared VPN gateway](/holtdroid/operations/vpn-gateway/) and give it
  servers nobody else uses with that key.
- WireGuard logs `sendmmsg: message too long`: lower its `mtu` to 1280 on
  overlay networks.
