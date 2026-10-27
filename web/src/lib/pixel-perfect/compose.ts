import type { FigmaComponent, FigmaLayers } from "@/api/client"
import type { Box } from "@/lib/pixel-perfect/geometry"

/** Whether the reference has to be redrawn from its components to leave some out. */
export function needsComposite(layers: FigmaLayers | null, hidden: readonly string[]) {
  return !!layers?.composable && layers.components.some((c) => hidden.includes(c.id))
}

/** A component's place as fractions of the frame, the way ignored areas are kept. */
export function componentFraction(layers: FigmaLayers, c: Pick<FigmaComponent, "x" | "y" | "w" | "h">): Box {
  const x0 = Math.max(0, c.x / layers.width)
  const y0 = Math.max(0, c.y / layers.height)
  const x1 = Math.min(1, (c.x + c.w) / layers.width)
  const y1 = Math.min(1, (c.y + c.h) / layers.height)
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

/** The hidden components' places, for the comparison to skip. */
export function hiddenFractions(layers: FigmaLayers | null, hidden: readonly string[]): Box[] {
  if (!layers) return []
  return layers.components
    .filter((c) => hidden.includes(c.id))
    .map((c) => componentFraction(layers, c))
    .filter((b) => b.w > 0 && b.h > 0)
}

/** The frame drawn again: its background, then every visible component in order, at the components' scale. */
export async function composeReference(
  layers: FigmaLayers,
  hidden: readonly string[],
  load: (url: string) => Promise<CanvasImageSource>,
): Promise<OffscreenCanvas> {
  const k = layers.scale
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(layers.width * k)),
    Math.max(1, Math.round(layers.height * k)),
  )
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("This browser can't draw offscreen")
  const shown = layers.components.filter((c) => !hidden.includes(c.id))
  const images = await Promise.all(shown.map((c) => load(c.url)))
  if (layers.background) {
    ctx.fillStyle = layers.background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.imageSmoothingQuality = "high"
  shown.forEach((c, i) => ctx.drawImage(images[i]!, c.x * k, c.y * k, c.w * k, c.h * k))
  return canvas
}
