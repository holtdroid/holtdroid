import { type RefObject, useEffect, useRef, useState } from "react"
import type { Display } from "@/api/client"
import { CutoutGraphic } from "@/components/session/cutout-graphic"
import { cornerPath, screenDp } from "@/lib/cutout"

type Box = { left: number; top: number; width: number; height: number }

const same = (a: Box, b: Box) =>
  Math.abs(a.left - b.left) < 0.5 &&
  Math.abs(a.top - b.top) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5 &&
  Math.abs(a.height - b.height) < 0.5

export function CutoutOverlay({
  canvasRef,
  screen,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  screen: Display
}) {
  const [box, setBox] = useState<Box | null>(null)
  const [hovered, setHovered] = useState(false)
  const shapeRef = useRef<SVGGElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const host = canvas?.parentElement
    if (!canvas || !host) return undefined
    const measure = () => {
      const vw = canvas.width
      const vh = canvas.height
      const portrait = screen.height >= screen.width
      if (!vw || !vh || vh >= vw !== portrait) {
        setBox(null)
        return
      }
      const scale = Math.min(canvas.clientWidth / vw, canvas.clientHeight / vh)
      const width = vw * scale
      const height = vh * scale
      const next = { left: (canvas.clientWidth - width) / 2, top: (canvas.clientHeight - height) / 2, width, height }
      setBox((prev) => (prev && same(prev, next) ? prev : next))
    }
    const onMove = (e: PointerEvent) => {
      const parts = Array.from(shapeRef.current?.children ?? [])
      setHovered(
        parts.some((part) => {
          const r = part.getBoundingClientRect()
          return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
        }),
      )
    }
    const onLeave = () => setHovered(false)
    const resize = new ResizeObserver(measure)
    resize.observe(canvas)
    const mutation = new MutationObserver(measure)
    mutation.observe(canvas, { attributes: true, attributeFilter: ["width", "height"] })
    host.addEventListener("pointermove", onMove)
    host.addEventListener("pointerleave", onLeave)
    measure()
    return () => {
      resize.disconnect()
      mutation.disconnect()
      host.removeEventListener("pointermove", onMove)
      host.removeEventListener("pointerleave", onLeave)
    }
  }, [canvasRef, screen.width, screen.height])

  if (!box) return null
  const { w, h } = screenDp(screen)
  const corners = cornerPath(w, h, screen.radius ?? 0)

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="pointer-events-none absolute"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      aria-hidden
    >
      {corners && <path d={corners} fill="#000" fillRule="evenodd" />}
      <g ref={shapeRef} className="transition-opacity duration-200" style={{ opacity: hovered ? 0.3 : 1 }}>
        {screen.shape && <CutoutGraphic shape={screen.shape} widthDp={w} />}
      </g>
    </svg>
  )
}
