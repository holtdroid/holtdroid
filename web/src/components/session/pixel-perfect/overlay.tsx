import { SnowflakeIcon, XIcon } from "lucide-react"
import { type RefObject, useEffect, useMemo, useRef, useState } from "react"
import type { ReferenceView } from "@/api/client"
import { useReferenceLayers, useReferences } from "@/api/queries"
import { PixelCanvas } from "@/components/session/pixel-perfect/mask-canvas"
import { type PixelPerfect, type Result, usePixelState } from "@/components/session/pixel-perfect/state"
import {
  type Box,
  fitScale,
  onReference,
  onScreen,
  percentBox,
  placeReference,
  type Size,
  spanBox,
} from "@/lib/pixel-perfect/geometry"
import { componentFraction } from "@/lib/pixel-perfect/compose"
import { cn } from "@/lib/utils"

const blendStyle = {
  normal: {},
  difference: { mixBlendMode: "difference" },
  invert: { filter: "invert(1)" },
} as const

function useCanvasSize(canvasRef: RefObject<HTMLCanvasElement | null>) {
  const [size, setSize] = useState<Size | null>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const read = () => setSize(canvas.width > 0 && canvas.height > 0 ? { w: canvas.width, h: canvas.height } : null)
    const observer = new MutationObserver(read)
    observer.observe(canvas, { attributes: true, attributeFilter: ["width", "height"] })
    read()
    return () => observer.disconnect()
  }, [canvasRef])
  return size
}

const motionColor: [number, number, number, number] = [56, 189, 248, 70]

type Drag =
  | { kind: "move"; x: number; y: number; px: number; py: number; perPixel: number }
  | { kind: "draw"; x: number; y: number; box: Box }

