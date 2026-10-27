import { expect, test } from "bun:test"
import { placeReference } from "./geometry"
import {
  appWindowInsets,
  areaBox,
  baselineRows,
  defaultLayout,
  gridColumns,
  guideAt,
  guidePos,
  insetsOf,
  outside,
  pxPerDp,
  sameLayout,
  snapOffset,
} from "./layout"

const size = { w: 540, h: 1200 }

test("dp follow the device's density and the stream's size", () => {
  expect(pxPerDp({ width: 1080, height: 2400, dpi: 480 }, size)).toBe(1.5)
  expect(pxPerDp(undefined, { w: 720, h: 1600 })).toBe(2)
})

test("the work area comes from insets in dp or a drawn box", () => {
  const k = 1.5
  expect(areaBox(defaultLayout.area, size, k)).toEqual({ x: 0, y: 0, w: 540, h: 1200 })
  const insets = { ...defaultLayout.area, kind: "insets" as const, insets: { top: 24, right: 0, bottom: 48, left: 0 } }
  expect(areaBox(insets, size, k)).toEqual({ x: 0, y: 36, w: 540, h: 1092 })
  const box = { ...defaultLayout.area, kind: "box" as const, box: { x: 0.1, y: 0.25, w: 0.5, h: 0.5 } }
  expect(areaBox(box, size, k)).toEqual({ x: 54, y: 300, w: 270, h: 600 })
  const none = { ...defaultLayout.area, kind: "insets" as const, insets: { top: 900, right: 0, bottom: 900, left: 0 } }
  expect(areaBox(none, size, k)).toEqual({ x: 0, y: 0, w: 540, h: 1200 })
  expect(insetsOf({ x: 0, y: 36, w: 540, h: 1092 }, size, k)).toEqual({ top: 24, right: 0, bottom: 48, left: 0 })
})

test("outside the area is skipped and the reference is fitted inside it", () => {
  const area = { x: 0, y: 36, w: 540, h: 1092 }
  expect(outside(area, size)).toEqual([
    { x: 0, y: 0, w: 540, h: 36 },
    { x: 0, y: 1128, w: 540, h: 72 },
  ])
  expect(placeReference(area, { w: 360, h: 728 }, { x: 0, y: 0, scale: 1 })).toEqual({ x: 0, y: 36, w: 540, h: 1092 })
})

test("grids and guides are laid out in dp inside the area", () => {
  const area = { x: 0, y: 36, w: 540, h: 1092 }
  const grid = { columns: 4, margin: 16, gutter: 8, baseline: 8 }
  const cols = gridColumns(grid, area, 1.5)
  expect(cols.length).toBe(4)
  expect(cols[0]).toEqual({ x: 24, y: 36, w: 114, h: 1092 })
  expect(cols[3]!.x + cols[3]!.w).toBe(516)
  expect(baselineRows(grid, area, 1.5).slice(0, 2)).toEqual([48, 60])
  expect(gridColumns({ ...grid, columns: 0 }, area, 1.5)).toEqual([])
  expect(guideAt({ axis: "y", pos: 56 }, area, 1.5)).toBe(120)
  expect(guidePos("y", 121, area, 1.5)).toBe(56.5)
})

test("snapping moves the nearest edge onto a target within the threshold", () => {
  expect(snapOffset([10, 110], [12, 300], 4)).toBe(2)
  expect(snapOffset([10, 110], [108, 13], 4)).toBe(-2)
  expect(snapOffset([10, 110], [50], 4)).toBe(0)
})

const node = (pkg: string, x: number, y: number, w: number, h: number, parent = -1) => ({
  parent,
  class: "android.widget.FrameLayout",
  package: pkg,
  x,
  y,
  w,
  h,
})

test("the app's window becomes insets in dp, in the dump's rotation", () => {
  const display = { width: 1080, height: 2400, dpi: 480 }
  const dump = {
    rotation: 0,
    nodes: [
      node("com.android.systemui", 0, 0, 1080, 72),
      node("com.example", 0, 72, 1080, 2184),
      node("com.example", 0, 100, 10, 10, 1),
    ],
  }
  expect(appWindowInsets(dump, "com.example", display)).toEqual({ top: 24, right: 0, bottom: 48, left: 0 })
  expect(
    appWindowInsets({ rotation: 1, nodes: [node("com.example", 0, 0, 2256, 1080)] }, "com.example", display),
  ).toEqual({ top: 0, right: 48, bottom: 0, left: 0 })
  expect(appWindowInsets(dump, "com.other", display)).toBeNull()
})

test("layouts compare without what their kind ignores", () => {
  const a = {
    ...defaultLayout,
    guides: [
      { axis: "x" as const, pos: 16 },
      { axis: "y" as const, pos: 8 },
    ],
  }
  const b = {
    ...defaultLayout,
    area: { ...defaultLayout.area, insets: { top: 9, right: 0, bottom: 0, left: 0 } },
    guides: [
      { axis: "y" as const, pos: 8 },
      { axis: "x" as const, pos: 16 },
    ],
  }
  expect(sameLayout(a, b)).toBe(true)
  expect(sameLayout(a, { ...a, grid: { ...a.grid, columns: 4 } })).toBe(false)
})
