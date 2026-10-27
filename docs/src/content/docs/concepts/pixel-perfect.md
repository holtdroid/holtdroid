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

A reference is an image: SVG, PNG, JPEG or WebP, up to
`pixelPerfect.maxFileSize` (25 MiB). Add one by dropping it on the tab,
choosing a file, or pasting it with ⌘V / Ctrl+V while the tab is open.

:::tip[From Figma, paste the link]
For a Figma frame, paste its link instead of an exported image (see
[Import from Figma](#import-from-figma)): it comes with its layers and
components, rendered by Figma itself. Keep the frame the size of the phone's
screen in dp (for example 360 × 800); Holtdroid fits it to the work area. An
exported image still works: a PNG at 3× or 4×, or an SVG for a flat frame
(Figma's SVG export loses corner smoothing and background blur).
:::

An SVG needs a size: `width` and `height` on its root, or a `viewBox`, which
Figma always writes.

## Import from Figma

A frame can come straight from Figma, together with its layers: select it,
**Copy link to selection** (⌘L / Ctrl+L), and paste the link into the tab, or
use **Figma** in the reference list. Figma renders it as a **PNG at 4×**
(less for very tall frames, to stay under 24 megapixels): its own rendering,
exact for corner smoothing, shadows, blurs and text, and the same as the
components it is split into. There is no format to choose.

### Components

The import also renders up to 20 parts of the frame on their own, so you can
leave some out of the reference, such as a placeholder where the app shows a
video, a camera picture or a map. The parts are the frame's children; while
there is room, the largest group or frame that adds nothing of its own (no
fill, stroke, effect, clipping, mask or opacity) is replaced by its children,
so a wrapper is split and a card stays whole. A frame with more than 20
children keeps them as they are, up to 60.

The **Components** tab lists them, top first, with a picture each;
pointing at one outlines it on the screen and the eye hides it. Hidden
components are kept with the reference. With all of them shown, the overlay
is the frame's own rendering; with some hidden, the browser draws the frame
again from its background colour and the visible components, in order.
**Skip hidden components** (on by default) also leaves their place out of the
comparison, so the video under a hidden placeholder isn't a difference.

Parts whose fill is an image or a video, or whose name says video, player,
stream, camera, preview or map, are marked **live?**, and **Hide live
content** hides them at once.

Redrawing works when the frame's own fill is plain colour and no mask spans
its parts; otherwise the tab says so and ignored areas are the way to skip
them. A redrawn frame can differ from Figma's rendering where hidden and
shown parts interact: background blur over a hidden part, or blend modes
between them. The pictures count towards your quota (usually a few MB) and
are fetched again by **Update from Figma**, which keeps the hidden ones that
still exist.

Importing needs a Figma **personal access token**. The server may have one
for everyone (`pixelPerfect.figma.token`); otherwise add yours on the
**Pixel perfect** page (the frame icon in the header), under **Account** in
the `users` sign-in mode, or right in the import form. Each of them has the
same step-by-step guide:

1. In Figma, click your name or avatar in the top left corner → **Settings**
   → **Security**.
2. Under **Personal access tokens**, **Generate new token**, name it
   `holtdroid` and pick the longest expiration Figma offers.
3. Scopes: **File content** read-only and **Current user** read (Holtdroid
   checks the token with it and shows whose it is); nothing else.
4. Copy the token (it starts with `figd_`, Figma shows it once), paste it and
   **Check and save**.

The token reads only the files your Figma account can open. Where it is
kept depends on the server:

- **With your account** when the database is `sqlite` and `auth.sessionKey`
  is set: the api checks it with Figma, encrypts it (AES-GCM with a key
  derived from `auth.sessionKey`) and never sends it back, so it works in
  every browser you sign in with. Changing `auth.sessionKey` makes saved
  tokens unreadable; everyone then saves theirs again.
- **In this browser** otherwise (an in-memory database would lose it on the
  next restart): the api only checks it, and the browser sends it with each
  import or update.

When the token expires, imports say Figma refused it: generate a new one and
**Replace** it.

## Pixel perfect page

The frame icon in the header opens the page for your references outside a
session: all of them grouped by app, with search, the space they take and
when they will be deleted; import from Figma or add an image, rename,
download, delete, open a Figma reference's frame in Figma or update it, and
show or hide its components (the layers button). It
also holds your Figma token and how the tab starts in this browser
(opacity, blend, and which of the switches below are on).

The import keeps the layers under the frame: their boxes, the top fill and
stroke, corner radius, opacity, font (family, weight, size, line height,
letter spacing) and auto layout padding and gap. They move with the
reference when you move or scale it, and the comparison uses them (see
[Elements](#elements)). **Update from Figma** (the arrows next to a reference)
fetches the frame again, keeping where it lies and its ignored areas.

A phone frame drawn at the screen's width in dp (360, 393, 412) has its
measures in dp; a wider frame is in pixels, and the tab says so. References belong to you, not to a session, so they are there in
every session; the ones added for the current app come first.

Double-click a name to rename it. Each reference also remembers where you put
it over the screen and which areas the comparison skips.

They live in the server's storage (S3 or a folder). Each user has
`pixelPerfect.quota` (1 GiB by default; per user in the `users` auth mode),
and a reference nobody opened for `pixelPerfect.maxAge` (30 days) is deleted;
laying it over a screen counts as opening it, its thumbnail in the list
doesn't.

The list shows small previews (160 px wide, the top of tall frames) that the
browser makes when you add an image, so opening the tab doesn't download the
full images; the server makes them for PNG, JPEG and WebP it got without
one.

## The tab

The toolbar at the top holds what is used all the time: the reference
(click it for the list, search, import from Figma or add an image), the eye
that hides the overlay, its opacity and blend, **Freeze**, the settings and
**Find differences**. Below it, three tabs:

- **Layout**: the work area, the position, the grid and the guides;
- **Components** (or **Skip areas** for an image): the Figma components to
  hide and the ignored areas;
- **Differences**: the result, which **Find differences** switches to.

When the panel is wide (DevTools stretched across the window), the three are
shown side by side as columns instead of tabs.

## Over the screen

Picking a reference lays it over the device screen. By default it fills the
work area's width without going past its height, top-aligned, so a mockup at
any density (1×, 2×, 3×) fits as is.

- **Opacity** and the **blend**: _Normal_ is the mockup see-through;
  _Difference_ is the classic "negative" check, where matching pixels turn
  black and anything off lights up; _Invert_ shows the inverted mockup, so
  matching areas fade to grey.
- **Position**: X and Y in the mockup's own pixels and a scale, where 100% is
  the fit above. Turn on **Move** to drag it over the screen or nudge it with
  the arrow keys (Shift for 10 px). While dragging, its edges and centre snap
  to the work area, the grid's columns and the guides; hold Alt not to. The
  device stays usable while Move is off: taps go through the overlay.
- The eye button hides the overlay without losing its settings.

## Work area

The work area is the part of the screen you work in, for example the app
without the status and navigation bars, or a single card. The reference is
fitted to it, the grid and the guides start at its corner, and the
comparison skips everything outside it. The area outside is dimmed and the
area outlined in amber.

- **Whole screen**, the default.
- **Insets**: top, right, bottom and left in dp, so the same area fits any
  screen size and density. **Without system bars** sets 24 and 48 dp.
- **Drawn**: drag a rectangle over the screen; it is kept as fractions of the
  screen.

**Detect** takes a screenshot and reads the views, and offers what it finds
as insets: **Content by colour** cuts off plain bars along the edges (black
bars above and below a letterboxed game; a camera hole or a few status icons
in them don't stop it), a large **WebView**, **SurfaceView**,
**TextureView** or player view, and the **App window**. Point at one to see
it outlined on the screen, click to use it. When the content reaches the
screen's edges and fills it, there is nothing to find.

While drawing the work area, an ignored area or a guide, a **loupe** next to
the pointer shows the screen magnified with its pixel grid. Corners land on
pixel boundaries and snap to the nearest contrasting edge within four
pixels, such as a card's border; hold Alt to place them freely. The loupe
uses a picture of the screen taken when the tool is turned on, or the frozen
frame.

Each reference keeps its own area, grid and guides. **Save as a preset**
(the bookmark button) keeps them under a name for your other references and
devices, and the list above the switch applies one; presets live with your
account in the server's storage.

## Grid and guides

The **grid** is drawn inside the work area, in dp: a number of columns with
a margin on each side and a gutter between them, like Material's layout
grids, and rows every so many dp for a baseline. **4 columns**, **8 columns**
and **8 dp rows** fill in common values.

**Guides** are lines at a distance in dp from the work area's left or top
edge. Turn on **Rulers** and drag from the ruler at the top of the screen
for a horizontal guide, or from the left one for a vertical guide; drag a
guide to move it (it snaps to the area and the columns) and drag it out of
the area to remove it. They are also listed with their positions to type in
exactly.

**Grid and guides on the screen** in the settings hides them without losing
them.

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
and numbered on the screen (**Differences on the screen** in the settings
turns that off) and on the **Differences** tab,
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
- **Ignored areas**: on the **Components** tab (**Skip areas** for an image
  without components), turn on **Draw** and drag over the screen to mark areas
  the comparison always skips for this reference, such as a player that may
  be paused.
- **Skip video, canvas and frames in WebViews** (with **Name differences by WebView elements** on, see below): in a WebView
  page, the boxes of `<video>`, `<canvas>`, `<iframe>`, `<embed>` and
  `<object>` elements are left out, paused or not (see below). They are
  hatched violet.

### Elements

A difference found by pixels says where; elements say what is there. Both
switches are in the settings (the sliders icon in the toolbar).

**Name differences by native views** (on by default) reads the app's views with Android's
`uiautomator`, the way Appium does, without touching the app: each difference
names the view that fits it, with its class, resource id, text or content
description, and its size in pixels and dp; pointing at a difference outlines
the view over the screen. Compose screens show their texts and descriptions,
and their test tags as ids when the app sets `testTagsAsResourceId`. It adds a
second or two, and doesn't work while the screen keeps animating: the tab then
says so and compares by pixels alone. With a frozen frame, the views are read
the moment it is frozen.

With a reference **imported from Figma**, each difference also names the
design layer there (`◆ Card › Pay`, outlined in pink when you point at it)
and what the design asks of it: size, fill, stroke, radius, font, padding and
gap; for a colour difference, the fill next to the colour on the screen. The
view or page element drawn where that layer is (outlined in amber) is
measured against it, so the list says `width 320 dp instead of 328` and the
magnified crop has a table of the edges and sizes that are off.

### WebView pages

This part is **experimental** and **off by default**: turn on **Name
differences by WebView elements** in the settings; the choice is remembered
in the browser.

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
numbered on them, and the list of differences with their sizes, positions,
their elements or views, and the Figma layer with what is off.

## Configuration

```yaml
pixelPerfect:
  enabled: true # the tab and its API; on by default
  quota: 1GiB # per user; 0 = no limit
  maxAge: 720h # deleted this long after it was last opened; 0 = never
  maxFileSize: 25MiB # largest image
  sweepInterval: 1h # how often retention runs
  figma:
    token: env:FIGMA_TOKEN # a personal access token for everyone; empty = each user gives theirs
    url: https://api.figma.com
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
