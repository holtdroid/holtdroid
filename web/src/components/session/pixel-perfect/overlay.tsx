import { SnowflakeIcon, XIcon } from "lucide-react"
import { type RefObject, useEffect, useMemo, useRef, useState } from "react"
import type { ReferenceView } from "@/api/client"
import { useReferenceLayers, useReferences } from "@/api/queries"
import { PixelCanvas } from "@/components/session/pixel-perfect/mask-canvas"
import { type PixelPerfect, type Result, type Tool, usePixelState } from "@/components/session/pixel-perfect/state"
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
import type { Pixels } from "@/lib/pixel-perfect/diff"
import { cropPixels, snapPoint } from "@/lib/pixel-perfect/loupe"
import {
  areaBox,
  baselineRows,
  type Guide,
  gridColumns,
  guideAt,
  guidePos,
  snapOffset,
} from "@/lib/pixel-perfect/layout"
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
  | { kind: "draw" | "area"; x: number; y: number; box: Box }
  | { kind: "guide"; index: number | null; axis: Guide["axis"]; at: number; perPixel: number }

const ruler = 18

export function PixelOverlay({ pp, canvasRef }: { pp: PixelPerfect; canvasRef: RefObject<HTMLCanvasElement | null> }) {
  const state = usePixelState(pp)
  const refs = useReferences()
  const size = useCanvasSize(canvasRef)
  const layer = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
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
  const layout = draft.layout
  const k = pp.pxPerDp(size)
  const area = areaBox(layout.area, size, k)
  const placed = placeReference(area, image, draft.placement)
  const columns = gridColumns(layout.grid, area, k)
  const guides = layout.guides.map((g) => ({ ...g, at: guideAt(g, area, k) }))
  const snapX = [
    area.x,
    area.x + area.w,
    ...columns.flatMap((c) => [c.x, c.x + c.w]),
    ...guides.filter((g) => g.axis === "x").map((g) => g.at),
  ]
  const snapY = [area.y, area.y + area.h, ...guides.filter((g) => g.axis === "y").map((g) => g.at)]
  const toScreen = (e: React.PointerEvent) => {
    const r = layer.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0, perPixel: 1 }
    const perPixel = size.w / r.width
    return { x: (e.clientX - r.left) * perPixel, y: (e.clientY - r.top) * perPixel, perPixel }
  }
  const precise = state.tool === "area" || state.tool === "ignore" || state.tool === "guides"
  const loupeScale = state.loupe ? state.loupe.width / size.w : 1
  const snap = (x: number, y: number, edges: boolean) => snapPoint(state.loupe, x, y, loupeScale, edges)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    const p = toScreen(e)
    if (state.tool === "move") {
      setDrag({ kind: "move", x: p.x, y: p.y, px: draft.placement.x, py: draft.placement.y, perPixel: p.perPixel })
    } else if (state.tool === "guides") {
      const near = guides.findIndex((g) => Math.abs((g.axis === "x" ? p.x : p.y) - g.at) <= 6 * p.perPixel)
      if (near >= 0) {
        const g = guides[near]!
        setDrag({ kind: "guide", index: near, axis: g.axis, at: g.at, perPixel: p.perPixel })
      } else if (p.y <= ruler * p.perPixel) {
        setDrag({ kind: "guide", index: null, axis: "y", at: p.y, perPixel: p.perPixel })
      } else if (p.x <= ruler * p.perPixel) {
        setDrag({ kind: "guide", index: null, axis: "x", at: p.x, perPixel: p.perPixel })
      }
    } else {
      const kind = state.tool === "area" ? "area" : "draw"
      const s = snap(p.x, p.y, !e.altKey)
      setPointer(s)
      setDrag({ kind, x: s.x, y: s.y, box: { x: s.x, y: s.y, w: 0, h: 0 } })
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = toScreen(e)
    const s = precise ? snap(p.x, p.y, !e.altKey) : null
    if (s) setPointer(s)
    if (!drag) return
    if (drag.kind === "move") {
      const ki = fitScale(area, image) * draft.placement.scale
      let x = drag.px + (p.x - drag.x) / ki
      let y = drag.py + (p.y - drag.y) / ki
      if (!e.altKey) {
        const at = placeReference(area, image, { ...draft.placement, x, y })
        const threshold = 6 * drag.perPixel
        x += snapOffset([at.x, at.x + at.w / 2, at.x + at.w], snapX, threshold) / ki
        y += snapOffset([at.y, at.y + at.h / 2, at.y + at.h], snapY, threshold) / ki
      }
      pp.edit(ref, { placement: { ...draft.placement, x: Math.round(x), y: Math.round(y) } })
    } else if (drag.kind === "guide") {
      const raw = drag.axis === "x" ? p.x : p.y
      const onLayout = e.altKey ? 0 : snapOffset([raw], drag.axis === "x" ? snapX : snapY, 6 * drag.perPixel)
      const at = onLayout ? raw + onLayout : (s ?? { x: raw, y: raw })[drag.axis]
      setDrag({ ...drag, at })
    } else {
      const end = s ?? p
      setDrag({ ...drag, box: spanBox(drag.x, drag.y, end.x, end.y) })
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (drag.kind === "draw" && drag.box.w > 4 && drag.box.h > 4) {
      const skip = onReference(placed, drag.box)
      if (skip) pp.edit(ref, { ignore: [...draft.ignore, skip] })
    }
    if (drag.kind === "area" && drag.box.w > 8 && drag.box.h > 8) {
      const b = drag.box
      pp.editLayout(ref, {
        area: {
          ...layout.area,
          kind: "box",
          box: { x: b.x / size.w, y: b.y / size.h, w: b.w / size.w, h: b.h / size.h },
        },
      })
      pp.set({ tool: "none" })
    }
    if (drag.kind === "guide") {
      const gone =
        drag.at < (drag.axis === "x" ? area.x : area.y) - 4 * drag.perPixel ||
        drag.at > (drag.axis === "x" ? area.x + area.w : area.y + area.h) + 4 * drag.perPixel
      const next = layout.guides.filter((_, i) => i !== drag.index)
      if (!gone) next.push({ axis: drag.axis, pos: guidePos(drag.axis, drag.at, area, k) })
      pp.editLayout(ref, { guides: next })
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
      {state.showLayout && (
        <LayoutLayer
          size={size}
          area={area}
          dim={state.tool === "area" || layout.area.kind !== "screen"}
          columns={columns}
          rows={baselineRows(layout.grid, area, k)}
          guides={guides.filter((_, i) => drag?.kind !== "guide" || drag.index !== i)}
          k={k}
        />
      )}
      {drag?.kind === "guide" && (
        <GuideLine size={size} axis={drag.axis} at={drag.at} label={`${guidePos(drag.axis, drag.at, area, k)} dp`} />
      )}
      {state.tool === "guides" && <Rulers size={size} area={area} k={k} />}
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
          aria-label={toolLabel[state.tool]}
          className={cn(
            "absolute inset-0 touch-none outline-none",
            state.tool === "move" ? "cursor-move" : state.tool === "guides" ? "cursor-default" : "cursor-crosshair",
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setPointer(null)}
          onKeyDown={onKeyDown}
        >
          {(drag?.kind === "draw" || drag?.kind === "area") && (
            <div
              className={cn(
                "pointer-events-none absolute border",
                drag.kind === "area" ? "border-amber-400 bg-amber-400/10" : "border-sky-400 bg-sky-400/20",
              )}
              style={percentBox(drag.box, size)}
            />
          )}
        </div>
      )}
      {precise && pointer && state.loupe && (
        <Loupe pixels={state.loupe} scale={loupeScale} at={pointer} size={size} k={k} />
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

const loupeCells = 15
const loupeCell = 9

/** The screen magnified around the pointer, with a pixel grid and the point drawing snaps to. */
function Loupe({
  pixels,
  scale,
  at,
  size,
  k,
}: {
  pixels: Pixels
  scale: number
  at: { x: number; y: number }
  size: Size
  k: number
}) {
  const half = Math.floor(loupeCells / 2)
  const cx = Math.round(at.x * scale)
  const cy = Math.round(at.y * scale)
  const crop = useMemo(
    () => cropPixels(pixels, cx - half - 1, cy - half - 1, loupeCells, loupeCells),
    [pixels, cx, cy, half],
  )
  const side = loupeCells * loupeCell
  const flipX = at.x / size.w > 0.6
  const flipY = at.y / size.h > 0.7
  const line = (half + 1) * loupeCell
  return (
    <div
      className="pointer-events-none absolute z-20 grid gap-1"
      style={{
        left: `${(at.x / size.w) * 100}%`,
        top: `${(at.y / size.h) * 100}%`,
        transform: `translate(${flipX ? "calc(-100% - 20px)" : "20px"}, ${flipY ? "calc(-100% - 20px)" : "20px"})`,
      }}
    >
      <div
        className="relative overflow-hidden rounded-lg bg-black shadow-xl ring-2 ring-white/80"
        style={{ width: side, height: side }}
      >
        <PixelCanvas pixels={crop} className="size-full [image-rendering:pixelated]" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgb(255 255 255 / 0.14) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.14) 1px, transparent 1px)",
            backgroundSize: `${loupeCell}px ${loupeCell}px`,
          }}
        />
        <div className="absolute inset-y-0 w-px bg-amber-400" style={{ left: line }} />
        <div className="absolute inset-x-0 h-px bg-amber-400" style={{ top: line }} />
      </div>
      <span className="justify-self-center rounded bg-neutral-900/85 px-1.5 font-mono text-[10px] leading-4 text-white">
        {Math.round((at.x / k) * 2) / 2} · {Math.round((at.y / k) * 2) / 2} dp
      </span>
    </div>
  )
}

