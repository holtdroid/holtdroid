---
title: Sessions and slots
description: Session states, activity, idle timeout, TTL and slot accounting.
sidebar:
  order: 2
---

A **session** is one device running one APK for one user. A **slot** is a
place a session can run: for the emulator provider, a Kubernetes node; for the
[phone provider](/holtdroid/configuration/phones/), a phone.

## States

```mermaid
stateDiagram-v2
  [*] --> provisioning
  provisioning --> booting
  booting --> installing
  installing --> restoring
  installing --> instrumenting
  restoring --> instrumenting
  instrumenting --> ready
  ready --> stopping
  provisioning --> failed
  booting --> failed
  installing --> failed
  restoring --> failed
  instrumenting --> failed
  failed --> stopping
  stopping --> [*]
```

`failed` sessions keep their slot until they are stopped or reaped, so the
reason stays visible on the home page.

## The app inside a session

When the app is closed or crashes it stays closed: the device stays `ready`
and the play button next to the app's name in the session header starts it
again; restart, reinstall and **Save app data now** sit next to it. Starting
it from the device's app drawer works as well; DevTools and clipboard sync
attach either way.

**Switch version** (click the app's name and icon in the session header)
lists every build with the same application ID and installs the chosen one into the
running device:

- with **Keep app data** on (default) it is installed over the current
  build, upgrade or downgrade, so you can test how the app's storage
  migrates. Builds signed with another key can't be installed this way;
- with it off, the current build and its data are removed first.

If the install fails, the previous build keeps running.

## Metrics

A bar at the bottom of the session page shows the load every two seconds:
device CPU and memory, the app's own CPU and memory per process (WebView
renderers included), the frames it renders and how many of them are janky,
network traffic, free space on `/data`, temperatures, the decoded screen
stream and, for emulators, the CPU, memory and throttling of the container
the emulator runs in. Hover an item for details. An emulator invents its
sensor readings; the node's own thermal zones are listed next to them.

The device is only measured while a session page is open and visible.

## Activity and reaping

A session counts as active when someone actually uses it:

- keyboard, mouse, wheel or touch input anywhere on its session page,
  including the device screen and the DevTools panel, while the tab is
  visible (reported every 30 seconds);
- a clipboard action, location switch, app restart, device button or
  device setting change;
- the user presses **Extend**.

An open tab that nobody touches does **not** keep the device alive.

The api deletes a session when it has been idle longer than
`sessions.idleTimeout` (default `30m`), or when it is older than
`sessions.maxTTL` (default `8h`) regardless of activity. The home page shows
both deadlines as countdowns.

## Slots

Each provider reports its slots as `free`, `busy` or `offline`. The emulator
provider runs at most one session per node (required pod anti-affinity) and at
most `slots` sessions overall. Nodes are chosen with the chart's
`nodeSelector` and `tolerations`. When nothing is free, a launch waits in
line on the launch page and starts as soon as a slot frees up, first come
first served; leaving the page gives up the place. The line lives in the api
replica's memory, so a restart drops it.

## Ownership

The user who launched a session is its owner. Every signed-in user can see
all sessions; only the owner and members of `auth.adminGroups` can stop or
extend them or use their ADB tools (`adb.ownerOnly`). Your
[connected computer](/holtdroid/concepts/ssh/) reaches only your own
sessions.
