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

/** The reference as it lies over a screen of this size; transparent where it doesn't reach. An SVG is drawn at that size, not scaled from pixels. */
export function referencePixels(image: CanvasImageSource, natural: Size, screen: Size, placement: Placement): Pixels {
  const ctx = context(screen.w, screen.h)
  const b = placeReference(screen, natural, placement)
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

/** Decodes an image, SVG included, which createImageBitmap can't take. */
export async function loadImage(src: Blob | string) {
  const url = typeof src === "string" ? src : URL.createObjectURL(src)
  const img = new Image()
  img.decoding = "async"
  img.src = url
  try {
    await img.decode()
  } finally {
    if (typeof src !== "string") URL.revokeObjectURL(url)
  }
  return img
}

function svgLength(v: string | null) {
  const n = Number.parseFloat((v ?? "").replace(/px$/, ""))
  return Number.isFinite(n) && n > 0 && !/%|em|ex|vw|vh/.test(v ?? "") ? n : 0
}

/** The size an SVG says it has: width and height, or its viewBox. */
export function svgSize(text: string): Size | null {
  const root = new DOMParser().parseFromString(text, "image/svg+xml").documentElement
  if (root.localName !== "svg") return null
  let w = svgLength(root.getAttribute("width"))
  let h = svgLength(root.getAttribute("height"))
  const box = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number)
  const [, , bw = 0, bh = 0] = box
  if ((!w || !h) && bw > 0 && bh > 0) {
    if (!w && !h) [w, h] = [bw, bh]
    else if (!w) w = (h * bw) / bh
    else h = (w * bh) / bw
  }
  return w > 0 && h > 0 ? { w: Math.ceil(w), h: Math.ceil(h) } : null
}

const thumbWidth = 160
const thumbMaxHeight = 320

/** The list's picture of an image: 160 px wide, the top of a tall one, on white. */
export async function makeThumbnail(file: Blob): Promise<Blob | null> {
  try {
    const img = await loadImage(file)
    const size =
      file.type === "image/svg+xml" ? svgSize(await file.text()) : { w: img.naturalWidth, h: img.naturalHeight }
    if (!size || !size.w || !size.h) return null
    const h = Math.round((thumbWidth * size.h) / size.w)
    const canvas = new OffscreenCanvas(thumbWidth, Math.max(1, Math.min(thumbMaxHeight, h)))
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(img, 0, 0, thumbWidth, h)
    return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 })
  } catch {
    return null
  }
}
