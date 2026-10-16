---
title: Emulator provider
description: Run sessions as Android emulator Pods on KVM-capable Kubernetes nodes.
sidebar:
  order: 6
---

The `provider-emulator` service creates one Pod per session in its own
namespace. It needs a ServiceAccount allowed to manage Pods and Secrets there
(the Helm chart creates it).

```yaml
listen: ":8080"
namespace: holtdroid
slots: 4
image: ghcr.io/kriakiku/holtdroid-session:0.1.0
imagePullSecrets: []
nodeSelector: {}
tolerations: []
resources:
  requests: { cpu: "3", memory: 5Gi }
  limits: { cpu: "4", memory: 7Gi }
vpn:
  locations: [] # see below; empty means no VPN sidecar
```

| Key                           | Meaning                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `slots`                       | Maximum concurrent sessions. At most one per node anyway |
| `image`                       | Session image (emulator + agent)                         |
| `nodeSelector`, `tolerations` | Where sessions may run. Nodes need `/dev/kvm`            |
| `resources`                   | Per-session emulator container resources                 |
| `vpn`                         | Per-session VPN, see below                               |

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
        password: holtdroid
        udp_over_tcp: true
    - id: nl
      label: Netherlands
      outbound: openbao:secret/holtdroid#vpn_nl # the outbound as JSON
```

| Key               | Meaning                                                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vpn.image`       | sing-box image for the sidecar (1.12 or newer)                                                                                                                                                        |
| `vpn.bypassCIDRs` | Ranges that never go through the tunnel. Must include your Pod and Service CIDRs, and the gateway's address                                                                                           |
| `vpn.dns`         | Resolver (IP) for the device's DNS, queried through the selected location                                                                                                                             |
| `vpn.resolver`    | Resolver (IP) for host names inside outbounds. Empty uses the Pod's `/etc/resolv.conf`, but sing-box sends `*.local` names to mDNS, so set your cluster DNS here when outbounds use `*.cluster.local` |
| `vpn.direct`      | Offer a `direct` location (no VPN). Default `true`                                                                                                                                                    |
| `vpn.default`     | Location a session starts in when the user picks none. Default: `direct`, or the first location                                                                                                       |
| `vpn.locations`   | `id` (lowercase letters, digits, `-`), `label`, and `outbound`                                                                                                                                        |
| `…[].outbound`    | A sing-box outbound or endpoint object without `tag`, or a [secret reference](/holtdroid/configuration/secrets/) whose value is that object as JSON. Use a reference whenever it holds credentials    |

Any outbound works, for example a WireGuard endpoint straight in the sidecar
(set `mtu: 1280` on overlay networks such as flannel VXLAN). But a WireGuard
key used by several session Pods at once breaks, so prefer the gateway.