const toolLabel: Record<Tool, string> = {
  none: "",
  move: "Drag the reference; arrow keys move it by a pixel",
  ignore: "Draw an area to ignore",
  area: "Draw the work area",
  guides: "Drag from a ruler to add a guide; drag a guide out of the area to remove it",
}

function LayoutLayer({
  size,
  area,
  dim,
  columns,
  rows,
  guides,
  k,
}: {
  size: Size
  area: Box
  dim: boolean
  columns: Box[]
  rows: number[]
  guides: (Guide & { at: number })[]
  k: number
}) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox={`0 0 ${size.w} ${size.h}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {dim && (
        <path
          d={`M0 0H${size.w}V${size.h}H0Z M${area.x} ${area.y}V${area.y + area.h}H${area.x + area.w}V${area.y}Z`}
          fill="rgb(0 0 0 / 0.35)"
          fillRule="evenodd"
        />
      )}
      {columns.map((c) => (
        <rect key={c.x} x={c.x} y={c.y} width={c.w} height={c.h} fill="rgb(244 63 94 / 0.1)" />
      ))}
      {rows.map((y) => (
        <line
          key={y}
          x1={area.x}
          x2={area.x + area.w}
          y1={y}
          y2={y}
          stroke="rgb(34 211 238 / 0.25)"
          strokeWidth={Math.max(1, k * 0.5)}
        />
      ))}
      {dim && (
        <rect
          x={area.x}
          y={area.y}
          width={area.w}
          height={area.h}
          fill="none"
          stroke="rgb(251 191 36)"
          strokeDasharray={`${6 * k} ${4 * k}`}
          strokeWidth={Math.max(1, k)}
        />
      )}
      {guides.map((g) => (
        <line
          key={`${g.axis}${g.pos}`}
          x1={g.axis === "x" ? g.at : 0}
          x2={g.axis === "x" ? g.at : size.w}
          y1={g.axis === "y" ? g.at : 0}
          y2={g.axis === "y" ? g.at : size.h}
          stroke="rgb(217 70 239)"
          strokeWidth={Math.max(1, k * 0.75)}
        />
      ))}
    </svg>
  )
}

function GuideLine({ size, axis, at, label }: { size: Size; axis: Guide["axis"]; at: number; label: string }) {
  const style =
    axis === "x"
      ? { left: `${(at / size.w) * 100}%`, top: 0, bottom: 0, width: 1 }
      : { top: `${(at / size.h) * 100}%`, left: 0, right: 0, height: 1 }
  return (
    <div className="pointer-events-none absolute bg-fuchsia-500" style={style}>
      <span className="absolute top-5 left-1 rounded-sm bg-fuchsia-600 px-1 font-mono text-[10px] leading-4 whitespace-nowrap text-white">
        {label}
      </span>
    </div>
  )
}

/** dp rulers along the top and left edges, counted from the work area's corner. */
function Rulers({ size, area, k }: { size: Size; area: Box; k: number }) {
  const step = k * 8 >= 6 ? 8 : 16
  const ticks = (from: number, length: number, origin: number) => {
    const out: { at: number; dp: number }[] = []
    const first = Math.ceil((from - origin) / k / step) * step
    for (let dp = first; origin + dp * k <= from + length && out.length < 600; dp += step)
      out.push({ at: origin + dp * k, dp })
    return out
  }
  return (
    <>
      <svg
        className="pointer-events-none absolute inset-x-0 top-0 w-full bg-neutral-900/75"
        style={{ height: ruler }}
        viewBox={`0 0 ${size.w} ${ruler}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {ticks(0, size.w, area.x).map((t) => (
          <line
            key={t.at}
            x1={t.at}
            x2={t.at}
            y1={t.dp % (step * 5) === 0 ? 4 : 12}
            y2={ruler}
            stroke="white"
            strokeOpacity={0.6}
          />
        ))}
      </svg>
      <svg
        className="pointer-events-none absolute inset-y-0 left-0 h-full bg-neutral-900/75"
        style={{ width: ruler }}
        viewBox={`0 0 ${ruler} ${size.h}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {ticks(0, size.h, area.y).map((t) => (
          <line
            key={t.at}
            y1={t.at}
            y2={t.at}
            x1={t.dp % (step * 5) === 0 ? 4 : 12}
            x2={ruler}
            stroke="white"
            strokeOpacity={0.6}
          />
        ))}
      </svg>
    </>
  )
}

function ToolHint({ reference, tool, onDone }: { reference: ReferenceView; tool: Tool; onDone: () => void }) {
  if (tool === "none") return null
  return (
    <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
      <div className="flex max-w-full items-center gap-2 rounded-full bg-neutral-900/80 py-1 pr-1 pl-3 text-xs text-white shadow-lg backdrop-blur">
        <span className="truncate">
          {tool === "move"
            ? `Moving “${reference.name}”: drag (Alt: no snapping), or arrows (Shift for 10 px)`
            : tool === "area"
              ? "Drag the work area over the screen"
              : tool === "guides"
                ? "Drag from a ruler to add a guide; drag one off the area to remove it"
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
