import { agentClient, type FigmaLayer, type FigmaLayers, type UIHierarchy, type UINode, unwrap } from "@/api/client"
import type { Box, Size } from "@/lib/pixel-perfect/geometry"

export type NativeView = UINode & {
  index: number
  /** Analysed pixels. */
  box: Box
  label: string
  /** The ids of its ancestors and itself, outermost first. */
  path: string
}

export type DesignLayer = FigmaLayer & {
  index: number
  /** Analysed pixels. */
  box: Box
  /** Its parents' names and its own, outermost first. */
  path: string
}

export async function probeViews(provider: string, id: string): Promise<UIHierarchy> {
  return unwrap(agentClient(provider, id).GET("/v1/device/ui"))
}

function shortId(resourceId: string | undefined) {
  if (!resourceId) return ""
  const i = resourceId.indexOf(":id/")
  return i >= 0 ? resourceId.slice(i + 4) : resourceId
}

export function viewLabel(n: Pick<UINode, "class" | "resourceId">) {
  const cls = n.class.slice(n.class.lastIndexOf(".") + 1) || "View"
  const id = shortId(n.resourceId)
  return id ? `${cls}#${id}` : cls
}

function clipBox(b: Box, size: Size): Box | null {
  const x0 = Math.max(0, b.x)
  const y0 = Math.max(0, b.y)
  const x1 = Math.min(size.w, b.x + b.w)
  const y1 = Math.min(size.h, b.y + b.h)
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

/** The views as they lie over the analysed pixels; device pixels are divided by toDevice. */
export function placeViews(h: UIHierarchy, toDevice: number, size: Size): NativeView[] {
  const out: NativeView[] = []
  const paths: string[] = []
  h.nodes.forEach((n, index) => {
    const id = shortId(n.resourceId)
    const parent = n.parent >= 0 ? (paths[n.parent] ?? "") : ""
    paths[index] = id ? (parent ? `${parent} › ${id}` : id) : parent
    const box = clipBox({ x: n.x / toDevice, y: n.y / toDevice, w: n.w / toDevice, h: n.h / toDevice }, size)
    if (!box || box.w * box.h >= size.w * size.h * 0.98) return
    out.push({ ...n, index, box, label: viewLabel(n), path: paths[index] ?? "" })
  })
  return out
}

/** The layers of a Figma frame as they lie over the analysed pixels, the frame placed at `placed`. */
export function placeLayers(l: FigmaLayers, placed: Box, size: Size): DesignLayer[] {
  if (l.width <= 0 || l.height <= 0) return []
  const kx = placed.w / l.width
  const ky = placed.h / l.height
  const names: string[] = []
  const out: DesignLayer[] = []
  l.layers.forEach((layer, index) => {
    const parent = layer.parent >= 0 ? names[layer.parent] : undefined
    names[index] = parent ? `${parent} › ${layer.name}` : layer.name
    const box = clipBox(
      { x: placed.x + layer.x * kx, y: placed.y + layer.y * ky, w: layer.w * kx, h: layer.h * ky },
      size,
    )
    if (box) out.push({ ...layer, index, box, path: names[index] ?? layer.name })
  })
  return out
}

function intersect(a: Box, b: Box) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** The item that fits a region best: most of the region inside it and most of it inside the region. */
export function matchRegion<T extends { box: Box }>(region: Box, items: T[]): T | null {
  const area = region.w * region.h
  let best: { item: T; score: number } | null = null
  for (const item of items) {
    const inter = intersect(region, item.box)
    if (!inter) continue
    const score = (inter / area) * (inter / (item.box.w * item.box.h))
    if (
      !best ||
      score > best.score ||
      (score === best.score && item.box.w * item.box.h < best.item.box.w * best.item.box.h)
    ) {
      best = { item, score }
    }
  }
  return best && best.score > 0.04 ? best.item : null
}

/** The item drawn where a design layer is: the best overlap of the two boxes, if they mostly agree. */
export function counterpart<T extends { box: Box }>(layer: Box, items: T[]): T | null {
  let best: { item: T; iou: number } | null = null
  for (const item of items) {
    const inter = intersect(layer, item.box)
    if (!inter) continue
    const iou = inter / (layer.w * layer.h + item.box.w * item.box.h - inter)
    if (!best || iou > best.iou) best = { item, iou }
  }
  return best && best.iou > 0.45 ? best.item : null
}

export type Measure = { label: string; design: number; actual: number }

/**
 * Where an element differs from its design layer, in the design's units (dp
 * for a phone frame) from the frame's corner: edges and size off by at least
 * half a unit.
 */
export function measure(layer: Box, actual: Box, frame: Box, unit: number): Measure[] {
  const d = (v: number) => Math.round((v / unit) * 2) / 2
  const rows: Measure[] = [
    { label: "left", design: d(layer.x - frame.x), actual: d(actual.x - frame.x) },
    { label: "top", design: d(layer.y - frame.y), actual: d(actual.y - frame.y) },
    { label: "width", design: d(layer.w), actual: d(actual.w) },
    { label: "height", design: d(layer.h), actual: d(actual.h) },
  ]
  return rows.filter((r) => Math.abs(r.design - r.actual) >= 0.5)
}
