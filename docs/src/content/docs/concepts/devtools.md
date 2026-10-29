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

Sessions run redroid, a rooted userdebug build. After the device boots, the
agent starts `frida-server`, installs the APK unmodified and **spawns** the
app under Frida with a small script that enables WebView debugging on the
main thread before the first WebView is created. The clipboard doesn't need
it: it is synced through scrcpy, like the screen.

:::note
Apps with root, emulator or instrumentation detection may refuse to run.
That is the main limitation of the emulator provider. A
[phone without root](/configuration/phones/) runs such apps, but
shows DevTools only for debuggable builds: the app turns WebView debugging on
by itself there, without Frida.
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
5. reports the DevTools frontend revision matching the WebView; the portal
   serves that frontend from a cache of its own in its storage, fetched from
   Google's frontend host ahead of time for every Chromium and WebView build
   it lists, so a session's VPN, bandwidth limit or offline mode doesn't
   affect it. While a revision is still being fetched the panel says so
   above DevTools, with the number of files so far; DevTools opens as its
   files arrive. Admins see every fetched revision on the **DevTools
   frontends** tab of the Inventory page, with its state, file count and
   archive, and can delete
   one (it is fetched afresh on the next open) or fetch it ahead of the
   queue. Chromium snapshot builds report no revision, so
   the agent uses the `frontend` tag
   of the [WebView build](/concepts/webview-versions/) or of the
   [Chromium build](/sources/chromium/) the session started with.
   Built-in WebViews of some Android images report a revision that is no
   real commit; for those the agent looks up the commit of the WebView's
   version in Chromium Dash.

All of this sits under the session's path on the portal's own origin, so your
auth cookie covers it and nothing has to be installed on your machine. When
the app navigates or recreates its WebView, the panel reconnects to the new
target automatically.

Next to the target selector, an address bar shows the selected target's
current URL. The bug icon in front of them refreshes the target list. Copy it with the button on the right, or type or paste
another one and press Enter to load it in the WebView (a URL without a
scheme gets `https://`, or `http://` for `localhost`, `127.x` and
`10.0.2.2`); Escape restores the current one. The button on the left
reloads the page. Both send `Page.navigate` / `Page.reload` over a second,
short-lived DevTools connection to the same target, so they work with the
screencast off. Service workers and other non-page targets only show their
URL.

Android's WebView renders every iframe in its page's process, even one from
another site, so an iframe is never a DevTools target of its own. Pick its
page, open the **Console** tab and choose the iframe in the context menu at
the console's top left, the one that reads `top ▾`; Elements, Sources and
Network already show it as part of the page. The target selector says the
same at the bottom of its list.

Next to DevTools are tabs built on the same connection, which work without
DevTools open: [WebSockets](/session-tools/websockets/),
[Cache](/session-tools/cache/),
[Images](/session-tools/images/) and
[SVG](/session-tools/svg/). The agent keeps the session's socket
traffic and requests, so they also show what happened before they were
opened or the page reloaded.

The settings button next to the target selector holds two switches, saved
in your browser:

- **Portal font and colors** (on by default): DevTools uses the portal's
  font, gray accents instead of Chrome's blue, and follows the portal's
  light or dark theme; in the dark theme its panels are near-black like the
  portal. Syntax highlighting keeps DevTools' colors.
- **Screencast on open** (off by default): DevTools' own preview of the page
  is off, since the session already shows the screen. The phone icon at the
  left of the DevTools toolbar still turns it on for the current target.
