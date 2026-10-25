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
  Back, Home and Recents keys. Only what was done in the portal is seen;
  input from `adb` over SSH or from the app itself isn't. Typed text and
  other keys are never recorded.

Nothing is rendered on the server: the agent copies the video the device
already encodes and writes the rest as small text files next to it. The
portal draws the page from that data in an Android look: logcat on the left,
the phone in the middle, and on the right the device clock like a status bar,
the app, quick-settings style tiles for Wi-Fi, mobile data, airplane mode,
Battery Saver and dark theme, the device, the network and the load.

## Recording a session

Sessions are recorded from the moment they are ready, unless the server is
set to record only on request (`recordings.auto: false`). The launch dialog
has a **Record the session** switch; your choice is remembered in the browser
and also used by the quick launch button.

On the session page the rail next to the screen has **Record** while
nothing is recorded and **Stop recording** with the elapsed time while it
is. Stopping a recording and starting again makes a new recording. A
recording ends when the session stops; the last few seconds are uploaded
before the device goes away.

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

The timeline shows where there is video (grey) and where the app closed (red
marks). Play and pause, five-second steps, speeds from 0.5× to 4× and full
screen are next to it. <kbd>Space</kbd> plays and pauses, <kbd>←</kbd> and
<kbd>→</kbd> step.

## Downloading a video

**Download video** renders the recording into an MP4 file in your browser,
at 1920×1080 and 30 fps, drawn in the same style as the page (the text there is part of the picture, so it can't be selected). A progress bar
over the recording's timeline shows how far it got, how fast it goes and
how long is left; keep the tab open until it finishes. The file is written
to the browser's private storage as it goes, so long recordings don't fill
the memory, and downloaded when done. It needs a browser with WebCodecs
(Chrome, Edge, Safari 17+, Firefox 130+).

## Sharing

**Share** (or the link button on a card) makes a link that opens the
recording without signing in, and copies it. Asking again gives the same
link; **Stop sharing** turns it off. People with the link can watch and
download the logcat, but the page has no video download.

## Keeping and space

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
  auto: true # record every session from its start; false: only on request
  maxAge: 168h # deleted this long after recording unless kept; 0 = never
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
