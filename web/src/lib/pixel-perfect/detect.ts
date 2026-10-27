import type { UIHierarchy } from "@/api/client"
import type { Pixels } from "@/lib/pixel-perfect/diff"
import type { Box, Size } from "@/lib/pixel-perfect/geometry"
import type { Insets } from "@/lib/pixel-perfect/layout"

export type AreaCandidate = {
  label: string
  /** Screen pixels of the screenshot the candidate was found on. */
  box: Box
}

function near(d: Uint8ClampedArray, i: number, c: [number, number, number], tolerance: number) {
  return (
    Math.abs(d[i]! - c[0]) <= tolerance &&
    Math.abs(d[i + 1]! - c[1]) <= tolerance &&
    Math.abs(d[i + 2]! - c[2]) <= tolerance
  )
}

/** The commonest colour of a line of pixels, to 16 levels per channel. */
function dominant(d: Uint8ClampedArray, indices: number[]): [number, number, number] {
  const counts = new Map<number, { n: number; c: [number, number, number] }>()
  let best: { n: number; c: [number, number, number] } | null = null
  for (const i of indices) {
    const key = ((d[i]! >> 4) << 8) | ((d[i + 1]! >> 4) << 4) | (d[i + 2]! >> 4)
    const e = counts.get(key) ?? { n: 0, c: [d[i]!, d[i + 1]!, d[i + 2]!] }
    e.n++
    counts.set(key, e)
    if (!best || e.n > best.n) best = e
  }
  return best?.c ?? [0, 0, 0]
}

/**
 * How many lines from one edge are a plain band of the edge's own colour:
 * at least share of each line within tolerance of it, so a camera hole or
 * a few status icons in a black bar don't stop it.
 */
function band(p: Pixels, side: "top" | "bottom" | "left" | "right", share: number, tolerance: number) {
  const { width: w, height: h, data } = p
  const horizontal = side === "top" || side === "bottom"
  const lines = horizontal ? h : w
  const length = horizontal ? w : h
  const step = Math.max(1, Math.floor(length / 400))
  const line = (n: number) => {
    const at = side === "top" || side === "left" ? n : lines - 1 - n
    const out: number[] = []
    for (let j = 0; j < length; j += step) out.push(horizontal ? (at * w + j) * 4 : (j * w + at) * 4)
    return out
  }
  const colour = dominant(data, line(0))
  let n = 0
  for (; n < lines / 2; n++) {
    const idx = line(n)
    let ok = 0
    for (const i of idx) if (near(data, i, colour, tolerance)) ok++
    if (ok / idx.length < share) break
  }
  return n
}

/**
 * The screen less the plain bands along its edges, such as black bars above
 * and below a letterboxed game; null when there are none or they would leave
 * less than a third of the screen.
 */
export function contentByColour(p: Pixels, share = 0.9, tolerance = 18): Box | null {
  const top = band(p, "top", share, tolerance)
  const bottom = band(p, "bottom", share, tolerance)
  const left = band(p, "left", share, tolerance)
  const right = band(p, "right", share, tolerance)
  if (top + bottom + left + right === 0) return null
  const box = { x: left, y: top, w: p.width - left - right, h: p.height - top - bottom }
  return box.w * box.h >= (p.width * p.height) / 3 ? box : null
}

const contentClass = /WebView|SurfaceView|TextureView|VideoView|PlayerView/

/** The largest views that draw their own content (WebViews, players, games), biggest first. */
export function contentViews(h: UIHierarchy, screen: Size): AreaCandidate[] {
  return h.nodes
    .filter((n) => contentClass.test(n.class) && n.w * n.h >= screen.w * screen.h * 0.15)
    .toSorted((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, 2)
    .map((n) => ({ label: n.class.slice(n.class.lastIndexOf(".") + 1), box: { x: n.x, y: n.y, w: n.w, h: n.h } }))
}

/** The app's own window: the largest window root of its package. */
export function appWindow(h: UIHierarchy, pkg: string): Box | null {
  const win = h.nodes
    .filter((n) => n.parent < 0 && n.package === pkg && n.w > 0 && n.h > 0)
    .toSorted((a, b) => b.w * b.h - a.w * a.h)[0]
  return win ? { x: win.x, y: win.y, w: win.w, h: win.h } : null
}

/** A box on a screen of this size as insets in dp, d being pixels per dp. */
export function boxInsets(b: Box, screen: Size, d: number): Insets {
  const r = (v: number) => Math.max(0, Math.round(v / d))
  return { top: r(b.y), right: r(screen.w - b.x - b.w), bottom: r(screen.h - b.y - b.h), left: r(b.x) }
}

/** The candidates worth offering: inside the screen, not all of it, and each different in dp. */
export function distinctCandidates(found: AreaCandidate[], screen: Size, d: number) {
  const seen = new Set<string>()
  const out: (AreaCandidate & { insets: Insets })[] = []
  for (const c of found) {
    const insets = boxInsets(c.box, screen, d)
    const key = `${insets.top}:${insets.right}:${insets.bottom}:${insets.left}`
    if (key === "0:0:0:0" || seen.has(key)) continue
    seen.add(key)
    out.push({ ...c, insets })
  }
  return out
}
