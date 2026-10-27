import type { Display, ReferenceView, UIHierarchy } from "@/api/client"
import type { Box, Size } from "@/lib/pixel-perfect/geometry"

export type ReferenceLayout = ReferenceView["layout"]
export type WorkArea = ReferenceLayout["area"]
export type Grid = ReferenceLayout["grid"]
export type Guide = ReferenceLayout["guides"][number]
export type Insets = WorkArea["insets"]

export const emptyBox = { x: 0, y: 0, w: 0, h: 0 }
export const noInsets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
export const defaultLayout: ReferenceLayout = {
  area: { kind: "screen", insets: noInsets, box: emptyBox },
  grid: { columns: 0, margin: 0, gutter: 0, baseline: 0 },
  guides: [],
}

/** Screen pixels per dp for a screen drawn at this size; a 360 dp wide screen when the device's density is unknown. */
export function pxPerDp(display: Pick<Display, "width" | "height" | "dpi"> | undefined, size: Size) {
  if (display && display.dpi > 0 && display.width > 0 && display.height > 0) {
    return ((display.dpi / 160) * Math.max(size.w, size.h)) / Math.max(display.width, display.height)
  }
  return size.w / 360
}

/** The work area in screen pixels, never empty. */
export function areaBox(area: WorkArea, size: Size, k: number): Box {
  let b: Box = { x: 0, y: 0, w: size.w, h: size.h }
  if (area.kind === "insets") {
    const i = area.insets
    b = { x: i.left * k, y: i.top * k, w: size.w - (i.left + i.right) * k, h: size.h - (i.top + i.bottom) * k }
  } else if (area.kind === "box") {
    b = { x: area.box.x * size.w, y: area.box.y * size.h, w: area.box.w * size.w, h: area.box.h * size.h }
  }
  if (b.w < 1 || b.h < 1) return { x: 0, y: 0, w: size.w, h: size.h }
  return b
}

/** The parts of the screen outside the area, for the comparison to skip. */
export function outside(area: Box, size: Size): Box[] {
  return [
    { x: 0, y: 0, w: size.w, h: area.y },
    { x: 0, y: area.y + area.h, w: size.w, h: size.h - area.y - area.h },
    { x: 0, y: area.y, w: area.x, h: area.h },
    { x: area.x + area.w, y: area.y, w: size.w - area.x - area.w, h: area.h },
  ].filter((b) => b.w > 0 && b.h > 0)
}

/** The columns of a grid inside the area, in screen pixels. */
export function gridColumns(grid: Grid, area: Box, k: number): Box[] {
  if (grid.columns < 1) return []
  const margin = grid.margin * k
  const gutter = grid.gutter * k
  const w = (area.w - 2 * margin - gutter * (grid.columns - 1)) / grid.columns
  if (w <= 0) return []
  return Array.from({ length: grid.columns }, (_, i) => ({
    x: area.x + margin + i * (w + gutter),
    y: area.y,
    w,
    h: area.h,
  }))
}

/** The baseline rows inside the area, as y in screen pixels. */
export function baselineRows(grid: Grid, area: Box, k: number): number[] {
  const step = grid.baseline * k
  if (step < 2) return []
  const out: number[] = []
  for (let y = area.y + step; y < area.y + area.h && out.length < 2000; y += step) out.push(y)
  return out
}

/** A guide's line in screen pixels: x for a vertical one, y for a horizontal one. */
export function guideAt(g: Guide, area: Box, k: number) {
  return g.axis === "x" ? area.x + g.pos * k : area.y + g.pos * k
}

/** A position in screen pixels as a guide's dp from the area's corner, to half a dp. */
export function guidePos(axis: Guide["axis"], px: number, area: Box, k: number) {
  return Math.round(((px - (axis === "x" ? area.x : area.y)) / k) * 2) / 2
}

/**
 * How far to move a box so one of its edges or its centre lands on the
 * nearest target within threshold; 0 when none is that close.
 */
export function snapOffset(edges: number[], targets: number[], threshold: number) {
  let best = 0
  let dist = threshold
  for (const e of edges) {
    for (const t of targets) {
      const d = Math.abs(t - e)
      if (d <= dist) {
        dist = d
        best = t - e
      }
    }
  }
  return best
}

/** Where a box sits as insets in dp, to keep an area that fits other screens. */
export function insetsOf(b: Box, size: Size, k: number): Insets {
  const r = (v: number) => Math.max(0, Math.round(v / k))
  return { top: r(b.y), right: r(size.w - b.x - b.w), bottom: r(size.h - b.y - b.h), left: r(b.x) }
}

export function describeArea(area: WorkArea) {
  if (area.kind === "insets") {
    const i = area.insets
    return `Insets ${i.top} · ${i.right} · ${i.bottom} · ${i.left} dp`
  }
  if (area.kind === "box") return "Drawn area"
  return "Whole screen"
}

/**
 * The app's window as insets in dp: the largest window root of the app's
 * package in a view dump, against the display turned the way the dump says.
 */
export function appWindowInsets(
  h: UIHierarchy,
  pkg: string,
  display: Pick<Display, "width" | "height" | "dpi">,
): Insets | null {
  const roots = h.nodes.filter((n) => n.parent < 0 && n.package === pkg && n.w > 0 && n.h > 0)
  const win = roots.toSorted((a, b) => b.w * b.h - a.w * a.h)[0]
  if (!win || display.dpi <= 0) return null
  const turned = h.rotation % 2 === 1
  const w = turned ? display.height : display.width
  const hgt = turned ? display.width : display.height
  const d = display.dpi / 160
  const r = (v: number) => Math.max(0, Math.round(v / d))
  return { top: r(win.y), right: r(w - win.x - win.w), bottom: r(hgt - win.y - win.h), left: r(win.x) }
}

/** Whether two layouts are the same, for telling which saved one is in use. */
export function sameLayout(a: ReferenceLayout, b: ReferenceLayout) {
  return JSON.stringify(normal(a)) === JSON.stringify(normal(b))
}

function normal(l: ReferenceLayout) {
  return {
    area: {
      kind: l.area.kind,
      insets: l.area.kind === "insets" ? l.area.insets : null,
      box: l.area.kind === "box" ? l.area.box : null,
    },
    grid: l.grid,
    guides: l.guides.map((g) => `${g.axis}:${g.pos}`).toSorted((a, b) => a.localeCompare(b)),
  }
}
