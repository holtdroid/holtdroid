---
title: Monitoring and audit
description: Prometheus metrics, OpenTelemetry tracing and the audit log — who did what, when.
sidebar:
  order: 4
---

Holtdroid keeps nothing about its own operation: metrics, traces and audit
events all leave the process for whatever you already run (Prometheus,
Loki, Elasticsearch, Datadog, an OpenTelemetry Collector). Everything below is
off by default except audit lines on stdout.

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

| Metric                                      | Type      | From             | Labels                                          |
| ------------------------------------------- | --------- | ---------------- | ----------------------------------------------- |
| `holtdroid_sessions`                        | gauge     | api              | `provider`, `state`                             |
| `holtdroid_slots`                           | gauge     | api              | `provider`, `kind` (`total`, `free`)            |
| `holtdroid_session_launches_total`          | counter   | api              | `provider`, `result` (`ok`, `denied`, `failed`) |
| `holtdroid_session_launch_duration_seconds` | histogram | api              | `provider`                                      |
| `holtdroid_sessions_failed_total`           | counter   | api              | `provider`                                      |
| `holtdroid_sessions_ended_total`            | counter   | api              | `provider`, `reason` (`stopped`, `idle`, `ttl`) |
| `holtdroid_apk_cache_requests_total`        | counter   | api              | `result` (`hit`, `miss`)                        |
| `holtdroid_session_proxy_connections`       | gauge     | api              | `provider`                                      |
| `holtdroid_ssh_connections`                 | gauge     | ssh-gateway      |                                                 |
| `holtdroid_ssh_logins_total`                | counter   | ssh-gateway      | `result`                                        |
| `holtdroid_ssh_tunnels`                     | gauge     | ssh-gateway      | `kind` (`adb`, `reverse`)                       |
| `holtdroid_ssh_tunnels_total`               | counter   | ssh-gateway      | `kind`, `result`                                |
| `holtdroid_ssh_bytes_total`                 | counter   | ssh-gateway      |                                                 |
| `holtdroid_ssh_key_requests_total`          | counter   | ssh-gateway      | `result` (`created`, `added`, `expired`)        |
| `holtdroid_http_requests_total`             | counter   | every API        | `api`, `operation`, `code`                      |
| `holtdroid_http_request_duration_seconds`   | histogram | every API        | `api`, `operation`                              |
| `holtdroid_audit_events_total`              | counter   | api, ssh-gateway | `action`, `result`                              |
| `holtdroid_audit_dropped_total`             | counter   | api, ssh-gateway | `sink`                                          |

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

| Action              | Details                                         | Notes                                                                                                                     |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `auth.signin`       | `method` (`anonymous`, `password`, `oidc`)      | Header mode has no sign-in: your proxy did it                                                                             |
| `auth.signout`      |                                                 |                                                                                                                           |
| `session.launch`    | `package`, `location`                           |                                                                                                                           |
| `session.stop`      |                                                 | Stopped by a user                                                                                                         |
| `session.reap`      | `owner`                                         | `reason`: `idle timeout` or `max TTL reached`                                                                             |
| `session.extend`    |                                                 |                                                                                                                           |
| `session.install`   | `package`, `keepData`                           | Another build installed into a running session                                                                            |
| `session.location`  | `location`                                      | VPN location switch                                                                                                       |
| `session.clipboard` |                                                 | Clipboard writes through the agent API; never the content. Clipboard sync inside the scrcpy stream is not seen by the api |
| `artifact.upload`   | `package`, `version`, `visibility`, `temporary` |                                                                                                                           |
| `artifact.update`   | `visibility`, `temporary`                       |                                                                                                                           |
| `artifact.delete`   |                                                 |                                                                                                                           |
| `ssh.keys`          | `keys`, `fingerprints`, `replicas`              | A user replaced their SSH keys                                                                                            |
| `ssh.connect`       | `slug` when denied                              | From the ssh-gateway                                                                                                      |
| `ssh.disconnect`    | `seconds`, `bytes`                              |                                                                                                                           |
| `ssh.tunnel`        | `kind` (`adb`, `reverse`), `port`               | Every `-L 5555:adb:5555` and `-R` request                                                                                 |

Session actions are also kept in the api's database for the session's
lifetime.

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

Holtdroid doesn't keep audit events itself, so durability is the
destination's job. For a complete trail, collect stdout: it is written
synchronously.
