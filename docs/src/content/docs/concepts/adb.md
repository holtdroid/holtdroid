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
- **Terminal** is a root shell on emulators, with a real terminal (colours,
  `top`, line editing).
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

The rail next to the screen also records to an MP4 file. The video is
encoded in the browser and written to disk as it goes (the browser's
private storage), so a long recording doesn't fill the memory; the file is
downloaded when you stop. Hover **Record** to pick what it records; the
choices are remembered in the browser:

- **Device screen** (default): the screen in a phone frame. The first
  second and a half shows the Holtdroid logo with the app and the device
  details, then the screen fades in.
- **Screen and details**: a 1920×1080 scene with the logo, the app (icon,
  name, package, version), the device (model, Android, slot, density,
  locale, time zone, VPN location, theme), the elapsed time, the framed
  screen, and the tool panel next to the screen as it is on the page:
  DevTools, Logcat or whichever tab is open. The browser asks to share
  this tab once per recording and records only that panel of it (element
  capture, Chromium); with **Also share tab audio** the tab's sound goes
  into the file. Where the browser can't capture a part of the page the
  scene has no panel.
- **Record automatically** starts recording in the chosen mode as soon as
  the screen connects and saves the file when you stop it or leave the
  session page. With **Screen and details** it starts without the panel
  and a toast offers to include it, because the browser only asks after a
  click.

The frame follows the device when it rotates and keeps its proportions when
the browser window is resized. If the tab closes mid-recording, the next
session page offers to download what was written: it plays up to where it
stopped.

## Configuration

```yaml
adb:
  browser: true # session pages may open ADB
  ownerOnly: true # only a session's owner and admins may
```

On emulators ADB is a root shell without an authorization prompt, so anyone
with the tools can run anything on that device. With `ownerOnly` (the
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

The browser keeps an ADB key in its storage; emulators don't ask for it.
