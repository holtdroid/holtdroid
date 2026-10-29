---
title: Overview
description: The tabs to the right of a session's screen, what each one is for and when it appears.
sidebar:
  order: 1
---

To the right of a session's screen is a row of tabs. Each one looks at the
device or the app from another side. Tabs stay open in the background while
you look at another one, so DevTools keeps its state and the terminal its
shell.

Not every tab is there in every session: a tab appears only when the session
can use it.

| Tab                                                | What it is for                                                                      | When it appears                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **DevTools**                                       | Chrome DevTools for the app's WebViews: Elements, Console, Network, Sources         | always ([WebView DevTools](/concepts/devtools/))         |
| [**Pixel perfect**](/session-tools/pixel-perfect/) | lay a design mockup over the screen and find where the app differs                  | unless the server turned it off (`pixelPerfect.enabled`) |
| [**WebSockets**](/session-tools/websockets/)       | the WebViews' sockets and event streams, frame by frame                             | when the app has a WebView DevTools can reach            |
| [**Cache**](/session-tools/cache/)                 | how the WebViews' requests use the HTTP cache and a CDN                             | same as WebSockets                                       |
| [**Images**](/session-tools/images/)               | images that are too big, in old formats or loaded but never shown                   | same as WebSockets                                       |
| [**SVG**](/session-tools/svg/)                     | SVG path data that could be smaller                                                 | same as WebSockets                                       |
| [**Network**](/session-tools/network/)             | slow, lossy or offline network conditions for the whole device                      | in emulator sessions with VPN locations                  |
| [**DNS**](/session-tools/dns/)                     | every name the device looks up, and rewrites of names to other addresses            | in sessions with a [VPN](/concepts/vpn/)                 |
| [**Routes**](/session-tools/routes/)               | where the connections go: servers, countries, networks, the VPN exit and slow paths | in sessions with a VPN                                   |
| [**Logcat**](/session-tools/logcat/)               | the device's log, with the app's lines and crashes                                  | when the session has ADB                                 |
| [**Files**](/session-tools/files/)                 | the app's private data and the shared storage                                       | when the session has ADB                                 |
| [**Terminal**](/session-tools/terminal/)           | a shell on the device                                                               | when the session has ADB and the device a shell          |

Logcat, Files and Terminal talk to the device over ADB straight from your
browser (see [ADB tools](/concepts/adb/)). The connection opens
when you first open one of them; if it drops, the tab offers **Reconnect**.

## In recordings

A [recording](/concepts/recordings/) keeps what most of these tabs
show: its player has Logcat, the WebViews' Network, Console and WebSockets,
Cache, Images, SVG, DNS, Routes and Pixel perfect, each as it was at the
moment you are at. Files and Terminal aren't recorded.
