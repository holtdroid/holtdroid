---
title: Phone provider
description: Run sessions on real Android phones plugged into a host over USB, without root.
sidebar:
  order: 6
---

The `provider-physical` service turns phones plugged into one host into
session slots: one phone is one slot. It runs on that host, next to its adb
server, and runs every session's device agent in its own process. The phones
need no root.

:::caution[Early stage]
Phones are a work in progress. Today a phone runs without root and without
most of the protections it needs, so give phone sessions only to people you
trust with the phone.
:::

## What works without root

| Feature                              | On a phone without root                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Screen, audio, keyboard, clipboard   | Yes, through scrcpy as on the emulator                                                             |
| Install, reinstall, other builds     | Yes                                                                                                |
| DevTools                             | Only for **debuggable** builds: release builds need Frida, which needs root                        |
| Device settings (dark mode, font, …) | Mostly. The system language, system time, network emulation and fake GPS need root or the emulator |
| Logcat, browser ADB, ADB tunnels     | Yes, through a filtering proxy: see [ADB on phones](#adb-on-phones)                                |
| App data save and restore            | No: reading another app's private files needs root                                                 |
| VPN locations                        | Yes, over the USB cable through the Holtdroid Tunnel app: see [VPN on phones](#vpn-on-phones)      |

The session page knows which phone it runs on (`capabilities` on the
session) and hides what isn't there.

## Preparing a phone

1. Turn on **Developer options** and **USB debugging**, plug the phone into
   the host and accept the host's key on the phone (tick _Always allow_).
2. Turn on **Stay awake** in Developer options; the provider also runs
   `svc power stayon usb` when a session starts.
3. Remove the lock screen PIN, or the session starts on the lock screen.
4. Note the serial from `adb devices`.

## Running it

The host needs `adb` (platform-tools) and the scrcpy server the agent pushes
to the phone (`scrcpy-server` of the version in the session image,
currently 3.3.3). For VPN locations it also needs `sing-box` and the
Holtdroid Tunnel APK, see [VPN on phones](#vpn-on-phones).

```sh
holtdroid provider-physical --config physical.yaml
```

```yaml
listen: ":8080" # provider API and the session agents, for the api
tunnelListen: ":8081" # tunnel endpoints, for the ssh-gateway only
publicURL: http://phones.homelab.example:8080 # how the api reaches this host
tunnelURL: http://phones.homelab.example:8081 # how the ssh-gateway reaches it
adb:
  bin: adb
  server: 127.0.0.1:5037 # the adb server `bin` talks to
  shell: allowlist # full | allowlist | off
stateFile: /var/lib/holtdroid/physical.json
phones:
  - serial: 1A2B3C4D5E6F
    label: Pixel 7 on the desk # default: the phone's model
agent:
  scrcpy:
    server: /opt/scrcpy/scrcpy-server
    version: 3.3.3
```

Then add it to the api's `providers`:

```yaml
providers:
  - name: phones
    url: http://phones.homelab.example:8080
```

| Key                 | Default                   | Meaning                                                                                      |
| ------------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| `adb.bin`           | `adb`                     | The adb CLI the provider runs                                                                |
| `adb.server`        | `127.0.0.1:5037`          | The host adb server user ADB goes through; the one `adb.bin` uses                            |
| `adb.shell`         | `allowlist`               | Shell commands users may run over ADB: `full`, `allowlist` or `off` (see below)              |
| `phones[]`          | `[]`                      | The inventory: `serial` from `adb devices` and an optional `label`. Other phones are ignored |
| `stateFile`         | `holtdroid-physical.json` | Sessions and pending resets; a restart picks them up again without reinstalling the app      |
| `refresh`           | `5s`                      | How often the provider checks which phones are connected                                     |
| `resetTimeout`      | `2m`                      | How long putting a phone back after a session may take                                       |
| `phone.bootTimeout` | `2m`                      | How long a session waits for its phone to show up                                            |
| `phone.poll`        | `5s`                      | How often a session checks that its phone is still connected                                 |
| `phone.misses`      | `3`                       | Missed checks in a row after which the session fails with "phone disconnected"               |
| `vpn.*`             | no locations              | Locations, exactly as for the [emulator provider](/holtdroid/configuration/emulator/#vpn)    |
| `singBox`           | `sing-box`                | The sing-box binary the provider runs per session when `vpn.locations` is set                |
| `tunnel.apk`        |                           | Holtdroid Tunnel APK, installed on a phone when it is missing or not `tunnel.version`        |
| `tunnel.version`    |                           | The version `tunnel.apk` is; empty installs only when the app is missing                     |
| `tunnel.port`       | `29180`                   | The phone-side port of the tunnel's `adb reverse`; don't publish it from a computer          |
| `tunnel.ipv6`       | `true`                    | Give the phone IPv6 through the tunnel                                                       |

A phone is `offline` in the launch dialog while adb doesn't list it as
`device` (unplugged, `unauthorized`, booting).

## ADB on phones

Users never reach the phone's adbd directly. The session agent speaks the
device side of the adb protocol itself (without an authorization prompt:
the portal or the SSH gateway has already signed the user in), reads the
service of every stream a client opens and replays allowed ones through the
host's adb server. The portal's ADB tools in the browser and
[ADB over SSH](/holtdroid/concepts/ssh/) both go through it.

Always refused: `reboot` (any mode), `root`, `unroot`, `remount`, `tcpip`,
`usb`, `sideload`, `disable-verity`, `enable-verity`, reverse forwards
(`adb reverse` would reach the provider's host, not the user's computer;
publish ports with the holtdroid client instead) and forwards to the
frida-server ports 27042 and 27043.

A shell command can't be filtered reliably (`sh -c`, `eval`, base64), so
`adb.shell` decides how much shell users get:

| `adb.shell` | Shell commands                                                                                                                                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `full`      | Anything the `shell` user may run, including an interactive shell                                                                                                                                                            |
| `allowlist` | Single commands from a short list: `getprop`, `logcat`, `am`, `pm list …`, `pm install…` and `cmd package install…`/`list` (what `adb install` and IDEs use). No interactive shell, no `;`, `&&`, pipes, redirects or `$(…)` |
| `off`       | None                                                                                                                                                                                                                         |

File transfer (`adb push`/`pull`, the Files tab), debuggers (`jdwp`), port
forwards (`adb forward`, Chrome's remote inspection) and screenshots work with
every setting. With `allowlist` the session page's Logcat, crash toasts, deep
links, force stop and the Files tab's listing, upload and download work; its
Terminal, Files' delete and new folder, and most App and Device tools
(permissions, clear data, doze, WebView provider, demo mode, bug reports)
fail. Android Studio's own deploy uses an installer of its own and needs
`full`. Give `full` only to people you trust with the phone: they can still
make it unusable until someone resets it by hand.

## VPN on phones

With `vpn.locations` set, a phone reaches the internet only through the
provider's host, over the same USB cable as ADB, and leaves where the
session's location says, as an emulator does:

```
app ─▶ Holtdroid Tunnel (VpnService) ─▶ 127.0.0.1:29180 on the phone
        ─ adb reverse ─▶ sing-box of the session on the host ─▶ location
```

For every session the provider starts its own `sing-box` with a `mixed`
inbound and the clash API on random loopback ports and the locations from
`vpn` (secret references are resolved into a config file that only the
provider can read and that is deleted with the session). When the phone is
up, the agent installs [Holtdroid Tunnel](https://github.com/kriakiku/holtdroid-tunnel)
if needed, grants it the VPN consent with `appops`, turns Wi-Fi and mobile
data off, maps the port with `adb reverse` and starts the tunnel. It checks
the tunnel on every poll and starts it again when it is down. The location
switcher, the egress IP and country work as on the emulator; DNS and UDP
(QUIC) travel through the tunnel too.

```yaml
singBox: /usr/local/bin/sing-box
tunnel:
  apk: /opt/holtdroid/holtdroid-tunnel-0.1.0.apk
  version: 0.1.0
vpn:
  default: pl
  locations:
    - id: pl
      label: Poland
      outbound: { type: socks, server: vpn-gateway.example, server_port: 1080 }
```

Download the APK from the
[tunnel's releases](https://github.com/kriakiku/holtdroid-tunnel/releases).
Without `vpn.locations` nothing changes: the phone uses its own Wi-Fi or
mobile data and the session has no location switcher.

Unlike the emulator, where the VPN lives outside the device, the app under
test can see that a VPN is active (`TRANSPORT_VPN`, a `tun0` interface).
Traffic to the `vpn.bypassCIDRs` leaves directly from the host, so the phone
reaches the host's private networks as an emulator reaches its cluster's.
After a restart a session's sing-box starts again at the session's first
location. Someone with `adb.shell: full` can turn the radios back on and
stop the tunnel; the agent starts the tunnel again within a poll.

## After a session

When a session ends, the phone stays busy until the provider has put it
back: the tunnel is stopped (it stays installed), the app is uninstalled, the device settings the portal offers are
reset (airplane mode, Wi-Fi, mobile data, battery simulation, battery
saver, font scale, density, size, rotation, automatic time), the agent's
files in `/data/local/tmp` are removed and every adb forward is dropped.
Anything else a user changes on the screen stays. A reset cut off by a
restart runs again on the next start.

## What is still missing

Phones are not disposable like emulators, so a phone needs protection that
the provider doesn't have yet: a device-owner app
that forbids accounts, factory reset and new users, root kept from users,
a deeper cleanup with a check before the phone is offered again, and power
cycling through the USB hub. Root mode with Frida, which gives DevTools for
release builds, comes together with those.
