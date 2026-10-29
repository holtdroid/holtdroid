---
title: Images
description: The images the app's WebViews load, checked against how their pages draw them, with what each one could save.
sidebar:
  order: 5
---

The **Images** tab lists what is wrong with the images the app's WebViews
load while you use it: images that come in but never show up, files many
times bigger than the place that draws them, PNGs and JPEGs that would be a
fraction of the size as WebP, and WebPs saved at a quality close to 100. Each
finding says how many bytes it would save. It is for QA reporting a slow
first screen and for developers deciding which images to fix first.

It needs no DevTools window: the session's agent follows every page and
iframe of the WebViews from their first request (see
[DevTools](/holtdroid/concepts/devtools/)), so the tab shows images that
loaded before you opened it, also after a reload of the session page.

## When the tab appears

The tab sits next to DevTools in every session whose device supports
DevTools. How much it can tell depends on the **image scan**:

- **Off** (the default): only the files themselves are checked, their
  format and compression. A note at the top says
  _This session doesn't check where its pages draw images_, with a
  **Turn on** button.
- **On**: the agent also runs a small script in the app's pages (each page
  and iframe) once a second that reports which images they draw, where and
  how big. Only then can the tab tell images that are on screen from those
  that aren't, and compare a file's size with the size it is drawn at.

Switch on **Check how pages draw their images** in the launch dialog to
have the scan from the start; the dialog remembers the choice in this
browser. **Turn on** in the tab starts it in a running session: it sees
what the pages show from then on, so reload the page in the app to also
check how it loads. **Image scan on · turn off** in the toolbar stops it and
takes the script out of the pages. The setting belongs to the session, so it
changes the [SVG](/holtdroid/session-tools/svg/) tab and everyone watching
the session too.

The APK isn't touched, but while the scan runs the pages have a
`window.__holtdroidImages` object and two observers (a `MutationObserver`
and an `IntersectionObserver`).

## What you see

The toolbar has **Pause** and **Clear** on the left and the number of images
on the right. Pause stops following the WebViews; on resume the tab catches
up with what the agent kept meanwhile. Clear empties the tab.

### The numbers on top

- **Images**: every image file the WebViews loaded, one per URL however
  often it was requested.
- **Downloaded**: what they took over the network, cache hits excluded.
- **Not on screen** (only with the image scan): the bytes of images that
  weren't shown within 10 s of loading, or that nothing drew.
- **Could save** (only when there is something to save): what would be left
  out if every image were as small as it can be: not loaded at all, at the
  size it is drawn, or as WebP.

### Findings

Below, the findings, warnings first and then by how much they save. The
chips above them filter by severity: **All**, **Warnings** (amber triangle)
and **Hints** (grey circle). Each row has the finding, the bytes it could
save (hover for whether that is measured or estimated) and `×N`, the number
of requests for the file.

| Finding                                                      | Severity                                                | When                                                                                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _… wasn't on screen in the 10 s after it loaded_             | warning                                                 | The page draws it, but below the fold, outside the viewport, or only in elements that are hidden. The saving is the whole file: it could be loaded later, with `loading="lazy"`. |
| _… loaded but the page draws it nowhere_                     | warning                                                 | No `<img>`, CSS background, SVG `<image>` or poster used it. Maybe a preload for a later screen, maybe not needed.                                                               |
| _… loaded 12.3 s before it was shown_                        | hint                                                    | It did show up, but more than 10 s after it arrived.                                                                                                                             |
| _… is 1024×1024 but drawn at 84×84 device pixels at most_    | warning at 4× the pixels or more, else hint             | The file is at least 1.5 times bigger than needed in both directions and at least 10,000 pixels go unused.                                                                       |
| _… is PNG: as WebP it would be about 41 KB instead of 75 KB_ | warning when it saves 20 KB or half the file, else hint | PNG, JPEG, GIF and BMP, when WebP saves at least 1 KB and 10%.                                                                                                                   |
| _… looks barely compressed: re-encoded it is …_              | warning                                                 | A WebP or AVIF that shrinks by at least 2 KB and 30% when re-encoded as WebP at quality 85.                                                                                      |
| _… is heavy for its size: 3.1 bits per pixel_                | hint                                                    | A WebP over 2.5 or an AVIF over 1.5 bits per pixel, 8 KB or bigger, when the file couldn't be re-encoded to measure it.                                                          |

