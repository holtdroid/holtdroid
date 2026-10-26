import { agentClient, type DevToolsTarget, sessionBase, unwrap } from "@/api/client"
import { CdpSession, targetSocket } from "@/lib/cdp"
import { pixelsOf } from "@/lib/pixel-perfect/capture"
import type { Pixels } from "@/lib/pixel-perfect/diff"
import type { Box } from "@/lib/pixel-perfect/geometry"

export const styleProps = [
  "display",
  "position",
  "width",
  "height",
  "margin",
  "padding",
  "gap",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "color",
  "background-color",
  "border",
  "border-radius",
  "opacity",
  "transform",
] as const

export type PageElement = {
  /** Its place in document.querySelectorAll("*") when the snapshot was taken. */
  index: number
  tag: string
  label: string
  selector: string
  text: string
  /** CSS pixels, relative to the layout viewport. */
  rect: Box
  styles: Record<string, string>
}

export type WebViewProbe = {
  target: DevToolsTarget
  socket: string
  dpr: number
  /** The visual viewport in CSS pixels: offset from the layout viewport, size, pinch zoom. */
  viewport: { x: number; y: number; w: number; h: number; scale: number }
  shot: ImageBitmap
  elements: PageElement[]
}

export type ScreenElement = PageElement & { box: Box }

export type WebViewMatch = {
  target: DevToolsTarget
  socket: string
  /** The WebView on the analysed screen. */
  bounds: Box
  /** Analysed pixels per CSS pixel. */
  scale: number
  elements: ScreenElement[]
  /** Video, canvas and frames, which the comparison can skip. */
  media: Box[]
}

const media = new Set(["video", "canvas", "iframe", "embed", "object"])

const snapshot = `(() => {
  const props = ${JSON.stringify(styleProps)}
  const vv = window.visualViewport
  const view = vv ? [vv.offsetLeft, vv.offsetTop, vv.width, vv.height, vv.scale] : [0, 0, innerWidth, innerHeight, 1]
  const [ox, oy, w, h] = view
  const selector = (el) => {
    const parts = []
    for (let e = el; e && e.nodeType === 1 && parts.length < 8; e = e.parentElement) {
      if (e.id) { parts.unshift("#" + CSS.escape(e.id)); break }
      let part = e.localName
      const same = e.parentElement ? [...e.parentElement.children].filter((c) => c.localName === e.localName) : []
      if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(e) + 1) + ")"
      parts.unshift(part)
    }
    return parts.join(" > ")
  }
  const all = document.querySelectorAll("*")
  const items = []
  for (let i = 0; i < all.length && items.length < 3000; i++) {
    const el = all[i]
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0 || r.right <= ox || r.bottom <= oy || r.left >= ox + w || r.top >= oy + h) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === "hidden" || cs.opacity === "0") continue
    let text = ""
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.textContent
    const cls = typeof el.className === "string" ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 3) : []
    items.push([i, el.localName, el.id, cls.join("."), text.trim().replace(/\\s+/g, " ").slice(0, 60), r.left, r.top, r.width, r.height,
      props.map((p) => cs.getPropertyValue(p)), selector(el)])
  }
  return { hidden: document.visibilityState === "hidden", dpr: devicePixelRatio, view, items }
})()`

type Snapshot = {
  hidden: boolean
  dpr: number
  view: [number, number, number, number, number]
  items: [number, string, string, string, string, number, number, number, number, string[], string][]
}

