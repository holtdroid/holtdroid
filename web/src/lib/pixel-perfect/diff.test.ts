import { expect, test } from "bun:test"
import { analyze, boxMask, describe, findRegions, motionMask, type Pixels } from "./diff"
import { fitScale, onReference, onScreen, placeReference } from "./geometry"

function canvas(w: number, h: number, bg = [255, 255, 255, 255]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) data.set(bg, i)
  return { data, width: w, height: h }
}

function rect(p: Pixels, x: number, y: number, w: number, h: number, color: number[]) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) p.data.set(color, (yy * p.width + xx) * 4)
}

test("the reference fits the width unless that overflows the height", () => {
  expect(fitScale({ w: 1080, h: 2400 }, { w: 360, h: 640 })).toBe(3)
  expect(fitScale({ w: 1080, h: 2400 }, { w: 360, h: 1000 })).toBe(2.4)
  expect(placeReference({ w: 1080, h: 2400 }, { w: 360, h: 1000 }, { x: 0, y: 0, scale: 1 })).toEqual({
    x: 108,
    y: 0,
    w: 864,
    h: 2400,
  })
  const placed = placeReference({ w: 1080, h: 2400 }, { w: 360, h: 640 }, { x: 10, y: -5, scale: 2 })
  expect(placed).toEqual({ x: 60, y: -30, w: 2160, h: 3840 })
  const r = { x: 0.25, y: 0.5, w: 0.25, h: 0.125 }
  const back = onReference(placed, onScreen(placed, r))
  expect(back?.x).toBeCloseTo(r.x)
  expect(back?.h).toBeCloseTo(r.h)
  expect(onReference(placed, { x: -500, y: -500, w: 10, h: 10 })).toBeNull()
})

test("identical images match and differences become regions", () => {
  const screen = canvas(200, 300)
  const reference = canvas(200, 300)
  rect(screen, 20, 20, 60, 30, [30, 30, 30, 255])
  rect(reference, 20, 20, 60, 30, [30, 30, 30, 255])
  expect(analyze(screen, reference).regions).toEqual([])

  rect(screen, 100, 200, 40, 40, [200, 0, 0, 255])
  const a = analyze(screen, reference)
  expect(a.regions.length).toBe(1)
  const r = a.regions[0]!
  expect(r.x).toBeLessThanOrEqual(100)
  expect(r.x + r.w).toBeGreaterThanOrEqual(140)
  expect(r.kind.type).toBe("extra")
  expect(a.match).toBeLessThan(1)
  expect(a.match).toBeGreaterThan(0.9)
})

test("a moved element is reported as a shift", () => {
  const screen = canvas(200, 200)
  const reference = canvas(200, 200)
  rect(reference, 50, 50, 40, 20, [20, 90, 200, 255])
  rect(screen, 53, 56, 40, 20, [20, 90, 200, 255])
  const a = analyze(screen, reference)
  expect(a.regions.length).toBe(1)
  expect(a.regions[0]!.kind).toEqual({ type: "shift", dx: 3, dy: 6 })
  expect(describe(a.regions[0]!.kind)).toBe("Shifted 3 px right, 6 px down")
  expect(describe(a.regions[0]!.kind, 2)).toBe("Shifted 6 px right, 12 px down")
})

test("another colour on the same shape is a colour difference", () => {
  const screen = canvas(120, 120)
  const reference = canvas(120, 120)
  rect(reference, 30, 30, 50, 50, [0, 0, 0, 255])
  rect(screen, 30, 30, 50, 50, [0, 0, 0, 255])
  rect(reference, 40, 40, 30, 30, [255, 0, 0, 255])
  rect(screen, 40, 40, 30, 30, [0, 0, 255, 255])
  const kinds = analyze(screen, reference).regions.map((r) => r.kind.type)
  expect(kinds).toEqual(["color"])
})

test("ignored areas and transparent parts of the reference are skipped", () => {
  const screen = canvas(100, 100)
  const reference = canvas(100, 100, [0, 0, 0, 0])
  rect(reference, 0, 0, 100, 50, [255, 255, 255, 255])
  rect(screen, 10, 60, 30, 30, [0, 0, 0, 255])
  expect(analyze(screen, reference).regions).toEqual([])
  expect(analyze(screen, reference).compared).toBe(5000)

  rect(screen, 10, 10, 20, 20, [0, 0, 0, 255])
  expect(analyze(screen, reference).regions.length).toBe(1)
  const ignore = boxMask(100, 100, [{ x: 5, y: 5, w: 30, h: 30 }])
  expect(analyze(screen, reference, ignore).regions).toEqual([])
})

test("noise of single pixels makes no region", () => {
  const mask = new Uint8Array(100 * 100)
  let seed = 7
  for (let n = 0; n < 40; n++) {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    mask[seed % mask.length] = 1
  }
  expect(findRegions(mask, 100, 100)).toEqual([])
})

test("moving content between frames becomes a mask", () => {
  const still = [canvas(64, 64), canvas(64, 64), canvas(64, 64)]
  expect(motionMask(still)).toBeNull()
  const frames = [canvas(64, 64), canvas(64, 64), canvas(64, 64)]
  rect(frames[1]!, 0, 0, 16, 16, [0, 0, 0, 255])
  rect(frames[2]!, 0, 0, 16, 16, [128, 128, 128, 255])
  const mask = motionMask(frames)
  expect(mask).not.toBeNull()
  expect(mask?.[0]).toBe(1)
  expect(mask?.[20 * 64 + 20]).toBe(1)
  expect(mask?.[63 * 64 + 63]).toBe(0)
})
