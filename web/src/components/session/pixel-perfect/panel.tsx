import {
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  ImagePlusIcon,
  Loader2Icon,
  MoveIcon,
  PencilIcon,
  RotateCcwIcon,
  ScanSearchIcon,
  SnowflakeIcon,
  SquareDashedIcon,
  Trash2Icon,
} from "lucide-react"
import { type DragEvent, useEffect, useEffectEvent, useRef, useState } from "react"
import { toast } from "sonner"
import type { ReferenceView, SessionView } from "@/api/client"
import { useDeleteReference, useReferences, useUpdateReference, useUploadReference } from "@/api/queries"
import { IconButton } from "@/components/session/icon-button"
import { Compare } from "@/components/session/pixel-perfect/compare"
import { type Blend, type PixelPerfect, usePixelState } from "@/components/session/pixel-perfect/state"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { download } from "@/lib/adb"
import { formatBytes, formatRelative, formatSpan } from "@/lib/format"
import { renderReport } from "@/lib/pixel-perfect/report"
import { cn } from "@/lib/utils"

const accepted = ["image/png", "image/jpeg", "image/webp"]

const blends: { value: Blend; label: string; hint: string }[] = [
  { value: "normal", label: "Normal", hint: "The reference as it is, see-through" },
  { value: "difference", label: "Difference", hint: "Matching pixels turn black, anything off lights up" },
  { value: "invert", label: "Invert", hint: "The reference inverted: matching areas fade to grey" },
]

function stamp() {
  return new Date().toISOString().slice(0, 19).replaceAll(":", "-")
}

export function PixelPerfectPanel({
  pp,
  session,
  active,
}: {
  pp: PixelPerfect
  session: SessionView
  active: boolean
}) {
  const state = usePixelState(pp)
  const refs = useReferences()
  const upload = useUploadReference()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const items = refs.data?.items ?? []
  const ref = items.find((r) => r.id === state.referenceId) ?? null

  const add = (file: Blob, name: string) => {
    if (!accepted.includes(file.type)) {
      toast.error("Only PNG, JPEG and WebP images can be references")
      return
    }
    upload.mutate(
      { file, name, pkg: session.package },
      {
        onSuccess: (v) => pp.select(v.id),
        onError: (e) => toast.error("Could not add the reference", { description: e.message }),
      },
    )
  }

  const onPaste = useEffectEvent((e: ClipboardEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]")) return
    const file = Array.from(e.clipboardData?.files ?? []).find((f) => accepted.includes(f.type))
    if (!file) return
    e.preventDefault()
    add(file, `Pasted ${new Date().toLocaleString()}`)
  })
  useEffect(() => {
    if (!active) return undefined
    const listener = (e: ClipboardEvent) => onPaste(e)
    document.addEventListener("paste", listener)
    return () => document.removeEventListener("paste", listener)
  }, [active])

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    for (const f of Array.from(e.dataTransfer.files)) add(f, f.name.replace(/\.[^.]+$/, ""))
  }

  if (refs.data && !refs.data.enabled) {
    return (
      <div className="text-muted-foreground grid h-full place-items-center p-6 text-center text-sm">
        Pixel perfect references are turned off on this server.
      </div>
    )
  }

  return (
    <div
      className={cn("@container relative h-full min-h-0 overflow-y-auto", dragging && "bg-primary/5")}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <input
        ref={input}
        type="file"
        accept={accepted.join(",")}
        multiple
        hidden
        onChange={(e) => {
          for (const f of Array.from(e.target.files ?? [])) add(f, f.name.replace(/\.[^.]+$/, ""))
          e.target.value = ""
        }}
      />
      <div className="grid gap-4 p-3 @3xl:grid-cols-[17rem_minmax(0,1fr)]">
        <Library
          pp={pp}
          items={items}
          selected={state.referenceId}
          pkg={session.package}
          uploading={upload.isPending}
          onAdd={() => input.current?.click()}
          rules={refs.data}
        />
        <div className="grid min-w-0 content-start gap-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          {ref ? (
            <Controls pp={pp} reference={ref} session={session} />
          ) : (
            <Empty onAdd={() => input.current?.click()} hasItems={items.length > 0} />
          )}
        </div>
      </div>
      {dragging && (
        <div className="border-primary bg-background/70 pointer-events-none absolute inset-2 grid place-items-center rounded-xl border-2 border-dashed text-sm font-medium">
          Drop images to add them as references
        </div>
      )}
    </div>
  )
}

