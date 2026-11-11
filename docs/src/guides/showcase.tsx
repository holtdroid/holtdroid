import { useEffect, useRef, useState } from "react"
import css from "./guides.css?inline"
import { Portal } from "./portal"
import { defaults } from "./portal/data"
import type { PortalState } from "./types"

const WIDTH = 1180
const HEIGHT = 720

export type View = [x: number, y: number, width: number, height: number]

const FULL: View = [0, 0, WIDTH, HEIGHT]

export function sceneState(state: Partial<PortalState>): PortalState {
  return { ...defaults, ...state }
}

export default function Showcase({
  state,
  view = FULL,
  label,
}: {
  state: Partial<PortalState>
  view?: View
  label: string
}) {
  const [x, y, w, h] = view
  const frameRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number | null>(null)
  const scale = (width ?? w) / w

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return undefined
    const resize = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    resize.observe(frame)
    return () => resize.disconnect()
  }, [])

  return (
    <div className="hd-demo not-content" role="img" aria-label={label}>
      <style href="hd-guides" precedence="default">
        {css}
      </style>
      <div ref={frameRef} className="relative overflow-hidden" style={{ aspectRatio: `${w} / ${h}` }}>
        <div
          inert
          className="pointer-events-none absolute top-0 left-0 origin-top-left select-none"
          style={{
            width: WIDTH,
            height: HEIGHT,
            transform: `scale(${scale}) translate(${-x}px, ${-y}px)`,
            visibility: width === null ? "hidden" : undefined,
          }}
        >
          <Portal s={sceneState(state)} />
        </div>
      </div>
    </div>
  )
}
