---
title: Contracts
description: The HTTP APIs between Holtdroid services, and how to implement your own source or provider.
sidebar:
  order: 1
---

Holtdroid's extension points are plain HTTP APIs. Anything that speaks them,
in any language, can plug in: add its URL to the api's `sources` or
`providers` list.

The Go types and OpenAPI definitions live in
[`internal/contract`](https://github.com/kriakiku/holtdroid/tree/main/internal/contract);
the authoritative description is
[`design/contracts.md`](https://github.com/kriakiku/holtdroid/blob/main/design/contracts.md).
Each contract is a Go interface plus a `Register…` function that mounts it on
an HTTP server, so a Go implementation only has to satisfy the interface.

## Artifact source

| Method | Path                           | Returns                             |
| ------ | ------------------------------ | ----------------------------------- |
| `GET`  | `/v1/artifacts?cursor=&limit=` | `{items, nextCursor}`, newest first |
| `GET`  | `/v1/artifacts/{id}`           | one artifact                        |
| `GET`  | `/v1/artifacts/{id}/download`  | the APK                             |
| `GET`  | `/v1/health`                   | `{ok: true}`                        |

An artifact is `{id, fileName, size, uploadedAt, uploadedBy, note, link}`.
Sources don't parse APKs: the api extracts package, version, label and icon
itself.

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
