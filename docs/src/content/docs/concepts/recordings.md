---
title: Recordings
description: Sessions recorded on the server with logcat, device, network and load next to the screen, to watch, download or share.
sidebar:
  order: 7
---

With recordings turned on, the server records sessions while they run. A
recording keeps more than the picture:

- the **screen**, as the device encoded it;
- **logcat** of the whole device, every line stamped with the time since the
  recording started;
- the **device**: model, Android, build, the WebView version, screen size and
  density, language, theme, battery;
- the **network**: the VPN location with its external IP and country, the
  emulated network conditions (throttling: added delay, bandwidth, loss,
  scenarios) and which links are on;
- the **time**: real time next to the device clock, with its time zone and
  how far it was set off real time;
- the **load** every two seconds: device and app CPU, memory, frames and
  jank, traffic, the container's CPU and throttling, temperatures;
- whether the app was running, and when another build was installed;
- what the person at the screen did: taps, long presses and swipes, and the
  buttons of the phone beside the screen (Back, Home, Recents, volume, rotate,
  the notification shade and so on). Only what was done in the portal is seen;
  input from `adb` over SSH or from the app itself isn't. Typed text and
  other keys are never recorded.

Nothing is rendered on the server: the agent copies the video the device
already encodes and writes the rest as small text files next to it. The
portal draws the page from that data in an Android look: logcat on the left,
the phone in the middle, and on the right the device clock like a status bar,
the app, quick-settings style tiles for Wi-Fi, mobile data, airplane mode,
Battery Saver and dark theme, the device, the network and the load.

## Recording a session

What gets recorded is set by `recordings.mode`:

- **`always`** (the default): every session is recorded from the moment it is
  ready, and a recording can't be stopped. There is no switch in the launch
  dialog and no Stop button.
- **`auto`**: sessions are recorded unless you turn **Record the session** off
  in the launch dialog (the choice is remembered in the browser and used by
  the quick launch button). A recording can be stopped from the session page.
- **`manual`**: sessions are recorded only when you switch it on at launch or
  start it from the session page.

On the session page the **Recording** card is among the cards beside the
screen. While a recording runs it shows the elapsed time, and **a click on the
card pins a marker** on the recording's timeline at that moment. Hover it for
the rest: how long it has run, its size and how much of your space is used;
**Keep forever**, which exempts the recording from the retention period; **Share**,
which makes a link and copies it (sharing keeps the recording too); a button
to open the recording; and, unless the mode is `always`, to stop or start
recording. Stopping and starting again makes a new recording. A recording
ends when the session stops; the last few seconds are uploaded before the
device goes away.

The screen is taken from what a viewer of the session already streams in
H.264, so watching and recording cost one encoder on the device. When nobody
watches, or the viewer picked H.265 or AV1, the agent runs a stream of its
own for the recording: H.264, at most 1280 pixels on the long side, 30 fps,
2 Mbit/s. A static screen costs next to nothing either way. Sound is not
recorded.

## Watching

**Recordings** in the header (the clapperboard) lists your recordings,
newest first, with a preview, the app, the length and the size. A recording
still in progress is marked and can be watched while it grows.

Everything beside the phone is ordinary page text, so you can select and
copy it. In the logcat panel:

- the level menu hides quieter lines (for example **Warnings and above**) and
  the filter box searches tags and messages;
- click a line's time to jump to it in the recording;
- while you hold a selection the panel stops following the video, so the text
  doesn't scroll away; click elsewhere to follow again;
- the copy button puts the lines on screen on the clipboard, and **Logcat**
  below downloads the whole logcat as one text file, each line starting with
  its time in the recording.

Taps and swipes show on the phone as green circles with a fading trail, and
the navigation keys as a label at the bottom. The pointer button in the player's controls hides them (it only appears when something was touched);
the downloaded video always has them.

### Markers

A marker is a pin on the timeline with an icon (pin, bug, flag, star, warning
or done) and a short note. Click the **Recording** card on the session page
while it records, press **Marker** (or <kbd>M</kbd>) in the player to pin the
moment you are at, and click a pin to rename it, change its icon, jump there
or delete it. Anyone with a share link sees the markers but can't change them.
The downloaded video shows each marker as a label over the phone for a few
seconds.

The timeline shows where there is video (grey) and where the app closed (red
marks). Play and pause, five-second steps, speeds from 0.5× to 4× and full
screen are next to it. <kbd>Space</kbd> plays and pauses, <kbd>←</kbd> and
<kbd>→</kbd> step.

