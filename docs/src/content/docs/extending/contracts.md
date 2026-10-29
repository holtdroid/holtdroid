---
title: Contracts
description: The HTTP APIs between Holtdroid services, and how to feed builds in or implement your own provider.
sidebar:
  order: 1
---

Holtdroid's extension points are plain HTTP APIs. Anything that speaks them,
in any language, can plug in: add its URL to the api's `providers` list.
Builds come in through files, not an API.

The Go types and OpenAPI definitions live in
[`internal/contract`](https://github.com/holtdroid/holtdroid/tree/main/internal/contract);
the authoritative description is
[`design/contracts.md`](https://github.com/holtdroid/holtdroid/blob/main/design/contracts.md).
Each contract is a Go interface plus a `Register…` function that mounts it on
an HTTP server, so a Go implementation only has to satisfy the interface.

## Artifact sources

A source is a folder or an S3 prefix the api lists itself. To feed builds
from Slack, CI or anywhere else, write `*.apk` files there, each with an
optional `<file>.apk.meta.json` sidecar (title, note, changelog, uploader,
link, origin, tags, owner, visibility) — see
[Artifact sources](/sources/overview/). The api parses the
APKs, notices replaced files by their ETag or modification time, and pushes
changes to the UI. [Writing your own](/sources/custom/) lists the
principles a sync job should follow.

## Device provider

| Method         | Path                        | Returns                                                                                   |
| -------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| `GET`          | `/v1/capabilities`          | display kind, DevTools/clipboard support, VPN locations and the default one, ABIs         |
| `GET`          | `/v1/capacity`              | slots with `free`/`busy`/`offline`/`maintenance` and the provider's maintenance hold      |
| `GET`/`POST`   | `/v1/sessions`              | list / create                                                                             |
| `GET`/`DELETE` | `/v1/sessions/{id}`         | get / stop                                                                                |
| `POST`         | `/v1/sessions/{id}/touch`   | record activity                                                                           |
| `POST`         | `/v1/sessions/{id}/install` | install another build of the session's package through the agent and record it            |
| `GET`          | `/v1/inventory`             | every slot with its session, device (model, Android, battery, sensors) or machine details |
| `PUT`          | `/v1/maintenance`           | hold a slot, or the whole provider, for maintenance, or release it                        |

The provider is the **source of truth** for its sessions; the api keeps no
state of its own.

## Node info

`holtdroid node-info` answers `GET /v1/host` with what `/proc` and `/sys`
say about the machine it runs on: CPU model and cores, memory, load,
uptime, kernel, thermal zones and hwmon temperature sensors. The chart runs
it as a DaemonSet on emulator nodes, and the emulator provider adds its
answers to the inventory. Another provider may use it the same way or
ignore it.

## Device agent

The agent is what the browser talks to, through the api's proxy at
`/s/{provider}/{session}/`. It serves
status as server-sent events, the screen as a scrcpy stream on
`/display/scrcpy` (codec, size, frame rate and bitrate as query parameters),
the device audio on `/display/audio`, vibrations on `/v1/vibrations`, whether the display is on and locked on `/v1/screen`, DevTools targets
and WebSocket proxying, clipboard and network endpoints, and device controls
(`/v1/device`: settings, hardware buttons, screenshots), app actions
(`/v1/app/restart`, `/v1/app/reinstall`), `/v1/install` for the provider
to swap the build, `/v1/app-data/export` for the api to save the app's
data (see [App data](/concepts/app-data/)) and `/v1/recording`
to start and stop a recording that the agent uploads to the api itself
(see [Recordings](/concepts/recordings/)). A provider for a new
kind of device ships its own agent that implements the same API; the UI
adapts to what `capabilities` advertises (`display: scrcpy` today).
