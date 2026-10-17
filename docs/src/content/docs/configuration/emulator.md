---
title: Emulator provider
description: Run sessions as Android emulator Pods on KVM-capable Kubernetes nodes.
sidebar:
  order: 5
---

The `provider-emulator` service creates one Pod per session in its own
namespace. It needs a ServiceAccount allowed to manage Pods and Secrets there,
and to list Nodes cluster-wide (the Helm chart creates both).

```yaml
listen: ":8080"
kubeconfig: "" # empty: the Pod's service account
namespace: holtdroid
slots: 4
nodeSelector: "holtdroid/kvm=true" # a label selector
tolerations:
  - { key: dedicated, operator: Equal, value: nas, effect: NoSchedule }
image: ghcr.io/kriakiku/holtdroid-session:0.1.0
imagePullPolicy: IfNotPresent
imagePullSecrets: []
agentPort: 8080
resources:
  requests: { cpu: "3", memory: 5Gi }
  limits: { memory: 7Gi }
vpn:
  locations: [] # see below; empty means no VPN sidecar
```

| Key                        | Meaning                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kubeconfig`               | Path to a kubeconfig. Empty uses the in-cluster service account                                                                                                    |
| `namespace`                | Where session Pods and their Secrets are created                                                                                                                   |
| `nodeSelector`             | [Label selector](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/#label-selectors) for nodes that may run sessions. Nodes need `/dev/kvm` |
| `tolerations`              | Taints session Pods tolerate. Nodes with other `NoSchedule`/`NoExecute` taints are not used                                                                        |
| `slots`                    | Maximum concurrent sessions; `0` means one per matching node                                                                                                       |
| `image`, `imagePullPolicy` | Session image (emulator + agent)                                                                                                                                   |
| `imagePullSecrets`         | Secret names for pulling the session image                                                                                                                         |
| `agentPort`                | Port the agent listens on inside the Pod; the api reaches it at the Pod IP                                                                                         |
| `resources`                | Per-session emulator container resources. Leave out a CPU limit: throttling makes the software-rendered screen stutter                                             |
| `vpn`                      | Per-session VPN, see below                                                                                                                                         |

Every matching node is one slot, at most one session per node. A session is
pinned to the first free node; nodes that are not Ready or are cordoned show
as offline. Session state lives on the Pod, so restarting the provider loses
nothing. Run one provider replica per namespace.

## Helm chart

`providers.emulator.enabled: true` deploys the provider (one replica) with its
ServiceAccount, a Role for Pods and Secrets in the release namespace and a
ClusterRole to list Nodes. The chart fills `namespace`, `image` and
`imagePullSecrets` itself:

```yaml
providers:
  emulator:
    enabled: true
    slots: 4
    nodeSelector: { holtdroid/kvm: "true" } # a map here; the chart turns it into a selector
    tolerations: []
    session:
      image: { repository: ghcr.io/kriakiku/holtdroid-session, tag: "" } # tag defaults to image.tag
      resources: { requests: { cpu: "3", memory: 5Gi }, limits: { memory: 7Gi } }
    vpn: {} # the vpn section below
    networkPolicy: { enabled: true } # only the api reaches session agents
    prepull:
      enabled: true # DaemonSet that pulls the session image onto session nodes
      refresh: { enabled: true, interval: 5m }
```

The session image is several GB. The pre-pull DaemonSet runs on the same
nodes as sessions and keeps the current tag on disk, so the first launch after
an upgrade doesn't wait for the download.

With a moving tag (`tag: main`) and `pullPolicy: Always`, an upgrade of the
image doesn't change the chart, so the DaemonSet wouldn't notice it. With
`prepull.refresh` on (the default), the provider asks the registry for the
tag's digest every `interval` and, when it moves, restarts the DaemonSet:
the nodes pull the new layers in the background, before the next session
needs them. The registry is queried anonymously, which works for public
images; with a pinned tag or `IfNotPresent` the refresh does nothing.

## VPN

With at least one location, every session Pod gets a `vpn` sidecar (see
[Per-session VPN](/holtdroid/concepts/vpn/)). Each location is a sing-box
outbound; the usual one points at a
[shared VPN gateway](/holtdroid/operations/vpn-gateway/):

```yaml
vpn:
  image: ghcr.io/sagernet/sing-box:v1.14.2
  bypassCIDRs: [10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7]
  dns: 1.1.1.1
  resolver: 10.43.0.10 # cluster DNS; needed for *.cluster.local names
  direct: true
  default: direct
  locations:
    - id: de
      label: Germany
      outbound:
        type: socks
        server: vpn-gateway.vpn.svc.cluster.local
        server_port: 1080
        username: de
        password: env:VPN_GATEWAY_PASSWORD # any string field may be a secret reference
        udp_over_tcp: true
    - id: nl
      label: Netherlands
      outbound: openbao:secret/holtdroid#vpn_nl # the outbound as JSON
```

| Key               | Meaning                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vpn.image`       | sing-box image for the sidecar (1.12 or newer)                                                                                                                                                                                                                                                                            |
| `vpn.bypassCIDRs` | Ranges that never go through the tunnel. Must include your Pod and Service CIDRs, and the gateway's address                                                                                                                                                                                                               |
| `vpn.dns`         | Resolver (IP) for the device's DNS, queried through the selected location                                                                                                                                                                                                                                                 |
| `vpn.resolver`    | Resolver (IP) for host names inside outbounds. Empty uses the Pod's `/etc/resolv.conf`, but sing-box sends `*.local` names to mDNS, so set your cluster DNS here when outbounds use `*.cluster.local`                                                                                                                     |
| `vpn.direct`      | Offer a `direct` location (no VPN). Default `true`                                                                                                                                                                                                                                                                        |
| `vpn.default`     | Location a session starts in when the user picks none. Default: `direct`, or the first location                                                                                                                                                                                                                           |
| `vpn.locations`   | `id` (lowercase letters, digits, `-`; quote ids YAML reads as booleans, such as `"no"` for Norway), `label`, and `outbound`                                                                                                                                                                                               |
| `…[].outbound`    | A sing-box outbound or endpoint object without `tag`, or a [secret reference](/holtdroid/configuration/secrets/) whose value is that object as JSON. Inside an object, any string value that is a secret reference (`env:`, `file:`, `openbao:`) is replaced by the secret, at any depth: use that for passwords and keys |

Any outbound works, for example a WireGuard endpoint straight in the sidecar
(set `mtu: 1280` on overlay networks such as flannel VXLAN). But a WireGuard
key used by several session Pods at once breaks, so prefer the gateway.
