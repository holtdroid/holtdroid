---
title: Per-session VPN
description: How each device gets its own switchable egress location.
sidebar:
  order: 4
---

Every emulator session can route all of the device's traffic (TCP, UDP and
DNS) through a VPN, and the user can switch the country from the session
toolbar at any time.

## How it works

The session Pod has a `vpn` sidecar running [sing-box](https://sing-box.sagernet.org/)
in the Pod's network namespace:

- a `tun` inbound with `auto_route` captures all egress from the emulator;
- cluster and LAN ranges (`providers.emulator.vpn.bypassCIDRs`) are
  excluded, so the portal can still reach the agent;
- each offered location is a WireGuard endpoint, plus `direct`, behind a
  selector;
- switching location changes the selector through sing-box's local API, so
  the switch is instant and needs no restart.

Android itself is not configured at all; to apps it looks like a normal
network.

## VPN providers

| Provider    | Locations come from                      | Notes                                                       |
| ----------- | ---------------------------------------- | ----------------------------------------------------------- |
| `none`      | –                                        | No sidecar, direct egress. Default.                         |
| `wireguard` | A static list of endpoints in config     | Bring any WireGuard-compatible VPN.                         |
| `nordvpn`   | NordVPN's public server API, per country | Picks a different server for each live session (see below). |

### Sharing one NordVPN key

NordVPN's WireGuard credentials are one key per account. Two peers using the
same key on the **same server** keep knocking each other off. The `nordvpn`
provider therefore picks, per location, a server that no other live session
uses. If the same key is used outside Holtdroid, list those servers in
`excludeServers`.

See [Emulator provider](/holtdroid/configuration/emulator/) for configuration.
