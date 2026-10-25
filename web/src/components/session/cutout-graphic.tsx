import type { CutoutShape } from "@/api/client"
import { shapePath, shapeRect } from "@/lib/cutout"

function Lens({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill="#05070d" stroke="#2a3552" strokeWidth={Math.max(0.4, r * 0.14)} />
      <circle cx={cx} cy={cy} r={r * 0.5} fill="#16254d" />
      <circle cx={cx - r * 0.22} cy={cy - r * 0.25} r={r * 0.17} fill="#fff" opacity="0.65" />
    </>
  )
}

function Details({ shape, widthDp }: { shape: CutoutShape; widthDp: number }) {
  const { x, y, w, h } = shapeRect(shape, widthDp)
  const cx = x + w / 2
  const cy = y + h / 2
  if (shape.kind === "circle") return <Lens cx={cx} cy={cy} r={Math.min(w, h) * 0.3} />
  if (shape.kind === "pill") {
    return (
      <>
        <Lens cx={x + h * 0.75} cy={cy} r={h * 0.3} />
        <circle cx={x + w - h * 0.7} cy={cy} r={h * 0.1} fill="#1b1d24" />
      </>
    )
  }
  if (w < 70) return <Lens cx={cx} cy={y + h * 0.45} r={Math.min(w * 0.14, h * 0.24)} />
  return (
    <>
      <rect
        x={cx - w * 0.3}
        y={y + h * 0.4}
        width={w * 0.26}
        height="4.5"
        rx="2.25"
        fill="#1b1d24"
        stroke="#000"
        strokeWidth="0.5"
      />
      <Lens cx={cx + w * 0.2} cy={y + h * 0.45} r={Math.min(7, h * 0.22)} />
    </>
  )
}

export function CutoutGraphic({
  shape,
  widthDp,
  fill = "#000",
  details = true,
}: {
  shape: CutoutShape
  widthDp: number
  fill?: string
  details?: boolean
}) {
  return (
    <>
      <path d={shapePath(shape, widthDp)} fill={fill} />
      {details && <Details shape={shape} widthDp={widthDp} />}
    </>
  )
}
