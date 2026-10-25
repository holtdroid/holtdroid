---
title: Introduction
description: What Holtdroid is, who it is for, and how a session looks from the user's side.
sidebar:
  order: 1
---

Holtdroid is a self-hosted web portal that launches Android devices on demand
for testing APKs. It is built for teams whose builds land in a chat channel
and whose apps lean on WebViews: QA engineers, web developers working on
hybrid apps, support engineers reproducing a customer bug.

## A session, end to end

1. Open the portal. The home page shows one card per app (package name) found
   in your configured sources (a folder or bucket that CI or a Slack sync job
   fills, plus your own uploads): its latest version, how many builds and
   versions there are and which sources they come from. **Launch** on a card
   starts the latest build; click the card to see every build of the app with
   its version, who posted it, its note and changelog.
2. Pick a build, choose a VPN location if you need one, press **Launch**. The
   provider is **Any** by default: the first provider with a free device, in
   the order of `providers` in the config. Pick a provider to choose one of
   its devices, busy ones included. A fresh Android device boots (about a
   minute). The ⚡ button next to it skips the dialog and launches with the
   provider and location you used last time (or the defaults). When every
   device is busy, or the one you picked, the launch waits in line and starts
   as soon as one frees up.
3. The APK is installed as-is and started with WebView debugging enabled at
   runtime.
4. The session page shows the device screen on the left and Chrome DevTools on
   the right, with a picker for the inspected target (any WebView page,
   iframe or worker in any process). The header shows the app: click its
   name and icon to switch to another build, and the icons next to it
   restart or reinstall the app or save its data; **Extend** and **Stop**
   sit on the right. The bar at the bottom shows the device's load. By default the screen's side follows the screen: it
   grows or shrinks until the screen fills its height or the side reaches
   70% of the page, also when the device rotates. Dragging the divider sizes
   it by hand; the button on the divider turns following back on.

   The screen sits in a phone body with keys on its right edge, like a
   real phone: the volume rocker turns the volume up (upper half, marked +)
   or down (lower half, −), and the power key locks the device or turns its
   screen off, as the icon next to it shows.
   Hovering the rocker shows the device's media volume with a slider and a
   tile that mutes Android itself; the rocker turns amber while the device is
   muted. Hovering the power key offers **Wake and unlock**, locking and
   turning the screen off right away, and picks what a click on the key
   does. To the right of the phone a network card shows the VPN
   location, the external IP and the network conditions; hovering it opens
   a panel styled like Android's quick settings shade with Wi-Fi, mobile
   data and airplane mode tiles, the VPN locations and the emulated network
   conditions (slow or lossy networks and scenarios such as a subway ride,
   each with its description, on emulators with VPN locations). Each
   corner of the phone has a thin arc in its bezel: hovering
   one opens back, home, recent apps, notifications, quick settings and
   rotation. Under the network card, the stream card picks the video codec
   (H.264, the lightest for the server, by default; H.265 or AV1 where the
   browser decodes them), quality (the device's own up to 1080p, then 720p,
   480p and 360p; a sharper screen is streamed at 1080p), frame rate (45 fps
   by default, up to the device's own and never above 60) and bitrate, switches the device audio
   (it plays in your browser by default), shows the frames, bitrate
   and dropped frames the browser decodes right now, and switches the keyboard between text input
   and a virtual USB keyboard that types in any alphabet with the layout set
   on the device. The codec, the bitrate and a frame rate below 45 fps are
   remembered in the browser; quality and faster frame rates last for one
   session.
   The clipboard card turns sync on or off with a click (both ways by
   default; hover to pick one direction) and keeps the last 10 synced
   texts, shown with · for spaces and ↵ for line breaks, each with buttons
   to copy it or save it as a text file. The date and time card shows the
   device's clock and is marked while the clock is shifted, not in real time
   or in a time zone picked by hand; hovering it opens real-time sync,
   shifting the clock back or forward by any amount, an exact moment entered
   in your own time zone (it unfolds in place), and the time zone, which
   follows the VPN location unless you pick another one for the session. The
   language card picks the system language and the keyboard layouts from a
   grid of flags: a click on a layout adds or removes it (up to 7, remembered
   in your browser and guessed from your keyboard where the browser allows).
   A panel opened by hovering stays open once you click inside it, until you
   click elsewhere or press Esc. When the device vibrates, the page
   shows a notification and plays a buzz. A rail next to the screen has the
   screenshot and recording buttons; the arrow at its top widens it into a
   menu with section titles and a label next to every icon, and back. Below
   them come the device controls,
   one button per section. Clicking a button does the common thing, hovering
   it opens the rest:
   - **Battery** (65%, on battery, at start): click for battery saver; charging and the
     charge level.
   - **Display**: click to cycle light, dark and matching the portal's theme;
     font and display size.
   - **GPS location** (on devices that can fake it): follows the VPN
     location unless you override it with a city, coordinates or your own
     position.

   An amber dot marks a section whose settings differ from the defaults, and
   its popup has a reset button.

5. Walk away. After the idle timeout (30 minutes by default) the device is
   deleted and the slot frees up. The home page shows every active session,
   its owner and how long it has left.

## What it is not

- Not a device farm for automated test runs (yet). The contracts allow it,
  but the first goal is interactive debugging.
- Not a way to modify or re-sign APKs. Anything that needs repackaging is out
  of scope on purpose.
- Not a Play Store environment: sessions run redroid, a rooted AOSP
  userdebug build without Google services.

## Requirements

- A Kubernetes cluster (1.31+) with **x86_64 nodes with binder and a Mesa
  GPU** for sessions, dedicated to them. Each session takes about 1 GB of
  memory idle and a core while its screen streams.
- Permission to run **privileged pods** in Holtdroid's namespace.
- A forward-auth proxy in front of the ingress (Authelia, oauth2-proxy, …),
  unless you run it locally with authentication disabled.
- For builds from Slack: a Slack app with a bot token and a small sync job
  that copies them into a source.
