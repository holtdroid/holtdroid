---
title: Camera
description: Give the device a camera that shows a test card, an image or video from your media library, or your own camera.
sidebar:
  order: 10
---

redroid devices have no camera of their own. Sessions on Android 13, 14 and
15 get one from Holtdroid: a back camera that any app can open (Camera2,
CameraX, a WebView's `getUserMedia`). The **Camera** card on the session page
chooses what it shows.

| Source       | What apps see                                                                          |
| ------------ | -------------------------------------------------------------------------------------- |
| Test card    | SMPTE color bars with the date and a running clock, the default                        |
| No picture   | A black frame, as from a covered lens                                                  |
| A media file | An image (a QR code, a document, a face) or a video from your media library, on repeat |
| Your camera  | This browser's camera, live, for as long as you keep it on                             |

The clock on the test card shows at a glance whether the picture an app got
is live, frozen or late. Images and videos are scaled to fill the frame the
app asked for and cut at the center, so any aspect ratio works; the picture
is upright on a phone held in portrait, as with a real back camera.

The card says **in use** while an app has the camera open. Your camera asks
for the browser's permission the first time, sends 15 frames a second
(about 3–7 Mbit/s up) and stops when you close the session page or pick
another source.

## Media library

Images and videos come from the same library as the
[microphone](/holtdroid/concepts/microphone/)'s files: add them from either
card. Each user has `media.quota` (5 GiB by default).

## Load

Nothing runs while no app uses the camera. The camera HAL starts when an app
opens the camera and exits a few seconds after it closes it; the agent
renders frames only for an open camera. While one is open, a 1080p stream
costs about a third of a CPU core (ffmpeg making the picture and the HAL
copying it into the app's buffers).

## How it works

holtdroid-redroid's images for Android 13 to 15 carry a small camera HAL
(an AIDL camera provider, declared lazy). When an app configures a stream it
connects to the agent over the abstract socket `@holtdroid-camera`, asks for
the largest stream's size and reads raw frames that ffmpeg renders from the
chosen source; it scales them into each of the app's buffers and encodes
JPEGs for still captures on the CPU, without the GPU. Android 11 and 12, and
phones, have no Holtdroid camera, and the card is not shown.
