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
  - name: slack
    url: http://holtdroid-source-slack:8080
providers:
  - name: emulator
    url: http://holtdroid-provider-emulator:8080
```

| Key                     | Default     | Meaning                                                                         |
| ----------------------- | ----------- | ------------------------------------------------------------------------------- |
| `listen`                | `:8080`     | Address for the UI, REST API and session proxy                                  |
| `internalListen`        | `:8081`     | Address for endpoints only agents use; never expose it through the ingress      |
| `publicURL`             | –           | External URL of the portal, used to build DevTools WebSocket URLs               |
| `internalURL`           | –           | URL agents use to reach `internalListen`                                        |
| `auth.*`                | `anonymous` | See [Authentication](/holtdroid/configuration/authentication/)                  |
| `secrets.openbao`       | –           | Enables `openbao:` references, see [Secrets](/holtdroid/configuration/secrets/) |
| `sessions.idleTimeout`  | `30m`       | Delete a session after this long without activity                               |
| `sessions.maxTTL`       | `8h`        | Delete a session after this long regardless of activity                         |
| `sessions.reapInterval` | `30s`       | How often the reaper runs                                                       |
| `storage.*`             | filesystem  | See [Artifact storage](/holtdroid/configuration/storage/)                       |
| `cache.maxSize`         | `20GiB`     | Least recently used APKs are evicted beyond this                                |
| `cache.warm`            | `10`        | Newest uncached APKs per listing to download and parse in the background        |
| `database.type`         | `memory`    | Only `memory` for now: SQLite in RAM, empty after every restart                 |
| `sources[]`             | `[]`        | Artifact sources: unique `name` and base `url`                                  |
| `providers[]`           | `[]`        | Device providers: unique `name` and base `url`                                  |