function Empty({ onAdd, hasItems }: { onAdd: () => void; hasItems: boolean }) {
  return (
    <div className="text-muted-foreground grid place-items-center gap-3 rounded-xl border border-dashed p-8 text-center text-sm">
      <ImagePlusIcon className="size-8 opacity-60" />
      <p className="max-w-sm">
        {hasItems
          ? "Pick a reference to lay it over the screen, or add another one."
          : "Add a design mockup to lay it over the screen."}{" "}
        Drop an image here, paste one copied from Figma (⌘V / Ctrl+V) or choose a file.
      </p>
      <Button size="sm" variant="outline" onClick={onAdd}>
        <ImagePlusIcon />
        Add image
      </Button>
    </div>
  )
}

function Library({
  pp,
  items,
  selected,
  pkg,
  uploading,
  onAdd,
  rules,
}: {
  pp: PixelPerfect
  items: ReferenceView[]
  selected: string | null
  pkg: string
  uploading: boolean
  onAdd: () => void
  rules?: { quota: number; used: number; maxAge: number }
}) {
  const sorted = items.toSorted((a, b) => Number(b.package === pkg) - Number(a.package === pkg))
  return (
    <section className="grid content-start gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">References</h3>
        <Button size="sm" variant="outline" onClick={onAdd} disabled={uploading}>
          {uploading ? <Loader2Icon className="animate-spin" /> : <ImagePlusIcon />}
          Add
        </Button>
      </div>
      {sorted.length > 0 && (
        <ul className="grid max-h-[50vh] gap-1 overflow-y-auto @3xl:max-h-none">
          {sorted.map((r) => (
            <ReferenceItem key={r.id} pp={pp} reference={r} active={r.id === selected} thisApp={r.package === pkg} />
          ))}
        </ul>
      )}
      {rules && (
        <div className="text-muted-foreground grid gap-1.5 text-xs">
          {rules.quota > 0 && (
            <>
              <Progress value={Math.min(100, (rules.used / rules.quota) * 100)} className="h-1" />
              <span>
                {formatBytes(rules.used)} of {formatBytes(rules.quota)}
              </span>
            </>
          )}
          {rules.maxAge > 0 && <span>Images unused for {formatSpan(rules.maxAge)} are deleted.</span>}
          <span>Paste an image (⌘V / Ctrl+V) or drop it here to add it.</span>
        </div>
      )}
    </section>
  )
}

function ReferenceItem({
  pp,
  reference: r,
  active,
  thisApp,
}: {
  pp: PixelPerfect
  reference: ReferenceView
  active: boolean
  thisApp: boolean
}) {
  const rename = useUpdateReference()
  const remove = useDeleteReference()
  const [name, setName] = useState<string | null>(null)

  const save = () => {
    if (name === null) return
    const next = name.trim()
    setName(null)
    if (!next || next === r.name) return
    rename.mutate(
      { ref: { ...r, ...pp.draft(r) }, name: next },
      { onError: (e) => toast.error("Could not rename", { description: e.message }) },
    )
  }

  return (
    <li
      className={cn(
        "group/item hover:bg-muted/60 flex items-center gap-2 rounded-lg p-1.5",
        active && "bg-muted ring-primary/40 ring-1",
      )}
    >
      <button
        type="button"
        className="bg-muted size-12 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-black/10"
        onClick={() => pp.select(active ? null : r.id)}
        aria-label={active ? `Hide ${r.name}` : `Use ${r.name}`}
      >
        <img src={`${r.imageUrl}?preview`} alt="" loading="lazy" className="size-full object-cover object-top" />
      </button>
      <div className="grid min-w-0 flex-1">
        {name !== null ? (
          <Input
            autoFocus
            value={name}
            maxLength={120}
            className="h-7 text-sm"
            onChange={(e) => setName(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") save()
              if (e.key === "Escape") setName(null)
            }}
          />
        ) : (
          <button
            type="button"
            className="cursor-pointer truncate text-left text-sm font-medium"
            onClick={() => pp.select(active ? null : r.id)}
            onDoubleClick={() => setName(r.name)}
            title={r.name}
          >
            {r.name}
          </button>
        )}
        <span className="text-muted-foreground truncate text-xs">
          {r.width}×{r.height} · {formatBytes(r.size)}
          {thisApp ? " · this app" : r.package ? ` · ${r.package}` : ""}
        </span>
        <span className="text-muted-foreground truncate text-xs">Used {formatRelative(r.lastUsedAt)}</span>
      </div>
      <div className="flex shrink-0 flex-col opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100">
        <IconButton label="Rename" className="size-6" onClick={() => setName(r.name)}>
          <PencilIcon />
        </IconButton>
        <IconButton
          label="Delete"
          className="size-6"
          disabled={remove.isPending}
          onClick={() => {
            if (!window.confirm(`Delete the reference “${r.name}”?`)) return
            if (active) pp.select(null)
            remove.mutate(r.id, { onError: (e) => toast.error("Could not delete", { description: e.message }) })
          }}
        >
          <Trash2Icon />
        </IconButton>
      </div>
    </li>
  )
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
  step = 1,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  suffix?: string
  step?: number
}) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="relative">
        <Input
          type="number"
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => {
            const v = e.target.valueAsNumber
            if (Number.isFinite(v)) onChange(v)
          }}
          className="h-8 pr-7 font-mono text-sm tabular-nums"
        />
        {suffix && (
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
            {suffix}
          </span>
        )}
      </div>
    </label>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return <section className="grid gap-3 rounded-xl border p-3">{children}</section>
}

function SectionHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h4 className="text-sm font-medium">{title}</h4>
      {children}
    </div>
  )
}

function Controls({ pp, reference: r, session }: { pp: PixelPerfect; reference: ReferenceView; session: SessionView }) {
  const state = usePixelState(pp)
  const draft = pp.draft(r)
  const p = draft.placement
  const result = state.result?.referenceId === r.id ? state.result : null
  const [exporting, setExporting] = useState(false)

  const exportReport = async () => {
    if (!result) return
    setExporting(true)
    try {
      const blob = await renderReport({
        ...result,
        title: r.name,
        subtitle: [
          session.label || session.package,
          session.versionName,
          session.capabilities?.screen?.label,
          new Date(result.at).toLocaleString(),
        ]
          .filter(Boolean)
          .join(" · "),
        source:
          result.source === "screenshot" ? "screenshot" : result.source === "frozen" ? "frozen frame" : "stream frame",
      })
      download(blob, `${r.name.replace(/[^\w.-]+/g, "-")}-pixel-perfect-${stamp()}.png`)
    } catch (e) {
      toast.error("Could not make the report", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate font-medium" title={r.name}>
          {r.name}
        </h3>
        <IconButton
          label={state.visible ? "Hide the overlay" : "Show the overlay"}
          onClick={() => pp.set({ visible: !state.visible })}
          aria-pressed={!state.visible}
        >
          {state.visible ? <EyeIcon /> : <EyeOffIcon />}
        </IconButton>
        <Button
          size="sm"
          variant={state.frozen ? "secondary" : "outline"}
          disabled={state.freezing}
          onClick={() => (state.frozen ? pp.unfreeze() : void pp.freeze())}
        >
          {state.freezing ? <Loader2Icon className="animate-spin" /> : <SnowflakeIcon />}
          {state.frozen ? "Back to live" : "Freeze frame"}
        </Button>
        <Button size="sm" disabled={state.analyzing} onClick={() => void pp.analyze(session.capabilities?.screen)}>
          {state.analyzing ? <Loader2Icon className="animate-spin" /> : <ScanSearchIcon />}
          Find differences
        </Button>
      </div>

      <Section>
        <SectionHead title="Overlay" />
        <div className="grid gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Opacity</span>
            <span className="font-mono tabular-nums">{Math.round(state.opacity * 100)}%</span>
          </div>
          <Slider
            value={[Math.round(state.opacity * 100)]}
            onValueChange={([v]) => pp.set({ opacity: (v ?? 50) / 100 })}
            aria-label="Opacity"
          />
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={state.blend}
          onValueChange={(v) => v && pp.set({ blend: v as Blend })}
          className="flex-wrap"
        >
          {blends.map((b) => (
            <ToggleGroupItem key={b.value} value={b.value} title={b.hint}>
              {b.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Section>

      <Section>
        <SectionHead title="Position">
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
              label="Back to the screen's width"
              onClick={() => pp.edit(r, { placement: { x: 0, y: 0, scale: 1 } })}
              disabled={p.x === 0 && p.y === 0 && p.scale === 1}
            >
              <RotateCcwIcon />
            </IconButton>
          </div>
        </SectionHead>
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
          100% fits the image to the screen&apos;s width without going past its height. X and Y are in the image&apos;s
          own pixels ({r.width}×{r.height}). With Move on, drag it or use the arrow keys (Shift for 10 px).
        </p>
      </Section>

      <Section>
        <SectionHead title="Ignored areas">
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={state.tool === "ignore" ? "secondary" : "ghost"}
              onClick={() => pp.set({ tool: state.tool === "ignore" ? "none" : "ignore" })}
            >
              <SquareDashedIcon />
              Draw
            </Button>
            {draft.ignore.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => pp.edit(r, { ignore: [] })}>
                Clear {draft.ignore.length}
              </Button>
            )}
          </div>
        </SectionHead>
        <div className="flex items-start gap-3">
          <Switch
            id="pp-motion"
            checked={state.ignoreMotion}
            onCheckedChange={(v) => {
              pp.set({ ignoreMotion: v })
              if (state.result) void pp.analyze()
            }}
          />
          <Label htmlFor="pp-motion" className="grid gap-0.5 font-normal">
            <span className="text-sm">Skip what moves</span>
            <span className="text-muted-foreground text-xs">
              A few frames are compared first: video, animations and live content under the interface stay out of the
              comparison, only the interface above them counts.
            </span>
          </Label>
        </div>
        <div className="flex items-start gap-3">
          <Switch
            id="pp-media"
            checked={state.ignoreMedia}
            onCheckedChange={(v) => {
              pp.set({ ignoreMedia: v })
              if (state.result) void pp.analyze()
            }}
          />
          <Label htmlFor="pp-media" className="grid gap-0.5 font-normal">
            <span className="text-sm">Skip video, canvas and frames in WebViews</span>
            <span className="text-muted-foreground text-xs">
              Their boxes come from the page through DevTools, so a paused player is skipped too.
            </span>
          </Label>
        </div>
        <p className="text-muted-foreground text-xs">
          Draw areas over the screen to always skip them for this reference, such as a player or a map.
        </p>
      </Section>

      {result && (
        <Section>
          <SectionHead title="Differences">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 text-xs">
                <Switch
                  id="pp-regions"
                  size="sm"
                  checked={state.showRegions}
                  onCheckedChange={(v) => pp.set({ showRegions: v })}
                />
                <Label htmlFor="pp-regions" className="text-xs font-normal">
                  On the screen
                </Label>
              </div>
              <Button size="sm" variant="outline" disabled={exporting} onClick={() => void exportReport()}>
                {exporting ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
                Report
              </Button>
            </div>
          </SectionHead>
          <Summary result={result} />
          <Compare pp={pp} result={result} hovered={state.hovered} />
        </Section>
      )}
    </>
  )
}

function Summary({ result }: { result: NonNullable<ReturnType<PixelPerfect["get"]>["result"]> }) {
  const a = result.analysis
  const pct = (a.match * 100).toFixed(a.match > 0.999 && a.match < 1 ? 2 : 1)
  const from = { screenshot: "a screenshot", frozen: "the frozen frame", stream: "the stream" }[result.source]
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className={cn("text-2xl font-semibold tabular-nums", a.regions.length ? "text-red-500" : "text-green-600")}>
        {pct}%
      </span>
      <span className="text-sm">
        {a.regions.length === 0
          ? "No differences"
          : a.regions.length === 1
            ? "1 difference"
            : `${a.regions.length} differences`}
      </span>
      <span className="text-muted-foreground text-xs">
        compared with {from}
        {result.motion ? ", moving content skipped" : ""}
        {result.media.length
          ? `, ${result.media.length} media ${result.media.length === 1 ? "element" : "elements"} skipped`
          : ""}
      </span>
      <span className="text-muted-foreground basis-full text-xs">
        {result.webview
          ? `WebView found: ${result.webview.target.title || result.webview.target.url}; differences inside it name their elements, pointing at one highlights it on the device.`
          : "No inspectable WebView found on the screen, so differences aren't tied to page elements."}
      </span>
    </div>
  )
}
