---
title: SVG
description: The SVG path data in what the app's WebViews load, with the bytes that rounding, shorter commands and shipping each path once would save.
sidebar:
  order: 6
---

Icons drawn as SVG are text, and their path data (`d="M12.0000 4.5000 …"`)
often ships with more digits than anyone can see, in longer commands than
needed, or once per component that uses it. The **SVG** tab finds those
paths in what the app's WebViews load and says, per file, how many bytes
each fix would take off. It is for developers trimming a bundle and for QA
checking that an icon set was exported sensibly.

Like the [Images](/session-tools/images/) tab, it needs no DevTools
window: the agent follows every page and iframe of the WebViews from their
first request (see [DevTools](/concepts/devtools/)), so files that
loaded before you opened the tab are there too.

## When the tab appears

The tab sits next to DevTools in every session whose device supports
DevTools. It searches:

- the **scripts, pages, stylesheets, SVG files and JSON or text responses
  to XHR and fetch** the WebViews load, as
  they load: SVG markup (`d="…"`), compiled JSX (`d:"M…"`), JSON-style
  `"d": "…"`, `setAttribute("d", …)`, and SVG data URIs, URL-encoded or
  base64;
- the **inline `<svg>` elements** the pages draw, but only while the
  [image scan](/session-tools/images/#when-the-tab-appears) runs.
  Without it a note says
  _This session doesn't collect the pages' inline SVGs_, with a
  **Turn on** button; the files are still checked.

A path counts when it starts with `M` or `m`, holds only path commands and
numbers, and is between 8 and 100,000 characters long.

## What you see

The toolbar has **Pause** and **Clear** on the left and the number of paths
on the right (and **Image scan on · turn off** while the scan runs). Pause
stops following the WebViews; on resume the tab catches up with what the
agent kept meanwhile. Clear empties the tab.

### The numbers on top

- **Files**: the files with path data in them; the inline SVGs of each page
  or iframe count as one, labelled `Inline SVG · ` and the page's host.
- **Paths**: how many paths they hold.
- **Path data**: the bytes of those paths.
- **Could save** (when there is something to save): what rounding, shorter
  commands and shipping each path once would take off, before gzip or
  Brotli.

While your browser works out the shorter commands, a line says
_Working out shorter commands with svgo…_; the **Longer commands** findings
appear when it is done.

### Findings

The findings come warnings first, then by how much they save. The chips
above them filter by severity: **All**, **Warnings** (amber triangle) and
**Hints** (grey circle). Each row shows the bytes it could save before
compression and `×N`, the number of paths it is about.

| Finding                                                                   | Shown when it saves | Warning when it saves                 |
| ------------------------------------------------------------------------- | ------------------- | ------------------------------------- |
| _`icons.js`: 120 of 340 paths keep up to 6 decimals, rounding saves 8 KB_ | 256 B in the file   | 10 KB, or 20% of the file's path data |
| _`icons.js`: shorter path commands save another 3 KB_                     | 256 B in the file   | 10 KB, or 20% of the file's path data |
| _14 paths are shipped more than once: 12 KB_                              | 256 B in all        | 10 KB                                 |

- **Too many decimals.** How many digits a path needs depends on its size:
  the nearest `viewBox` in the 1500 characters before it, else the path's
  own extent. A path under 10 units across keeps 3 digits after the point,
  under 100 units 2 (a 24-unit icon), under 1000 units 1, and none from 1000
  on. The saving is what rounding alone takes off.
- **Longer commands than needed.** What svgo's `convertPathData` saves on top
  of rounding: relative or absolute coordinates per segment, whichever is
  shorter, no needless separators or repeated commands, lines as `H` and `V`
  and curves as shorthand or arcs where it can. The details say how many of
  the file's commands are absolute.
- **Paths shipped more than once.** The same path data in several files, or
  several times in one, with the bytes the extra copies take. Inline SVGs
  count only paths no file brought, so an icon a page renders from its
  bundle isn't counted twice.

### A finding's details

Click a finding to open it below the list (click it again, or the cross, to
close it). Its explanation comes first, then the **File** it is about (its
full URL; not for repeated paths, which span files) and the **Paths**, the first 100 when there are more. Each path
shows:

- a small preview, when the `viewBox` is known;
- its length in bytes and its data, and below that the shorter version in
  the accent colour: rounded for _too many decimals_, after svgo for
  _longer commands_;
- for a repeated path, how often it appears and in which files;
- `up to 6 decimals, 2 needed for a size of 24 (viewBox)`: the most digits
  it has, the digits its size needs, and the size they were worked out from.

## Common tasks

**Find the heaviest icon file.** Sort is already by saving: the top warning
names the file. Open it to see its worst paths and their rounded form.

**Check an icon export.** Clear the tab, reload the page in the app and look
for _too many decimals_ on the icon bundle; the details show exactly which
paths kept six digits.

**Find duplicated icons.** Open _shipped more than once_: each path lists the
files that carry it, which is where a shared icon component or a sprite
(`<symbol>` and `<use>`) would help.

## In recordings

A [recording](/concepts/recordings/#cache-images-and-svg) has the same tab
with the same checks over the recorded files; there
**Open in Network** in a finding's details opens the file's request.

## Limits

- Savings are bytes before compression. gzip and Brotli already take off
  part of them, so the transfer shrinks by less.
- The live tab asks the agent for the bodies of the last 200 of those
  files, while the WebView still has them; bodies over 1 MB are cut, and
  only the part kept is searched.
- The scan sends each inline `<svg>` once, skips nested ones and ones over
  64 KB of markup, and stops after 1 MB of SVG markup per page.
- Paths are found by pattern, not by running the code: one assembled at run
  time from pieces, or kept in a format other than the ones above, isn't
  seen.
