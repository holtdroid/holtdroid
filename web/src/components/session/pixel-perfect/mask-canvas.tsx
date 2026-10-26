import { useEffect, useRef } from "react"
import type { Pixels } from "@/lib/pixel-perfect/diff"
import { cn } from "@/lib/utils"

const red: [number, number, number, number] = [255, 0, 0, 255]

/** Draws pixels, or a mask in one colour, into a canvas at their own size. */
export function PixelCanvas({
  pixels,
  mask,
  color = red,
  className,
  style,
}: {
  pixels?: Pixels
  mask?: { data: Uint8Array; width: number; height: number }
  color?: [number, number, number, number]
  className?: string
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const src = pixels ?? mask
    if (!canvas || !src) return
    canvas.width = src.width
    canvas.height = src.height
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    let data: Uint8ClampedArray<ArrayBuffer>
    if (pixels) {
      data = new Uint8ClampedArray(pixels.data)
    } else {
      data = new Uint8ClampedArray(src.width * src.height * 4)
      const m = (src as { data: Uint8Array }).data
      for (let p = 0; p < m.length; p++) if (m[p]) data.set(color, p * 4)
    }
    ctx.putImageData(new ImageData(data, src.width, src.height), 0, 0)
  }, [pixels, mask, color])
  return <canvas ref={ref} className={cn("block", className)} style={style} />
}
