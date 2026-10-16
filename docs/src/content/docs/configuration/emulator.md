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
  provider: nordvpn # none | wireguard | nordvpn
  image: ghcr.io/sagernet/sing-box:v1.14.2
  bypassCIDRs: [10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16]
  privateKey: env:NORDVPN_PRIVATE_KEY
  address: 10.5.0.2/32
  locations: [pl, de, us]
  excludeServers: []
```

| Key                           | Meaning                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `slots`                       | Maximum concurrent sessions. At most one per node in any case                    |
| `image`                       | Session image (emulator + agent)                                                 |
| `nodeSelector`, `tolerations` | Where sessions may run. Nodes need `/dev/kvm`                                    |
| `resources`                   | Per-session emulator container resources                                         |
| `vpn.provider`                | See [Per-session VPN](/holtdroid/concepts/vpn/)                                  |
| `vpn.bypassCIDRs`             | Ranges that never go through the tunnel; must include your Pod and Service CIDRs |
| `vpn.locations`               | For `nordvpn`: ISO country codes offered in the UI                               |
| `vpn.excludeServers`          | For `nordvpn`: server hostnames to never pick                                    |

### Static WireGuard locations

```yaml
vpn:
  provider: wireguard
  locations:
    - id: nl
      label: Netherlands
      endpoint: nl1.example.net:51820
      publicKey: "…"
      privateKey: env:WG_NL_PRIVATE_KEY
      address: 10.66.0.2/32
```
