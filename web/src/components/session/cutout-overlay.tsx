import { type RefObject, useEffect, useId, useRef, useState } from "react"
import type { Display } from "@/api/client"

type Box = { left: number; top: number; width: number; height: number }

const NOTCH_W = 128
const NOTCH_H = 32
const NOTCH_R = 14

function notch(cx: number, y: number, dir: 1 | -1) {
  const x = cx - NOTCH_W / 2
  const r = NOTCH_R
  const h = NOTCH_H
  const sweep = dir === 1 ? 1 : 0
  return `M${x} ${y} H${x + NOTCH_W} V${y + dir * (h - r)} a${r} ${r} 0 0 ${sweep} ${-r} ${dir * r} H${x + r} a${r} ${r} 0 0 ${sweep} ${-r} ${-dir * r} Z`
}

function Lens({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill="#05070d" stroke="#2a3552" strokeWidth="1" />
      <circle cx={cx} cy={cy} r={r * 0.5} fill="#16254d" />
      <circle cx={cx - r * 0.22} cy={cy - r * 0.25} r={r * 0.17} fill="#fff" opacity="0.65" />
    </>
  )
}

function Speaker({ x, y, width }: { x: number; y: number; width: number }) {
  return <rect x={x} y={y} width={width} height="5" rx="2.5" fill="#1b1d24" stroke="#000" strokeWidth="0.5" />
}

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
  const gradient = useId()

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
      setBox((prev) =>
        prev &&
        Math.abs(prev.left - next.left) < 0.5 &&
        Math.abs(prev.top - next.top) < 0.5 &&
        Math.abs(prev.width - next.width) < 0.5 &&
        Math.abs(prev.height - next.height) < 0.5
          ? prev
          : next,
      )
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
  const w = (screen.width * 160) / screen.dpi
  const h = (screen.height * 160) / screen.dpi
  const cx = w / 2

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="pointer-events-none absolute"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradient} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.9" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g ref={shapeRef} className="transition-opacity duration-200" style={{ opacity: hovered ? 0.3 : 1 }}>
        {(screen.cutout === "tall" || screen.cutout === "double") && (
          <>
            <path d={notch(cx, -1, 1)} fill="#000" />
            <Speaker x={cx - 40} y={13} width={46} />
            <Lens cx={cx + 26} cy={15.5} r={7} />
          </>
        )}
        {screen.cutout === "double" && (
          <>
            <path d={notch(cx, h + 1, -1)} fill="#000" />
            <circle cx={cx} cy={h - 14} r="2" fill="#1b1d24" />
          </>
        )}
        {screen.cutout === "hole" && (
          <>
            <circle cx={cx} cy={19} r="10.5" fill="#000" />
            <Lens cx={cx} cy={19} r={6} />
          </>
        )}
        {screen.cutout === "corner" && (
          <>
            <circle cx={24} cy={24} r="10.5" fill="#000" />
            <Lens cx={24} cy={24} r={6} />
          </>
        )}
        {screen.cutout === "waterfall" && (
          <>
            <rect x="0" y="0" width="14" height={h} fill={`url(#${gradient})`} />
            <rect
              x="0"
              y="0"
              width="14"
              height={h}
              fill={`url(#${gradient})`}
              transform={`translate(${w} 0) scale(-1 1)`}
            />
          </>
        )}
      </g>
    </svg>
  )
}
