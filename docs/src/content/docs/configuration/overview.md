---
title: Configuration files
description: How every Holtdroid service is configured, and the api's options.
sidebar:
  order: 1
---

Every service reads one YAML file passed with `--config` (the Helm chart
renders them for you). Any key can be overridden by an environment variable:
`HOLTDROID_` + the key path in upper case with `__` between levels. Matching
is case-insensitive.

```sh
HOLTDROID_SESSIONS__IDLETIMEOUT=45m
HOLTDROID_AUTH__PROVIDER=none
```

Logging is configured with flags or environment, not the file:
`--log-level` / `HOLTDROID_LOG_LEVEL` (`debug`, `info`, `warn`, `error`) and
`--log-format` / `HOLTDROID_LOG_FORMAT` (`json`, `text`).

Fields that hold credentials only accept **secret references**, never plain
values — see [Secrets](/holtdroid/configuration/secrets/).

Every service also reads two shared sections: `telemetry` (Prometheus
metrics on a separate port, OpenTelemetry tracing) and, in the api and the
ssh-gateway, `audit` (the audit log). Both are described in
[Monitoring and audit](/holtdroid/operations/monitoring/).

```yaml
telemetry:
  metrics: { listen: ":9090" }
  tracing: { enabled: true, endpoint: http://otel-collector:4318 }
audit:
  stdout: true
```

## api

```yaml
listen: ":8080" # browser-facing: UI, /api, /s/{provider}/{id}
internalListen: ":8081" # cluster-only: artifact downloads for agents
publicURL: https://android.example.com
internalURL: http://holtdroid-api-internal:8081 # how agents reach internalListen

auth:
  mode: anonymous # anonymous | password | oidc | header | none
  sessionKey: env:SESSION_KEY

sessions:
  idleTimeout: 30m
  maxTTL: 8h
  reapInterval: 30s

storage:
  type: filesystem # filesystem | s3
  filesystem:
    dir: /var/cache/holtdroid

cache:
  maxSize: 20GiB
  warm: 10

database:
  type: memory

secrets:
  openbao:
    address: https://bao.example.com
    kubernetes: { role: holtdroid }

sources:
  - name: local
    type: filesystem
    filesystem: { dir: /var/lib/holtdroid/apks }
uploads:
  enabled: true
  maxSize: 1GiB
  temporaryTTL: 168h
downloads:
  adminOnly: false
appData:
  enabled: false
recordings:
  enabled: false
pixelPerfect:
  enabled: true
adb:
  browser: true
  ownerOnly: true
providers:
  - name: emulator
    url: http://holtdroid-provider-emulator:8080
```

| Key                     | Default          | Meaning                                                                                               |
| ----------------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| `listen`                | `:8080`          | Address for the UI, REST API and session proxy                                                        |
| `internalListen`        | `:8081`          | Address for endpoints only agents use; never expose it through the ingress                            |
| `publicURL`             | –                | External URL of the portal, used to build DevTools WebSocket URLs                                     |
| `internalURL`           | –                | URL agents use to reach `internalListen`                                                              |
| `auth.*`                | `anonymous`      | See [Authentication](/holtdroid/configuration/authentication/)                                        |
| `secrets.openbao`       | –                | Enables `openbao:` references, see [Secrets](/holtdroid/configuration/secrets/)                       |
| `sessions.idleTimeout`  | `30m`            | Delete a session after this long without activity                                                     |
| `sessions.maxTTL`       | `8h`             | Delete a session after this long regardless of activity                                               |
| `sessions.reapInterval` | `30s`            | How often the reaper runs                                                                             |
| `sessions.maxPerUser`   | `0`              | Devices one user may run at once, 0 for no limit; per user in the `users` auth mode                   |
| `storage.*`             | filesystem       | See [Artifact storage](/holtdroid/configuration/storage/)                                             |
| `cache.maxSize`         | `20GiB`          | Least recently used APKs are evicted beyond this                                                      |
| `cache.warm`            | `10`             | Newest uncached APKs per listing to download and parse in the background                              |
| `database.*`            | `memory`         | SQLite in RAM, or a file replicated to S3, see [Database](/holtdroid/configuration/database/)         |
| `sources[]`             | `local`          | Folders or S3 buckets with APKs, see [Artifact sources](/holtdroid/sources/overview/)                 |
| `uploads.*`             | enabled          | Uploads from the UI, see [Artifact sources](/holtdroid/sources/overview/#uploads)                     |
| `downloads.adminOnly`   | `false`          | Only admins may download APKs, see [Downloads](/holtdroid/sources/overview/#downloads)                |
| `appData.*`             | off              | Save app data between sessions, see [App data](/holtdroid/concepts/app-data/)                         |
| `recordings.*`          | off              | Record sessions on the server, see [Recordings](/holtdroid/concepts/recordings/)                      |
| `pixelPerfect.*`        | on               | Reference images for the Pixel perfect tab, see [Pixel perfect](/holtdroid/concepts/pixel-perfect/)   |
| `webview.storage`       | off              | The WebView catalog, see [WebView versions](/holtdroid/concepts/webview-versions/)                    |
| `map.url`               | OpenFreeMap      | Tile server for the GPS map, proxied by the api; empty turns the map off, see [below](#gps-map)       |
| `routing.url`           | FOSSGIS Valhalla | Valhalla server for GPS routes along roads; empty draws straight lines, see [below](#gps-map)         |
| `adb.browser`           | `true`           | ADB tools on the session page, see [ADB tools](/holtdroid/concepts/adb/)                              |
| `adb.ownerOnly`         | `true`           | Only a session's owner and admins may use its ADB tools                                               |
| `providers[]`           | `[]`             | Device providers: unique `name` and base `url`; **Any** in the launch dialog tries them in this order |

### GPS map

The GPS panel of a session shows a map: click it or drag the marker to fake
the device's position there, or click points for it to walk, run or drive
through. The tiles come from
[OpenFreeMap](https://openfreemap.org), which needs no API key, through the
api: the browser only talks to the portal, and the tile server sees the
api's address and User-Agent, never the user's cookies.

```yaml
map:
  url: https://tiles.openfreemap.org # empty turns the map off
  style: styles/liberty # path of the MapLibre style under url
  darkStyle: styles/dark # for the portal's dark theme; defaults to style
```

Any server that keeps a MapLibre style, its TileJSON, tiles, sprites and
glyphs under one base URL works, a self-hosted one included: the api rewrites
`map.url` in JSON responses to its own proxy path. The api needs outbound
HTTPS to it; nothing is stored, browsers cache the tiles.

GPS routes along roads come from a [Valhalla](https://github.com/valhalla/valhalla)
server, through the api as well: by default the public FOSSGIS one, free
and keyless under fair use. Walking and running use its `pedestrian`
profile, driving `auto`; a route takes up to 18 clicked points.

```yaml
routing:
  url: https://valhalla1.openstreetmap.de # empty: straight lines only
```

A self-hosted Valhalla works the same; run your own if many people plan
long routes, since the public server limits the rate and the distance.
