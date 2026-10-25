import type { RecordingEvent } from "@/api/client"
import { md, sans } from "@/lib/recording/android"

type Point = { t: number; x: number; y: number }
type Gesture = { pointer: number; start: number; end: number; points: Point[] }

export type TouchDot = {
  x: number
  y: number
  /** ms since the finger lifted, 0 while it is down */
  age: number
  /** ms since it touched the screen */
  held: number
  trail: { x: number; y: number; age: number }[]
}

export type Overlay = { touches: TouchDot[]; key?: { name: string; age: number } }

const fade = 380
const trailSpan = 500
const keyShown = 900
const lostFinger = 1000
const ripple = 320
const keyNames: Record<string, string> = { back: "Back", home: "Home", recents: "Recents" }

/** The recording's touches and navigation keys, to show what was done on the screen at any time. */
export class TouchTrack {
  readonly gestures: Gesture[] = []
  readonly keys: { t: number; key: string }[] = []
  #maxEnd: number[] = []

  constructor(events: RecordingEvent[]) {
    const open = new Map<number, Gesture>()
    for (const e of events) {
      if (e.key) this.keys.push({ t: e.t, key: e.key })
      const touch = e.touch
      if (!touch) continue
      const p = { t: e.t, x: touch.x, y: touch.y }
      let g = open.get(touch.pointer)
      if (touch.action === "down" || !g) {
        if (g) this.#finish(g, open)
        g = { pointer: touch.pointer, start: e.t, end: e.t, points: [] }
        open.set(touch.pointer, g)
        this.gestures.push(g)
      }
      g.points.push(p)
      g.end = e.t
      if (touch.action === "up") open.delete(touch.pointer)
    }
    for (const g of open.values()) g.end = g.points.at(-1)!.t + lostFinger
    this.gestures.sort((a, b) => a.start - b.start)
    let max = 0
    this.#maxEnd = this.gestures.map((g) => (max = Math.max(max, g.end)))
  }

  #finish(g: Gesture, open: Map<number, Gesture>) {
    open.delete(g.pointer)
    g.end += 200
  }

  get empty() {
    return this.gestures.length === 0 && this.keys.length === 0
  }

  at(t: number): Overlay {
    const out: Overlay = { touches: [] }
    let lo = 0
    let hi = this.gestures.length - 1
    let last = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.gestures[mid]!.start <= t) {
        last = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    for (let i = last; i >= 0 && this.#maxEnd[i]! + fade >= t; i--) {
      const g = this.gestures[i]!
      if (g.end + fade < t) continue
      const upto = g.points.filter((p) => p.t <= t)
      const tip = upto.at(-1)
      if (!tip) continue
      out.touches.push({
        x: tip.x,
        y: tip.y,
        age: Math.max(0, t - g.end),
        held: t - g.start,
        trail: upto.filter((p) => t - p.t <= trailSpan).map((p) => ({ x: p.x, y: p.y, age: t - p.t })),
      })
    }
    for (let i = this.keys.length - 1; i >= 0; i--) {
      const k = this.keys[i]!
      if (k.t > t) continue
      if (t - k.t < keyShown) out.key = { name: keyNames[k.key] ?? k.key, age: t - k.t }
      break
    }
    return out
  }
}

/** Draws fingers, swipe trails and navigation keys over a screen at x, y of size w by h. */
export function drawOverlay(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, o: Overlay) {
  const r = Math.max(10, w * 0.045)
  ctx.save()
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  for (const t of o.touches) {
    const alpha = t.age > 0 ? 1 - t.age / fade : 1
    if (t.trail.length > 1) {
      for (let i = 1; i < t.trail.length; i++) {
        const a = t.trail[i - 1]!
        const b = t.trail[i]!
        ctx.globalAlpha = Math.max(0, 1 - b.age / trailSpan) * 0.4 * alpha
        ctx.strokeStyle = md.primary
        ctx.lineWidth = r * 1.1
        ctx.beginPath()
        ctx.moveTo(x + a.x * w, y + a.y * h)
        ctx.lineTo(x + b.x * w, y + b.y * h)
        ctx.stroke()
      }
    }
    const cx = x + t.x * w
    const cy = y + t.y * h
    if (t.held < ripple && t.age === 0) {
      const k = t.held / ripple
      ctx.globalAlpha = 0.55 * (1 - k)
      ctx.strokeStyle = md.primary
      ctx.lineWidth = Math.max(2, r * 0.12)
      ctx.beginPath()
      ctx.arc(cx, cy, r * (1 + k * 1.2), 0, Math.PI * 2)
      ctx.stroke()
    }
    if (t.age === 0) {
      ctx.globalAlpha = 0.5
      ctx.fillStyle = md.primary
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 0.95
      ctx.strokeStyle = md.onPrimaryContainer
      ctx.lineWidth = Math.max(2, r * 0.1)
      ctx.stroke()
    } else {
      ctx.globalAlpha = 0.7 * alpha
      ctx.strokeStyle = md.primary
      ctx.lineWidth = Math.max(2, r * 0.1)
      ctx.beginPath()
      ctx.arc(cx, cy, r * (1 + (t.age / fade) * 0.7), 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  if (o.key) {
    const alpha = Math.min(1, (keyShown - o.key.age) / 300)
    const size = Math.max(14, w * 0.04)
    ctx.font = `500 ${size}px ${sans}`
    const tw = ctx.measureText(o.key.name).width
    const bw = tw + size * 2
    const bh = size * 2.1
    ctx.globalAlpha = alpha * 0.92
    ctx.fillStyle = md.containerHighest
    ctx.beginPath()
    ctx.roundRect(x + (w - bw) / 2, y + h - bh - h * 0.09, bw, bh, bh / 2)
    ctx.fill()
    ctx.globalAlpha = alpha
    ctx.fillStyle = md.onSurface
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(o.key.name, x + w / 2, y + h - bh / 2 - h * 0.09)
  }
  ctx.restore()
}
