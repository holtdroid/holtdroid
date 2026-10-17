---
title: WebView DevTools
description: How Holtdroid enables WebView debugging without touching the APK, and how DevTools reaches your browser.
sidebar:
  order: 3
---

Android only exposes a WebView to Chrome DevTools when the app calls
`WebView.setWebContentsDebuggingEnabled(true)` or is built as `debuggable`.
Release and most test builds do neither, and a debuggable OS build does not
change that.

## Enabling debugging at runtime

Session images are rooted `google_apis` builds. After the device boots, the
agent starts `frida-server`, installs the APK unmodified and **spawns** the
app under Frida with a small script that enables WebView debugging on the
main thread before the first WebView is created. The clipboard doesn't need
it: it is synced through scrcpy, like the screen.

:::note
Apps with root, emulator or instrumentation detection may refuse to run.
That is the main limitation of the emulator provider; the planned
physical-device provider addresses some of those cases.
:::

## Getting DevTools into the browser

Each process with debuggable WebViews listens on an abstract UNIX socket
named `webview_devtools_remote_<pid>`. The agent:

1. watches `/proc/net/unix` for those sockets (and `chrome_devtools_remote`);
2. forwards each one through ADB;
3. merges their target lists into one, which the toolbar's **target**
   selector shows (page, iframe, service worker, grouped by process);
4. proxies the DevTools WebSocket, rewriting the `Host` header to
   `localhost`, since the DevTools server rejects any other host;
5. serves the DevTools frontend matching the WebView's revision from a local
   cache, fetching it from Google's frontend host on first use.

All of this sits under the session's path on the portal's own origin, so your
auth cookie covers it and nothing has to be installed on your machine. When
the app navigates or recreates its WebView, the panel reconnects to the new
target automatically.
