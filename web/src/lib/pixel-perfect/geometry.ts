export type Size = { w: number; h: number }
export type Box = { x: number; y: number; w: number; h: number }
export type Placement = { x: number; y: number; scale: number }

/** Screen pixels per reference pixel at scale 1: the full width, unless that overflows the height. */
export function fitScale(screen: Size, image: Size) {
  return Math.min(screen.w / image.w, screen.h / image.h)
}

/**
 * Where the reference lands, in screen pixels: fitted to the work area (the
 * whole screen when it has no corner), top-aligned, centred when the height
 * limits it.
 */
export function placeReference(area: Size & { x?: number; y?: number }, image: Size, p: Placement): Box {
  const fit = fitScale(area, image)
  const k = fit * p.scale
  return {
    x: (area.x ?? 0) + (area.w - image.w * fit) / 2 + p.x * k,
    y: (area.y ?? 0) + p.y * k,
    w: image.w * k,
    h: image.h * k,
  }
}

/** A box given as fractions of the reference, mapped onto the screen. */
export function onScreen(placed: Box, r: Box): Box {
  return { x: placed.x + r.x * placed.w, y: placed.y + r.y * placed.h, w: r.w * placed.w, h: r.h * placed.h }
}

/** A box in screen pixels as fractions of the reference, clipped to it; null when it misses the reference. */
export function onReference(placed: Box, r: Box): Box | null {
  const x0 = Math.max(0, (r.x - placed.x) / placed.w)
  const y0 = Math.max(0, (r.y - placed.y) / placed.h)
  const x1 = Math.min(1, (r.x + r.w - placed.x) / placed.w)
  const y1 = Math.min(1, (r.y + r.h - placed.y) / placed.h)
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Two corners in any order as a box. */
export function spanBox(ax: number, ay: number, bx: number, by: number): Box {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) }
}

export function percentBox(b: Box, screen: Size) {
  return {
    left: `${(b.x / screen.w) * 100}%`,
    top: `${(b.y / screen.h) * 100}%`,
    width: `${(b.w / screen.w) * 100}%`,
    height: `${(b.h / screen.h) * 100}%`,
  }
}
