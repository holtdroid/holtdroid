---
title: Network
description: Slow, lossy or dropping networks for the whole device, and a region's round trips to CDNs and servers, on top of the session's own route.
sidebar:
  order: 7
---

Apps are built on fast office Wi-Fi and used on a train. The **Network** tab
puts the device on a slower network: a named link such as 3G or weak 4G, a
scenario that changes the link over time (a subway ride, an elevator), and
optionally a **region**, the round trips that users in a country have to a
CDN and to your servers. Use it to see whether the app shows loaders,
retries and clear errors instead of a blank screen.

## When the tab is there

The tab appears in emulator sessions with a [VPN](/concepts/vpn/):
the conditions are applied to the VPN tunnel, so without VPN locations
configured there is no tab. Phones don't have it (see
[Phones](/configuration/phones/)). The **Network** card beside the
phone shows the current conditions, and its **Network conditions** row
(**Slow links, scenarios and regions in the Network tab**) opens the tab.

## What it affects

The conditions apply to **the whole device**: every app, the WebView, native
code, DNS lookups. They are not DevTools' throttling, which slows down one
page only. What Holtdroid itself uses to reach the device (the screen,
DevTools, ADB, the agent) isn't slowed down, and neither are the addresses
in `vpn.bypassCIDRs`.

An outage in a scenario drops every packet while Android still sees a
connected network, so requests hang until they time out, as on a dead cell.
For a network that Android knows is gone, turn on **Airplane mode**, or turn
**Wi-Fi** and **Mobile data** off, in the Network card.

