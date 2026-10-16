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
[`internal/contract`](https://github.com/kriakiku/holtdroid/tree/main/internal/contract);
the authoritative description is
[`design/contracts.md`](https://github.com/kriakiku/holtdroid/blob/main/design/contracts.md).
Each contract is a Go interface plus a `Register…` function that mounts it on
an HTTP server, so a Go implementation only has to satisfy the interface.

## Artifact sources

A source is a folder or an S3 prefix the api lists itself. To feed builds
from Slack, CI or anywhere else, write `*.apk` files there, each with an
optional `<file>.apk.meta.json` sidecar (title, note, changelog, uploader,
link, origin, tags, owner, visibility) — see
[Artifact sources](/holtdroid/configuration/sources/). The api parses the
APKs, notices replaced files by their ETag or modification time, and pushes
changes to the UI.

## Device provider

| Method         | Path                      | Returns                                                       |
| -------------- | ------------------------- | ------------------------------------------------------------- |
| `GET`          | `/v1/capabilities`        | display kind, DevTools/clipboard support, VPN locations, ABIs |
| `GET`          | `/v1/capacity`            | slots with `free`/`busy`/`offline`                            |
| `GET`/`POST`   | `/v1/sessions`            | list / create                                                 |
| `GET`/`DELETE` | `/v1/sessions/{id}`       | get / stop                                                    |
| `POST`         | `/v1/sessions/{id}/touch` | record activity                                               |

The provider is the **source of truth** for its sessions; the api keeps no
state of its own.

## Device agent

The agent is what the browser talks to, through the api's proxy at
`/s/{provider}/{session}/`. It serves
status as server-sent events, the screen under `/display/`, DevTools targets
and WebSocket proxying, clipboard and network endpoints. A provider for a new
kind of device ships its own agent that implements the same API; the UI
adapts to what `capabilities` advertises (for example `display: novnc` vs
`display: scrcpy`).
