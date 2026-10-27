import { expect, test } from "bun:test"
import type { Pixels } from "./diff"
import { nearestEdge, snapPoint } from "./loupe"

function card(w: number, h: number, box: { x: number; y: number; w: number; h: number }): Pixels {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h
      data.set(inside ? [30, 30, 30, 255] : [240, 240, 240, 255], (y * w + x) * 4)
    }
  }
  return { data, width: w, height: h }
}

const p = card(100, 100, { x: 20, y: 30, w: 40, h: 20 })

test("the nearest edge within the radius is found on each axis", () => {
  expect(nearestEdge(p, 22.4, 40, "x")).toBe(20)
  expect(nearestEdge(p, 57.6, 40, "x")).toBe(60)
  expect(nearestEdge(p, 40, 33, "y")).toBe(30)
  expect(nearestEdge(p, 40, 10, "y")).toBeNull()
  expect(nearestEdge(p, 5, 5, "x")).toBeNull()
})

test("points land on pixel boundaries and snap to edges when asked", () => {
  expect(snapPoint(p, 22.4, 33.6, 1, true)).toEqual({ x: 20, y: 30 })
  expect(snapPoint(p, 22.4, 33.6, 1, false)).toEqual({ x: 22, y: 34 })
  expect(snapPoint(p, 11.2, 16.8, 2, true)).toEqual({ x: 10, y: 15 })
  expect(snapPoint(null, 3.6, 4.2, 1, true)).toEqual({ x: 4, y: 4 })
})
