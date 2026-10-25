---
title: ADB tools
description: Logcat, files, a terminal and app tools in the session page, over ADB in the browser.
sidebar:
  order: 6
---

The session page talks to the device's ADB itself, in the browser, so you
don't need `adb`, SSH or a key on your machine. The tools sit in tabs next to
DevTools:

- **Logcat** follows the main, system and crash buffers. By default it shows
  only lines from your app (matched by the app's user id, so it keeps working
  across restarts and covers all of its processes); switch to **Everything**
  for the whole device. Filter by level and text, pause, clear, and download
  what is shown. When the app crashes, a notification shows the first lines
  of the stack trace with a link to the log. The log is collected from the
  moment the device is ready and survives app restarts and installing another
  build.
- **Files** browses the device: shared storage, the app's private data
  (`/data/data/<package>`: shared preferences, databases, WebView cookies and
  storage), `/data/local/tmp` and the whole file system. Download files, upload
  them with the button or by dropping them onto the list (handy for testing
  file pickers), create folders and delete.
- **Terminal** is a shell with a real terminal (colours, `top`, line
  editing). On emulators it only appears when the provider allows arbitrary
  commands (`redroid.shell: full`); by default it is off, because that shell
  is root on the node running the session.
- **App** shows the installed version, opens deep links (`myapp://…` or
  `https://…`, optionally only in your app, with a history kept in the
  browser), grants and revokes runtime permissions, force-stops the app,
  clears its data, puts the device into deep doze and moves the app between
  standby buckets.
- **Device** shows the model, Android version, ABIs and build, the WebView
  version, and switches the WebView provider when the image has more than one
  (restart the app afterwards). **Demo mode** gives a clean status bar for
  screenshots: 12:00, full battery and signal, no notifications.
  **Download bundle** builds a zip with a screenshot, the logcat collected in
  the tab, device and app details, ready to attach to a bug; **Full Android bug
  report** runs Android's own `bugreportz`.

Recording a session is done by the server, with logcat and the device's
state next to the screen: see [Recordings](/holtdroid/concepts/recordings/).

## Configuration

```yaml
adb:
  browser: true # session pages may open ADB
  ownerOnly: true # only a session's owner and admins may
```

On emulators ADB is a root shell without an authorization prompt, so anyone
with the tools can run anything on that device, and because redroid shares
the node's kernel, root there reaches the node too (see
[Security](/holtdroid/operations/security/)). With `ownerOnly` (the
default) other users get only the screen and DevTools of sessions that aren't
theirs; set it to `false` to give everyone the tools, or `browser: false` to
turn them off. Each connection is
audited as `adb.connect` and `adb.disconnect`; see
[Monitoring and audit](/holtdroid/operations/monitoring/).

Requests that would restart adbd or the device or move ADB somewhere else
(`reboot`, `unroot`, `remount`, `tcpip`, `usb`, `sideload`, `disable-verity`)
are refused here and over [SSH](/holtdroid/concepts/ssh/), because they would
cut the session off from its own device. On phones the
[phone provider](/holtdroid/configuration/phones/#adb-on-phones) also refuses
`root`, reverse forwards and the frida-server ports, and limits shell
commands with `adb.shell`.

On emulators the same `redroid.shell` policy applies to the browser and the
`holtdroid` client: `allowlist` (the default) runs only the commands behind
the Logcat, Files, App and Device tabs, `full` runs anything and shows the
Terminal tab, `off` refuses every shell command. See
[Emulator provider](/holtdroid/configuration/emulator/#users-adb-inside-android).

The browser keeps an ADB key in its storage; emulators don't ask for it.
