---
title: Terminal
description: An interactive ADB shell on the session's device, in a tab of the session page.
sidebar:
  order: 12
---

The **Terminal** tab is `adb shell` in the browser: a full terminal on the
session's device, with colours, line editing and full-screen programs such
as `top`. Use it to poke at the device the way you would with a cable on
your desk: read a property, list processes, run `am` or `pm` by hand, look
at a file with `cat`. It works over [ADB in the browser](/holtdroid/concepts/adb/),
so you need nothing installed on your computer.

## When the tab appears

The tab sits after **Logcat** and **Files**. It needs everything the other
ADB tabs need:

- the server allows ADB in the browser (`adb.browser`, on by default);
- with `adb.ownerOnly` (the default), the session is yours or you are an
  admin;

and on top of that, the device must allow **any** shell command. That is
off by default: emulators show the tab only with `redroid.shell: full`
([Emulator provider](/holtdroid/configuration/emulator/#users-adb-inside-android)),
phones only with `adb.shell: full`
([ADB on phones](/holtdroid/configuration/phones/#adb-on-phones)). With the
default `allowlist` the device runs only the commands behind the other tabs,
and the Terminal tab isn't shown at all.

There is nothing to click or allow. The page connects to the device's ADB
once the device is first ready, and the tab shows **Connecting to ADB…**
until then. If the connection fails or drops, it shows
**Could not reach the device over ADB** with the reason and a **Reconnect**
button.

## What you see

A dark terminal that fills the tab, with the shell's prompt. The shell
starts the first time you open the tab and gets the focus, so you can type
right away. The terminal follows the size of the tab, and full-screen
programs redraw when you resize the window or the split between the device
and the tools.

Who the shell runs as depends on the device:

- **Emulators**: root. redroid's adbd runs as root, so the shell can read and
  change anything in Android, and because redroid shares the node's kernel,
  root there reaches the node too. That is why the tab is off by default; see
  [Security](/holtdroid/operations/security/).
- **Phones**: Android's `shell` user, the same as `adb shell` on your own
  phone. On a phone in root mode, `su` works from this shell.

The terminal keeps the last 5000 lines; scroll up with the mouse wheel.

## Common tasks

- **Type and edit commands** as in any terminal: arrow keys, history, tab
  completion and Ctrl+C to stop a command all go to the device's shell.
- **Paste** with the browser's paste shortcut.
- **Copy** by selecting text with the mouse and using the browser's copy
  shortcut (Cmd+C on macOS). Ctrl+C is sent to the shell as an interrupt,
  not a copy.
- **Switch tabs.** The shell keeps running while you look at DevTools,
  Logcat or Files, with its output and history, and is where you left it
  when you come back.
- **Start over.** Type `exit` (or press Ctrl+D): the terminal prints
  `[the shell exited]` and shows a **New shell** button that opens a fresh
  one.

The `adb` commands that only make sense on your computer (`adb push`,
`adb pull`, `adb install`) don't exist inside the device's shell. Move files
with the [Files](/holtdroid/session-tools/files/) tab and install builds from
the portal.

## Compared with your own adb

The [holtdroid client](/holtdroid/concepts/ssh/) gives each of your devices
an ADB port on your computer, so your own `adb`, Android Studio and scripts
work against it. Use it when you need `adb push`, `adb pull`, port forwards,
scripted runs or your usual terminal. The Terminal tab needs nothing
installed and is one click away, but it is one interactive shell in one
browser tab.

Both go through the same policy: what the Terminal tab can't run, your own
`adb shell` can't run either, and requests that would cut the session off
from its device (`reboot`, `unroot`, `remount`, `tcpip`, `usb`, `sideload`,
`disable-verity`) are refused in both; see
[ADB tools](/holtdroid/concepts/adb/).

## Recordings

[Recordings](/holtdroid/concepts/recordings/) don't keep anything of the
terminal: the player has no Terminal tab, and neither the commands nor
their output are recorded. Only what a command does to the screen shows up
in the recorded video.

## Limits

- The shell lives in this browser tab. Reloading the page, closing it or
  leaving the session ends it, along with whatever runs in the foreground;
  each browser tab gets its own shell.
- When the ADB connection drops, the shell is gone; after **Reconnect** the
  tab opens a new one.
- Everything you change on the device is gone when the session ends, like
  the rest of the device.
- A device without the shell protocol (very old Android) gets a shell that
  doesn't learn the terminal's size, so full-screen programs may draw in the
  wrong size.
