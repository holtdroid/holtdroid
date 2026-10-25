import { useId } from "react"
import { cn } from "@/lib/utils"

export type Cutout = "none" | "corner" | "double" | "hole" | "tall" | "waterfall" | undefined

const H = 100

export function PhonePreview({
  width,
  height,
  cutout,
  className,
}: {
  width: number
  height: number
  cutout?: Cutout
  className?: string
}) {
  const id = useId()
  const w = Math.round((H * width) / height)
  const tablet = width / height > 0.55
  const r = tablet ? 6 : 10
  const mid = w / 2
  return (
    <svg viewBox={`0 0 ${w} ${H}`} className={cn("text-foreground h-20 w-auto", className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.14" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.03" />
        </linearGradient>
      </defs>
      <rect
        x="1"
        y="1"
        width={w - 2}
        height={H - 2}
        rx={r}
        fill={`url(#${id})`}
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="2"
      />
      <rect x={w * 0.14} y={H * 0.2} width={w * 0.5} height="5" rx="2.5" fill="currentColor" opacity="0.2" />
      <rect x={w * 0.14} y={H * 0.2 + 9} width={w * 0.72} height="12" rx="3" fill="currentColor" opacity="0.1" />
      <rect x={w * 0.14} y={H * 0.2 + 25} width={w * 0.72} height="12" rx="3" fill="currentColor" opacity="0.1" />
      <rect x={mid - w * 0.12} y={H - 6} width={w * 0.24} height="2" rx="1" fill="currentColor" opacity="0.45" />
      {cutout === "tall" && <rect x={mid - w * 0.14} y="1.5" width={w * 0.28} height="6" rx="3" fill="currentColor" />}
      {cutout === "hole" && <circle cx={mid} cy="7" r="2.8" fill="currentColor" />}
      {cutout === "corner" && <circle cx="8" cy="8" r="2.8" fill="currentColor" />}
      {cutout === "double" && (
        <>
          <rect x={mid - w * 0.14} y="1.5" width={w * 0.28} height="6" rx="3" fill="currentColor" />
          <rect x={mid - w * 0.14} y={H - 7.5} width={w * 0.28} height="6" rx="3" fill="currentColor" />
        </>
      )}
      {cutout === "waterfall" && (
        <>
          <path
            d={`M1.5 ${r} C5 ${H * 0.3} 5 ${H * 0.7} 1.5 ${H - r}`}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.5"
            strokeWidth="1.5"
          />
          <path
            d={`M${w - 1.5} ${r} C${w - 5} ${H * 0.3} ${w - 5} ${H * 0.7} ${w - 1.5} ${H - r}`}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.5"
            strokeWidth="1.5"
          />
        </>
      )}
    </svg>
  )
}
