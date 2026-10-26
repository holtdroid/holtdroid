---
title: Monitoring and audit
description: Prometheus metrics, OpenTelemetry tracing and the audit log — who did what, when.
sidebar:
  order: 4
---

Metrics, traces and audit events leave the process for whatever you already
run (Prometheus, Loki, Elasticsearch, Datadog, an OpenTelemetry Collector).
For small installs without such a stack, the api also keeps a bounded list
of recent audit events that admins can browse in the portal. Everything
below is off by default except audit lines on stdout and that list.

Every service reads the same two sections from its config file, `telemetry`
and `audit`. The audit log only comes from the api and the ssh-gateway.

## Metrics

```yaml
telemetry:
  metrics:
    listen: ":9090" # empty: off
```

Each service then serves Prometheus metrics on `GET /metrics` at that
address, separate from its API port. In the Helm chart:

```yaml
telemetry:
  metrics:
    enabled: true
    port: 9090
    podMonitor:
      enabled: true # needs the Prometheus Operator CRDs
      labels: { release: kube-prometheus-stack }
```

The chart adds a `metrics` port to every pod and a `PodMonitor` for the
components and, with the emulator provider, for session pods. Session pods
sit behind a NetworkPolicy; `telemetry.metrics.from` says who may scrape
them (any namespace by default).

| Metric                                      | Type      | From             | Labels                                                                     |
| ------------------------------------------- | --------- | ---------------- | -------------------------------------------------------------------------- |
| `holtdroid_sessions`                        | gauge     | api              | `provider`, `state`                                                        |
| `holtdroid_slots`                           | gauge     | api              | `provider`, `kind` (`total`, `free`, `maintenance`)                        |
| `holtdroid_session_launches_total`          | counter   | api              | `provider`, `result` (`ok`, `denied`, `failed`)                            |
| `holtdroid_session_launch_duration_seconds` | histogram | api              | `provider`                                                                 |
| `holtdroid_sessions_failed_total`           | counter   | api              | `provider`                                                                 |
| `holtdroid_sessions_ended_total`            | counter   | api              | `provider`, `reason` (`stopped`, `idle`, `ttl`)                            |
| `holtdroid_apk_cache_requests_total`        | counter   | api              | `result` (`hit`, `miss`)                                                   |
| `holtdroid_session_proxy_connections`       | gauge     | api              | `provider`                                                                 |
| `holtdroid_app_data_saves_total`            | counter   | api              | `trigger` (`stop`, `reap`, `manual`), `result` (`ok`, `failed`, `skipped`) |
| `holtdroid_app_data_restores_total`         | counter   | api              |                                                                            |
| `holtdroid_ssh_connections`                 | gauge     | ssh-gateway      |                                                                            |
| `holtdroid_ssh_logins_total`                | counter   | ssh-gateway      | `result`                                                                   |
| `holtdroid_ssh_tunnels`                     | gauge     | ssh-gateway      | `kind` (`adb`, `reverse`)                                                  |
| `holtdroid_ssh_tunnels_total`               | counter   | ssh-gateway      | `kind`, `result`                                                           |
| `holtdroid_ssh_bytes_total`                 | counter   | ssh-gateway      |                                                                            |
| `holtdroid_http_requests_total`             | counter   | every API        | `api`, `operation`, `code`                                                 |
| `holtdroid_http_request_duration_seconds`   | histogram | every API        | `api`, `operation`                                                         |
| `holtdroid_audit_events_total`              | counter   | api, ssh-gateway | `action`, `result`                                                         |
| `holtdroid_audit_dropped_total`             | counter   | api, ssh-gateway | `sink`                                                                     |

Plus the standard Go runtime and process metrics. Session counts and slots
are refreshed by the reaper (`sessions.reapInterval`). The launch duration
is measured from the launch request to the session being ready, by the
replica that launched it. Streaming operations (server-sent events, the
screen) count in the request duration until the stream ends.

## Tracing

```yaml
telemetry:
  tracing:
    enabled: true
    endpoint: http://otel-collector.monitoring:4318 # OTLP over HTTP
    insecure: false
    sampleRatio: 1
```