The conditions stay when you switch the VPN location; the tab then measures
the new route (see [The session's route](#the-sessions-route)).

## What you see

The heading says what is on: `No emulation`, the network's name (`3G`),
or the region with its link (`Germany · typical mobile`). **No emulation**
next to it turns everything off.

### The session's route

The box at the top, **The session's own route, through its VPN location**,
shows what the session's network already takes before any emulation:

- `CDN edge 23 ms`: the round trip to Cloudflare's nearest edge;
- `↓ 48 Mbit/s`: the route's download bandwidth;
- the round trip to each server location (`Frankfurt 31 ms · N. Virginia
  112 ms · …`);
- how old a measurement is, when it is over two minutes (`12 min ago`).

Every emulated network comes on top of it: a network adds its delay to
these round trips, and can't be faster than the route's bandwidth. Round
trips are measured every minute; the bandwidth after a location change, or
when the last test is over six hours old. A new session starts from the last
route measured through its location. Until the first measurement the box
says **Measuring…**. How the agent measures is described under
[Network conditions](/configuration/emulator/#the-sessions-route).

### Access link

One card per network. Each shows its name, a short description and its
numbers: the delay it adds with its jitter, the download and upload
bandwidth, the packet loss (`+70 ±20 ms · ↓ 10 Mbit/s ↑ 3 Mbit/s · 0.5% loss`).
The picked card is outlined. Without a region, a card also shows the round
trip it means to a CDN edge (`≈ 93 ms to a CDN edge`), the route's plus its
own delay.

| Network               | Delay                                       | Download   | Upload     | Loss          |
| --------------------- | ------------------------------------------- | ---------- | ---------- | ------------- |
| **No limits**         | the session's own network, nothing emulated |            |            |               |
| **5G**                | +25 ±5 ms                                   | 150 Mbit/s | 30 Mbit/s  |               |
| **Good 4G**           | +45 ±10 ms                                  | 30 Mbit/s  | 10 Mbit/s  |               |
| **Typical 4G**        | +70 ±20 ms                                  | 10 Mbit/s  | 3 Mbit/s   | 0.5%          |
| **Weak 4G**           | +150 ±60 ms                                 | 1.5 Mbit/s | 500 kbit/s | 2%, in bursts |
| **3G**                | +200 ±50 ms                                 | 1.5 Mbit/s | 400 kbit/s | 1%            |
| **2G (EDGE)**         | +500 ±150 ms                                | 200 kbit/s | 80 kbit/s  | 2%            |
| **GPRS**              | +800 ±200 ms                                | 50 kbit/s  | 25 kbit/s  | 3%            |
| **Busy public Wi-Fi** | +120 ±80 ms                                 | 3 Mbit/s   | 1 Mbit/s   | 3%, in bursts |
| **Crowded venue**     | +400 ±250 ms                                | 500 kbit/s | 150 kbit/s | 8%, in bursts |
| **Satellite (GEO)**   | +650 ±40 ms                                 | 10 Mbit/s  | 2 Mbit/s   | 0.5%          |
| **Slow upload**       | +60 ±10 ms                                  | 20 Mbit/s  | 300 kbit/s |               |
| **Lossy link**        | +60 ±10 ms                                  | 10 Mbit/s  | 5 Mbit/s   | 10%           |
| **Far away server**   | +300 ±10 ms                                 | unlimited  | unlimited  |               |

Loss is per direction. "In bursts" means lost packets come in runs, as on a
weak cell or a busy hotspot, rather than one at a time. The numbers are rough
medians from public mobile network reports, rounded to be easy to remember,
not measurements of a specific operator. There are no custom values: pick
the closest network.

Amber notes on a card say where the route spoils it:

- **The VPN route's N ms is more than this network's own N ms**: the route
  is already slower than the network would be (5G behind a far VPN
  location), so the delay ends up larger than named;
- **Capped at about N Mbit/s by the VPN**: the network is faster than the
  route's bandwidth.

The card can still be picked: loss, jitter and slower links are unaffected.

### Scenarios

Scenarios loop through networks, holding each for a random time within the
range given:

| Scenario                 | Steps                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Satellite (Starlink)** | its own link (+45 ±15 ms, 100 Mbit/s down, 15 Mbit/s up, 0.5% loss) for 14 to 15 s, then an outage of 0.5 to 1.5 s |
| **Subway**               | Typical 4G for 20 to 40 s, 3G for 10 to 20 s, an outage of 5 to 20 s                                               |
| **Driving**              | Typical 4G for 40 to 80 s, Weak 4G for 15 to 30 s, 3G for 10 to 20 s, an outage of 2 to 6 s                        |
| **Elevator**             | Typical 4G for 45 to 75 s, an outage of 8 to 15 s                                                                  |
| **Fading signal**        | Typical 4G, Weak 4G, 3G, 2G (EDGE) and an outage, 20 s each, then from the start                                   |
| **Flapping**             | Typical 4G for 3 s, an outage of 3 s                                                                               |

### Region

**Region** stands in for the app's users in a country. Pick one of Germany,
the United States, Ukraine, Kazakhstan, Bangladesh, India, Pakistan,
Indonesia, the Philippines, Nigeria, Kenya, Egypt or Brazil (or **No
region**), then where your servers run in **Servers in**: Frankfurt (the
default), N. Virginia, N. California, São Paulo, Mumbai, Singapore or Tokyo.
Each server location in the menu shows the region's round trip to it, and
the route's in amber when the route is slower (`160 ms · VPN 210 ms`). A
region the route is slower to is marked **VPN slower:** with `CDN`,
`servers` or `bandwidth`.

A region splits the device's traffic into two paths. The table below the
menus shows them:

| Column            | What it is                                                                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Path**          | **CDN edge and DNS** (the address ranges of Cloudflare, Fastly and Google, served from the edge the region's users reach, and every DNS query), or **Servers in …** (your backends and everything not on a CDN) |
| **In the region** | the round trip the region's users have on that path, beyond their access link                                                                                                                                   |
| **Session route** | what the session's route already takes on it; amber when that is more than the region's                                                                                                                         |
| **Added**         | what the tab adds: the region's round trip less the route's, never below 0                                                                                                                                      |

The access link comes on top of both paths. With **No limits** picked as
the access link, the first card becomes **Typical mobile in** the region,
the region's median mobile connection, and that link is used.

When the route is already slower than the region on a path, a warning says
so: emulation can only add delay, so a VPN location closer to the servers,
or none, gets nearer.

| Region        | Typical mobile link               | CDN edge                                | Edge round trip |
| ------------- | --------------------------------- | --------------------------------------- | --------------- |
| Germany       | +30 ±8 ms, 60 / 12 Mbit/s, 0.2%   | Frankfurt                               | 5 ms            |
| United States | +35 ±10 ms, 100 / 12 Mbit/s, 0.3% | the nearest metro                       | 10 ms           |
| Ukraine       | +35 ±10 ms, 30 / 12 Mbit/s, 0.5%  | Kyiv                                    | 8 ms            |
| Kazakhstan    | +40 ±12 ms, 35 / 12 Mbit/s, 0.5%  | Almaty                                  | 10 ms           |
| Bangladesh    | +55 ±25 ms, 15 / 6 Mbit/s, 1%     | Dhaka or Singapore, by operator         | 30 ms           |
| India         | +45 ±20 ms, 90 / 10 Mbit/s, 0.5%  | Mumbai, Chennai, Delhi and others       | 15 ms           |
| Pakistan      | +60 ±25 ms, 20 / 9 Mbit/s, 1%     | Karachi or the Middle East, by operator | 35 ms           |
| Indonesia     | +45 ±20 ms, 30 / 12 Mbit/s, 0.5%  | Jakarta                                 | 15 ms           |
| Philippines   | +50 ±25 ms, 30 / 8 Mbit/s, 1%     | Manila                                  | 20 ms           |
| Nigeria       | +65 ±30 ms, 25 / 9 Mbit/s, 1.5%   | Lagos                                   | 20 ms           |
| Kenya         | +55 ±30 ms, 25 / 9 Mbit/s, 1.5%   | Nairobi or Mombasa                      | 15 ms           |
| Egypt         | +50 ±20 ms, 20 / 8 Mbit/s, 1%     | Cairo                                   | 25 ms           |
| Brazil        | +40 ±15 ms, 45 / 12 Mbit/s, 0.5%  | São Paulo and other metros              | 10 ms           |

Round trips from each region to the server locations, in milliseconds:

| Region        | Frankfurt | N. Virginia | N. California | São Paulo | Mumbai | Singapore | Tokyo |
| ------------- | --------- | ----------- | ------------- | --------- | ------ | --------- | ----- |
| Germany       | 10        | 90          | 150           | 200       | 120    | 160       | 230   |
| United States | 100       | 30          | 50            | 130       | 220    | 190       | 130   |
| Ukraine       | 35        | 120         | 180           | 230       | 150    | 180       | 250   |
| Kazakhstan    | 75        | 160         | 220           | 270       | 120    | 160       | 220   |
| Bangladesh    | 170       | 240         | 230           | 340       | 60     | 50        | 110   |
| India         | 120       | 200         | 220           | 300       | 20     | 50        | 120   |
| Pakistan      | 130       | 210         | 260           | 310       | 50     | 90        | 160   |
| Indonesia     | 180       | 230         | 180           | 330       | 70     | 20        | 90    |
| Philippines   | 200       | 220         | 160           | 330       | 90     | 40        | 60    |
| Nigeria       | 100       | 160         | 220           | 230       | 200    | 260       | 300   |
| Kenya         | 130       | 210         | 270           | 280       | 110    | 180       | 260   |
| Egypt         | 60        | 140         | 200           | 230       | 110    | 150       | 220   |
| Brazil        | 200       | 120         | 170           | 15        | 300    | 330       | 260   |

These are rounded estimates from public speed reports and latency maps,
plausible rather than measured per operator.

### Backends behind a CDN

An API behind Cloudflare has a CDN address, but its requests go through to
your servers. List such hosts under **Backends behind a CDN**, one per line
(or separated by commas): a host name, `*.example.com` for every name below
it, or an IPv4 address. **Save backends** appears when the list changed.

Their traffic then takes the servers' path. The agent answers the device's
DNS, so it picks up the addresses the device gets when it looks a backend
up, and shapes them about a second later; the tab lists the addresses found
so far. Other hosts on the same CDN addresses take the servers' path too.

The list is kept per app: in your account when the portal's
[database](/configuration/database/) is persistent, in this
browser otherwise. It is filled in when you pick a region in the app's next
session.

## Common tasks

**Check the app on a slow network.** Pick **3G** or **Weak 4G** and go
through the main screens: loaders should show, and nothing should be
tapped twice while a request is slow.

**Check that the app survives drops.** Pick **Subway**, **Elevator** or
**Flapping**. Requests made during an outage hang until they time out; the
app should retry or say what happened. The
[WebSockets](/session-tools/websockets/) tab shows each reconnect
of a socket as a new row.

**Test for users in a country.** Pick the country as the region, your
servers' location in **Servers in**, and list your API under **Backends
behind a CDN**. A [VPN location](/concepts/vpn/) in or near the
same country keeps the route short, so the tab can add the region's full
round trips; the IP address then also matches the country.

**Find out why the emulated network is faster than promised.** Read the
amber notes: the route is already slower than the network, or the network
faster than the route's bandwidth. Pick a closer VPN location.

**See how long requests took.** The tab only sets the conditions; the
timings are elsewhere (see [Measuring the effect](#measuring-the-effect)).

## Measuring the effect

Holtdroid has no separate load-speed report. Request timings are in these
places:

- live, in the **DevTools** tab's Network panel: Chrome's own timing for
  each request of the WebView;
- in a [recording](/concepts/recordings/#network-console-and-websockets),
  a request's **Timing** on the Network tab: queued and stalled, DNS,
  connect (with TLS), send, **Waiting (TTFB)**, download and the total;
- in a recording's [Routes](/session-tools/routes/) tab, the
  median connect, TLS and waiting times of the WebView's requests to each
  name, and how many of them opened a new connection;
- the Network card's **Device traffic**: download and upload of the whole
  device every two seconds over the last minute.

## In recordings

A [recording](/concepts/recordings/#the-player) keeps the
conditions as they changed: the player's **Network** card shows the VPN
location, **Throttling** with the network's name and numbers (or **Full
speed**), the **Region** with what it added to the CDN and the servers
(`CDN +5 ms · Frankfurt +40 ms`) and the device's traffic, each as it was
at the moment you are at.

## Limits

- Only emulator sessions with VPN locations have the tab; phones don't.
- Emulation can only add delay and take bandwidth away, never make the
  session's route faster.
- Addresses are IPv4 only; the CDN ranges are Cloudflare's, Fastly's and
  Google's published lists.
- There are no custom networks: the cards and scenarios are fixed.
