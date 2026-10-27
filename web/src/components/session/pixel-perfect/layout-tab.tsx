import {
  BookmarkPlusIcon,
  Loader2Icon,
  MoveIcon,
  PlusIcon,
  RotateCcwIcon,
  ScanIcon,
  SquareDashedIcon,
  Trash2Icon,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import type { ReferenceView, SessionView } from "@/api/client"
import { useLayoutPresets, useSaveLayoutPresets } from "@/api/queries"
import { IconButton } from "@/components/session/icon-button"
import { type PixelPerfect, usePixelState } from "@/components/session/pixel-perfect/state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { probeViews } from "@/lib/pixel-perfect/elements"
import {
  appWindowInsets,
  defaultLayout,
  describeArea,
  type Grid,
  type Guide,
  type Insets,
  noInsets,
  type ReferenceLayout,
  sameLayout,
  type WorkArea,
} from "@/lib/pixel-perfect/layout"
import { cn } from "@/lib/utils"

export function Block({ children }: { children: React.ReactNode }) {
  return <section className="grid gap-2.5 border-b px-3 py-3 last:border-b-0">{children}</section>
}

export function BlockHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-2">
      <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</h4>
      {children}
    </div>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  suffix,
  step = 1,
  min,
  className,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  suffix?: string
  step?: number
  min?: number
  className?: string
}) {
  return (
    <label className={cn("grid gap-1 text-xs", className)}>
      <span className="text-muted-foreground">{label}</span>
      <div className="relative">
        <Input
          type="number"
          step={step}
          min={min}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => {
            const v = e.target.valueAsNumber
            if (Number.isFinite(v)) onChange(min === undefined ? v : Math.max(min, v))
          }}
          className={cn("h-8 font-mono text-sm tabular-nums", suffix && "pr-8")}
        />
        {suffix && (
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs">
            {suffix}
          </span>
        )}
      </div>
    </label>
  )
}

export function LayoutTab({
  pp,
  reference: r,
  session,
}: {
  pp: PixelPerfect
  reference: ReferenceView
  session: SessionView
}) {
  const layout = pp.layout(r)
  return (
    <div className="grid">
      <AreaBlock pp={pp} reference={r} session={session} layout={layout} />
      <PositionBlock pp={pp} reference={r} />
      <GridBlock grid={layout.grid} onChange={(grid) => pp.editLayout(r, { grid })} />
      <GuidesBlock pp={pp} reference={r} guides={layout.guides} />
    </div>
  )
}

const kinds: { value: WorkArea["kind"]; label: string }[] = [
  { value: "screen", label: "Whole screen" },
  { value: "insets", label: "Insets" },
  { value: "box", label: "Drawn" },
]

