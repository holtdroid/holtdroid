import { Fragment, useMemo, useState } from "react"
import { CopyButton } from "@/components/copy-button"
import { PixelCanvas } from "@/components/session/pixel-perfect/mask-canvas"
import type { PixelPerfect, RegionMatch, Result } from "@/components/session/pixel-perfect/state"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { differencePixels } from "@/lib/pixel-perfect/capture"
import { describe, type Pixels, type Region, type RegionKind } from "@/lib/pixel-perfect/diff"
import type { DesignLayer, NativeView } from "@/lib/pixel-perfect/elements"
import type { ScreenElement } from "@/lib/pixel-perfect/webview"
import { type Box, percentBox } from "@/lib/pixel-perfect/geometry"
import { cn } from "@/lib/utils"

type Mode = "2-up" | "swipe" | "onion" | "difference"

const modes: { value: Mode; label: string }[] = [
  { value: "2-up", label: "Side by side" },
  { value: "swipe", label: "Swipe" },
  { value: "onion", label: "Onion skin" },
  { value: "difference", label: "Difference" },
]

const diffColor: [number, number, number, number] = [255, 40, 40, 255]

function Regions({
  regions,
  size,
  hovered,
  selected,
}: {
  regions: Region[]
  size: { w: number; h: number }
  hovered: number | null
  selected: number | null
}) {
  return regions.map((r, i) => (
    <div
      key={`${r.x}-${r.y}`}
      className={cn(
        "pointer-events-none absolute outline-2 -outline-offset-1 outline-red-500",
        (hovered === i || selected === i) && "bg-red-500/20",
      )}
      style={percentBox(r, size)}
    >
      <span className="absolute top-0 left-0 -translate-y-full bg-red-500 px-1 text-[10px] leading-4 font-semibold text-white">
        {i + 1}
      </span>
    </div>
  ))
}

function Frame({ children, ratio, className }: { children: React.ReactNode; ratio: number; className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-[conic-gradient(#8882_25%,transparent_0_50%,#8882_0_75%,transparent_0)] bg-[length:16px_16px] ring-1 ring-border",
        className,
      )}
      style={{ aspectRatio: ratio }}
    >
      {children}
    </div>
  )
}

const fill = "absolute inset-0 size-full"

