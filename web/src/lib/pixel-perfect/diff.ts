import pixelmatch from "pixelmatch"
import type { Box } from "@/lib/pixel-perfect/geometry"

export type Pixels = { data: Uint8ClampedArray; width: number; height: number }

export type RegionKind =
  | { type: "shift"; dx: number; dy: number }
  | { type: "color"; screen: string; reference: string }
  | { type: "missing" }
  | { type: "extra" }
  | { type: "differs" }

export type Region = Box & { pixels: number; kind: RegionKind }

export type Analysis = {
  width: number
  height: number
  compared: number
  different: number
  /** 0–1 of the compared pixels that match. */
  match: number
  regions: Region[]
  /** 1 where the screen differs from the reference. */
  mask: Uint8Array
}

const cell = 8
const minPixels = 10
const maxShift = 8

function luma(d: Uint8ClampedArray, i: number) {
  return 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!
}

/**
 * The reference composited over the screen, so its transparent parts and the
 * ignored areas compare as equal, and how many pixels are actually compared.
 */
export function composite(screen: Pixels, reference: Pixels, ignore?: Uint8Array) {
  const a = screen.data
  const r = reference.data
  const out = new Uint8ClampedArray(a.length)
  let compared = 0
  for (let p = 0, i = 0; i < a.length; p++, i += 4) {
    const alpha = ignore?.[p] ? 0 : r[i + 3]! / 255
    if (alpha > 0) compared++
    out[i] = r[i]! * alpha + a[i]! * (1 - alpha)
    out[i + 1] = r[i + 1]! * alpha + a[i + 1]! * (1 - alpha)
    out[i + 2] = r[i + 2]! * alpha + a[i + 2]! * (1 - alpha)
    out[i + 3] = 255
  }
  return { data: out, compared }
}

export function analyze(screen: Pixels, reference: Pixels, ignore?: Uint8Array, threshold = 0.12): Analysis {
  const { width: w, height: h } = screen
  const opaque = new Uint8ClampedArray(screen.data)
  for (let i = 3; i < opaque.length; i += 4) opaque[i] = 255
  const ref = composite({ ...screen, data: opaque }, reference, ignore)
  const out = new Uint8ClampedArray(w * h * 4)
  pixelmatch(opaque, ref.data, out, w, h, { threshold, includeAA: false, diffMask: true, diffColor: [255, 0, 0] })
  const mask = new Uint8Array(w * h)
  let different = 0
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    if (out[i + 3] === 255 && out[i] === 255 && out[i + 1] === 0) {
      mask[p] = 1
      different++
    }
  }
  const regions = findRegions(mask, w, h).map((b) => Object.assign(b, { kind: classify(opaque, ref.data, w, h, b) }))
  return {
    width: w,
    height: h,
    compared: ref.compared,
    different,
    match: ref.compared > 0 ? 1 - different / ref.compared : 1,
    regions,
    mask,
  }
}

/** Groups differing pixels into boxes: cells with a few of them, joined across one-cell gaps. */
export function findRegions(mask: Uint8Array, w: number, h: number): (Box & { pixels: number })[] {
  const cw = Math.ceil(w / cell)
  const ch = Math.ceil(h / cell)
  const counts = new Uint32Array(cw * ch)
  for (let y = 0; y < h; y++) {
    const row = y * w
    const crow = Math.floor(y / cell) * cw
    for (let x = 0; x < w; x++) if (mask[row + x]) counts[crow + Math.floor(x / cell)]!++
  }
  const hot = (c: number) => counts[c]! >= 2
  const label = new Int32Array(cw * ch).fill(-1)
  const boxes: (Box & { pixels: number })[] = []
  const stack: number[] = []
  for (let start = 0; start < counts.length; start++) {
    if (!hot(start) || label[start]! >= 0) continue
    const id = boxes.length
    let x0 = cw
    let y0 = ch
    let x1 = 0
    let y1 = 0
    let pixels = 0
    label[start] = id
    stack.push(start)
    while (stack.length) {
      const c = stack.pop() as number
      const cx = c % cw
      const cy = (c - cx) / cw
      x0 = Math.min(x0, cx)
      y0 = Math.min(y0, cy)
      x1 = Math.max(x1, cx)
      y1 = Math.max(y1, cy)
      pixels += counts[c]!
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue
          const n = ny * cw + nx
          if (hot(n) && label[n]! < 0) {
            label[n] = id
            stack.push(n)
          }
        }
      }
    }
    boxes.push({ x: x0 * cell, y: y0 * cell, w: (x1 + 1) * cell - x0 * cell, h: (y1 + 1) * cell - y0 * cell, pixels })
  }
  return boxes
    .filter((b) => b.pixels >= minPixels)
    .map((b) => Object.assign(b, { w: Math.min(b.w, w - b.x), h: Math.min(b.h, h - b.y) }))
    .toSorted((a, b) => b.pixels - a.pixels)
}

