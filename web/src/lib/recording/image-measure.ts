import { decodeBase64 } from "@/lib/recording/body"
import { type ImageEntry, type ImageMeasure, webpQuality } from "@/lib/recording/images"

async function webpSize(bitmap: ImageBitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: webpQuality })
  return blob.type === "image/webp" ? blob.size : undefined
}

/**
 * Decodes a recorded image in this browser and re-encodes it as WebP, whole
 * and at the size it is drawn. A GIF is only measured, since its frames
 * would be lost.
 */
export async function measureImage(e: ImageEntry): Promise<ImageMeasure | null> {
  if (!e.body) return null
  const bytes = e.body.base64 ? decodeBase64(e.body.data) : new TextEncoder().encode(e.body.data)
  const blob = new Blob([bytes], { type: e.body.mime || "application/octet-stream" })
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    return null
  }
  const m: ImageMeasure = { width: bitmap.width, height: bitmap.height }
  try {
    if (e.format === "gif") return m
    m.webp = await webpSize(bitmap)
    const n = e.needed
    if (n && n.width < bitmap.width && n.height < bitmap.height) {
      const scale = Math.max(n.width / bitmap.width, n.height / bitmap.height)
      const width = Math.max(1, Math.round(bitmap.width * scale))
      const height = Math.max(1, Math.round(bitmap.height * scale))
      const small = await createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" })
      const webp = await webpSize(small)
      small.close()
      if (webp !== undefined) m.resized = { width, height, webp }
    }
  } catch {
    return m
  } finally {
    bitmap.close()
  }
  return m
}
