---
title: WebSockets
description: The WebSockets and event streams of the app's WebViews, frame by frame, with JSON and common protocols taken apart, kept for the whole session.
sidebar:
  order: 3
---

Chrome DevTools shows a socket's messages only while its Network panel is
open, and forgets them when you reload. The **WebSockets** tab doesn't: the
agent follows every WebSocket and event stream (`EventSource`) of the app's
WebViews for the whole session, whether or not anyone is looking, and the
tab lists them with every message sent and received. Use it to check what
a live chat, a price feed or a push channel actually sends, and in what
order.

## When the tab is there

The tab sits next to DevTools whenever the session has WebView DevTools:
always on emulators, and on [phones](/holtdroid/configuration/phones/) only
for debuggable builds (see [WebView DevTools](/holtdroid/concepts/devtools/)).
The agent watches every page, iframe, worker and service worker of every
WebView process from its first request, so a socket opened while the app
starts is there too.

The tab keeps no state of its own. Reload the portal page, or open the
session in another browser, and it fills again with what the agent kept
(see [Limits](#limits)).

## What you see

### The toolbar

- **Pause** stops updating the tab; **Resume** catches up on what came in
  the meantime, as long as the agent still keeps it.
- **Clear** empties the tab. It clears only this view: reloading the page
  brings back what the agent kept.
- **Filter** keeps the frames of the picked socket whose payload contains
  the text, ignoring case.
- **Hide under 15 B** hides frames shorter than 15 bytes, such as pings and
  heartbeats. The browser remembers the choice.
- On the right, how many sockets there are and how many frames the picked
  one has (`3 sockets · 128 frames`).

### Sockets

The list on the left has one row per WebSocket or event stream, in the
order they appeared; the newest one is picked until you pick another. Each
row shows:

- the host and path it connected to (hover for the whole URL), or **opened
  before Holtdroid attached** when the socket existed before the agent
  could see its address;
- its state: `connecting`, `open`, `error`, `closed`, or **media stream, not
  shown** (see below), and how many frames the tab has of it;
- a radio icon, green while the socket is up and grey once it closed.

An event stream is listed like a socket: each event it receives is a frame.

### Frames

The table on the right lists the picked socket's frames, oldest at the top.
It follows new frames as they come; scroll up and it stops following, scroll
to the end and it follows again.

| Column     | What it shows                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------- |
| (arrow)    | a green ↑ for a frame the app **sent** (the row is tinted green), a red ↓ for one it **received** |
| **Data**   | a one-line preview of the payload (see [How payloads are read](#how-payloads-are-read))           |
| **Length** | the payload's size in bytes, decoded for binary frames                                            |
| **Time**   | when the agent saw it, to the millisecond, in your browser's time zone                            |

Click a frame to open it below the table: **Sent** or **Received**, its
time, and the payload with a toolbar on top:

- what the payload is: **JSON**, **Socket.IO**, **Engine.IO**, **SignalR**,
  **Server-Sent Events**, **JSON Lines**, **Form**, **Binary** or **Text**,
  with the number of packets when there are several;
- **binary · UTF-8** when the bytes came in a binary frame but are text;
- the size, and **cut at the recording limit** in amber when the payload was
  longer than the agent keeps;
- **Pretty** and **Raw**, to switch between the parsed view and the text as
  it was sent;
- the copy button (**Copy as base64** for binary payloads).

A frame that looked like video or a picture has no payload: **The payload
looked like media and isn't kept.**

### How payloads are read

The preview and the details take apart what they recognise:

- JSON is a tree you open and close, also when it sits in a string field;
- **Socket.IO** events get their name as a label, other packets their type
  (`socket.io connect`, `engine.io ping` and `engine.io pong` for `2` and
  `3`);
- **SignalR** messages and Engine.IO polling records, separated by `\x1e`,
  are split into their packets, SignalR ones labelled `handshake json`,
  `invoke SendMessage`, `ping` and so on;
- **Server-Sent Events** blocks get their `event:` name as a label and their
  `data:` parsed;
- **JSON Lines** (several lines, each a JSON value) are split per line.

In the list, a binary frame carries a **bin** mark. One that holds UTF-8
text shows that text, parsed like any other; one with real bytes shows its
size, and its details show a hex dump of the first 4 KB.

Values that look like a point in time (Unix seconds, milliseconds,
microseconds or nanoseconds, ISO 8601 and HTTP dates) get two chips: how far
they were from the device clock when the frame came, and how far they are
from it now. Hover one for the same moment in UTC, in the device's time
zone and in yours. The [recordings page](/holtdroid/concepts/recordings/#network-console-and-websockets)
explains the chips in full.

### Media streams

A socket that carries video, audio or pictures would fill the tab with
bytes nobody reads. The agent drops payloads whose first bytes look like
H.264, MP4, WebM, Ogg, JPEG, PNG, RIFF (WAV, WebP, AVI) or FLV, and once a
socket has sent three of them, or has moved 1 MB or 60 binary frames within
the last four seconds, it marks the socket **media stream, not shown**. From
then on the agent counts its frames but sends none to the tab.

## Common tasks

**Find the message behind a wrong value on screen.** Pick the socket, type
the value or a field name into **Filter**, and open the frame. The time
chips show whether a timestamp in it was already old when it arrived.

**Check that the app reconnects.** Turn on a scenario such as **Subway** or
**Flapping** in the [Network](/holtdroid/session-tools/network/) tab and
watch the list: every reconnect is a new row, the old one turns `closed`.

**See only what the app sends.** Sent frames are the green rows with ↑;
**Hide under 15 B** removes the heartbeats around them.

**Read a binary protocol.** Open a **bin** frame: text inside binary
frames is decoded as UTF-8; anything else is a hex dump you can copy as
base64.

**Mark the moment for a bug report.** While the session
[records](/holtdroid/concepts/recordings/), click a frame's time to pin a
marker at that moment of the recording. Hover the time instead to pick the
marker's icon (Pin, Bug, Flag, Star, Warning or Done) or **Open the
recording from here**, which opens the recording half a second before the
frame, on its WebSockets tab with that socket picked. A frame that came while
nothing was recording says so.

## In recordings

A [recording](/holtdroid/concepts/recordings/#network-console-and-websockets)
keeps every socket and frame within the same limits, and its WebSockets tab
shows them up to the playhead. It adds what the live tab doesn't have:
**All**, **Sent** and **Received** filters, whether a row is a **WebSocket**
or an **Event stream**, the iframe or worker it came from, and for a media
stream the moment it was marked and how many frames and bytes it moved.
Each frame's time seeks the video there, and
[markers](/holtdroid/concepts/recordings/#markers) show on the timeline.
**Download → Network (.har)** saves the messages with the requests.

## Limits

- Only text and binary data frames are shown; ping, pong and close frames
  are not.
- Event streams are `EventSource` connections. A response read as a stream
  with `fetch()` is a request, which DevTools' Network panel shows, not a
  socket.
- The agent keeps a text frame up to 128 KB and a binary one up to 16 KB;
  longer payloads are cut and marked.
- For a reload or another browser the agent keeps about 16 MB of socket
  traffic; once there is more, the oldest goes first.
- The tab keeps the last 5000 frames of each socket and lists the last 500
  of them that pass the filters.
- **Filter** reads text frames. A binary frame is matched against its
  base64 form, so text inside binary frames isn't found.
- The live tab doesn't show a socket's handshake status or error message;
  the [DevTools](/holtdroid/concepts/devtools/) Network panel does, while it
  is open.