function hex(d: Uint8ClampedArray, w: number, b: Box) {
  const sums = [0, 0, 0]
  let n = 0
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = (y * w + x) * 4
      sums[0]! += d[i]!
      sums[1]! += d[i + 1]!
      sums[2]! += d[i + 2]!
      n++
    }
  }
  return `#${sums
    .map((s) =>
      Math.round(s / Math.max(1, n))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`
}

function spread(d: Uint8ClampedArray, w: number, b: Box) {
  let sum = 0
  let sq = 0
  let n = 0
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      const l = luma(d, (y * w + x) * 4)
      sum += l
      sq += l * l
      n++
    }
  }
  const mean = sum / Math.max(1, n)
  return Math.sqrt(Math.max(0, sq / Math.max(1, n) - mean * mean))
}

function edges(d: Uint8ClampedArray, w: number, b: Box) {
  const out = new Uint8Array(b.w * b.h)
  for (let y = b.y + 1; y < b.y + b.h - 1; y++) {
    for (let x = b.x + 1; x < b.x + b.w - 1; x++) {
      const i = (y * w + x) * 4
      let g = 0
      for (let c = 0; c < 3; c++) {
        g += Math.abs(d[i + 4 + c]! - d[i - 4 + c]!) + Math.abs(d[i + w * 4 + c]! - d[i - w * 4 + c]!)
      }
      if (g > 90) out[(y - b.y) * b.w + (x - b.x)] = 1
    }
  }
  return out
}

/** How many pixels of the box still differ with the reference moved by (dx, dy). */
function misses(
  screen: Uint8ClampedArray,
  ref: Uint8ClampedArray,
  w: number,
  h: number,
  b: Box,
  dx: number,
  dy: number,
  step: number,
) {
  let n = 0
  for (let y = b.y; y < b.y + b.h; y += step) {
    const ry = y - dy
    if (ry < 0 || ry >= h) continue
    for (let x = b.x; x < b.x + b.w; x += step) {
      const rx = x - dx
      if (rx < 0 || rx >= w) continue
      if (Math.abs(luma(screen, (y * w + x) * 4) - luma(ref, (ry * w + rx) * 4)) > 24) n++
    }
  }
  return n
}

