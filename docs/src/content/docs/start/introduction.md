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
   sit on the right. The bar at the bottom shows the device's load and its
   current external IP.

   A rail next to the screen has the hardware buttons (lock or screen off,
   wake, volume, rotate, back/home/recents, notifications, quick settings),
   a screenshot button, clipboard sync (both ways by default; hover to pick
   one direction) and a switch for the device's audio, which plays in your browser
   by default. When the device vibrates, the page shows a notification and
   plays a buzz. The arrow at the top of the rail widens it into a menu with
   section titles and a label next to every icon, and back. Its
   **Stream and keyboard** popover picks the video codec (H.264, H.265 or
   AV1), resolution, frame rate and bitrate, and switches the keyboard
   between text input and a virtual USB keyboard that types in any alphabet
   with the layout set on the device. Below them come the device controls,
   one button per section. Clicking a button does the common thing, hovering
   it opens the rest:
   - **Network**: click for airplane mode; Wi-Fi, mobile data, emulated
     network speed and the VPN location.
   - **Battery** (65%, on battery, at start): click for battery saver; charging and the
     charge level.
   - **Display**: click to cycle light, dark and matching the portal's theme;
     font and display size.
   - **Language and region**: system language, time zone, extra keyboard
     layouts (remembered in your browser, guessed from your keyboard where
     the browser allows) and a faked GPS position.
   - **Date and time**: real-time sync, shifting the clock back or forward by
     any amount, or an exact moment entered in your own time zone.

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
- Not a Play Store environment: images are rooted `google_apis` builds without
  Google sign-in.

## Requirements

- A Kubernetes cluster with **x86_64 nodes exposing `/dev/kvm`** for emulator
  sessions. Each session takes roughly 3–4 CPU cores and 5–7 GiB of memory.
- Permission to run **privileged pods** in Holtdroid's namespace.
- A forward-auth proxy in front of the ingress (Authelia, oauth2-proxy, …),
  unless you run it locally with authentication disabled.
- For builds from Slack: a Slack app with a bot token and a small sync job
  that copies them into a source.
