---
title: DNS log and rewrites
description: Every name a session's device looks up, rewrites of names to other addresses, a TTL limit and saved sets of rewrites.
sidebar:
  order: 8
---

Sessions with a [VPN](/concepts/vpn/) answer the device's DNS
themselves: the sidecar hands every query to the session's agent, which
logs it, answers the names you rewrote and sends the rest to `vpn.dns`
through the selected location. Each session starts with an empty cache and
no rewrites, so nothing carries over from another session.

The **DNS** tab next to DevTools has two views.

## Queries

Every name the device looks up, as it happens. Apps ask for a name's `A`,
`AAAA` and `HTTPS` records at once, so those queries share one row: the
time, the name, the record types it asked for, the addresses it got (or
where a `CNAME` points, or what an `HTTPS` record offers, such as
`alpn h3, h2`), the TTL and how long the slowest answer took. A TTL like
`0s / 5m` is what the device got next to what the upstream sent. The list
survives a reload of the page (the agent keeps the last 2000 queries).
Filter it by name or answer, or show only rewritten, failed or `NXDOMAIN`
lookups.

An ordinary answer has no marks; what stands out does:

- **rewrite** (violet): a rewrite answered it;
- **NXDOMAIN** (amber): the name doesn't exist;
- **SERVFAIL** (red): the upstream didn't answer;
- **no records**: the name exists but has none of these types;
- **far** (amber): every address answered is on another continent than
  the session's exit (see [Routes](/session-tools/routes/)).

A dashed type means an empty answer: `AAAA` is always empty because the
sidecar resolves IPv4 only, so apps connect over IPv4. A click on a row
shows each query's records, with the `CNAME` chain and every `HTTPS`
parameter, and the country and network of each address.

The wand at the end of a row, or **Rewrite this name…** in its details,
opens a new rewrite for that name.

## Rewrites

A rewrite answers a name with your own answer instead of the real one:

| Answer with   | What the device gets                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| IP address    | the IPv4 addresses you enter for `A` queries; other types get an empty answer |
| Block         | `0.0.0.0`, so connections fail at once                                        |
| Other name    | a `CNAME` to that name and its addresses, looked up through the location      |
| Doesn't exist | `NXDOMAIN`                                                                    |

A name is either exact (`api.example.com`) or a wildcard (`*.example.com`,
every name under `example.com` but not `example.com` itself). An exact name
wins over a wildcard and a longer wildcard over a shorter one. When you
start from a query, the dialog offers the name itself, its siblings and
everything under it, and shows which names seen in the session would match.

A rewrite's TTL is 0 by default, so Android doesn't cache it and turning the
rewrite off takes effect at once. Every rule has a switch to turn it off
without deleting it, and counts how many queries in the list it answered.

Changing the rewrites clears Android's DNS cache. Connections that are
already open keep their address until they close, and an app's own cache
can keep a name a little longer (a WebView up to a minute); restart the app
when a rewrite has to apply to everything.

## TTL limit and the cache

The TTL menu caps every TTL the device gets: **TTL 0 s** keeps Android from
caching answers at all, so every lookup shows up in the list; 5, 30, 60 or
300 seconds keeps lookups fresh without that many queries. The limit also
applies to negative answers (through the `SOA` record). **Clear DNS cache**
empties Android's resolver cache right away.

The agent turns Android's Private DNS (DNS over TLS) off in these sessions:
lookups over TLS would bypass the log and the rewrites.

## Encrypted DNS in apps

Browsers and some apps resolve names themselves over DNS over HTTPS (DoH),
which the log and the rewrites never see. Two things keep them on the
device's DNS:

- **Chrome and Chromium** get the policy `DnsOverHttpsMode: off` on their
  command line, next to the flags that skip their welcome screens. Chrome
  reads command-line policies only on debuggable devices (redroid is) and
  not in its Stable and Beta channels; Chromium builds, Dev and Canary obey
  it.
- **Block DoH** in the toolbar (on by default) answers the names of
  well-known DoH and DNS-over-TLS servers (Cloudflare, Google, Quad9,
  OpenDNS, NextDNS, AdGuard, the rest of Chrome's upgrade list) with
  `NXDOMAIN`. Chrome Stable in its automatic mode, and most apps that bundle
  DoH, then fall back to the device's DNS. Those lookups are marked
  **DoH blocked**, and Chrome's retries of its server (about one a second)
  fold into one row with a count; a rewrite of the same name wins over the block. Turn the
  switch off to test an app's own DoH.

WebViews never use DoH: in Chromium only the browser turns it on, so the
WebView of any provider resolves through the device.

## Saved sets

**Sets** saves the current rewrites and TTL limit under a name, for you
alone, in the portal's [database](/configuration/database/). A set
is never loaded into a new session by itself: pick it from **Sets** and
choose to use it instead of the current rewrites or to add it to them (a
name in both takes the set's rewrite). The same menu overwrites, renames or
deletes a set, and imports and exports sets as JSON files to share them.

## Recordings

A [recording](/concepts/recordings/) keeps the DNS log: its DNS
tab lists the queries up to the playhead, with rows where the rewrites or
the TTL limit changed and where the cache was cleared. Those moments are
violet ticks on the timeline.

## Limits

- Only sessions with a VPN sidecar have the tab; physical phones don't yet.
- Chrome picks up its flags when it starts: one that was already running
  before a new install keeps its DoH until it restarts. An app that reaches
  a DoH server by IP address (`https://1.1.1.1/dns-query`) isn't blocked.
- An app that hard-codes an IP address, or resolves names over its own
  DNS-over-HTTPS, isn't affected by rewrites.
- Addresses are IPv4 only, like everything the sidecar resolves.
