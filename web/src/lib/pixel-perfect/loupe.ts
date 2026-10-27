import type { Pixels } from "@/lib/pixel-perfect/diff"

function luma(p: Pixels, x: number, y: number) {
  const i = (y * p.width + x) * 4
  return 0.299 * p.data[i]! + 0.587 * p.data[i + 1]! + 0.114 * p.data[i + 2]!
}

/**
 * The pixel boundary near (x, y) where the picture changes most across the
 * axis, within radius pixels: x for a vertical edge, y for a horizontal one.
 * Null when nothing there stands out, so a flat area doesn't pull the pointer.
 */
export function nearestEdge(p: Pixels, x: number, y: number, axis: "x" | "y", radius = 4, min = 24): number | null {
  const cx = Math.round(x)
  const cy = Math.round(y)
  let best: { at: number; strength: number } | null = null
  for (let b = (axis === "x" ? cx : cy) - radius; b <= (axis === "x" ? cx : cy) + radius; b++) {
    let sum = 0
    let n = 0
    for (let d = -2; d <= 2; d++) {
      const [x0, y0, x1, y1] = axis === "x" ? [b - 1, cy + d, b, cy + d] : [cx + d, b - 1, cx + d, b]
      if (x0 < 0 || y0 < 0 || x1 >= p.width || y1 >= p.height || x0 >= p.width || y0 >= p.height || x1 < 0 || y1 < 0)
        continue
      sum += Math.abs(luma(p, x1, y1) - luma(p, x0, y0))
      n++
    }
    const strength = n ? sum / n : 0
    const closer =
      best &&
      strength === best.strength &&
      Math.abs(b - (axis === "x" ? x : y)) < Math.abs(best.at - (axis === "x" ? x : y))
    if (!best || strength > best.strength || closer) best = { at: b, strength }
  }
  return best && best.strength >= min ? best.at : null
}

/** A point moved onto pixel boundaries, and onto a nearby edge of the picture when there is one. */
export function snapPoint(p: Pixels | null, x: number, y: number, scale: number, edges: boolean) {
  const at = { x: Math.round(x), y: Math.round(y) }
  if (!p || !edges) return at
  const ex = nearestEdge(p, x * scale, y * scale, "x")
  const ey = nearestEdge(p, x * scale, y * scale, "y")
  return { x: ex === null ? at.x : Math.round(ex / scale), y: ey === null ? at.y : Math.round(ey / scale) }
}

/** A w×h window of the picture at (x0, y0); transparent where it falls outside. */
export function cropPixels(p: Pixels, x0: number, y0: number, w: number, h: number): Pixels {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = y0 + y
    if (sy < 0 || sy >= p.height) continue
    for (let x = 0; x < w; x++) {
      const sx = x0 + x
      if (sx < 0 || sx >= p.width) continue
      const i = (sy * p.width + sx) * 4
      out.set(p.data.subarray(i, i + 4), (y * w + x) * 4)
    }
  }
  return { data: out, width: w, height: h }
}
