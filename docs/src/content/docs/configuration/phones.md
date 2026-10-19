---
title: Phone provider
description: Run sessions on real Android phones plugged into a host over USB, with or without root.
sidebar:
  order: 6
---

The `provider-physical` service turns phones plugged into one host into
session slots: one phone is one slot. It runs on that host, next to its adb
server, and runs every session's device agent in its own process. A phone
runs without root by default; a rooted phone (Magisk) can be marked
`root: true` for more — see [Root mode](#root-mode).

:::caution[Early stage]
Phones are a work in progress, and the protections a phone needs are not all
in place yet (no device-owner app, and root mode still grants `su` to the
shell uid — see [Root mode](#root-mode)), so give phone sessions only to
people you trust with the phone.
:::

## What works without root

| Feature                              | On a phone without root                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Screen, audio, keyboard, clipboard   | Yes, through scrcpy as on the emulator                                                                                   |
| Install, reinstall, other builds     | Yes                                                                                                                      |
| DevTools                             | Only for **debuggable** builds: release builds need Frida, which needs root                                              |
| Device settings (dark mode, font, …) | Mostly. The language is the app's own, not the system's; battery level, network emulation and fake GPS are emulator-only |
| Logcat, browser ADB, ADB tunnels     | Yes, through a filtering proxy: see [ADB on phones](#adb-on-phones)                                                      |
| App data save and restore            | No: reading another app's private files needs root                                                                       |
| VPN locations                        | Yes, over the USB cable through the Holtdroid Tunnel app: see [VPN on phones](#vpn-on-phones)                            |

The session page knows which phone it runs on (`capabilities` on the
session) and hides what isn't there.

## Preparing a phone

1. Turn on **Developer options** and **USB debugging**, plug the phone into
   the host and accept the host's key on the phone (tick _Always allow_).
2. Turn on **Stay awake** in Developer options; the provider also runs
   `svc power stayon usb` when a session starts.
3. Remove the lock screen PIN, or the session starts on the lock screen.
4. Note the serial from `adb devices`.

## Helm chart

On Kubernetes, plug the phones into one node and enable the provider in the
chart; the api gets it as a provider by itself:

```yaml
providers:
  physical:
    enabled: true
    name: phones
    nodeName: k3s-1 # a kubernetes.io/hostname selector; or nodeSelector
    phones:
      - { serial: R92X632WPYV, label: Galaxy A05 }
    vpn: {} # the same locations as providers.emulator.vpn
    config: # anything else of the provider's config
      adb: { shell: allowlist }
```

Phones come before emulators in the api's `providers`, so an **Any** launch
takes a free phone first.

The pod runs on that node's **host network** (adb only notices a phone
reconnecting on USB through hotplug events, which reach the host's network
namespace), as root and privileged so it can open the USB devices, with
`/dev/bus/usb` and a host directory `stateDir`
(`/var/lib/holtdroid-physical`) for the state file and adb's key. It
listens on the node's `port` (18580) and `tunnelPort` (18581), without
authentication: keep them closed to the outside with the host firewall
(pods reach them over the cluster interfaces). Secrets referenced in `vpn`
come from `existingSecret` like the other components'. Only one adb server
may run on that node.

## Running it

The host needs `adb` (platform-tools) and the scrcpy server the agent pushes
to the phone (`scrcpy-server` of the version in the session image,
currently 3.3.3). For VPN locations it also needs `sing-box` and the
Holtdroid Tunnel APK, see [VPN on phones](#vpn-on-phones).

```sh
holtdroid provider-physical --config physical.yaml
```

Or run the image `ghcr.io/kriakiku/holtdroid-physical` (linux/amd64), which
has all of that pinned: adb, scrcpy-server, sing-box and the Holtdroid
Tunnel APK (`tunnel.apk` already points at it, and its version is read from
the APK). It runs as uid 65532 and keeps its state and adb's key in
`/var/lib/holtdroid`; mount a volume there, or every new container is a new
adb host and each phone asks again to allow USB debugging. The container
needs the host's network (adb learns that a phone reconnected on USB from
the kernel's hotplug events, which only reach the host's network
namespace; without it a rebooted or re-enumerated phone stays gone until
adb restarts), the host's USB devices (`/dev/bus/usb`) and permission to
open them:
either a udev rule on the host that gives a group access to the phones
(for example NixOS `programs.adb.enable`, group `adbusers`) and that group
as a supplementary group of the container, or root in the container.

```sh
docker run -d --name phones --network host \
  --device /dev/bus/usb --group-add "$(getent group adbusers | cut -d: -f3)" \
  -v phones:/var/lib/holtdroid -v "$PWD/physical.yaml:/etc/holtdroid/physical.yaml:ro" \
  ghcr.io/kriakiku/holtdroid-physical:main provider-physical -c /etc/holtdroid/physical.yaml
```

Only one adb server may own a phone: stop any other `adb` on that host.
On the host network the provider's `listen` and `tunnelListen` ports are
open on the host's interfaces and have no authentication of their own:
firewall them so that only the api and the ssh-gateway reach them.

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
    root: false # true for a Magisk-rooted phone, see Root mode
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

| Key                    | Default                   | Meaning                                                                                                                                                      |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `adb.bin`              | `adb`                     | The adb CLI the provider runs                                                                                                                                |
| `adb.server`           | `127.0.0.1:5037`          | The host adb server user ADB goes through; the one `adb.bin` uses                                                                                            |
| `adb.shell`            | `allowlist`               | Shell commands users may run over ADB: `full`, `allowlist` or `off` (see below)                                                                              |
| `phones[]`             | `[]`                      | The inventory: `serial` from `adb devices`, an optional `label`, and `root: true` for a rooted phone (see [Root mode](#root-mode)). Other phones are ignored |
| `stateFile`            | `holtdroid-physical.json` | Sessions, pending resets, baselines and maintenance holds; a restart picks them up again                                                                     |
| `refresh`              | `5s`                      | How often the provider checks which phones are connected                                                                                                     |
| `resetTimeout`         | `5m`                      | How long cleaning a phone after a session may take                                                                                                           |
| `phone.bootTimeout`    | `2m`                      | How long a session waits for its phone to show up                                                                                                            |
| `phone.poll`           | `5s`                      | How often a session checks that its phone is still connected                                                                                                 |
| `phone.misses`         | `3`                       | Missed checks in a row after which the session fails with "phone disconnected"                                                                               |
| `phone.suspend`        | Settings, Contacts, …     | Packages kept suspended so sessions can't open them (see below)                                                                                              |
| `phone.protectBattery` | `true`                    | Turn on Samsung's _Protect battery_ (charging stops at 80% on One UI 6): phones stay plugged in                                                              |
| `vpn.*`                | no locations              | Locations, exactly as for the [emulator provider](/holtdroid/configuration/emulator/#vpn)                                                                    |
| `singBox`              | `sing-box`                | The sing-box binary the provider runs per session when `vpn.locations` is set                                                                                |
| `tunnel.apk`           |                           | Holtdroid Tunnel APK, installed on a phone when it is missing or not `tunnel.version`                                                                        |
| `tunnel.version`       |                           | The version `tunnel.apk` is; empty installs only when the app is missing                                                                                     |
| `tunnel.port`          | `29180`                   | The phone-side port of the tunnel's `adb reverse`; don't publish it from a computer                                                                          |
| `tunnel.ipv6`          | `true`                    | Give the phone IPv6 through the tunnel                                                                                                                       |

A phone is `offline` in the launch dialog while adb doesn't list it as
`device` (unplugged, `unauthorized`, booting).

## Inventory and maintenance

The admins' **Inventory** page lists every phone of `phones[]` with what adb
tells about it without root: maker, model and code name, Android version and
API level, build and security patch, ABIs, cores, memory, storage on
`/data`, uptime, the battery (level, charging, health, temperature, voltage)
and every sensor `dumpsys thermalservice` reports. A phone that isn't
connected or authorized shows its adb state instead. The host the phones
hang off is shown above them (CPU, memory, load, its sensors).

**Hold** a phone to keep sessions off it while you swap a cable, update it
or let it cool down; a session already running finishes normally. Holds are
kept in the state file.

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

| `adb.shell` | Shell commands                                                                                                                                                                                                                                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `full`      | Anything the `shell` user may run, including an interactive shell                                                                                                                                                                                                                                                                                         |
| `allowlist` | Single commands from a short list: `getprop`, `logcat`, `am`, `pm list …`, `pm install…` and `cmd package install…`/`list` (what `adb install` and IDEs use), `settings get …` and the session page's read-only `dumpsys` calls (`package`, `battery`, `webviewupdate`, `deviceidle get`). No interactive shell, no `;`, `&&`, pipes, redirects or `$(…)` |
| `off`       | None                                                                                                                                                                                                                                                                                                                                                      |

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

## Sound, microphone and camera

A phone sits in someone's room, so it should neither play sound nor hear
or see anything:

- **Sound** goes only to the browser. A phone session keeps one audio
  capture running from start to end and shares it with every viewer; while
  scrcpy captures the output, Android doesn't play it on the phone, so the
  phone stays silent even when nobody has the session's sound on. Between
  sessions every volume is at zero (alarms at their lowest).
- **Microphone**: the phone's _Microphone access_ privacy toggle is turned
  off, so apps record silence. Without the device owner a user can turn it
  back on from the system prompt; the agent turns it off again on every poll.
- **Camera**: where the phone has a _Camera access_ toggle it is turned off
  the same way and apps see a blank picture. Many phones (the Galaxy A05,
  for one) don't have it. Android without root can't feed apps a fake
  camera picture; cover the lens, with a sticker of any picture if you like.

## Cleaning a phone

The first time the provider sees a phone free, it records a **baseline**:
the packages installed for the phone's user and every global, secure and
system setting. It keeps it in the state file. Before every session and
after it, the phone is cleaned against that baseline:

- the tunnel is stopped and background apps are killed;
- every package that wasn't in the baseline is uninstalled, and baseline
  packages someone removed are installed again (`install-existing`);
- the data of every app on the launcher is cleared (browsers, gallery,
  files, …), except Settings, the launcher and Holtdroid Tunnel, and the apps
  in recents are closed;
- shared storage (`/sdcard`: photos, downloads, documents) is wiped; the
  standard directories stay, empty, and `Android/` is left alone;
- the portal's device settings are undone, every setting that differs from
  the baseline is put back and every setting added since is deleted (an
  `http_proxy`, say); settings the system keeps changing, such as counters
  and timestamps, are left alone;
- Bluetooth, NFC and location are turned off. With VPN locations, Wi-Fi and
  mobile data are turned off and every saved Wi-Fi network is forgotten, so
  the phone's only network is the tunnel; without them, Wi-Fi and mobile
  data are turned on;
- every adb forward and reverse is dropped.

After a session the phone is then parked: battery saver on, lowest
brightness, screen off and locked, no longer kept awake on USB. Before a
session it is woken with its baseline brightness and battery saver off.
The phone stays busy until the cleanup is done; a cleanup cut off by a
restart runs again on the next start.

The baseline is the phone as it was then, so plug in a phone the way it
should look for every session. To record it again, stop the provider and
remove the phone from `baselines` in the state file.

Battery level and charging are an emulator's simulation; a phone offers only
battery saver without root. Fake GPS and network emulation are emulator-only
too. A rooted phone gets the battery, GPS and clock back — see
[Root mode](#root-mode).

Apps a session must not open are kept **suspended** (`pm suspend`, no root
needed): Settings (so no PIN, Developer options, USB debugging or resets),
Contacts, Messages, SOS, Galaxy Store, Samsung account, Samsung's
updaters, Smart Switch and the Camera app. Opening one shows Android's "app
paused" dialog. Android won't suspend the default dialer, launcher or
installer, and emergency calls always work. The list is `phone.suspend`;
the app under test is never suspended. To use Settings on the phone
yourself, run `adb shell pm unsuspend com.android.settings`; the next
cleanup suspends it again.

Without root the system language can't be changed, so on phones the
language control sets the app's own language (Android 13+,
`cmd locale set-app-locales`), and keyboard languages are chosen in the
phone's keyboard; a rooted phone sets the system language instead. A global proxy left by a user is cleared with
`settings put global http_proxy :0`; deleting the setting alone leaves it
applied.

What the cleanup can't do without the device-owner part of Holtdroid
Tunnel: clear a lock screen PIN set before Settings was suspended, block
the power menu, disable the camera hardware for every app.

## Device owner

Every phone gets [Holtdroid Tunnel](https://github.com/kriakiku/holtdroid-tunnel)
(also without VPN locations): it draws the session's wallpaper, the same
one an emulator shows. Made the phone's **device owner**, it also locks the
phone down:

- no accounts, factory reset, safe mode, network reset, new users or work
  profiles, outgoing calls or SMS, Wi-Fi/Bluetooth/tethering/mobile network
  or VPN/private DNS changes, APKs from the browser (USB file transfer stays
  allowed: switching it off makes the phone reconnect on USB, and the cable
  ends at the provider's host);
- the camera disabled for every app (the microphone and camera toggles
  are left to the cleanup, which keeps them blocked: freezing them through
  the device owner turns access back on);
- no lock screen, and a PIN someone set is removed after every session;
- the tunnel is the always-on VPN with lockdown: no traffic leaves the phone
  outside it;
- system updates postponed;
- every session runs in a **soft kiosk** (lock task): the user goes home and
  switches between the apps on the launcher, but Settings, stores, account
  apps and the power menu are out of reach. Emergency calls always work.

The agent finds out by itself whether the app is the device owner. To make
it one (once per phone; the phone must have no accounts and one user;
block the microphone and camera before, which the provider's cleanup
does):

```sh
adb shell dpm set-device-owner io.github.kriakiku.holtdroid.tunnel/.AdminReceiver
```

Only provision with a release-signed APK (v0.2.1 and later, certificate
SHA-256 `FB:A4:C1:7B:…:3C:80`): a device owner can only be updated by an APK
signed with the same key. The image ships one. To undo it:

```sh
adb shell am broadcast -n io.github.kriakiku.holtdroid.tunnel/.ControlReceiver -a io.github.kriakiku.holtdroid.tunnel.RELEASE
```

## Root mode

Mark a Magisk-rooted phone `root: true` and its sessions gain what needs
root. The agent escalates through Magisk's `su`, so the phone must grant it
to the shell uid (Magisk Superuser → the shell app). Root mode adds, all
undone when the session ends:

- **Frida**: the app under test is instrumented as on the emulator, so
  **release builds get DevTools**, not only debuggable ones.
- **System language and clock**, battery level and charging, and **app data
  save and restore** — all the device settings that are emulator-only
  without root.
- **GPS and clock follow the VPN location**: give each location a `geo`
  (centre and radius, default 10&nbsp;km) and a `timezone`; switching
  location drops the phone at a random point in that radius and sets the
  zone, quietly. The real position is never exposed (the real providers are
  overridden). A per-session **Override** toggle on the session page pins a
  manual position; it is not kept after the session.
- **Root hidden** from the app under test (added to the Magisk DenyList).
- **A transparent tunnel** instead of the VpnService one: a sing-box `tun`
  started as root takes the phone's default route, so the app sees an
  ordinary Wi-Fi connection, not a VPN. Traffic still leaves through the
  host's per-session sing-box over the USB cable, and the default route is
  swung into the tun only while that egress is healthy, so a dead proxy
  fails fast instead of hanging the phone.
- **A calls lockdown**: airplane mode (Wi-Fi back on for the tunnel), the
  dialer and emergency apps disabled, and the lock screen off so its
  emergency button is gone.

```yaml
phones:
  - serial: 1A2B3C4D5E6F
    root: true
vpn:
  default: pl
  locations:
    - id: pl
      label: Poland
      timezone: Europe/Warsaw
      geo: { lat: 52.2297, lng: 21.0122, radius: 10000 }
      outbound: { type: socks, server: vpn-gateway.example, server_port: 1080 }
```

:::danger[Emergency calls]
Android does not let anything block emergency calls — not even a device
owner. The lockdown only removes the on-screen ways to dial; the real
guarantee that a session can't call 112/911 is a phone with **no SIM and no
usable cellular signal**. Run the farm phones that way.
:::

Root mode is transitional: it grants `su` to the shell uid, so a user with
`adb.shell: full` would inherit root (phones default to `allowlist`). The
hardening that keeps root from users — a token-authenticated frida-server
and `su` denied to the shell uid, with a watchdog — is still to come, as is
the network-speed profile on phones whose kernel has no traffic shaping.

## What is still missing

Phones are not disposable like emulators, so a phone still needs more than it
has: the root hardening that keeps root from users (above), a deeper cleanup
with a check before a phone is offered again, and power cycling through the
USB hub. [Rooting a phone](/holtdroid/configuration/rooting/) is written up
separately, as a record of what it takes and costs on one device.