function AreaBlock({
  pp,
  reference: r,
  session,
  layout,
}: {
  pp: PixelPerfect
  reference: ReferenceView
  session: SessionView
  layout: ReferenceLayout
}) {
  const state = usePixelState(pp)
  const presets = useLayoutPresets()
  const save = useSaveLayoutPresets()
  const [naming, setNaming] = useState<string | null>(null)
  const [detecting, setDetecting] = useState(false)
  const items = presets.data?.items ?? []
  const current = items.find((p) => sameLayout(p, layout))
  const area = layout.area
  const setArea = (patch: Partial<WorkArea>) => pp.editLayout(r, { area: { ...area, ...patch } })
  const setInsets = (patch: Partial<Insets>) => setArea({ kind: "insets", insets: { ...area.insets, ...patch } })

  const detect = async () => {
    const display = session.capabilities?.screen
    if (!display) {
      toast.error("This device doesn't say its screen size and density")
      return
    }
    setDetecting(true)
    try {
      const insets = appWindowInsets(await probeViews(session.provider, session.id), session.package, display)
      if (insets) setInsets(insets)
      else toast.error("The app's window isn't on the screen", { description: "Open the app and try again." })
    } catch (e) {
      toast.error("Could not read the app's window", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setDetecting(false)
    }
  }

  const savePreset = () => {
    const name = naming?.trim()
    setNaming(null)
    if (!name) return
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    save.mutate([...items, { id, name, area: layout.area, grid: layout.grid, guides: layout.guides }], {
      onSuccess: () => toast.success(`Saved “${name}”`),
      onError: (e) => toast.error("Could not save", { description: e.message }),
    })
  }

  const removePreset = (id: string) =>
    save.mutate(
      items.filter((p) => p.id !== id),
      { onError: (e) => toast.error("Could not delete", { description: e.message }) },
    )

  return (
    <Block>
      <BlockHead title="Work area">
        <IconButton label="Save as a preset" onClick={() => setNaming(naming === null ? describeArea(area) : null)}>
          <BookmarkPlusIcon />
        </IconButton>
      </BlockHead>
      <div className="flex items-center gap-2">
        <Select
          value={current?.id ?? "custom"}
          onValueChange={(id) => {
            if (id === "default") pp.edit(r, { layout: defaultLayout })
            const p = items.find((x) => x.id === id)
            if (p) pp.edit(r, { layout: { area: p.area, grid: p.grid, guides: p.guides } })
          }}
        >
          <SelectTrigger size="sm" className="min-w-0 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="custom" disabled>
              {current ? current.name : "This reference's own"}
            </SelectItem>
            <SelectItem value="default">Whole screen, no grid</SelectItem>
            {items.length > 0 && (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Saved</SelectLabel>
                  {items.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            )}
          </SelectContent>
        </Select>
        {current && (
          <IconButton label={`Delete the preset “${current.name}”`} onClick={() => removePreset(current.id)}>
            <Trash2Icon />
          </IconButton>
        )}
      </div>
      {naming !== null && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            savePreset()
          }}
        >
          <Input
            autoFocus
            value={naming}
            maxLength={80}
            onChange={(e) => setNaming(e.target.value)}
            placeholder="Preset name"
            className="h-8"
          />
          <Button size="sm" type="submit" disabled={!naming.trim() || save.isPending}>
            Save
          </Button>
        </form>
      )}
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={area.kind}
        onValueChange={(v) => {
          if (!v) return
          if (v === "box") pp.set({ tool: "area" })
          else setArea({ kind: v as WorkArea["kind"] })
        }}
        className="w-full"
      >
        {kinds.map((k) => (
          <ToggleGroupItem key={k.value} value={k.value} className="flex-1">
            {k.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {area.kind === "insets" && (
        <>
          <div className="grid grid-cols-4 gap-2">
            <NumberField
              label="Top"
              value={area.insets.top}
              min={0}
              suffix="dp"
              onChange={(top) => setInsets({ top })}
            />
            <NumberField
              label="Right"
              value={area.insets.right}
              min={0}
              suffix="dp"
              onChange={(right) => setInsets({ right })}
            />
            <NumberField
              label="Bottom"
              value={area.insets.bottom}
              min={0}
              suffix="dp"
              onChange={(bottom) => setInsets({ bottom })}
            />
            <NumberField
              label="Left"
              value={area.insets.left}
              min={0}
              suffix="dp"
              onChange={(left) => setInsets({ left })}
            />
          </div>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" disabled={detecting} onClick={() => void detect()}>
              {detecting ? <Loader2Icon className="animate-spin" /> : <ScanIcon />}
              App window
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setInsets({ top: 24, bottom: 48, left: 0, right: 0 })}>
              Without system bars
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setInsets(noInsets)}>
              Clear
            </Button>
          </div>
        </>
      )}
      {area.kind === "box" && (
        <Button
          size="sm"
          variant={state.tool === "area" ? "secondary" : "outline"}
          onClick={() => pp.set({ tool: state.tool === "area" ? "none" : "area" })}
        >
          <SquareDashedIcon />
          {state.tool === "area" ? "Drawing… drag over the screen" : "Draw again"}
        </Button>
      )}
      <p className="text-muted-foreground text-xs">
        The reference is fitted to this area, the grid and guides start at its corner, and the comparison skips what
        lies outside it. Insets in dp fit any screen; “App window” reads them from the app.
      </p>
    </Block>
  )
}

function PositionBlock({ pp, reference: r }: { pp: PixelPerfect; reference: ReferenceView }) {
  const state = usePixelState(pp)
  const p = pp.draft(r).placement
  return (
    <Block>
      <BlockHead title="Position">
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={state.tool === "move" ? "secondary" : "ghost"}
            onClick={() => pp.set({ tool: state.tool === "move" ? "none" : "move" })}
          >
            <MoveIcon />
            Move
          </Button>
          <IconButton
            label="Fit to the area again"
            onClick={() => pp.edit(r, { placement: { x: 0, y: 0, scale: 1 } })}
            disabled={p.x === 0 && p.y === 0 && p.scale === 1}
          >
            <RotateCcwIcon />
          </IconButton>
        </div>
      </BlockHead>
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="X" value={p.x} suffix="px" onChange={(x) => pp.edit(r, { placement: { ...p, x } })} />
        <NumberField label="Y" value={p.y} suffix="px" onChange={(y) => pp.edit(r, { placement: { ...p, y } })} />
        <NumberField
          label="Scale"
          value={Math.round(p.scale * 1000) / 10}
          suffix="%"
          step={0.5}
          onChange={(v) => pp.edit(r, { placement: { ...p, scale: Math.min(2000, Math.max(5, v)) / 100 } })}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        100% fits the image to the area&apos;s width. X and Y are in the image&apos;s pixels ({r.width}×{r.height}).
        With Move on, drag it (it snaps to the area, columns and guides; hold Alt not to) or use the arrows, Shift for
        10 px.
      </p>
    </Block>
  )
}

const gridPresets: { label: string; grid: Grid }[] = [
  { label: "4 columns", grid: { columns: 4, margin: 16, gutter: 16, baseline: 0 } },
  { label: "8 columns", grid: { columns: 8, margin: 24, gutter: 24, baseline: 0 } },
  { label: "8 dp rows", grid: { columns: 0, margin: 0, gutter: 0, baseline: 8 } },
]

function GridBlock({ grid, onChange }: { grid: Grid; onChange: (g: Grid) => void }) {
  const on = grid.columns > 0 || grid.baseline > 0
  return (
    <Block>
      <BlockHead title="Grid">
        {on && (
          <Button size="sm" variant="ghost" onClick={() => onChange(defaultLayout.grid)}>
            Off
          </Button>
        )}
      </BlockHead>
      <div className="grid grid-cols-4 gap-2">
        <NumberField
          label="Columns"
          value={grid.columns}
          min={0}
          onChange={(columns) => onChange({ ...grid, columns: Math.min(24, Math.round(columns)) })}
        />
        <NumberField
          label="Margin"
          value={grid.margin}
          min={0}
          suffix="dp"
          onChange={(margin) => onChange({ ...grid, margin })}
        />
        <NumberField
          label="Gutter"
          value={grid.gutter}
          min={0}
          suffix="dp"
          onChange={(gutter) => onChange({ ...grid, gutter })}
        />
        <NumberField
          label="Rows"
          value={grid.baseline}
          min={0}
          suffix="dp"
          onChange={(baseline) => onChange({ ...grid, baseline })}
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {gridPresets.map((g) => (
          <Button key={g.label} size="sm" variant="ghost" onClick={() => onChange({ ...grid, ...pick(g.grid) })}>
            {g.label}
          </Button>
        ))}
      </div>
    </Block>
  )
}

function pick(g: Grid): Partial<Grid> {
  return g.columns > 0 ? { columns: g.columns, margin: g.margin, gutter: g.gutter } : { baseline: g.baseline }
}

function GuidesBlock({ pp, reference: r, guides }: { pp: PixelPerfect; reference: ReferenceView; guides: Guide[] }) {
  const state = usePixelState(pp)
  const set = (next: Guide[]) => pp.editLayout(r, { guides: next })
  const sorted = guides
    .map((g, i) => ({ g, i }))
    .toSorted((a, b) => a.g.axis.localeCompare(b.g.axis) || a.g.pos - b.g.pos)
  return (
    <Block>
      <BlockHead title="Guides">
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={state.tool === "guides" ? "secondary" : "ghost"}
            onClick={() => pp.set({ tool: state.tool === "guides" ? "none" : "guides" })}
          >
            Rulers
          </Button>
          <IconButton label="Add a vertical guide" onClick={() => set([...guides, { axis: "x", pos: 16 }])}>
            <PlusIcon />
          </IconButton>
        </div>
      </BlockHead>
      {sorted.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          Turn on Rulers and drag from the top or left edge of the screen to add one, or add it here.
        </p>
      ) : (
        <ul className="grid gap-1">
          {sorted.map(({ g, i }) => (
            <li key={i} className="flex items-center gap-2">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={g.axis}
                onValueChange={(axis) =>
                  axis && set(guides.map((x, j) => (j === i ? { ...x, axis: axis as Guide["axis"] } : x)))
                }
              >
                <ToggleGroupItem value="x" title="Vertical, from the area's left edge">
                  ↔ x
                </ToggleGroupItem>
                <ToggleGroupItem value="y" title="Horizontal, from the area's top edge">
                  ↕ y
                </ToggleGroupItem>
              </ToggleGroup>
              <NumberField
                label=""
                value={g.pos}
                suffix="dp"
                step={0.5}
                className="flex-1 [&>span]:hidden"
                onChange={(pos) => set(guides.map((x, j) => (j === i ? { ...x, pos } : x)))}
              />
              <IconButton label="Remove the guide" onClick={() => set(guides.filter((_, j) => j !== i))}>
                <Trash2Icon />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Block>
  )
}