/** Guesses what kind of difference a box holds: a shifted element, another colour, something missing or extra. */
export function classify(
  screen: Uint8ClampedArray,
  ref: Uint8ClampedArray,
  w: number,
  h: number,
  box: Box,
): RegionKind {
  const b = {
    x: Math.max(0, box.x - 4),
    y: Math.max(0, box.y - 4),
    w: 0,
    h: 0,
  }
  b.w = Math.min(w, box.x + box.w + 4) - b.x
  b.h = Math.min(h, box.y + box.h + 4) - b.y
  const step = b.w * b.h > 120_000 ? 3 : b.w * b.h > 30_000 ? 2 : 1
  const base = misses(screen, ref, w, h, b, 0, 0, step)
  if (b.w * b.h <= 400_000 && base > 0) {
    let best = { n: base, dx: 0, dy: 0 }
    for (let dy = -maxShift; dy <= maxShift; dy++) {
      for (let dx = -maxShift; dx <= maxShift; dx++) {
        if (dx === 0 && dy === 0) continue
        const n = misses(screen, ref, w, h, b, dx, dy, step)
        if (n < best.n || (n === best.n && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) {
          best = { n, dx, dy }
        }
      }
    }
    if ((best.dx || best.dy) && best.n <= base * 0.35) return { type: "shift", dx: best.dx, dy: best.dy }
  }
  const s = spread(screen, w, b)
  const r = spread(ref, w, b)
  if (r > 12 && s < 4) return { type: "missing" }
  if (s > 12 && r < 4) return { type: "extra" }
  const es = edges(screen, w, b)
  const er = edges(ref, w, b)
  let both = 0
  let either = 0
  for (let i = 0; i < es.length; i++) {
    if (es[i] && er[i]) both++
    if (es[i] || er[i]) either++
  }
  if (either === 0 || both / either > 0.6)
    return { type: "color", screen: hex(screen, w, b), reference: hex(ref, w, b) }
  return { type: "differs" }
}

const motionCell = 16

/**
 * Areas that changed between frames taken moments apart, such as a video
 * under the interface: 1 for every pixel of a 16 px cell where enough moved,
 * grown by one cell.
 */
export function motionMask(frames: Pixels[]): Uint8Array | null {
  if (frames.length < 2) return null
  const { width: w, height: h } = frames[0]!
  if (frames.some((f) => f.width !== w || f.height !== h)) return null
  const cw = Math.ceil(w / motionCell)
  const ch = Math.ceil(h / motionCell)
  const moved = new Uint32Array(cw * ch)
  for (let f = 1; f < frames.length; f++) {
    const a = frames[f - 1]!.data
    const b = frames[f]!.data
    for (let y = 0; y < h; y++) {
      const crow = Math.floor(y / motionCell) * cw
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (Math.abs(luma(a, i) - luma(b, i)) > 10) moved[crow + Math.floor(x / motionCell)]!++
      }
    }
  }
  const area = motionCell * motionCell * (frames.length - 1)
  const cells = new Uint8Array(cw * ch)
  let any = false
  for (let c = 0; c < cells.length; c++) {
    if (moved[c]! / area > 0.06) {
      cells[c] = 1
      any = true
    }
  }
  if (!any) return null
  const grown = new Uint8Array(cw * ch)
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      if (!cells[cy * cw + cx]) continue
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx >= 0 && ny >= 0 && nx < cw && ny < ch) grown[ny * cw + nx] = 1
        }
      }
    }
  }
  const mask = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const crow = Math.floor(y / motionCell) * cw
    for (let x = 0; x < w; x++) mask[y * w + x] = grown[crow + Math.floor(x / motionCell)]!
  }
  return mask
}

/** Marks every pixel inside the boxes. */
export function boxMask(w: number, h: number, boxes: Box[], into = new Uint8Array(w * h)) {
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(b.x))
    const y0 = Math.max(0, Math.floor(b.y))
    const x1 = Math.min(w, Math.ceil(b.x + b.w))
    const y1 = Math.min(h, Math.ceil(b.y + b.h))
    for (let y = y0; y < y1; y++) into.fill(1, y * w + x0, y * w + x1)
  }
  return into
}

export function describe(kind: RegionKind, toDevice = 1) {
  switch (kind.type) {
    case "shift": {
      const parts = []
      const dx = Math.round(kind.dx * toDevice)
      const dy = Math.round(kind.dy * toDevice)
      if (dx) parts.push(`${Math.abs(dx)} px ${dx > 0 ? "right" : "left"}`)
      if (dy) parts.push(`${Math.abs(dy)} px ${dy > 0 ? "down" : "up"}`)
      return `Shifted ${parts.join(", ") || "under 1 px"}`
    }
    case "color":
      return `Colour ${kind.screen} instead of ${kind.reference}`
    case "missing":
      return "Missing on the screen"
    case "extra":
      return "Not in the reference"
    default:
      return "Differs"
  }
}
