import { expect, test } from "bun:test"
import type { Pixels } from "./diff"
import { findOffset, matchRegion, type ScreenElement } from "./webview"

function noise(w: number, h: number, seed: number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v =
        Math.imul((Math.floor(x / 3) * 73856093) ^ (Math.floor(y / 3) * 19349663) ^ (seed * 83492791), 2654435761) >>>
        24
      data.set([v, v, v, 255], (y * w + x) * 4)
    }
  }
  return { data, width: w, height: h }
}

function crop(p: Pixels, x: number, y: number, w: number, h: number): Pixels {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let r = 0; r < h; r++)
    out.set(p.data.subarray(((y + r) * p.width + x) * 4, ((y + r) * p.width + x + w) * 4), r * w * 4)
  return { data: out, width: w, height: h }
}

test("a WebView is found where it sits on the screen", () => {
  const screen = noise(540, 1200, 3)
  expect(findOffset(screen, crop(screen, 0, 133, 540, 900))).toEqual({ x: 0, y: 133, score: 0 })
  expect(findOffset(screen, crop(screen, 37, 401, 300, 500))).toMatchObject({ x: 37, y: 401 })
})

test("a native view over part of the WebView doesn't hide it", () => {
  const screen = noise(300, 600, 9)
  const view = crop(screen, 0, 80, 300, 400)
  for (let y = 0; y < 60; y++) view.data.fill(0, y * 300 * 4, (y + 1) * 300 * 4)
  const found = findOffset(screen, view)
  expect(found).toMatchObject({ x: 0, y: 80 })
  expect(found!.score).toBeLessThan(0.3)
})

test("a picture that isn't on the screen scores badly", () => {
  expect(findOffset(noise(200, 400, 1), noise(200, 200, 2))!.score).toBeGreaterThan(0.5)
  expect(findOffset(noise(200, 400, 1), noise(201, 200, 2))).toBeNull()
})

function el(label: string, x: number, y: number, w: number, h: number): ScreenElement {
  return {
    index: 0,
    tag: "div",
    label,
    selector: label,
    text: "",
    rect: { x, y, w, h },
    styles: {},
    box: { x, y, w, h },
  }
}

test("a region belongs to the element that fits it best", () => {
  const elements = [el("body", 0, 0, 1080, 2000), el("card", 40, 400, 1000, 600), el("button", 80, 800, 300, 96)]
  expect(matchRegion({ x: 76, y: 796, w: 312, h: 104 }, elements)?.label).toBe("button")
  expect(matchRegion({ x: 40, y: 400, w: 1000, h: 300 }, elements)?.label).toBe("card")
  expect(matchRegion({ x: 0, y: 2100, w: 50, h: 50 }, elements)).toBeNull()
})