async function probe(base: string, target: DevToolsTarget): Promise<WebViewProbe | null> {
  const socket = targetSocket(base, target)
  const s = new CdpSession(socket)
  try {
    const ev = await s.send("Runtime.evaluate", { expression: snapshot, returnByValue: true }, 8_000)
    const value = (ev.result as { value?: Snapshot } | undefined)?.value
    if (!value || value.hidden || ev.exceptionDetails) return null
    const shot = await s.send("Page.captureScreenshot", { format: "png" }, 6_000)
    if (typeof shot.data !== "string") return null
    const blob = await (await fetch(`data:image/png;base64,${shot.data}`)).blob()
    const [x, y, w, h, scale] = value.view
    return {
      target,
      socket,
      dpr: value.dpr,
      viewport: { x, y, w, h, scale },
      shot: await createImageBitmap(blob),
      elements: value.items.map(([index, tag, id, cls, text, rx, ry, rw, rh, styles, selector]) => ({
        index,
        tag,
        label: tag + (id ? `#${id}` : "") + (cls ? `.${cls}` : ""),
        selector,
        text,
        rect: { x: rx, y: ry, w: rw, h: rh },
        styles: Object.fromEntries(styleProps.map((p, i) => [p, styles[i] ?? ""])),
      })),
    }
  } finally {
    s.close()
  }
}

/** Every visible WebView page of the session with its DOM and a screenshot of it; ones that fail are left out. */
export async function probeWebViews(provider: string, id: string): Promise<WebViewProbe[]> {
  const targets = await unwrap(agentClient(provider, id).GET("/v1/devtools/targets"))
  const base = sessionBase(provider, id)
  const pages = targets.items.filter((t) => t.type === "page").slice(0, 4)
  const found = await Promise.all(pages.map((t) => probe(base, t).catch(() => null)))
  return found.filter((p): p is WebViewProbe => p !== null)
}

function lumas(p: Pixels) {
  const out = new Float32Array(p.width * p.height)
  const d = p.data
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!
  return out
}

function shrink(l: Float32Array, w: number, h: number, f: number) {
  const sw = Math.floor(w / f)
  const sh = Math.floor(h / f)
  const out = new Float32Array(sw * sh)
  for (let y = 0; y < sh * f; y++) {
    const row = Math.floor(y / f) * sw
    for (let x = 0; x < sw * f; x++) out[row + Math.floor(x / f)]! += l[y * w + x]!
  }
  for (let i = 0; i < out.length; i++) out[i]! /= f * f
  return { l: out, w: sw, h: sh }
}

type Plane = { l: Float32Array; w: number; h: number }

function search(s: Plane, v: Plane, xs: [number, number], ys: [number, number], tolerance: number) {
  const cols = Math.min(48, v.w)
  const rows = Math.min(96, v.h)
  const points: [number, number][] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = Math.floor(((c + 0.5) * v.w) / cols)
      const py = Math.floor(((r + 0.5) * v.h) / rows)
      points.push([px, py])
    }
  }
  let best = { x: xs[0], y: ys[0], n: points.length + 1 }
  for (let y = Math.max(0, ys[0]); y <= Math.min(s.h - v.h, ys[1]); y++) {
    for (let x = Math.max(0, xs[0]); x <= Math.min(s.w - v.w, xs[1]); x++) {
      let n = 0
      for (const [px, py] of points) {
        if (Math.abs(s.l[(y + py) * s.w + x + px]! - v.l[py * v.w + px]!) > tolerance && ++n >= best.n) break
      }
      if (n < best.n) best = { x, y, n }
    }
  }
  return { x: best.x, y: best.y, score: best.n / points.length }
}

/**
 * Where a smaller picture sits inside a bigger one: a search over both
 * scaled down, then a pixel-exact one around the best spot. The score is the
 * share of samples that disagree, so native views drawn over part of a
 * WebView don't hide it.
 */
export function findOffset(screen: Pixels, view: Pixels): { x: number; y: number; score: number } | null {
  const W = screen.width
  const H = screen.height
  const w = view.width
  const h = view.height
  if (w > W || h > H || w < 8 || h < 8) return null
  const s = { l: lumas(screen), w: W, h: H }
  const v = { l: lumas(view), w, h }
  const f = Math.max(1, Math.round(W / 180))
  if (f === 1) return search(s, v, [0, W - w], [0, H - h], 20)
  const coarse = search(shrink(s.l, W, H, f), shrink(v.l, w, h, f), [0, W], [0, H], 14)
  return search(s, v, [coarse.x * f - f, coarse.x * f + f], [coarse.y * f - f, coarse.y * f + f], 20)
}

