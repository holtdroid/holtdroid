---
title: Writing a provider
description: Plug a new kind of device into Holtdroid by implementing the provider and agent APIs.
sidebar:
  order: 2
---

A provider owns devices: it starts a session on a free one, reports its
state, and stops it. Holtdroid ships `provider-emulator` (emulators as
Kubernetes Pods) and `provider-fake` (simulated devices for development).
Anything else — a farm of USB phones, emulators on bare metal, a cloud
device service — is a new provider. It is a plain HTTP service; the api only
needs its URL:

```yaml
providers:
  - name: lab
    url: http://lab-provider.devices:8080
```

## What the api expects

The endpoints are listed in [Contracts](/holtdroid/extending/contracts/#device-provider);
the request and response shapes are the Go types in
[`internal/contract/types.go`](https://github.com/kriakiku/holtdroid/blob/main/internal/contract/types.go)
and the OpenAPI document a Go provider serves at `/openapi.json`.

1. **The provider is the source of truth.** The api is stateless: it asks
   the provider for the session list on every page load and reaper pass, and
   expects it to survive restarts of both. Keep session state where your
   devices are (Pod annotations, a file next to the phone, your service's
   database), not in memory only.
2. **`GET /v1/capacity` lists slots.** One slot per device that can run a
   session, `free`, `busy`, `offline` or `maintenance`. The api refuses a launch when no
   slot is free, so keep it honest and cheap: the reaper calls it.
3. **`POST /v1/sessions` returns quickly.** Answer with the session in
   `provisioning` and do the work in the background. The UI shows `state`
   and `detail` while it waits for `ready`. Return 409 when there is no free
   slot, 400 for a bad request. When `CreateSession.slot` is set, use that
   slot: 422 if you don't know it, 409 if it isn't free. The api always
   sends the slot it picked from your capacity.
4. **The agent downloads the build.** `CreateSession.artifactUrl` points at
   the api's internal port and serves the exact cached revision. The device
   side must be able to reach it; the browser never does. When
   `CreateSession.appData` is set, pass it to the agent too: it restores
   `appData.url` (also on the internal port) after installing the APK.
5. **`POST /v1/sessions/{id}/touch` stores activity.** The api batches the
   last user activity and flushes it every `sessions.flushInterval`; return
   it as `lastActivity` so the idle timeout survives an api restart.
6. **`DELETE /v1/sessions/{id}` frees the device.** Wipe what the user left
   behind before the slot is `free` again. The reaper calls it for idle and
   expired sessions.
7. **`agentUrl`** is where the api proxies the browser's requests:
   `/s/{provider}/{id}/…` with the prefix stripped. It must only be reachable
   from the api (and `tunnelUrl` from the ssh-gateway).
8. **Errors** follow RFC 9457 problem JSON, like the rest of the API; 404 for
   an unknown session id.
9. **Maintenance holds belong to the provider.** `PUT /v1/maintenance`
   holds a slot (or, without `slot`, every slot) or releases it. Keep the
   holds with your session state so they survive a restart, and report a
   held slot as `maintenance` once nothing runs on it; a running session
   keeps going. `contract.MaintenanceState` does the bookkeeping for Go
   providers. 400 for a slot you don't know.
10. **`GET /v1/inventory` is for the admins' Inventory page.** Return every
    slot (as in `capacity`), the session on it, and whatever you can tell
    about the device (`device`: model, Android, battery, sensors, memory,
    storage) or the machine (`host`: OS, CPU, load, sensors). Leave out what
    you don't know and say why in `error`; keep it within a few seconds,
    the page asks every 10.

`capabilities` tells the UI what to show: VPN locations and the default
one, whether DevTools and the clipboard work, the display kind (`scrcpy`),
and the ABIs the device runs. When devices differ from slot to slot, as
phones do, put a `capabilities` object (model, Android version, ABIs, root,
DevTools scope `all` or `debuggable`, ADB, app data) on each slot and copy
it onto the sessions that run there; the session page reads it from the
session.

## The agent

Every session needs an agent next to the device that implements the
[agent API](/holtdroid/extending/contracts/#device-agent): status, the
scrcpy screen stream, DevTools targets and their WebSockets, clipboard,
network and device controls. The browser talks to it directly through the
api's proxy, so whatever your device is, the UI works the same.
`holtdroid agent` starts and drives an emulator itself; its pieces in
[`internal/agent`](https://github.com/kriakiku/holtdroid/tree/main/internal/agent)
(adb, Frida, scrcpy bridge, DevTools proxy) are the starting point for an
agent that drives some other device.

## Writing it in Go

Satisfy `contract.Provider` and mount it:

```go
mux := http.NewServeMux()
contract.RegisterProvider(contract.NewAPI(mux, "lab provider"), myProvider)
http.ListenAndServe(":8080", mux)
```

`internal/provider/fake` is the smallest complete example: slots, a session
lifecycle with delays, and an in-process agent. Test the round trip the way
`internal/contract/contract_test.go` does: serve your implementation with
`httptest.NewServer` and drive it through `contract.NewProviderClient`.

## Any other language

Serve the same JSON over HTTP. The OpenAPI document of the Go types
(`/openapi.json` on any Go provider, for example
`holtdroid provider-fake`) can generate a server stub. To try it in the UI,
run `holtdroid api` with your provider in `providers`.

## Observability

Propagate the W3C `traceparent` header from the api's requests into your
own spans, and the api's traces continue through your provider. See
[Monitoring and audit](/holtdroid/operations/monitoring/).
