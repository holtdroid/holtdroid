import type { Pixels } from "@/lib/pixel-perfect/diff"
import { type Box, type Placement, placeReference, type Size } from "@/lib/pixel-perfect/geometry"

const maxPixels = 4_500_000

function context(w: number, h: number) {
  const ctx = new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("This browser can't draw offscreen")
  return ctx
}

/** The analysis size for a frame: its own, scaled down past a few megapixels. */
export function workSize(frame: Size): Size {
  const k = Math.min(1, Math.sqrt(maxPixels / (frame.w * frame.h)))
  return { w: Math.round(frame.w * k), h: Math.round(frame.h * k) }
}

export async function pixelsOf(source: Blob | ImageBitmap | OffscreenCanvas, size?: Size): Promise<Pixels> {
  const decoded = source instanceof Blob ? await createImageBitmap(source) : null
  const image = decoded ?? (source as ImageBitmap | OffscreenCanvas)
  const w = size?.w ?? image.width
  const h = size?.h ?? image.height
  const ctx = context(w, h)
  ctx.drawImage(image, 0, 0, w, h)
  decoded?.close()
  return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h }
}

/** The reference as it lies over a screen of this size; transparent where it doesn't reach. */
export function referencePixels(image: ImageBitmap, screen: Size, placement: Placement): Pixels {
  const ctx = context(screen.w, screen.h)
  const b = placeReference(screen, { w: image.width, h: image.height }, placement)
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(image, b.x, b.y, b.w, b.h)
  return { data: ctx.getImageData(0, 0, screen.w, screen.h).data, width: screen.w, height: screen.h }
}

export function toCanvas(p: Pixels) {
  const c = new OffscreenCanvas(p.width, p.height)
  c.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0)
  return c
}

/** A mask as a translucent image: colour where it is set. */
export function maskCanvas(mask: Uint8Array, w: number, h: number, rgba: [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let p = 0; p < mask.length; p++) if (mask[p]) data.set(rgba, p * 4)
  return toCanvas({ data, width: w, height: h })
}

/** |screen − reference| per channel: black where they match. */
export function differencePixels(screen: Pixels, reference: Pixels): Pixels {
  const a = screen.data
  const r = reference.data
  const out = new Uint8ClampedArray(a.length)
  for (let i = 0; i < a.length; i += 4) {
    const alpha = r[i + 3]! / 255
    for (let c = 0; c < 3; c++) out[i + c] = Math.abs(a[i + c]! - (r[i + c]! * alpha + a[i + c]! * (1 - alpha)))
    out[i + 3] = 255
  }
  return { data: out, width: screen.width, height: screen.height }
}

export function scaleBox(b: Box, k: number): Box {
  return { x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k }
}

export async function blobURL(canvas: OffscreenCanvas) {
  return URL.createObjectURL(await canvas.convertToBlob({ type: "image/png" }))
}