function intersect(a: Box, b: Box) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** The element that fits a region best: most of the region inside it and most of it inside the region. */
export function matchRegion(region: Box, elements: ScreenElement[]): ScreenElement | null {
  const area = region.w * region.h
  let best: { el: ScreenElement; score: number } | null = null
  for (const el of elements) {
    const inter = intersect(region, el.box)
    if (!inter) continue
    const score = (inter / area) * (inter / (el.box.w * el.box.h))
    if (!best || score > best.score || (score === best.score && el.box.w * el.box.h < best.el.box.w * best.el.box.h)) {
      best = { el, score }
    }
  }
  return best && best.score > 0.04 ? best.el : null
}

/** Finds which probed WebView is on the screen and lays its elements over the analysed pixels. */
export async function matchWebView(
  probes: WebViewProbe[],
  screen: Pixels,
  toDevice: number,
): Promise<WebViewMatch | null> {
  let best: { probe: WebViewProbe; x: number; y: number; k: number; score: number } | null = null
  for (const p of probes) {
    const k = (p.dpr * p.viewport.scale) / toDevice
    const size = { w: Math.round(p.viewport.w * k), h: Math.round(p.viewport.h * k) }
    if (size.w > screen.width + 2 || size.h > screen.height + 2) continue
    size.w = Math.min(size.w, screen.width)
    size.h = Math.min(size.h, screen.height)
    const found = findOffset(screen, await pixelsOf(p.shot, size))
    if (found && found.score < 0.3 && (!best || found.score < best.score)) best = { probe: p, ...found, k }
  }
  if (!best) return null
  const { probe: p, x, y, k } = best
  const bounds = { x, y, w: p.viewport.w * k, h: p.viewport.h * k }
  const elements: ScreenElement[] = []
  for (const el of p.elements) {
    const raw = {
      x: x + (el.rect.x - p.viewport.x) * k,
      y: y + (el.rect.y - p.viewport.y) * k,
      w: el.rect.w * k,
      h: el.rect.h * k,
    }
    const x0 = Math.max(raw.x, bounds.x)
    const y0 = Math.max(raw.y, bounds.y)
    const x1 = Math.min(raw.x + raw.w, bounds.x + bounds.w)
    const y1 = Math.min(raw.y + raw.h, bounds.y + bounds.h)
    if (x1 > x0 && y1 > y0) elements.push({ ...el, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } })
  }
  return {
    target: p.target,
    socket: p.socket,
    bounds,
    scale: k,
    elements,
    media: elements.filter((e) => media.has(e.tag)).map((e) => e.box),
  }
}

/** Shows an element on the device the way DevTools does when you point at it; null hides it. */
export class Highlighter {
  #session: CdpSession | null = null
  #socket = ""
  #ready: Promise<unknown> | null = null

  async show(socket: string, index: number | null, tag?: string) {
    if (index === null) {
      if (this.#session && !this.#session.closed)
        await this.#session.send("Overlay.hideHighlight").catch(() => undefined)
      return
    }
    if (!this.#session || this.#session.closed || this.#socket !== socket) {
      this.#session?.close()
      this.#session = new CdpSession(socket)
      this.#socket = socket
      const s = this.#session
      this.#ready = s.send("DOM.enable").then(() => s.send("Overlay.enable"))
    }
    const s = this.#session
    await this.#ready
    const found = await s.send("Runtime.evaluate", {
      expression: `(() => { const el = document.querySelectorAll("*")[${index}]; return el && el.localName === ${JSON.stringify(tag ?? "")} ? el : null })()`,
    })
    const objectId = (found.result as { objectId?: string } | undefined)?.objectId
    if (!objectId) return
    await s.send("Overlay.highlightNode", {
      objectId,
      highlightConfig: {
        showInfo: true,
        showStyles: true,
        contentColor: { r: 111, g: 168, b: 220, a: 0.45 },
        paddingColor: { r: 147, g: 196, b: 125, a: 0.45 },
        borderColor: { r: 255, g: 229, b: 153, a: 0.6 },
        marginColor: { r: 246, g: 178, b: 107, a: 0.45 },
      },
    })
  }

  close() {
    this.#session?.close()
    this.#session = null
  }
}