**Download → Logcat** gives the whole logcat. The **colored
.log** keeps the levels and colours as ANSI codes (the level letter in bold, tags
and the lines of warnings and errors coloured), so it reads well with
`less -R`, `bat`, `lnav` or an editor with ANSI support; the **plain text**
version has the same lines without colour codes. Each line starts with its time
in the recording, followed by the usual `threadtime` line.

## Downloading a video

**Download → Video (.mp4)** renders the recording into an MP4 file in your browser,
frame by frame, with the Holtdroid logo on top and the same panels as the page
(the text is part of the picture, so it can't be selected). It is 1296 pixels
tall and 30 fps: 2304×1296 for a phone held upright, 20% above 1080p. If the
screen turned sideways in the recording or it is a tablet, the middle column
is made wider and so is the video (up to about 3200 pixels), so the picture
stays readable; the phone's frame turns smoothly when the device does. A
progress bar over the recording's timeline shows how far it got, how fast it
goes and how long is left; keep the tab open until it finishes.

The video is never held in memory. In Chrome and Edge you first pick where to
save it and it is written straight into that file as it renders; cancelling
removes the half-written file. Other browsers collect it in their private
storage as they go and download it at the end. It needs a browser with
WebCodecs (Chrome, Edge, Safari 17+, Firefox 130+) that can encode a video this
size.

## Recording files

**Download → Recording file (.holtdroid)** saves everything in one file: the
video segments, the events (device state, network, load, taps), the logcat, the
markers, the preview and the app's icon. It is an ordinary ZIP archive whose
video and logs are stored as they are, so any archiver opens it. It points back
at nothing on the server.

Open it again, on any machine and without signing in, on the **Open** page
(**Recordings → Open a file**, or `/open`): drop the file on the page or pick
it. It plays exactly like a recording on the server, with the logcat, panels,
taps, markers and the video download, and **nothing is uploaded**. The browser
reads only the pieces it plays (the segment under the playhead, the logcat
around it) from your disk, so the file never sits in memory whole, however
big it is. Keep, sharing and editing markers are only for recordings on the
server.

In the archive: `holtdroid.json` (the format, the recording's details and
its markers), `manifest.json`, `init-N.mp4` and `seg-N.m4s` (the video, as fragmented MP4),
`events-N.jsonl.gz` (one JSON event per line), `logcat-N.log.gz`,
`thumb.jpg` and `icon.png`. To get a plain video of a recording without
a new epoch (the screen didn't turn or restart), join an init file and its segments
in order: `cat init-0.mp4 seg-1.m4s seg-2.m4s … > video.mp4`.

## Sharing

**Share** (or the link button on a card) makes a link that opens the
recording without signing in, and copies it. Asking again gives the same
link; **Stop sharing** turns it off. A shared recording is kept, so the link
doesn't die after `recordings.maxAge`; it stays kept when you stop sharing,
until you let it expire yourself. People with the link can watch and
download the logcat, but the page has no video download.

## Keeping and space

A recording that ends in under `recordings.minDuration` (20 seconds by default)
is deleted as soon as it ends: a session stopped at once or one that failed to
start leaves nothing to watch. A recording you kept or shared, or one with a
marker on it, stays.

Recordings are deleted `recordings.maxAge` after they were made unless you
**Keep** them. Each user has `recordings.quota` bytes: when a new recording
doesn't fit, the oldest recordings that aren't kept are deleted first; when
only kept ones are left, new sessions start without a recording and a
running one stops. Kept recordings count against the quota too.

As a rough guide, a recording takes 0.2 to 2 GB per hour of an app in use (the viewer’s stream quality decides),
less for mostly static screens; logcat and the device data add a few
megabytes per hour.

## Configuration

```yaml
recordings:
  enabled: true
  mode: always # always: every session, can't be stopped; auto: unless the launch says no; manual: only on request
  maxAge: 168h # deleted this long after recording unless kept; 0 = never
  minDuration: 20s # a finished recording shorter than this is deleted unless kept or marked; 0 = keep all
  quota: 50GiB # per user; 0 = no limit
  share: true # allow share links
  maxFileSize: 64MiB # largest file an agent may upload
  sweepInterval: 10m # how often retention runs
  storage: # optional: where recordings go; default is the shared storage under recordings/
    type: s3
    s3:
      endpoint: https://s3.example.com
      bucket: holtdroid
      prefix: recordings
      accessKey: env:S3_ACCESS_KEY
      secretKey: env:S3_SECRET_KEY
```

Agents upload to the api's internal listener (`internalURL`), so session
Pods need to reach it, as they already do for APKs. Each upload URL carries a
secret only that session's agent knows.
