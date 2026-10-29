---
title: Microphone
description: Make the device's microphone hear a test signal, a file from your media library or your own microphone.
sidebar:
  order: 9
---

A redroid device has no microphone of its own: apps that record hear
silence. The **Microphone** card on the session page replaces what they hear,
for every app and every kind of recording (voice notes, speech recognition,
calls in a WebView), until you turn it off.

| Source          | What apps hear                                                             |
| --------------- | -------------------------------------------------------------------------- |
| Off             | Silence, the device's own microphone                                       |
| Line-up tone    | A steady 1 kHz tone at −18 dBFS, the broadcast test tone                   |
| Beeps           | A 100 ms 1 kHz beep at the start of every second, to measure delay         |
| Pink noise      | Steady noise across all frequencies                                        |
| A media file    | An audio file, or the sound of a video, from your media library, on repeat |
| Your microphone | This browser's microphone, live, for as long as you keep it on             |

Click the card to turn whatever plays off. Choosing another source stops the
one before, including your microphone in another tab. Your microphone asks
for the browser's permission the first time and stops when you close the
session page.

The card is there only on devices whose microphone can be replaced: redroid
sessions on Android 11 and later. Phones keep their own microphone (and
Holtdroid denies it to the app under test, see
[Phones](/configuration/phones/#sound-microphone-and-camera)).

## Media library

Files you add to the library belong to you, not to a session, so every
session can play them. The library also holds the images and videos the
[camera](/concepts/camera/) shows. Anything ffmpeg reads works: MP3, AAC, Opus, WAV,
FLAC, or a video, whose sound is played. Files keep their format; nothing is
converted on upload, and the sound is resampled to what the app records at.

Each user has `media.quota` (5 GiB by default; per role and per user in the
`users` auth mode, see [Authentication](/configuration/authentication/)),
and one file can be up to `media.maxFileSize` (1 GiB). Files stay until you
delete them.

## How it works

The agent starts a small helper on the device that registers an Android
audio policy: every recording is routed to a remote submix that the helper
plays into. The agent feeds it with ffmpeg (test signals and files, in real
time) or with the samples your browser sends over a WebSocket (16-bit mono at
48 kHz, about 100 KB/s). When the helper exits, Android drops the policy and
the microphone is silent again.

## Configuration

```yaml
media:
  enabled: true # the library and its API; on by default
  quota: 5GiB # per user; 0 = no limit
  maxFileSize: 1GiB # largest file
  storage: # optional: where files go; default is the shared storage under media/
    type: s3
    s3: { endpoint: https://s3.example.com, bucket: holtdroid, prefix: media }
```

Test signals and your microphone work with the library turned off.
