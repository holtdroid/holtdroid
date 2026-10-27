---
title: Routes
description: Where a session's connections go — the servers behind each name, their country and network, the VPN location they left through, and what makes a path slower than it needs to be.
sidebar:
  order: 5
---

Sessions with a [VPN](/holtdroid/concepts/vpn/) know every connection the
device opens: the sidecar that carries its traffic reports them to the
session's agent. The **Routes** tab next to DevTools turns them into the
path the app's traffic takes, from the device through the VPN location to
each server, and points out what looks off.

## The path

The line at the top is the session's route: the device, the VPN location,
its exit address with the country and network it belongs to, then the
servers. Below it, one row per name the app connected to (or per address,
for a connection without a name):

- the **address** of the server, and how many others the name led to;
- **where** it is: the country and the network (autonomous system) the
  address belongs to, and **CDN** for an edge of Cloudflare, Fastly or
  Google;
- **via**: the VPN location (or `bypass`) the traffic left through;
- how many **connections** it took, open ones in brackets, and the bytes
  received.

Names whose connections all closed are greyed. The list survives a reload
(the agent keeps the open connections and the last 2000 closed ones).

## What is flagged

- **far**: the server is on another continent than the session's exit, so
  every round trip crosses an ocean or two. A CDN edge is never far: its
  address is anycast, and the site that answers is the nearest one,
  whatever country the address is listed in.
- **no reuse**: six or more TCP connections to one port within a minute.
  Each pays a TCP and a TLS handshake; keep-alive or HTTP/2 would carry them
  over one connection.
- **bypass**: some of the traffic left past the VPN location (the
  addresses in `vpn.bypassCIDRs`).
- **HTTP**: unencrypted HTTP on port 80.

**Flagged** shows only the names with a flag.

## A name's details

A click on a row shows the name's servers with their places, its DNS
answers (asked through the VPN location, so a geo-DNS service answers for
that location's country), and every connection: when it opened, how long
it lasted, the protocol and port, the outbound and its bytes. In a
recording, the details also show the median connect, TLS and waiting times
of the WebView's requests to that name, and how many of them opened a new
connection.

The [DNS](/holtdroid/concepts/dns/) tab places the addresses it answered the
same way and marks a lookup **far** when every address in it is on another
continent than the exit.

## In recordings

[Recordings](/holtdroid/concepts/recordings/) keep the connections, and the
player has the same tab: it shows the connections as they stood at the
playhead. Places are looked up when the recording is watched, so they are
where the addresses are now.

## Limits

- Emulator sessions see every connection as it opens and closes, however
  short, with its final bytes. On [phones](/holtdroid/configuration/phones/)
  the open connections are read four times a second, so one shorter than
  that may be missing, or shown without its last bytes.
- Places are per country, from the [DB-IP Lite](https://db-ip.com)
  databases in the portal's image (`geoIP` in the
  [configuration](/holtdroid/configuration/overview/#ip-geolocation)); a
  portal without them shows no countries or networks, only CDN edges.
- Holtdroid doesn't trace the hops to a server: from inside the session a
  trace stops at the tunnel, and the exit belongs to the VPN.
- Sessions without a VPN sidecar have no Routes tab.