The on-screen checks need the image scan and skip `favicon.ico`, images
only workers loaded, and images that loaded before the pages were first
scanned (they get no _not on screen_ or _late_ findings). "Drawn at" counts
the screen's density, `object-fit` and `background-size`; an image used in
several places is judged by the largest. SVG and ICO files only get the
on-screen checks.

**Measured or estimated.** For the last 300 images (SVGs aside) the tab
asks the agent for the file the WebView received and your browser decodes
it and re-encodes it as WebP at quality 85, whole and at the size it is
drawn. When the WebView no longer has the file, or it is over 1 MB, the
saving is a guess from what WebP usually saves (a PNG to about 55%, a JPEG
to 70%, a GIF to 60%, a BMP to 15%), and the finding says _about_. GIFs are
always a guess, since re-encoding would lose an animation's frames.

### A finding's details

Click a finding to open it below the list (click it again, or the cross, to
close it). Its explanation comes first, then:

- **Image**: a preview on a checkerboard, the **format**, the **file** size,
  the **natural size**, **drawn at most** in device pixels, and when it was
  measured **WebP q85** (the whole image as WebP) and **WebP at** the drawn
  size. The full URL is underneath.
- **Drawn by** (with the image scan): each element that used it, with the
  device's time of its first use, what it is (**&lt;img&gt;**,
  **CSS background**, **SVG &lt;image&gt;**, **video poster** or
  **image button**), its box in CSS pixels times the screen's density, its
  `object-fit` or `background-size`, and whether it was **on screen**,
  **off screen** (amber) or **hidden**. On screen means inside the phone's
  screen: an image in an iframe that is scrolled away or clipped counts as
  off screen.
- **Requests**: every request for the file with its time and size, or the
  cache it came from (`memory`, `disk`, `service-worker`, `prefetch`).

## Common tasks

**Find what slows the first screen.** Launch with
**Check how pages draw their images**, open the screen, wait ten seconds and
look at the warnings. _Wasn't on screen_ and _draws it nowhere_ are bytes the
first screen paid for and didn't show; **Not on screen** adds them up.

**Check a fix.** Clear the tab, reload the page in the app and compare
**Downloaded** and **Could save** with before.

**Report an image.** Open the finding: the URL, natural size, drawn size and
the WebP sizes are what a developer needs to export it right. With a
[recording](/holtdroid/concepts/recordings/#cache-images-and-svg), **Open in Network**
takes you to the request itself.

**Look at an image that doesn't show.** Its **Drawn by** rows say whether
the element was off screen (the page could load it lazily) or hidden (it was
downloaded for nothing).

## In recordings

A [recording](/holtdroid/concepts/recordings/#cache-images-and-svg) has the same tab with
the same checks, judged up to the playhead: a time there seeks the video and
**Open in Network** opens the request. Recordings keep image files up to
512 KB to measure; without the image scan they get only the checks on the
files, and say so.

## Limits

- Images inlined as `data:` or `blob:` URLs, redirects and failed requests
  (4xx and 5xx) aren't listed.
- The tab follows the last 5000 requests and 3000 scan reports, and the
  agent keeps 8 MB of requests and scan reports for a page that reconnects;
  in a very long session the oldest drop out.
- The scan reports at most 300 image uses per frame each second and looks at
  CSS backgrounds again at most every 3 seconds, after the page changed.
  Pages in the background report nothing.
- Files are measured from the WebView's own copy, which it keeps only while
  it has room (32 MB in all, 2 MB a file). A file it already dropped is
  judged by a guess, marked so.
- A page's own `srcset` choice is what is judged: the device's screen
  density decides which candidate it loads.
- Savings are byte counts of the files. They don't count decoding time or
  memory, which also shrink with smaller images.
