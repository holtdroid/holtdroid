import type { CutoutShape, Display } from "@/api/client"

export type Rect = { x: number; y: number; w: number; h: number }

export function screenDp(d: Pick<Display, "width" | "height" | "dpi">) {
  return { w: (d.width * 160) / d.dpi, h: (d.height * 160) / d.dpi }
}

export function shapeRect(s: CutoutShape, widthDp: number): Rect {
  const w = s.width
  const h = s.height || s.width
  const offset = s.offset ?? 0
  const cx = s.align === "left" ? offset : s.align === "right" ? widthDp - offset : widthDp / 2
  return { x: cx - w / 2, y: s.top, w, h }
}

export function shapePath(s: CutoutShape, widthDp: number) {
  const { x, y, w, h } = shapeRect(s, widthDp)
  if (s.kind === "circle") {
    return `M${x} ${y + h / 2} a${w / 2} ${h / 2} 0 1 0 ${w} 0 a${w / 2} ${h / 2} 0 1 0 ${-w} 0 Z`
  }
  if (s.kind === "pill") {
    const r = Math.min(w, h) / 2
    return `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`
  }
  const r = s.kind === "drop" ? Math.min(w / 2, h) : Math.min(h * 0.55, w / 4)
  const top = y > 0.5 ? y : y - 2
  return `M${x} ${top} H${x + w} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} Z`
}

export function cornerPath(w: number, h: number, radius: number) {
  const r = Math.min(radius, w / 2, h / 2)
  if (r <= 0) return ""
  return `M0 0H${w}V${h}H0Z M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`
}
