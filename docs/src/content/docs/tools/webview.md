---
title: Holtdroid WebView
description: A WebView test browser with DevTools unlocked, presets, several engines and live control over adb.
sidebar:
  order: 1
---

[Holtdroid WebView](https://github.com/holtdroid/holtdroid-webview) is a small
Android app for testing web pages inside a WebView. It is made for Holtdroid
sessions but works on any phone or emulator on its own.

It opens a page in the system WebView (or GeckoView), lets you change how the
WebView is set up, and keeps remote debugging on, so every page shows up in
Holtdroid's DevTools tab and in `chrome://inspect`. Settings are grouped into
presets on the start screen, and everything — presets, single settings and
actions like resize or freeze — can be driven from adb while the page is open.

## Install

Releases are on
[GitHub](https://github.com/holtdroid/holtdroid-webview/releases):

| File                                              | What                                               |
| ------------------------------------------------- | -------------------------------------------------- |
| `holtdroid-webview-<version>.apk`                 | WebView and Custom Tabs, about 2 MB, any ABI       |
| `holtdroid-webview-gecko-<version>-x86_64.apk`    | plus GeckoView, for emulators (Holtdroid sessions) |
| `holtdroid-webview-gecko-<version>-arm64-v8a.apk` | plus GeckoView, for phones                         |

Both builds use the package name `io.github.holtdroid.webview`, so
installing one replaces the other. In Holtdroid, upload the APK or publish it
into a source (for example with the [GitHub sync](/holtdroid/sources/github/))
and launch it like any other app; through [ADB](/holtdroid/concepts/adb/)
`adb install -r holtdroid-webview-<version>.apk` works too.

## The start screen

- **Open a page**: type an address or a search and pick the preset to open it
  with. Recent addresses sit under the field.
- **Engines**: the active WebView provider with its version. Tap it to see the
  installed providers and copy the command that switches between them.
- **Presets**: tap a card to open its start address (or the address you typed)
  with its settings. The menu edits, duplicates, reorders, deletes a preset or
  makes it the default for links and adb. Tags on the card summarise what the
  preset changes; the risky ones are red.
- The top bar switches the theme (system, light, dark) and opens app settings:
  Material You colours, external control on/off, restoring the built-in
  presets, clearing every engine's data.
- **Documentation** opens this page.

The built-in presets:

| Preset       | What it does                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Browse       | A plain browser window: toolbar, strict TLS, DevTools on                                                                    |
| Unlocked     | TLS errors ignored, mixed content, file access, popups, permissions granted, Eruda, autoplay, screen kept on                |
| Kiosk        | Full screen without browser UI, navigation locked to the start host, Back opens the controls, no zoom, popups or long press |
| App shell    | Edge to edge like an app's own WebView, with a floating handle                                                              |
| Small phone  | A 360 × 640 viewport framed in the middle of the screen                                                                     |
| Desktop site | Desktop user agent, overview viewport, landscape                                                                            |
| Fresh start  | Wipes cookies, storage, cache and history on every launch, no HTTP cache                                                    |
| Proxy        | All traffic through `127.0.0.1:8080` with TLS errors ignored                                                                |

The Proxy preset fits Holtdroid's [connected computers](/holtdroid/concepts/ssh/):
run mitmproxy or Charles on port 8080 of your computer, publish that port on
the Computers page and watch the traffic. User-installed CA
certificates are trusted too, so a strict preset also works once the proxy's
CA is installed on the device.

## The page

In Standard and Immersive mode a toolbar shows back, the address (tap to
edit), the keyboard button, reload and the controls button. Edge-to-edge and Kiosk modes hide it;
the floating handle (draggable) opens the controls instead. Back goes back in
history and then to the start screen, or opens the controls when **Back opens
controls** is on.

The control panel holds:

- **Freeze**: pauses timers, animations and rendering of the page and blocks
  input until you resume. Useful to inspect a transient state in DevTools.
- **Hard reload**: clears the HTTP cache and reloads.
- **Desktop**: toggles the desktop user agent and overview mode.
- **Dark**: switches the app theme; pages see it through
  `prefers-color-scheme`.
- **Console**: messages the page logged, and a prompt that evaluates
  JavaScript in the page.
- **Eruda**: injects the [Eruda](https://github.com/liriliri/eruda) in-page
  DevTools. Eruda is bundled into the APK and injected the way DevTools runs
  scripts, so it works offline and on pages with a strict Content Security
  Policy (only its icon font may be blocked there).
- **Keyboard**: shows or hides the on-screen keyboard for the focused field
  (see below).
- **Rotate** and **Settings**: swap the frame's width and height; edit every
  setting of the open page, apply it, or save it as a preset.
- **Display**: the display mode and the toolbar position.
- **Viewport**: frame presets from 320 × 568 to 1280 × 800, and the scale.
  The badge under a framed page shows its size in CSS pixels and its scale.
- **Clear data**: cache, cookies, storage or everything.
- **DevTools**: remote debugging on/off and the `adb forward` command for the
  page's DevTools socket.
- **Engine**: WebView, GeckoView or a Custom Tab.

## On-screen keyboard

Android hides the on-screen keyboard while a hardware keyboard is attached.
Holtdroid's emulators report one (`hw.keyboard=yes`), so tapping a field
there brings up no keyboard; you type through the session's keyboard instead.
To get the on-screen one, focus the field and press the keyboard button. If
the system still hides it, the app shows two fixes:

```sh
# show the on-screen keyboard next to a hardware one, for every app
adb shell settings put secure show_ime_with_hard_keyboard 1

# or let the app switch that setting on by itself when you press the button
adb shell pm grant io.github.holtdroid.webview android.permission.WRITE_SECURE_SETTINGS
```

The same setting is **Use on-screen keyboard** in the system's physical
keyboard settings, which the dialog opens.

## Engines

- **WebView** is Android's system WebView. Android uses one provider for every
  app, and only the system can change it: run
  `adb shell cmd webviewupdate set-webview-implementation <package>` (the
  Engines dialog copies it for each installed provider), or use Developer
  options → WebView implementation. Holtdroid's
  [device card](/holtdroid/concepts/adb/) switches it too.
- **GeckoView** is Firefox's engine, built into the `-gecko` APK. Settings
  marked "WebView only" don't apply to it; the console can't evaluate
  scripts. Debug it from Firefox on a computer: `about:debugging` → USB
  devices.
- **Custom Tab** opens the page in the default browser's Custom Tab, which
  shares that browser's cookies. None of the app's settings apply there.

## Settings

Every setting has a key. The editor shows it under the description, and the
same key works in adb commands and in the `holtdroid-webview://` link.
Booleans take `true`/`false` (also `1`/`0`, `on`/`off`, `yes`/`no`), choices
are case-insensitive, numbers are plain integers.

| Key                    | Values                                          | Default                   | What                                                        |
| ---------------------- | ----------------------------------------------- | ------------------------- | ----------------------------------------------------------- |
| `url`                  | address                                         | `https://www.google.com/` | Start address                                               |
| `engine`               | `webview` `gecko` `custom-tabs`                 | `webview`                 | Engine                                                      |
| `display`              | `standard` `immersive` `edge` `kiosk`           | `standard`                | Display mode                                                |
| `toolbar`              | `top` `bottom`                                  | `top`                     | Toolbar position                                            |
| `handle`               | boolean                                         | `true`                    | Floating handle when the toolbar is hidden                  |
| `lockBack`             | boolean                                         | `false`                   | Back opens the controls instead of leaving                  |
| `orientation`          | `auto` `portrait` `landscape` `locked`          | `auto`                    | Orientation lock (`locked` keeps the current one)           |
| `keepScreenOn`         | boolean                                         | `false`                   | Keep the screen on                                          |
| `width`, `height`      | dp, `0` = fill                                  | `0`                       | Viewport frame                                              |
| `scale`                | percent, `0` = fit                              | `0`                       | Frame scale                                                 |
| `javaScript`           | boolean                                         | `true`                    | JavaScript                                                  |
| `domStorage`           | boolean                                         | `true`                    | localStorage and sessionStorage                             |
| `zoom`                 | boolean                                         | `true`                    | Pinch to zoom                                               |
| `zoomControls`         | boolean                                         | `false`                   | On-screen zoom buttons                                      |
| `wideViewport`         | boolean                                         | `true`                    | Honour `<meta name=viewport>`                               |
| `overviewMode`         | boolean                                         | `false`                   | Fit the page width to the screen                            |
| `textZoom`             | 25–400                                          | `100`                     | Text size, percent                                          |
| `darkening`            | boolean                                         | `false`                   | Algorithmic darkening of light pages in the dark theme      |
| `mediaAutoplay`        | boolean                                         | `false`                   | Play media without a gesture                                |
| `blockImages`          | boolean                                         | `false`                   | Don't load images                                           |
| `offline`              | boolean                                         | `false`                   | Block every network load                                    |
| `cacheMode`            | `default` `no-cache` `cache-first` `cache-only` | `default`                 | HTTP cache                                                  |
| `userAgent`            | `default` `desktop` `custom`                    | `default`                 | User agent                                                  |
| `customUserAgent`      | text                                            |                           | Used with `userAgent=custom`                                |
| `userAgentSuffix`      | text                                            |                           | Appended to the user agent                                  |
| `headers`              | `Name: value` lines                             |                           | Extra headers on loads you start (not on subresources)      |
| `proxy`                | `host:port` or `scheme://host:port`             |                           | Proxy for all WebView traffic                               |
| `proxyBypass`          | hosts, comma separated                          |                           | Hosts that skip the proxy                                   |
| `ssl`                  | `strict` `ask` `ignore`                         | `strict`                  | TLS certificate errors                                      |
| `mixedContent`         | `never` `compatible` `always`                   | `compatible`              | http resources on https pages                               |
| `safeBrowsing`         | boolean                                         | `true`                    | Safe Browsing                                               |
| `cookies`              | boolean                                         | `true`                    | Cookies                                                     |
| `thirdPartyCookies`    | boolean                                         | `true`                    | Third-party cookies                                         |
| `permissions`          | `ask` `grant` `deny`                            | `ask`                     | Camera, microphone and location requests                    |
| `allowedHosts`         | hosts, comma separated                          |                           | Pages may only navigate to these hosts and their subdomains |
| `externalApps`         | boolean                                         | `true`                    | Follow `tel:`, `mailto:`, `intent:`, `market:` links        |
| `popups`               | boolean                                         | `false`                   | `window.open` and `target=_blank` (opened in the same view) |
| `jsDialogs`            | boolean                                         | `true`                    | `alert`, `confirm`, `prompt`, `beforeunload`                |
| `longPress`            | boolean                                         | `true`                    | Text selection and context menu                             |
| `fileAccess`           | boolean                                         | `false`                   | `file://` URLs                                              |
| `universalFileAccess`  | boolean                                         | `false`                   | `file://` pages may read anything                           |
| `contentAccess`        | boolean                                         | `true`                    | `content://` URLs                                           |
| `clearOnStart`         | boolean                                         | `false`                   | Wipe all data whenever the page opens                       |
| `debugging`            | boolean                                         | `true`                    | Remote debugging                                            |
| `eruda`                | boolean                                         | `false`                   | Inject the bundled Eruda                                    |
| `console`              | boolean                                         | `true`                    | Keep console messages                                       |
| `userScript`           | JavaScript                                      |                           | Injected at document start into every frame                 |
| `hardwareAcceleration` | boolean                                         | `true`                    | Off renders in software                                     |
| `offscreenPreRaster`   | boolean                                         | `false`                   | Draw tiles outside the viewport ahead of time               |

`allowedHosts` limits navigation the page starts; addresses you load yourself
(the address bar, `cmd=load`) always open.

## Control from adb

The app listens to two entry points:

- `am start` opens a page, starting the app if needed.
- `am broadcast` acts on the page that is open now. The app must be running.
  The broadcast prints the result: `result=-1` means success, `result=1` an
  error, and `data` carries the message or the requested value.

Every command is also logged under the `HoltdroidWebView` tag
(`adb logcat -s HoltdroidWebView`).

```sh
P=io.github.holtdroid.webview

# open with the default preset
adb shell am start -n $P/.MainActivity -d https://example.com

# open with a preset (id or name) and overrides
adb shell am start -n $P/.MainActivity --es preset unlocked --es url https://example.com \
  --es display kiosk --ez keepScreenOn true

# change settings of the open page
adb shell am broadcast -a $P.CONTROL -p $P --es ssl ignore --es userAgent desktop

# resize the viewport, then back to full size
adb shell am broadcast -a $P.CONTROL -p $P --es cmd resize --es size 390x844
adb shell am broadcast -a $P.CONTROL -p $P --es cmd resize

# run JavaScript and print the result (quote the whole command for the device shell)
adb shell "am broadcast -a $P.CONTROL -p $P --es cmd eval --es js 'document.title'"
```

`--es`, `--ei` and `--ez` all work; values are converted to the setting's
type. Commands go in `cmd`; without one, `am start` opens a page and
`am broadcast` applies the settings to the open page.

| `cmd`                                 | Arguments                                    | What                                                                |
| ------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| `open`                                | `preset`, `url`, any setting                 | Open a page with a preset (default preset if omitted) and overrides |
| `set`                                 | any setting, `url`                           | Change settings of the open page; `url` also loads it               |
| `load`                                | `url`                                        | Load an address in the open page                                    |
| `resize`                              | `width`, `height` or `size=WxH`, `scale`     | Frame the viewport; no arguments returns to full size               |
| `rotate`                              |                                              | Swap width and height                                               |
| `freeze`, `unfreeze`, `toggle-freeze` |                                              | Pause or resume the page                                            |
| `reload`                              | `hard=true`                                  | Reload, optionally clearing the HTTP cache first                    |
| `back`, `forward`, `stop`             |                                              | Navigation                                                          |
| `home`                                |                                              | Close the page and return to the start screen                       |
| `clear`                               | `what=cache\|cookies\|storage\|history\|all` | Clear data (default `all`)                                          |
| `eval`                                | `js`                                         | Evaluate JavaScript; prints the JSON result                         |
| `console`                             | `lines` (default 50)                         | Print the latest console messages                                   |
| `theme`                               | `theme=system\|light\|dark`                  | Switch the app theme                                                |
| `keyboard`                            | `show=true\|false`                           | Show, hide or toggle the on-screen keyboard for the focused field   |
| `state`                               |                                              | Print the screen, page, viewport and every setting as JSON          |
| `presets`                             |                                              | Print preset ids and names                                          |

Links do the same: `holtdroid-webview://<cmd>?<key>=<value>&…` opens the app
and runs the command, for example
`holtdroid-webview://open?preset=kiosk&url=https%3A%2F%2Fexample.com`. The app
is also offered as a browser for `http` and `https` links, which then open
with the default preset.

Any app on the device can send these broadcasts and links. Turn **External
control** off in app settings to accept only plain `url` links.

## DevTools

With `debugging` on, the WebView exposes the DevTools socket
`webview_devtools_remote_<pid>`. In a Holtdroid session it appears in the
DevTools target list like any other app's WebView (see
[WebView DevTools](/holtdroid/concepts/devtools/)). On your own computer:

```sh
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof io.github.holtdroid.webview)
```

then open `chrome://inspect`, or `http://localhost:9222/json`. The control
panel copies the exact command.
