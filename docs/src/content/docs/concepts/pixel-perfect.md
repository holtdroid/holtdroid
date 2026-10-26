---
title: Pixel perfect
description: Lay a design mockup over the device screen, find where the app differs from it and export a report.
sidebar:
  order: 8
---

The **Pixel perfect** tab next to DevTools lays a design mockup over the
device's screen, the way the PerfectPixel browser extension does for web
pages, and goes a step further: it finds where the screen differs from the
mockup, explains each difference and makes a report to send to whoever owns
it.

## References

A reference is an image: PNG, JPEG or WebP, up to `pixelPerfect.maxFileSize`
(25 MiB). Add one by dropping it on the tab, choosing a file, or pasting it:
copy a frame in Figma with **Copy as PNG** and press ⌘V / Ctrl+V while the tab
is open. References belong to you, not to a session, so they are there in
every session; the ones added for the current app come first.

Double-click a name to rename it. Each reference also remembers where you put
it over the screen and which areas the comparison skips.

They live in the server's storage (S3 or a folder). Each user has
`pixelPerfect.quota` (1 GiB by default; per user in the `users` auth mode),
and a reference nobody opened for `pixelPerfect.maxAge` (30 days) is deleted;
laying it over a screen counts as opening it, its thumbnail in the list
doesn't.

## Over the screen

Picking a reference lays it over the device screen. By default it fills the
screen's width without going past its height, top-aligned, so a mockup at
any density (1×, 2×, 3×) fits as is.

- **Opacity** and the **blend**: _Normal_ is the mockup see-through;
  _Difference_ is the classic "negative" check, where matching pixels turn
  black and anything off lights up; _Invert_ shows the inverted mockup, so
  matching areas fade to grey.
- **Position**: X and Y in the mockup's own pixels and a scale, where 100% is
  the fit above. Turn on **Move** to drag it over the screen or nudge it with
  the arrow keys (Shift for 10 px). The device stays usable while Move is off:
  taps go through the overlay.
- The eye button hides the overlay without losing its settings.

## Freeze frame

**Freeze frame** keeps the current picture of the screen over the live one,
so a toast, a ripple or an animation that is gone in a second can still be
compared: freeze it while it is on the screen, then line the mockup up and
look for differences at leisure. **Live** (on the screen or in the tab) goes
back to the stream.

## Finding differences

**Find differences** compares the screen with the mockup as it lies:

1. The screen is taken from a lossless screenshot of the device, or from the
   frozen frame. A frozen frame comes from the stream, so a higher stream
   quality makes it sharper.
2. Pixels are compared perceptually (pixelmatch, YIQ colour distance), with
   anti-aliased edges left out. Transparent parts of the mockup are not
   compared, and lone stray pixels (video compression, dithering) don't make
   a region.
3. Differing pixels are grouped into regions, and each region gets a guess at
   what is wrong: **shifted** by so many pixels in which direction (the
   mockup is moved around the region to find where it fits), **colour**
   (same shapes, another colour, with both colours), **missing** on the
   screen, **not in the reference**, or simply **differs**. Sizes are in the
   device's pixels.

The match is the share of compared pixels that agree. Regions are outlined
and numbered on the screen (**On the screen** turns that off) and in the tab,
which offers the views that image diffs on code review sites use: **Side by
side**, **Swipe** (a line to drag across), **Onion skin** and **Difference**
(black where equal, the size of the error otherwise, with the differing
pixels in red). Pointing at a region in the list highlights it everywhere; a
click opens a magnified crop of the reference, the difference and the screen.

While a frame is frozen, moving or scaling the mockup or changing the ignored
areas runs the comparison again at once, which helps line a mockup up.

### Interfaces over video

An interface drawn over a video, a camera picture or a map would differ from
any mockup everywhere the video is. Three things keep that out:

- **Skip what moves** (on by default) takes a few frames a moment apart
  before comparing, marks the parts of the screen that changed between them
  and leaves them out: video and animation under the interface are skipped,
  the still interface over them is compared. The skipped area is shaded blue.
  Freeze frame takes these frames right after the frozen one.
- **Ignored areas**: turn on **Draw** and drag over the screen to mark areas
  the comparison always skips for this reference, such as a player that may
  be paused.
- **Skip video, canvas and frames in WebViews** (on by default): in a WebView
  page, the boxes of `<video>`, `<canvas>`, `<iframe>`, `<embed>` and
  `<object>` elements are left out, paused or not (see below). They are
  hatched violet.

### WebView pages

When the screen shows a WebView that DevTools can inspect, the comparison
also asks the page about itself, through its own DevTools connection next to
the DevTools tab (Chrome serves several at once):

1. It reads the visible elements of each open page: their boxes, a CSS
   selector, their own text and a few computed styles, and takes a screenshot
   of the page.
2. It finds where that screenshot sits on the device's screen, which places
   the page on it exactly: under the status bar and the app's own toolbar, or
   wherever the app put its WebView. A WebView that isn't on the screen, or a
   page in a background WebView, doesn't match and is left out. The page found
   is outlined violet on the screen.
3. Each difference gets the element that fits it best: the list shows
   `button.submit “Pay”` under the difference, and the magnified crop adds
   its selector (with a copy button), its size in CSS pixels, a shift in CSS
   pixels as well as device pixels, and the styles that matter for that kind
   of difference: margins, padding and transforms for a shift, colours and
   borders for a colour difference, sizes and fonts otherwise.
4. Pointing at a difference in the list highlights its element on the device
   the way DevTools does, with margins, padding and its info box.

With a frozen frame, the page is read the moment the frame is frozen, so a
toast that is gone by the time you compare still names its element.
Highlighting needs the element to still be there.

## Report

**Report** downloads a PNG with the project's logo, the reference name, the
app, its version, the screen and the time, the match, three columns (the
reference, the difference with ignored areas, the screen) with the regions
numbered on them, and the list of differences with their sizes, positions
and, in a WebView, their elements.

## Configuration

```yaml
pixelPerfect:
  enabled: true # the tab and its API; on by default
  quota: 1GiB # per user; 0 = no limit
  maxAge: 720h # deleted this long after it was last opened; 0 = never
  maxFileSize: 25MiB # largest image
  sweepInterval: 1h # how often retention runs
  storage: # optional: where references go; default is the shared storage under pixel-perfect/
    type: s3
    s3:
      endpoint: https://s3.example.com
      bucket: holtdroid
      prefix: pixel-perfect
      accessKey: env:S3_ACCESS_KEY
      secretKey: env:S3_SECRET_KEY
```

Without a storage of its own the references go to `storage`, which the Helm
chart puts on the cache volume, an `emptyDir`: give them an S3 prefix or a
persistent folder to keep them across restarts.
