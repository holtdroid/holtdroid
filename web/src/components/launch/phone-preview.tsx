import type { Display } from "@/api/client"
import { CutoutGraphic } from "@/components/session/cutout-graphic"
import { screenDp } from "@/lib/cutout"
import { cn } from "@/lib/utils"

export function PhonePreview({ display, className }: { display: Display; className?: string }) {
  const { w, h } = screenDp(display)
  const r = Math.min(Math.max(display.radius ?? 0, w * 0.04), w / 2)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("text-foreground h-20 w-auto", className)} aria-hidden>
      <rect width={w} height={h} rx={r} fill="currentColor" fillOpacity="0.08" />
      <rect
        x={w * 0.12}
        y={h * 0.18}
        width={w * 0.5}
        height={h * 0.02}
        rx={h * 0.01}
        fill="currentColor"
        opacity="0.25"
      />
      <rect
        x={w * 0.12}
        y={h * 0.23}
        width={w * 0.76}
        height={h * 0.045}
        rx={h * 0.012}
        fill="currentColor"
        opacity="0.12"
      />
      <rect
        x={w * 0.12}
        y={h * 0.29}
        width={w * 0.76}
        height={h * 0.045}
        rx={h * 0.012}
        fill="currentColor"
        opacity="0.12"
      />
      <rect
        x={w * 0.38}
        y={h * 0.985}
        width={w * 0.24}
        height={h * 0.005}
        rx={h * 0.0025}
        fill="currentColor"
        opacity="0.45"
      />
      {display.shape && <CutoutGraphic shape={display.shape} widthDp={w} fill="currentColor" details={false} />}
      <rect
        x={0}
        y={0}
        width={w}
        height={h}
        rx={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