export function PixelOverlay({ pp, canvasRef }: { pp: PixelPerfect; canvasRef: RefObject<HTMLCanvasElement | null> }) {
  const state = usePixelState(pp)
  const refs = useReferences()
  const size = useCanvasSize(canvasRef)
  const layer = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const ref = refs.data?.items.find((r) => r.id === state.referenceId) ?? null
  const layers = useReferenceLayers(ref).data
  const result = state.result?.referenceId === ref?.id ? state.result : null
  const motion = useMemo(
    () =>
      result?.motion ? { data: result.motion, width: result.analysis.width, height: result.analysis.height } : null,
    [result],
  )

  if (!size || (!ref && !state.frozen)) return null

  const frozen = state.frozen && (
    <>
      <img src={state.frozen.url} alt="" className="pointer-events-none absolute inset-0 size-full select-none" />
      <FrozenBadge at={state.frozen.at} onLive={() => pp.unfreeze()} />
    </>
  )
  if (!ref) return frozen

  const draft = pp.draft(ref)
  const image = { w: ref.width, h: ref.height }
  const placed = placeReference(size, image, draft.placement)
  const toScreen = (e: React.PointerEvent) => {
    const r = layer.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0, perPixel: 1 }
    const perPixel = size.w / r.width
    return { x: (e.clientX - r.left) * perPixel, y: (e.clientY - r.top) * perPixel, perPixel }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    const p = toScreen(e)
    if (state.tool === "move") {
      setDrag({ kind: "move", x: p.x, y: p.y, px: draft.placement.x, py: draft.placement.y, perPixel: p.perPixel })
    } else {
      setDrag({ kind: "draw", x: p.x, y: p.y, box: { x: p.x, y: p.y, w: 0, h: 0 } })
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const p = toScreen(e)
    if (drag.kind === "move") {
      const k = fitScale(size, image) * draft.placement.scale
      pp.edit(ref, {
        placement: {
          ...draft.placement,
          x: Math.round(drag.px + (p.x - drag.x) / k),
          y: Math.round(drag.py + (p.y - drag.y) / k),
        },
      })
    } else {
      setDrag({ ...drag, box: spanBox(drag.x, drag.y, p.x, p.y) })
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (drag.kind === "draw" && drag.box.w > 4 && drag.box.h > 4) {
      const area = onReference(placed, drag.box)
      if (area) pp.edit(ref, { ignore: [...draft.ignore, area] })
    }
    setDrag(null)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const step = steps[e.key]
    if (e.key === "Escape") pp.set({ tool: "none" })
    if (!step) return
    e.preventDefault()
    const n = e.shiftKey ? 10 : 1
    pp.edit(ref, {
      placement: { ...draft.placement, x: draft.placement.x + step[0] * n, y: draft.placement.y + step[1] * n },
    })
  }

  const showIgnored = state.tool === "ignore" || (result && state.showRegions)
  const interactive = state.tool !== "none"

  return (
    <>
      {frozen}
      {state.visible && (
        <img
          src={pp.overlaySource(ref)}
          alt=""
          draggable={false}
          className="pointer-events-none absolute max-w-none select-none"
          style={{ ...percentBox(placed, size), opacity: state.opacity, ...blendStyle[state.blend] }}
        />
      )}
      {result && state.showRegions && motion && (
        <PixelCanvas mask={motion} color={motionColor} className="pointer-events-none absolute inset-0 size-full" />
      )}
      {showIgnored &&
        draft.ignore.map((r, i) => (
          <div
            key={`${r.x}:${r.y}:${r.w}:${r.h}`}
            className="absolute border border-dashed border-sky-400 bg-[repeating-linear-gradient(45deg,rgb(56_189_248/0.25)_0_6px,transparent_6px_12px)]"
            style={{
              ...percentBox(onScreen(placed, r), size),
              pointerEvents: state.tool === "ignore" ? "auto" : "none",
            }}
          >
            {state.tool === "ignore" && (
              <button
                type="button"
                aria-label="Remove this ignored area"
                className="absolute -top-2.5 -right-2.5 z-10 grid size-5 cursor-pointer place-items-center rounded-full bg-sky-500 text-white shadow [&_svg]:size-3"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => pp.edit(ref, { ignore: draft.ignore.filter((_, j) => j !== i) })}
              >
                <XIcon />
              </button>
            )}
          </div>
        ))}
      {result && state.showRegions && result.webview && (
        <div
          className="pointer-events-none absolute border border-dashed border-violet-400/70"
          style={percentBox(result.webview.bounds, { w: result.analysis.width, h: result.analysis.height })}
        />
      )}
      {result &&
        state.showRegions &&
        result.media.map((b) => (
          <div
            key={`${b.x}:${b.y}:${b.w}:${b.h}`}
            className="pointer-events-none absolute bg-[repeating-linear-gradient(45deg,rgb(167_139_250/0.3)_0_6px,transparent_6px_12px)]"
            style={percentBox(b, { w: result.analysis.width, h: result.analysis.height })}
          />
        ))}
      {result &&
        state.showRegions &&
        result.analysis.regions.map((r, i) => (
          <div
            key={`${r.x}-${r.y}`}
            className={cn(
              "pointer-events-none absolute rounded-[2px] outline-2 -outline-offset-1 outline-red-500 transition-colors",
              state.hovered === i ? "bg-red-500/25 outline-red-400" : "bg-red-500/5",
            )}
            style={percentBox(r, { w: result.analysis.width, h: result.analysis.height })}
          >
            <span className="absolute -top-0.5 -left-0.5 -translate-y-full rounded-sm bg-red-500 px-1 text-[10px] leading-4 font-semibold text-white tabular-nums">
              {i + 1}
            </span>
          </div>
        ))}
      {layers &&
        state.hoveredComponent &&
        layers.components
          .filter((c) => c.id === state.hoveredComponent)
          .map((c) => (
            <div
              key={c.id}
              className="pointer-events-none absolute bg-sky-400/15 outline-2 -outline-offset-1 outline-sky-500"
              style={percentBox(onScreen(placed, componentFraction(layers, c)), size)}
            >
              <span className="absolute top-0 left-0 max-w-full -translate-y-full truncate rounded-sm bg-sky-600 px-1 text-[10px] leading-4 font-medium text-white">
                {c.name}
              </span>
            </div>
          ))}
      {result && state.hovered !== null && <HoveredMatch result={result} index={state.hovered} />}
      {interactive && (
        <div
          ref={layer}
          tabIndex={0}
          role="application"
          aria-label={
            state.tool === "move" ? "Drag the reference; arrow keys move it by a pixel" : "Draw an area to ignore"
          }
          className={cn(
            "absolute inset-0 touch-none outline-none",
            state.tool === "move" ? "cursor-move" : "cursor-crosshair",
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          {drag?.kind === "draw" && (
            <div
              className="pointer-events-none absolute border border-sky-400 bg-sky-400/20"
              style={percentBox(drag.box, size)}
            />
          )}
        </div>
      )}
      <ToolHint reference={ref} tool={state.tool} onDone={() => pp.set({ tool: "none" })} />
    </>
  )
}

function HoveredMatch({ result, index }: { result: Result; index: number }) {
  const m = result.matches[index]
  if (!m) return null
  const size = { w: result.analysis.width, h: result.analysis.height }
  const own = m.implementation ?? (m.view && !m.element ? m.view : null)
  return (
    <>
      {m.layer && (
        <div
          className="pointer-events-none absolute outline-2 -outline-offset-1 outline-fuchsia-500 outline-dashed"
          style={percentBox(m.layer.box, size)}
        >
          <span className="absolute bottom-0 left-0 max-w-full translate-y-full truncate rounded-sm bg-fuchsia-600 px-1 text-[10px] leading-4 font-medium text-white">
            ◆ {m.layer.name}
          </span>
        </div>
      )}
      {own && (
        <div
          className="pointer-events-none absolute bg-amber-400/15 outline-2 -outline-offset-1 outline-amber-400"
          style={percentBox(own.box, size)}
        >
          <span className="absolute top-0 right-0 max-w-full -translate-y-full truncate rounded-sm bg-amber-500 px-1 font-mono text-[10px] leading-4 text-black">
            {own.label}
          </span>
        </div>
      )}
    </>
  )
}

function ToolHint({ reference, tool, onDone }: { reference: ReferenceView; tool: string; onDone: () => void }) {
  if (tool === "none") return null
  return (
    <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
      <div className="flex max-w-full items-center gap-2 rounded-full bg-neutral-900/80 py-1 pr-1 pl-3 text-xs text-white shadow-lg backdrop-blur">
        <span className="truncate">
          {tool === "move"
            ? `Moving “${reference.name}”: drag, or arrows (Shift for 10 px)`
            : "Drag over what the comparison should skip"}
        </span>
        <button
          type="button"
          className="cursor-pointer rounded-full bg-white/15 px-2 py-0.5 font-medium hover:bg-white/25"
          onClick={onDone}
        >
          Done
        </button>
      </div>
    </div>
  )
}

function FrozenBadge({ at, onLive }: { at: number; onLive: () => void }) {
  return (
    <div className="absolute inset-x-0 top-3 z-10 flex justify-center px-3">
      <div className="flex items-center gap-2 rounded-full bg-sky-600/90 py-1 pr-1 pl-2.5 text-xs text-white shadow-lg backdrop-blur [&_svg]:size-3.5">
        <SnowflakeIcon />
        <span className="tabular-nums">Frozen at {new Date(at).toLocaleTimeString()}</span>
        <button
          type="button"
          className="cursor-pointer rounded-full bg-white/20 px-2 py-0.5 font-medium hover:bg-white/30"
          onClick={onLive}
        >
          Live
        </button>
      </div>
    </div>
  )
}