export function Compare({ pp, result, hovered }: { pp: PixelPerfect; result: Result; hovered: number | null }) {
  const [mode, setMode] = useState<Mode>("2-up")
  const [split, setSplit] = useState(50)
  const [onion, setOnion] = useState(50)
  const [selected, setSelected] = useState<number | null>(null)
  const a = result.analysis
  const size = { w: a.width, h: a.height }
  const ratio = a.width / a.height
  const diff = useMemo(() => differencePixels(result.screen, result.reference), [result])
  const mask = useMemo(() => ({ data: a.mask, width: a.width, height: a.height }), [a])
  const pick = selected !== null && selected < a.regions.length ? selected : null
  const portrait = ratio < 1

  const regions = <Regions regions={a.regions} size={size} hovered={hovered} selected={pick} />
  let view: React.ReactNode
  if (mode === "2-up") {
    view = (
      <div className={cn("grid gap-3", portrait ? "grid-cols-2" : "grid-cols-1")}>
        {(
          [
            ["Reference", result.reference],
            ["Screen", result.screen],
          ] as const
        ).map(([label, pixels]) => (
          <figure key={label} className="grid gap-1">
            <figcaption className="text-muted-foreground text-xs">{label}</figcaption>
            <Frame ratio={ratio}>
              <PixelCanvas pixels={pixels} className={fill} />
              {regions}
            </Frame>
          </figure>
        ))}
      </div>
    )
  } else if (mode === "swipe") {
    view = (
      <div className="grid gap-2">
        <Frame ratio={ratio} className={cn(portrait && "mx-auto max-h-[70vh]")}>
          <PixelCanvas pixels={result.screen} className={fill} />
          <PixelCanvas
            pixels={result.reference}
            className={fill}
            style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
          />
          <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-sky-400" style={{ left: `${split}%` }} />
          {regions}
        </Frame>
        <Slider
          value={[split]}
          onValueChange={([v]) => setSplit(v ?? 50)}
          aria-label="Reference on the left of the line"
        />
        <p className="text-muted-foreground text-xs">Reference left of the line, screen right of it.</p>
      </div>
    )
  } else if (mode === "onion") {
    view = (
      <div className="grid gap-2">
        <Frame ratio={ratio} className={cn(portrait && "mx-auto max-h-[70vh]")}>
          <PixelCanvas pixels={result.screen} className={fill} />
          <PixelCanvas pixels={result.reference} className={fill} style={{ opacity: onion / 100 }} />
          {regions}
        </Frame>
        <Slider value={[onion]} onValueChange={([v]) => setOnion(v ?? 50)} aria-label="Reference opacity" />
      </div>
    )
  } else {
    view = (
      <div className="grid gap-2">
        <Frame ratio={ratio} className={cn("bg-black", portrait && "mx-auto max-h-[70vh]")}>
          <PixelCanvas pixels={diff} className={fill} />
          <PixelCanvas mask={mask} color={diffColor} className={cn(fill, "opacity-60 mix-blend-screen")} />
          {regions}
        </Frame>
        <p className="text-muted-foreground text-xs">
          Black where the screen matches; colour shows how far a pixel is off, red marks what counts as a difference.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={mode}
        onValueChange={(v) => v && setMode(v as Mode)}
        className="flex-wrap"
      >
        {modes.map((m) => (
          <ToggleGroupItem key={m.value} value={m.value}>
            {m.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {view}
      {a.regions.length > 0 && (
        <ol className="grid gap-1 text-sm" onPointerLeave={() => pp.hover(null)}>
          {a.regions.map((r, i) => (
            <li key={`${r.x}-${r.y}`}>
              <button
                type="button"
                className={cn(
                  "hover:bg-muted flex w-full cursor-pointer items-baseline gap-2 rounded-md px-2 py-1 text-left",
                  pick === i && "bg-muted",
                )}
                onPointerEnter={() => pp.hover(i)}
                onClick={() => setSelected(pick === i ? null : i)}
              >
                <span className="w-6 shrink-0 font-mono text-xs font-semibold text-red-500">#{i + 1}</span>
                <span className="grid min-w-0 flex-1">
                  <span className="truncate">{describe(r.kind, result.toDevice)}</span>
                  <MatchLines result={result} index={i} />
                </span>
                <span className="text-muted-foreground shrink-0 font-mono text-xs">
                  {Math.round(r.w * result.toDevice)}×{Math.round(r.h * result.toDevice)}
                </span>
              </button>
              {pick === i && <Inspector result={result} region={r} diff={diff} />}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function crop(p: Pixels, b: Box): Pixels {
  const w = Math.max(1, Math.round(b.w))
  const h = Math.max(1, Math.round(b.h))
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const from = ((Math.round(b.y) + y) * p.width + Math.round(b.x)) * 4
    out.set(p.data.subarray(from, from + w * 4), y * w * 4)
  }
  return { data: out, width: w, height: h }
}

function Inspector({ result, region, diff }: { result: Result; region: Region; diff: Pixels }) {
  const a = result.analysis
  const margin = Math.max(12, Math.round(Math.max(region.w, region.h) * 0.25))
  const x = Math.max(0, region.x - margin)
  const y = Math.max(0, region.y - margin)
  const w = Math.min(a.width, region.x + region.w + margin) - x
  const h = Math.min(a.height, region.y + region.h + margin) - y
  const crops = useMemo(() => {
    const box = { x, y, w, h }
    return [
      ["Reference", crop(result.reference, box)],
      ["Difference", crop(diff, box)],
      ["Screen", crop(result.screen, box)],
    ] as const
  }, [result, diff, x, y, w, h])
  const box = { x, y, w, h }
  const inner = { x: region.x - box.x, y: region.y - box.y, w: region.w, h: region.h }
  const m = result.matches[result.analysis.regions.indexOf(region)] ?? null
  return (
    <div className="grid gap-3 px-2 pt-1 pb-3">
      <div className="grid grid-cols-3 gap-2">
        {crops.map(([label, pixels]) => (
          <figure key={label} className="grid content-start gap-1">
            <figcaption className="text-muted-foreground text-xs">{label}</figcaption>
            <div className="ring-border relative overflow-hidden rounded ring-1" style={{ aspectRatio: box.w / box.h }}>
              <PixelCanvas pixels={pixels} className="absolute inset-0 size-full [image-rendering:pixelated]" />
              <div
                className="pointer-events-none absolute outline-1 outline-red-500/80 outline-dashed"
                style={percentBox(inner, { w: box.w, h: box.h })}
              />
            </div>
          </figure>
        ))}
      </div>
      {m?.element && result.webview && (
        <ElementInfo el={m.element} kind={region.kind} cssScale={result.webview.scale} />
      )}
      {m?.view && !m.element && <ViewInfo view={m.view} result={result} />}
      {m?.layer && <DesignInfo match={m} layer={m.layer} kind={region.kind} result={result} />}
    </div>
  )
}

function MatchLines({ result, index }: { result: Result; index: number }) {
  const m = result.matches[index]
  if (!m) return null
  const unit = designUnitName(result)
  const own = m.element
    ? `${m.element.label}${m.element.text ? ` “${m.element.text}”` : ""}`
    : m.view
      ? `${m.view.label}${m.view.text || m.view.description ? ` “${m.view.text || m.view.description}”` : ""}`
      : ""
  return (
    <>
      {own && <span className="text-muted-foreground truncate font-mono text-xs">{own}</span>}
      {m.layer && (
        <span className="truncate text-xs text-fuchsia-600 dark:text-fuchsia-400" title={m.layer.path}>
          ◆ {m.layer.path}
        </span>
      )}
      {m.measures.length > 0 && (
        <span className="truncate text-xs text-amber-700 dark:text-amber-400">
          {m.measures.map((x) => `${x.label} ${x.actual} ${unit} instead of ${x.design}`).join(", ")}
        </span>
      )}
    </>
  )
}

/** Figma's units are dp for a frame drawn at a phone's width in dp, pixels for a bigger one. */
function designUnitName(result: Result) {
  return result.frame.w / result.unit <= 600 ? "dp" : "px"
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="truncate">{v}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

const round1 = (v: number) => Math.round(v * 10) / 10

function ViewInfo({ view, result }: { view: NativeView; result: Result }) {
  const w = view.box.w * result.toDevice
  const h = view.box.h * result.toDevice
  const rows: [string, React.ReactNode][] = [["size", `${Math.round(w)} × ${Math.round(h)} px`]]
  if (result.density) rows.push(["", `${round1(w / result.density)} × ${round1(h / result.density)} dp`])
  if (view.text) rows.push(["text", `“${view.text}”`])
  if (view.description) rows.push(["description", `“${view.description}”`])
  if (view.path) rows.push(["path", view.path])
  return (
    <div className="bg-muted/40 grid gap-2 rounded-lg border p-2 text-xs">
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <code className="truncate font-semibold">{view.label}</code>
          <code className="text-muted-foreground truncate" title={view.class}>
            {view.resourceId || view.class}
          </code>
        </div>
        {view.resourceId && <CopyButton text={view.resourceId} label="Copy the resource id" />}
      </div>
      <Rows rows={rows} />
    </div>
  )
}

function DesignInfo({
  match,
  layer,
  kind,
  result,
}: {
  match: RegionMatch
  layer: DesignLayer
  kind: RegionKind
  result: Result
}) {
  const unit = designUnitName(result)
  const rows: [string, React.ReactNode][] = [["size", `${layer.w} × ${layer.h} ${unit}`]]
  if (layer.text) rows.push(["text", `“${layer.text}”`])
  if (layer.fill) rows.push(["fill", <Swatch key="fill" color={layer.fill} />])
  if (kind.type === "color") rows.push(["on screen", <Swatch key="screen" color={kind.screen} />])
  if (layer.stroke)
    rows.push(["stroke", <Swatch key="stroke" color={layer.stroke} suffix={` ${layer.strokeWeight ?? 1}`} />])
  if (layer.radius?.length) rows.push(["radius", layer.radius.join(" ")])
  if (layer.font) {
    const f = layer.font
    rows.push(["font", `${f.family} ${f.weight ?? ""} ${f.size}`.replace(/\s+/g, " ")])
    if (f.lineHeight) rows.push(["line height", String(f.lineHeight)])
    if (f.letterSpacing) rows.push(["letter spacing", String(f.letterSpacing)])
  }
  if (layer.padding) rows.push(["padding", layer.padding.join(" ")])
  if (layer.gap) rows.push(["gap", String(layer.gap)])
  if (layer.opacity) rows.push(["opacity", String(layer.opacity)])
  return (
    <div className="grid gap-2 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/5 p-2 text-xs">
      <div className="grid min-w-0 gap-0.5">
        <span className="truncate font-semibold">◆ {layer.name}</span>
        <span className="text-muted-foreground truncate" title={layer.path}>
          {layer.path} · {layer.type.toLowerCase()} in Figma
        </span>
      </div>
      <Rows rows={rows} />
      {match.implementation && (
        <div className="grid gap-1">
          <span className="text-muted-foreground">
            On the screen it is <code>{match.implementation.label}</code>
            {match.measures.length ? ":" : ", where the design puts it."}
          </span>
          {match.measures.length > 0 && (
            <table className="w-fit font-mono">
              <thead className="text-muted-foreground">
                <tr>
                  <th />
                  <th className="px-2 text-right font-normal">design</th>
                  <th className="px-2 text-right font-normal">screen</th>
                  <th className="px-2 text-right font-normal">off by</th>
                </tr>
              </thead>
              <tbody>
                {match.measures.map((x) => (
                  <tr key={x.label}>
                    <td className="text-muted-foreground pr-2">{x.label}</td>
                    <td className="px-2 text-right">{x.design}</td>
                    <td className="px-2 text-right">{x.actual}</td>
                    <td className="px-2 text-right text-amber-700 dark:text-amber-400">
                      {x.actual > x.design ? "+" : ""}
                      {round1(x.actual - x.design)} {unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function Swatch({ color, suffix }: { color: string; suffix?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="ring-border inline-block size-3 rounded-sm ring-1" style={{ background: color }} />
      {color}
      {suffix}
    </span>
  )
}

const relevant: Record<RegionKind["type"], string[]> = {
  shift: ["margin", "padding", "gap", "position", "transform", "line-height"],
  color: ["color", "background-color", "border", "opacity"],
  missing: ["display", "width", "height", "opacity"],
  extra: ["display", "width", "height", "opacity"],
  differs: [
    "width",
    "height",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "border-radius",
  ],
}

function cssShift(kind: RegionKind, scale: number) {
  if (kind.type !== "shift") return null
  const dx = Math.round((kind.dx / scale) * 10) / 10
  const dy = Math.round((kind.dy / scale) * 10) / 10
  const parts = []
  if (dx) parts.push(`${Math.abs(dx)} CSS px ${dx > 0 ? "right" : "left"}`)
  if (dy) parts.push(`${Math.abs(dy)} CSS px ${dy > 0 ? "down" : "up"}`)
  return parts.join(", ")
}

function ElementInfo({ el, kind, cssScale }: { el: ScreenElement; kind: RegionKind; cssScale: number }) {
  const shift = cssShift(kind, cssScale)
  const styles = relevant[kind.type].filter((p) => el.styles[p])
  return (
    <div className="bg-muted/40 grid gap-2 rounded-lg border p-2 text-xs">
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <code className="truncate font-semibold">{el.label}</code>
          <code className="text-muted-foreground truncate" title={el.selector}>
            {el.selector}
          </code>
          {el.text && <span className="text-muted-foreground truncate">“{el.text}”</span>}
        </div>
        <CopyButton text={el.selector} label="Copy the selector" />
      </div>
      {shift && <p>In the page: {shift}.</p>}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono">
        <dt className="text-muted-foreground">size</dt>
        <dd className="truncate">
          {Math.round(el.rect.w * 10) / 10} × {Math.round(el.rect.h * 10) / 10}
        </dd>
        {styles.map((p) => (
          <Fragment key={p}>
            <dt className="text-muted-foreground">{p}</dt>
            <dd className="truncate" title={el.styles[p]}>
              {el.styles[p]}
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  )
}
