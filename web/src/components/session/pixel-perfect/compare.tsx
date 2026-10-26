import { useMemo, useState } from "react"
import { PixelCanvas } from "@/components/session/pixel-perfect/mask-canvas"
import type { PixelPerfect, Result } from "@/components/session/pixel-perfect/state"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { differencePixels } from "@/lib/pixel-perfect/capture"
import { describe, type Pixels, type Region } from "@/lib/pixel-perfect/diff"
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
        <ol className="grid gap-1 text-sm" onPointerLeave={() => pp.set({ hovered: null })}>
          {a.regions.map((r, i) => (
            <li key={`${r.x}-${r.y}`}>
              <button
                type="button"
                className={cn(
                  "hover:bg-muted flex w-full cursor-pointer items-baseline gap-2 rounded-md px-2 py-1 text-left",
                  pick === i && "bg-muted",
                )}
                onPointerEnter={() => pp.set({ hovered: i })}
                onClick={() => setSelected(pick === i ? null : i)}
              >
                <span className="w-6 shrink-0 font-mono text-xs font-semibold text-red-500">#{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{describe(r.kind, result.toDevice)}</span>
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
  return (
    <div className="grid grid-cols-3 gap-2 px-2 pt-1 pb-3">
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
  )
}
