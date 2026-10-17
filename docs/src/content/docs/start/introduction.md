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

1. Open the portal. The home page lists the APKs in your configured sources
   (a folder or bucket that CI or a Slack sync job fills, plus your own
   uploads) with icon, version, package name, who posted it, its note and
   changelog.
2. Pick one, choose a VPN location if you need one, press **Launch**. A free
   slot is assigned and a fresh Android device boots (about a minute). The
   ⚡ button next to it skips the dialog and launches with the device and
   location you used last time (or the defaults).
3. The APK is installed as-is and started with WebView debugging enabled at
   runtime.
4. The session page shows the device screen on the left and Chrome DevTools on
   the right. A toolbar lets you:
   - switch the inspected target (any WebView page, iframe or worker in any
     process);
   - paste your clipboard into the device and receive what the app copies;
   - switch the device's egress country and see its current external IP;
   - restart or reinstall the app, or stop the session.

   A rail next to the screen has the hardware buttons (lock, wake, volume,
   rotate, back/home/recents, notifications, quick settings), a screenshot
   button and a switch for the device's audio, which plays in your browser
   by default. When the device vibrates, the page shows a notification and
   plays a buzz. Its
   **Stream and keyboard** popover picks the video codec (H.264, H.265 or
   AV1), resolution, frame rate and bitrate, and switches the keyboard
   between text input and a virtual USB keyboard that types in any alphabet
   with the layout set on the device. Its
   **Device settings** panel switches airplane mode, Wi-Fi, mobile data,
   battery saver, charging and battery level, dark theme, font and display
   size, emulated network speed, the system language and time zone, and moves
   the device clock: by a preset (±5 s to ±1 year from real time) or to an
   exact moment entered in your own time zone.

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
