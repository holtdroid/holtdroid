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
  `grep -cE 'vmx|svm' /proc/cpuinfo` must be non-zero, and the `kvm_intel`
  or `kvm_amd` module loaded.
- Nested virtualization (a VM as node) needs it enabled on the hypervisor
  (Proxmox: CPU type `host`; VMware: "Expose hardware assisted
  virtualization").
- Check the emulator logs: `kubectl -n holtdroid logs <session> -c emulator`.
  The emulator and the agent share that container; agent lines are JSON.
- Images built for one architecture: the session image is `linux/amd64`
  only. arm64 nodes can't run it.

## Install fails with `INSTALL_FAILED_NO_MATCHING_ABIS`

The session image is Android 15 x86_64 with ARM translation
(`libndk_translation`), which runs `arm64-v8a` libraries. APKs that ship only
32-bit ARM libraries (`armeabi-v7a` without `arm64-v8a`) can't be installed:
no Android 12–15 x86_64 image translates 32-bit ARM. Ask for a build that
includes `arm64-v8a` (or `x86_64`).

## App installs but crashes immediately

- ARM-only native libraries run through Android's ARM translation layer;
  a few libraries (heavy NEON assembly, JIT engines, some DRM) don't work
  under it. `adb logcat` through an [SSH tunnel](/holtdroid/concepts/ssh/)
  shows `libndk_translation` in the crash's backtrace.
- The app may detect root, an emulator or Frida and exit. The agent log shows
  the Frida spawn and the app's exit. Holtdroid never repackages an APK, so
  such apps need a build without the checks.

## Frida doesn't attach

The agent starts the app under Frida to turn on WebView debugging; nothing
in the APK changes.

- The session fails with `adb root: …` or `start frida-server: …`: after
  boot the agent runs `adb root`, pushes `frida-server` and starts it.
  Images without `adb root` (Google Play images) can't do that, which is why
  sessions use `google_apis` images.
- Only the app's main process is instrumented. A WebView in another
  process of the app may show up without debugging enabled.
- Apps started from the launcher are instrumented too: the agent gates
  spawns and attaches before the app resumes.
- Upgrading Frida means bumping `frida-go` and `FRIDA_VERSION` in
  `images/session.Dockerfile` together: the agent's devkit and the device's
  `frida-server` must be the same version.
- Building the session image on Apple Silicon works, running the agent there
  under Rosetta doesn't (Frida needs `eventfd`). Test on an amd64 node.

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

## No metrics or audit lines

- Metrics are off until `telemetry.metrics.listen` is set (chart:
  `telemetry.metrics.enabled`). `curl <pod>:9090/metrics` from inside the
  cluster; session pods only accept scrapes from `telemetry.metrics.from`.
- The `PodMonitor` needs the Prometheus Operator CRDs, and your Prometheus
  usually only picks monitors with its own release label
  (`telemetry.metrics.podMonitor.labels`).
- Audit lines go to **stdout**, regular logs to stderr. A collector that only
  reads one stream misses the other. Filter on `"log":"audit"`.
- `holtdroid_audit_dropped_total{sink="webhook"}` growing: the webhook is
  down or slow; the api log says why (`audit webhook dropped a batch`).
