import { expect, test } from "bun:test"
import type { Pixels } from "./diff"
import { appWindow, contentByColour, contentViews, distinctCandidates } from "./detect"

function letterboxed(w: number, h: number, top: number, bottom: number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bar = y < top || y >= h - bottom
      const v = bar ? 0 : (Math.imul((x * 73856093) ^ (y * 19349663), 2654435761) >>> 24) | 64
      data.set([v, v, bar ? 0 : 255 - v, 255], (y * w + x) * 4)
    }
  }
  for (let y = 8; y < 14; y++) for (let x = 96; x < 104; x++) data.set([60, 60, 70, 255], (y * w + x) * 4)
  for (let x = 4; x < 12; x++) data.set([255, 255, 255, 255], (10 * w + x) * 4)
  return { data, width: w, height: h }
}

test("plain bars along the edges are cut off, a camera hole and icons in them don't stop it", () => {
  expect(contentByColour(letterboxed(200, 400, 30, 40))).toEqual({ x: 0, y: 30, w: 200, h: 330 })
  expect(contentByColour(letterboxed(200, 400, 0, 0))).toBeNull()
  expect(contentByColour(letterboxed(200, 400, 150, 150))).toBeNull()
})

const node = (cls: string, x: number, y: number, w: number, h: number, parent = 0, pkg = "com.example") => ({
  parent,
  class: cls,
  package: pkg,
  x,
  y,
  w,
  h,
})

test("content views and the app's window come from the view tree", () => {
  const dump = {
    rotation: 0,
    nodes: [
      node("android.widget.FrameLayout", 0, 0, 1080, 2400, -1),
      node("android.webkit.WebView", 0, 249, 1080, 1965),
      node("android.view.SurfaceView", 0, 0, 100, 100),
      node("android.widget.FrameLayout", 0, 0, 1080, 72, -1, "com.android.systemui"),
    ],
  }
  expect(contentViews(dump, { w: 1080, h: 2400 })).toEqual([
    { label: "WebView", box: { x: 0, y: 249, w: 1080, h: 1965 } },
  ])
  expect(appWindow(dump, "com.example")).toEqual({ x: 0, y: 0, w: 1080, h: 2400 })
  expect(appWindow(dump, "com.other")).toBeNull()
})

test("candidates become insets in dp, without duplicates or the whole screen", () => {
  const screen = { w: 1080, h: 2400 }
  const found = [
    { label: "By colour", box: { x: 0, y: 249, w: 1080, h: 1965 } },
    { label: "WebView", box: { x: 0, y: 249, w: 1080, h: 1965 } },
    { label: "App window", box: { x: 0, y: 0, w: 1080, h: 2400 } },
  ]
  expect(distinctCandidates(found, screen, 3)).toEqual([
    { label: "By colour", box: found[0]!.box, insets: { top: 83, right: 0, bottom: 62, left: 0 } },
  ])
})