Requests are traced from the api through the provider to the session's
agent: every contract call carries the W3C `traceparent` header, and every
service continues the trace it receives. Without `endpoint` the exporter
reads the standard `OTEL_EXPORTER_OTLP_*` environment variables. The chart
passes the same settings to session agents.

## Audit log

The api and the ssh-gateway write one JSON line per action to **stdout**,
while their regular logs go to stderr. Every audit line has
`"log":"audit"` and a `schema` version, so a collector can route them apart:

```json
{
  "time": "2026-01-01T12:00:00Z",
  "level": "INFO",
  "msg": "audit",
  "log": "audit",
  "schema": 1,
  "service": "api",
  "action": "session.launch",
  "result": "ok",
  "actor": "otter",
  "provider": "emulator",
  "session": "3f9c1a2b7e",
  "artifact": "slack/C1/F1/app.apk@1f2e",
  "clientIp": "10.42.0.17",
  "forwardedFor": "203.0.113.7",
  "userAgent": "Mozilla/5.0 …",
  "details": { "location": "pl", "package": "com.example.app" }
}
```

| Field                 | Meaning                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `schema`              | Version of this format; bumped on any incompatible change                  |
| `service`             | `api` or `ssh-gateway`                                                     |
| `action`              | What happened, see below                                                   |
| `result`              | `ok`, `denied` (not allowed) or `failed` (allowed, but it didn't work)     |
| `actor`               | User name; `admin: true` when they acted as an admin. Empty for the reaper |
| `provider`, `session` | The session acted on                                                       |
| `artifact`            | `source/path` of the build, with `@revision` once it was resolved          |
| `clientIp`            | The peer address the service saw (often your ingress)                      |
| `forwardedFor`        | The raw `X-Forwarded-For` header: only as trustworthy as your proxy        |
| `userAgent`           | The browser or client                                                      |
| `reason`              | Why it was denied or failed, or why the reaper stopped the session         |
| `details`             | Action-specific strings                                                    |

| Action                 | Details                                                       | Notes                                                                                                                     |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `auth.signin`          | `method` (`anonymous`, `password`, `oidc`)                    | Header mode has no sign-in: your proxy did it                                                                             |
| `auth.signout`         |                                                               |                                                                                                                           |
| `session.launch`       | `package`, `location`, `appData`, `appDataCache`, `recording` | `appData` is the id of the save the session started from; `recording` the recording that started with it                  |
| `session.stop`         |                                                               | Stopped by a user                                                                                                         |
| `session.reap`         | `owner`                                                       | `reason`: `idle timeout` or `max TTL reached`                                                                             |
| `session.extend`       |                                                               |                                                                                                                           |
| `session.install`      | `package`, `keepData`                                         | Another build installed into a running session                                                                            |
| `session.location`     | `location`                                                    | VPN location switch                                                                                                       |
| `session.clipboard`    |                                                               | Clipboard writes through the agent API; never the content. Clipboard sync inside the scrcpy stream is not seen by the api |
| `artifact.upload`      | `package`, `version`, `visibility`, `temporary`               |                                                                                                                           |
| `artifact.update`      | `visibility`, `temporary`                                     |                                                                                                                           |
| `artifact.delete`      |                                                               |                                                                                                                           |
| `artifact.download`    |                                                               | Denied for non-admins with `downloads.adminOnly`                                                                          |
| `ssh.enroll`           | `computer`, `hostname`, `fingerprint`, `os`                   | A computer was enrolled with a code from the portal; denied for invalid, expired or reused codes                          |
| `ssh.connect`          | `computer`, `hostname`                                        | From the ssh-gateway; denied for a rejected certificate from the portal's authority                                       |
| `ssh.disconnect`       | `computer`, `hostname`, `seconds`, `bytes`                    |                                                                                                                           |
| `ssh.tunnel`           | `computer`, `hostname`, `kind` (`adb`, `reverse`), `port`     | Every ADB connection and port published on a device                                                                       |
| `appdata.save`         | `owner`, `package`, `trigger`, `id`, `cache`, `size`          | `trigger`: `stop`, `reap` or `manual`; nothing is recorded when the app had no data                                       |
| `appdata.download`     | `package`, `id`                                               |                                                                                                                           |
| `appdata.delete`       | `package`, `id`                                               | Deleted by the user; retention deletions are only logged                                                                  |
| `recording.start`      | `recording`                                                   | Started from the session page; recordings started at launch show up as `recording` in `session.launch`                    |
| `recording.stop`       | `recording`                                                   | Stopped from the session page; stopping the session ends its recording too                                                |
| `recording.delete`     | `recording`                                                   | Deleted by the user; retention and quota deletions are only logged                                                        |
| `recording.marker`     | `recording`                                                   | A marker was pinned from the session page                                                                                 |
| `recording.rename`     | `recording`                                                   | The owner gave it a name                                                                                                  |
| `recording.share`      | `recording`                                                   | A share link was made                                                                                                     |
| `recording.unshare`    | `recording`                                                   |                                                                                                                           |
| `adb.connect`          |                                                               | The session page's ADB connection; denied per `adb.browser` / `adb.ownerOnly`                                             |
| `adb.disconnect`       | `seconds`                                                     |                                                                                                                           |
| `audit.export`         | `events`, `q`                                                 | An admin downloaded events from the audit page                                                                            |
| `provider.maintenance` | `slot`, `enabled`, `reason`                                   | An admin held or released a slot (empty `slot`: the whole provider) on the Inventory page                                 |

Session actions are also kept in the api's
[database](/holtdroid/configuration/database/).

### Other destinations

```yaml
audit:
  stdout: true
  otlp:
    enabled: true
    endpoint: http://otel-collector.monitoring:4318 # empty: OTEL_EXPORTER_OTLP_* variables
  webhook:
    url: env:AUDIT_WEBHOOK_URL # a secret reference
    authorization: env:AUDIT_WEBHOOK_AUTH # optional Authorization header value
    batchSize: 100
    flushInterval: 5s
    retries: 5
    timeout: 10s
```

- **OTLP logs** carry the same fields as attributes, with the action as the
  event name.
- **The webhook** receives `POST` requests with a JSON array of events (the
  fields above, without `level`/`msg`/`log`), at most `batchSize` at a time
  and at least every `flushInterval`. Failed batches are retried with
  backoff; after `retries` they are dropped and counted in
  `holtdroid_audit_dropped_total`, as are events that arrive while 4096 are
  already waiting. Events still queued are sent on shutdown.

Durability is the destination's job. For a complete trail, collect stdout:
it is written synchronously.

### Audit log in the portal

Admins (members of `auth.adminGroups`) get an **Audit log** page: events
newest first, filters by action or action group, user, result, service,
time range and free text, a live mode that refreshes every 5 seconds, a
detail view per event and an export of the filtered events as JSON lines.
Clicking a user, an action or a session in the table filters by it.

```yaml
audit:
  store:
    enabled: true
    maxEvents: 10000 # the oldest events are dropped beyond either limit
    maxAge: 720h # 0: no age limit
    path: /var/lib/holtdroid/audit/events.jsonl # empty: memory only
```

The api keeps the events in memory; 10 000 of them take about 5 MiB. With
`path`, they are also appended to a JSON lines file, read back on start,
and the file is rewritten whenever it holds twice as many lines as events
are kept, so it stays bounded. The ssh-gateway sends its events to the api
in batches when its `audit.forward` is on (the chart does that whenever
`audit.store.enabled` is set).

In the chart, `audit.store.persistence` decides where the file lives:

| Value            | Where                                               | Survives                                      |
| ---------------- | --------------------------------------------------- | --------------------------------------------- |
| `data` (default) | the api data volume (`api.persistence`)             | restarts and new pods, if the volume is a PVC |
| `volume`         | `audit.store.volume`, by default a tmpfs `emptyDir` | container restarts, not a new pod             |
| `none`           | nowhere, memory only                                | nothing                                       |

A tmpfs volume counts against the api container's memory limit.

The page is a convenience, not an archive: each api replica keeps its own
events (with several replicas, each page load shows one replica's view),
and it never replaces collecting stdout or the sinks above.
