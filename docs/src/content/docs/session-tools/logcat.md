---
title: Logcat
description: The device's log in the session page, filtered to your app by default, with levels, search, pause, download and a notice when the app crashes.
sidebar:
  order: 10
---

The **Logcat** tab is Android's log, live, in the session page: what
`adb logcat` would print, without `adb` on your machine. By default it shows
only your app's lines, so QA can see the error behind a broken screen and
developers can follow their own tags without the rest of the system.

The session page reads it over [ADB in the browser](/concepts/adb/),
from the device's `main`, `system` and `crash` buffers.

## When the tab appears

Logcat, [Files and Terminal](/concepts/adb/) are the tabs that need
ADB. They appear when the portal lets the session page open ADB
(`adb.browser`, on by default) and you may use it: with `adb.ownerOnly` (the
default) only the session's owner and admins get them; everyone else sees
the screen and DevTools only. See
[ADB tools](/concepts/adb/#configuration).

Collecting starts once the device is first ready, whether or not the tab is
open, and keeps going while the app restarts or another build is installed.
The first lines are the last 2000 the device already had, so what happened
during start-up is there too.

## What you see

### The toolbar

- **This app** / **Everything**: only your app's lines, or the whole device.
  Your app is matched by its Linux user id, so all its processes count and a
  restart doesn't lose it. If the id couldn't be found, a line says
  _The app's user id is unknown, so every line is shown._
- The level menu: **Verbose** (everything, the default), **Debug**,
  **Info**, **Warn** or **Error**, each showing that level and above.
  Fatal lines always show.
- **Filter tag or message**: keeps lines whose tag or message contains the
  text, ignoring case.
- **Pause** / **Resume**: freezes the list at the last line; lines keep
  coming in underneath and show up on resume.
- **Scroll to the newest** (an arrow to a line): the list follows new lines
  while you are at the bottom and stops when you scroll up; this button
  takes you back and follows again.
- **Clear** (the eraser): empties the list.
- **Download what is shown**: a text file
  `logcat-<package>-<date and time>.txt` with exactly the lines that pass
  the filters, in the usual `threadtime` form (time, PID, TID, level, tag,
  message).

### The lines

Each line has the time (`MM-DD HH:MM:SS.mmm`, in your browser's time zone),
the process id, the level letter, the tag (cut short; hover for the whole
tag) and the message, wrapped. The letter and the tag are coloured by level:

| Letter | Level   | Colour         |
| ------ | ------- | -------------- |
| `V`    | Verbose | grey           |
| `D`    | Debug   | blue           |
| `I`    | Info    | green          |
| `W`    | Warn    | amber          |
| `E`    | Error   | red            |
| `F`    | Fatal   | dark red, bold |

Lines from the `crash` buffer have a red tint behind them. While ADB
connects the tab shows **Connecting to ADB…**; if that fails or the
connection drops, **Could not reach the device over ADB** with the reason
and a **Reconnect** button. Before the first line arrives the tab says
_Waiting for log lines…_; when the filters hide
everything, _No line matches the filters._

### The crash notice

When your app crashes (a `FATAL EXCEPTION` from `AndroidRuntime`, or a native
crash's `*** *** ***` from `DEBUG` in the crash buffer) and the report names
the app's process (`Process: <package>` for Java, `>>> <package> <<<` or
the app's uid for a native one), a notice
_The app crashed_ pops up on any tab with the first five lines of the stack
trace. It stays for 15 seconds; its **Logcat** button opens this tab.

## Common tasks

**Catch the error behind a bug.** Reproduce it, set the level to **Error**
or **Warn**, and download what is shown to attach to the report.

**Follow your own tags.** Type the tag into the filter, or a word from your
messages. Switch to **Everything** when the cause may be outside the app,
such as `ActivityManager` killing it or the WebView's own process.

**Read a crash.** Click **Logcat** in the crash notice and scroll to the red
lines; switch the level to **Error** to see the stack trace alone.

**Start from a clean log.** **Clear** before reproducing, so the download
holds only what happened since.

For a bug report with a screenshot, device and app details and this log
(the whole device, whatever the filters), use **Bundle** in the **Device**
card: see [ADB tools](/concepts/adb/).

## In recordings

A [recording](/concepts/recordings/#logcat) keeps its own logcat,
written on the server: the whole device, each line stamped with its time in
the recording. Its player has a logcat panel with the same level and text
filters, follows the playhead, and downloads the whole log as plain text or
with colours. It doesn't depend on this tab: a recording has its logcat even
when nobody had the session page open.

## Limits

- The tab keeps the last 20,000 lines in the browser; older ones drop out,
  also while paused. Reloading the session page starts over with the last
  2000 lines the device has.
- Only the `main`, `system` and `crash` buffers; not `events` or `radio`.
- The log lives in the browser tab, not on the server. Two people watching
  the same session each collect their own.
- Logcat runs as a shell command: with `redroid.shell: off` on emulators,
  or `adb.shell: off` on [phones](/configuration/phones/#adb-on-phones),
  the tab stays empty. See
  [Emulator provider](/configuration/emulator/#users-adb-inside-android).
- When the ADB connection drops, the tab stops getting lines. **Reconnect**
  opens it again, and logcat carries on from the last line it had.
