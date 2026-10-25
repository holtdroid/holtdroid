import { type ReactNode, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

const smallest = 0.8
const step = 0.02

/**
 * Shows its children whole in the height it is given, shrinking them a little
 * when they would not fit; only when even that isn't enough does it scroll.
 * Narrower children reflow as they shrink, so the scale is found by trying:
 * down at once, up only when there is clearly room.
 */
export function FitHeight({ children, className }: { children: ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ scale: 1, height: 0 })
  const latest = useRef(fit)

  useEffect(() => {
    const o = outer.current
    const i = inner.current
    if (!o || !i) return undefined
    const measure = () => {
      const now = latest.current
      const natural = i.offsetHeight
      let scale = now.scale
      if (!window.matchMedia("(min-width: 1024px)").matches) scale = 1
      else if (natural * scale > o.clientHeight + 1 || natural * scale < o.clientHeight - 1) {
        const wanted = Math.max(smallest, Math.min(1, o.clientHeight / natural))
        const down = Math.floor(wanted / step) * step
        if (down < scale || down > scale + 2 * step) scale = down
      }
      if (scale !== now.scale || Math.abs(natural - now.height) > 0.5) {
        latest.current = { scale, height: natural }
        setFit(latest.current)
      }
    }
    const observer = new ResizeObserver(measure)
    observer.observe(o)
    observer.observe(i)
    measure()
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={outer} className={cn("min-h-0 overflow-x-hidden overflow-y-auto", className)}>
      <div style={{ height: fit.height * fit.scale || undefined }}>
        <div
          ref={inner}
          style={{
            width: `${100 / fit.scale}%`,
            transform: fit.scale === 1 ? undefined : `scale(${fit.scale})`,
            transformOrigin: "0 0",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
