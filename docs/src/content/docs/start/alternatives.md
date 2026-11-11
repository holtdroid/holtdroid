---
title: A self-hosted alternative to BrowserStack, Appetize and Genymotion
description: How Holtdroid compares with BrowserStack, Appetize, Genymotion, DeviceFarmer STF, docker-android, redroid and an emulator on your own machine.
sidebar:
  label: Alternatives
  order: 2
---

There are many ways to get an Android device in front of a tester. This page
says where Holtdroid fits among them, and when another tool is the better
choice. Holtdroid is a self-hosted, open-source (Apache-2.0) portal: you run
it on your own Kubernetes cluster, there is no hosted service to sign up for.

## At a glance

|                                  | Holtdroid            | Cloud device services            | DeviceFarmer STF | docker-android | Local emulator     |
| -------------------------------- | -------------------- | -------------------------------- | ---------------- | -------------- | ------------------ |
| Where it runs                    | Your cluster         | The vendor's cloud               | Your hosts       | Your hosts     | Your computer      |
| Builds leave your network        | No                   | Yes                              | No               | No             | No                 |
| Price                            | Free, your hardware  | Per seat or minute               | Free             | Free           | Free               |
| Virtual devices on demand        | Yes, redroid Pods    | Yes                              | No               | Yes            | One at a time      |
| Real phones                      | Yes, over USB        | Large catalogues                 | Yes              | No             | Over USB           |
| WebView DevTools in the browser  | Yes, APK untouched   | Varies, often a debuggable build | No               | No             | `chrome://inspect` |
| VPN country per device           | Yes, switchable live | Some offer geolocation           | No               | No             | A VPN app          |
| Builds from Slack, S3, GitHub    | Yes                  | Upload or CI plugins             | No               | No             | Download by hand   |
| Recordings with network and logs | Yes                  | Video and logs                   | No               | No             | No                 |
| iOS                              | No                   | Yes                              | No               | No             | Xcode              |

## BrowserStack, Sauce Labs, LambdaTest

Commercial clouds of real and virtual devices. Pick them when you need
hundreds of real phone models, iOS, or large automated test grids, and are
fine with uploading builds to a third party and paying per seat or minute.

Holtdroid covers the other case: a team that tests its own APKs by hand,
wants them to stay inside its network, and cares about what a WebView inside
the app does. Every device gets [DevTools](/concepts/devtools/) without a
debuggable build, a [VPN country](/concepts/vpn/) of its own,
[network presets](/session-tools/network/) and
[recordings](/concepts/recordings/) that keep the network, console and
logcat next to the video.

## Appetize.io

Appetize streams emulators to a browser and is good at embedding an app in a
web page for demos and support. It is a hosted service. Holtdroid gives a
similar browser tab on your own hardware, and adds the debugging tools around
the screen: [Logcat](/session-tools/logcat/), [files](/session-tools/files/),
a [terminal](/session-tools/terminal/), [DNS](/session-tools/dns/) and
[routes](/session-tools/routes/), and ADB on your computer through the
[holtdroid client](/concepts/ssh/).

## Genymotion

Genymotion's desktop emulator and its cloud images are mature virtual
devices for developers. Holtdroid is not an emulator itself: it runs Android
in containers with [redroid](/configuration/emulator/) and puts a portal in
front for a whole team, with sign-in, a device pool, limits per person,
[idle timeouts](/concepts/sessions/) and an audit log.

## DeviceFarmer STF

STF (formerly OpenSTF) is the classic open-source web UI for a farm of real
phones on USB. Holtdroid can run [real phones](/configuration/phones/) too,
and also starts virtual devices on demand, picks the
[Android and WebView version](/concepts/webview-versions/) at launch, lists
builds from your [sources](/sources/overview/) and keeps
[app data](/concepts/app-data/) between sessions.

## docker-android and redroid

docker-android runs the Android emulator in a container with a noVNC screen;
redroid runs Android itself in a container on the host's kernel. Both are
building blocks for one device. Holtdroid uses redroid as its runtime and
adds what a team needs around it: scheduling on Kubernetes, a session
lifecycle, a scrcpy screen in the browser, DevTools, VPN and the portal.

## Android Studio's emulator on your machine

The best choice for the developer who writes the app. For testers, designers
and support engineers it means installing Android Studio, a fast computer and
a cable or `chrome://inspect` for WebViews. Holtdroid needs only a browser,
and the [holtdroid client](/guides/developers/connect-computer/) still puts
the devices into `adb` and Android Studio when a developer wants them there.

## When Holtdroid is not the right tool

- You need iOS, or a specific real phone model you don't own.
- You can't run privileged Pods: redroid shares the node's kernel, see
  [emulator isolation](/operations/emulator-security/).
- You want a hosted service with no cluster to run.
- Your main need is running automated test suites across many devices.
