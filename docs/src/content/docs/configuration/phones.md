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
| VPN locations                        | Not yet                                                                                            |

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
currently 3.3.3).

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

## After a session

When a session ends, the phone stays busy until the provider has put it
back: the app is uninstalled, the device settings the portal offers are
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
