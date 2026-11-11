export type Rect = { top: number; left: number; bottom: number; right: number }

export type Offset = { top: number; left: number }

function axis(start: number, end: number, from: number, to: number, scroll: number, max: number, margin: number) {
  const size = to - from
  const a = start - from
  const b = end - from
  if (a >= margin && b <= size - margin) return scroll
  const len = b - a
  const lead = len > size - 2 * margin ? margin : Math.max(margin, (size - len) / 3)
  return Math.min(Math.max(0, max), Math.max(0, Math.round(scroll + a - lead)))
}

export function reveal(target: Rect, view: Rect, scroll: Offset, max: Offset, margin = 8): Offset {
  return {
    top: axis(target.top, target.bottom, view.top, view.bottom, scroll.top, max.top, margin),
    left: axis(target.left, target.right, view.left, view.right, scroll.left, max.left, margin),
  }
}

export function clip(r: Rect, bounds: Rect): Rect | null {
  const out = {
    top: Math.max(r.top, bounds.top),
    left: Math.max(r.left, bounds.left),
    bottom: Math.min(r.bottom, bounds.bottom),
    right: Math.min(r.right, bounds.right),
  }
  return out.bottom - out.top < 1 || out.right - out.left < 1 ? null : out
}
