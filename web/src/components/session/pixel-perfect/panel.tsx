import {
  ChevronsUpDownIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  FrameIcon,
  ImageIcon,
  ImagePlusIcon,
  Loader2Icon,
  RefreshCwIcon,
  ScanSearchIcon,
  SearchIcon,
  Settings2Icon,
  SnowflakeIcon,
  SquareDashedIcon,
  Trash2Icon,
} from "lucide-react"
import { type DragEvent, useEffect, useEffectEvent, useRef, useState } from "react"
import { Link } from "@tanstack/react-router"
import { toast } from "sonner"
import type { ReferenceView, SessionView } from "@/api/client"
import {
  useDeleteReference,
  useImportFigma,
  useReferenceLayers,
  useReferences,
  useRefreshFigma,
  useUploadReference,
} from "@/api/queries"
import { IconButton } from "@/components/session/icon-button"
import { Compare } from "@/components/session/pixel-perfect/compare"
import { ComponentsList } from "@/components/session/pixel-perfect/components-list"
import { FigmaImport } from "@/components/session/pixel-perfect/figma-import"
import { Block, BlockHead, LayoutTab } from "@/components/session/pixel-perfect/layout-tab"
import {
  type Blend,
  type PixelPerfect,
  type Prefs,
  type Result,
  type Tab,
  usePixelState,
} from "@/components/session/pixel-perfect/state"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { download } from "@/lib/adb"
import { browserFigmaToken, isFigmaLink } from "@/lib/figma-token"
import { formatBytes, formatRelative } from "@/lib/format"
import { makeThumbnail } from "@/lib/pixel-perfect/capture"
import { renderReport } from "@/lib/pixel-perfect/report"
import { cn } from "@/lib/utils"

const accepted = ["image/svg+xml", "image/png", "image/jpeg", "image/webp"]

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
  const importFigma = useImportFigma()
  const [figmaUrl, setFigmaUrl] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [preparing, setPreparing] = useState(0)
  const items = refs.data?.items ?? []
  const ref = items.find((r) => r.id === state.referenceId) ?? null
  const hasToken = !!(refs.data?.figmaToken || refs.data?.figmaSaved || browserFigmaToken())
  const busy = upload.isPending || preparing > 0 || importFigma.isPending

  const add = async (file: Blob, name: string) => {
    if (!accepted.includes(file.type)) {
      toast.error("Only SVG, PNG, JPEG and WebP images can be references")
      return
    }
    setPreparing((n) => n + 1)
    const thumbnail = await makeThumbnail(file)
    setPreparing((n) => n - 1)
    upload.mutate(
      { file, thumbnail, name, pkg: session.package },
      {
        onSuccess: (v) => pp.select(v.id),
        onError: (e) => toast.error("Could not add the reference", { description: e.message }),
      },
    )
  }

  const imported = (v: ReferenceView) => {
    pp.select(v.id)
    setPicking(false)
    if (v.components)
      toast.success(`“${v.name}” imported`, {
        description: `Hide live content such as a video placeholder on the Components tab (${v.components}).`,
      })
  }

  const onPaste = useEffectEvent((e: ClipboardEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]")) return
    const file = Array.from(e.clipboardData?.files ?? []).find((f) => accepted.includes(f.type))
    const text = file ? "" : (e.clipboardData?.getData("text/plain") ?? "").trim()
    if (isFigmaLink(text)) {
      e.preventDefault()
      if (!hasToken) {
        setFigmaUrl(text)
        setPicking(true)
        return
      }
      importFigma.mutate(
        { url: text, pkg: session.package, token: browserFigmaToken() },
        {
          onSuccess: imported,
          onError: (err) => {
            setFigmaUrl(text)
            setPicking(true)
            toast.error("Could not import from Figma", { description: err.message })
          },
        },
      )
      return
    }
    const svg = /^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text) ? new Blob([text], { type: "image/svg+xml" }) : null
    if (!file && !svg) return
    e.preventDefault()
    void add(file ?? (svg as Blob), `Pasted ${new Date().toLocaleString()}`)
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
    for (const f of Array.from(e.dataTransfer.files)) void add(f, f.name.replace(/\.[^.]+$/, ""))
  }

  if (refs.data && !refs.data.enabled) {
    return (
      <div className="text-muted-foreground grid h-full place-items-center p-6 text-center text-sm">
        Pixel perfect references are turned off on this server.
      </div>
    )
  }

  const library = (
    <Library
      pp={pp}
      items={items}
      selected={state.referenceId}
      pkg={session.package}
      busy={busy}
      quota={refs.data}
      hasToken={hasToken}
      figmaUrl={figmaUrl}
      onFigmaUrl={setFigmaUrl}
      onAdd={() => input.current?.click()}
      onPicked={() => setPicking(false)}
      onImported={imported}
    />
  )

  return (
    <div
      className={cn("@container relative flex h-full min-h-0 flex-col", dragging && "bg-primary/5")}
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
          for (const f of Array.from(e.target.files ?? [])) void add(f, f.name.replace(/\.[^.]+$/, ""))
          e.target.value = ""
        }}
      />
      <Toolbar pp={pp} reference={ref} session={session}>
        <Popover open={picking} onOpenChange={setPicking}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-9 max-w-64 min-w-0 justify-start gap-2 px-2">
              {ref ? <Thumb reference={ref} className="size-6" /> : <ImageIcon />}
              <span className="truncate">{ref?.name ?? "Choose a reference"}</span>
              {busy ? (
                <Loader2Icon className="ml-auto animate-spin" />
              ) : (
                <ChevronsUpDownIcon className="ml-auto opacity-60" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[22rem] p-0">
            {library}
          </PopoverContent>
        </Popover>
      </Toolbar>
      {state.error && (
        <Alert variant="destructive" className="m-3 mb-0 w-auto">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {ref ? (
          <ReferenceTabs pp={pp} reference={ref} session={session} />
        ) : (
          <div className="mx-auto grid max-w-md gap-4 p-6">
            <div className="text-center">
              <h3 className="font-medium">Lay a design over the screen</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                Paste a Figma frame&apos;s link (Copy link to selection) or an image with ⌘V / Ctrl+V, drop a file here,
                or pick one you added before.
              </p>
            </div>
            <div className="rounded-xl border">{library}</div>
          </div>
        )}
      </div>
      {dragging && (
        <div className="border-primary bg-background/70 pointer-events-none absolute inset-2 grid place-items-center rounded-xl border-2 border-dashed text-sm font-medium">
          Drop images to add them as references
        </div>
      )}
    </div>
  )
}

function Thumb({ reference: r, className }: { reference: ReferenceView; className?: string }) {
  return (
    <span
      className={cn(
        "bg-muted grid shrink-0 place-items-center overflow-hidden rounded ring-1 ring-black/10",
        className,
      )}
    >
      {r.thumbnailUrl ? (
        <img src={r.thumbnailUrl} alt="" loading="lazy" width={160} className="size-full object-cover object-top" />
      ) : (
        <ImageIcon className="text-muted-foreground size-4" />
      )}
    </span>
  )
}

function Toolbar({
  pp,
  reference: r,
  session,
  children,
}: {
  pp: PixelPerfect
  reference: ReferenceView | null
  session: SessionView
  children: React.ReactNode
}) {
  const state = usePixelState(pp)
  return (
    <div className="flex flex-wrap items-center gap-2 border-b p-2">
      {children}
      {r && (
        <>
          <div className="flex items-center gap-1">
            <IconButton
              label={state.visible ? "Hide the overlay" : "Show the overlay"}
              onClick={() => pp.set({ visible: !state.visible })}
              aria-pressed={!state.visible}
            >
              {state.visible ? <EyeIcon /> : <EyeOffIcon />}
            </IconButton>
            <Slider
              className="w-20"
              value={[Math.round(state.opacity * 100)]}
              onValueChange={([v]) => pp.set({ opacity: (v ?? 50) / 100 })}
              aria-label="Overlay opacity"
              disabled={!state.visible}
            />
            <span className="text-muted-foreground w-9 text-right font-mono text-xs tabular-nums">
              {Math.round(state.opacity * 100)}%
            </span>
          </div>
          <Select value={state.blend} onValueChange={(v) => pp.set({ blend: v as Blend })}>
            <SelectTrigger size="sm" aria-label="Blend" title={blends.find((b) => b.value === state.blend)?.hint}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {blends.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  <span className="grid">
                    <span>{b.label}</span>
                    <span className="text-muted-foreground text-xs">{b.hint}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant={state.frozen ? "secondary" : "ghost"}
              disabled={state.freezing}
              onClick={() => (state.frozen ? pp.unfreeze() : void pp.freeze())}
              title="Keep the current picture of the screen to compare at leisure"
            >
              {state.freezing ? <Loader2Icon className="animate-spin" /> : <SnowflakeIcon />}
              {state.frozen ? "Live" : "Freeze"}
            </Button>
            <SettingsMenu pp={pp} />
            <Button
              size="sm"
              disabled={state.analyzing}
              onClick={() => void pp.analyze(session.capabilities?.screen, true)}
            >
              {state.analyzing ? <Loader2Icon className="animate-spin" /> : <ScanSearchIcon />}
              Find differences
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

const settings: { key: keyof Prefs; label: string; hint: string; reanalyze?: boolean }[] = [
  { key: "showLayout", label: "Grid and guides on the screen", hint: "The work area, columns, rows and guides." },
  { key: "showRegions", label: "Differences on the screen", hint: "Outlined and numbered over the device." },
  {
    key: "ignoreMotion",
    label: "Skip what moves",
    hint: "A few frames are compared first; video and animation under the interface don't count.",
    reanalyze: true,
  },
  {
    key: "views",
    label: "Name differences by native views",
    hint: "Reads the app's views with uiautomator; adds a second or two.",
    reanalyze: true,
  },
  {
    key: "devtools",
    label: "Name differences by WebView elements",
    hint: "Experimental: reads the page through its own DevTools connection.",
    reanalyze: true,
  },
  {
    key: "ignoreMedia",
    label: "Skip video, canvas and frames in WebViews",
    hint: "Their boxes come from DevTools, so a paused player is skipped too.",
    reanalyze: true,
  },
  {
    key: "skipHidden",
    label: "Skip hidden components",
    hint: "The place of a hidden Figma component doesn't count.",
    reanalyze: true,
  },
]

function SettingsMenu({ pp }: { pp: PixelPerfect }) {
  const state = usePixelState(pp)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="Comparison settings" title="Settings">
          <Settings2Icon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-80 gap-3">
        {settings
          .filter((s) => s.key !== "ignoreMedia" || state.devtools)
          .map((s) => (
            <div key={s.key} className="flex items-start gap-3">
              <Switch
                id={`pp-${s.key}`}
                size="sm"
                checked={!!state[s.key]}
                onCheckedChange={(v) => {
                  pp.set({ [s.key]: v })
                  if (s.reanalyze && state.result) void pp.analyze()
                }}
              />
              <Label htmlFor={`pp-${s.key}`} className="grid gap-0.5 font-normal">
                <span className="text-sm">{s.label}</span>
                <span className="text-muted-foreground text-xs">{s.hint}</span>
              </Label>
            </div>
          ))}
        <Link to="/pixel-perfect" className="text-muted-foreground text-xs underline">
          Defaults, references and your Figma token
        </Link>
      </PopoverContent>
    </Popover>
  )
}

function Library({
  pp,
  items,
  selected,
  pkg,
  busy,
  quota,
  hasToken,
  figmaUrl,
  onFigmaUrl,
  onAdd,
  onPicked,
  onImported,
}: {
  pp: PixelPerfect
  items: ReferenceView[]
  selected: string | null
  pkg: string
  busy: boolean
  quota?: { quota: number; used: number }
  hasToken: boolean
  figmaUrl: string | null
  onFigmaUrl: (url: string | null) => void
  onAdd: () => void
  onPicked: () => void
  onImported: (v: ReferenceView) => void
}) {
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const sorted = items
    .filter((r) => !q || r.name.toLowerCase().includes(q))
    .toSorted((a, b) => Number(b.package === pkg) - Number(a.package === pkg))
  return (
    <div className="grid">
      <div className="flex items-center gap-2 border-b p-2">
        <div className="relative flex-1">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find" className="h-8 pl-7" />
        </div>
        <Button
          size="sm"
          variant={figmaUrl !== null ? "secondary" : "outline"}
          onClick={() => onFigmaUrl(figmaUrl === null ? "" : null)}
        >
          <FrameIcon />
          Figma
        </Button>
        <Button size="sm" variant="outline" onClick={onAdd} disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : <ImagePlusIcon />}
          Image
        </Button>
      </div>
      {figmaUrl !== null && (
        <div className="border-b p-2">
          <FigmaImport
            key={figmaUrl}
            pkg={pkg}
            hasToken={hasToken}
            initialUrl={figmaUrl}
            onDone={(v) => {
              onFigmaUrl(null)
              if (v) onImported(v)
            }}
          />
        </div>
      )}
      {sorted.length > 0 ? (
        <ul className="grid max-h-80 gap-0.5 overflow-y-auto p-1">
          {sorted.map((r) => (
            <ReferenceItem
              key={r.id}
              pp={pp}
              reference={r}
              active={r.id === selected}
              thisApp={r.package === pkg}
              onPicked={onPicked}
            />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground p-4 text-center text-sm">
          {q ? "Nothing matches." : "No references yet: import a Figma frame or add an image."}
        </p>
      )}
      <div className="text-muted-foreground flex items-center gap-2 border-t px-3 py-2 text-xs">
        {quota && quota.quota > 0 && (
          <>
            <Progress value={Math.min(100, (quota.used / quota.quota) * 100)} className="h-1 w-16" />
            <span>
              {formatBytes(quota.used)} of {formatBytes(quota.quota)}
            </span>
          </>
        )}
        <Link to="/pixel-perfect" className="ml-auto underline">
          Manage
        </Link>
      </div>
    </div>
  )
}

function ReferenceItem({
  pp,
  reference: r,
  active,
  thisApp,
  onPicked,
}: {
  pp: PixelPerfect
  reference: ReferenceView
  active: boolean
  thisApp: boolean
  onPicked: () => void
}) {
  const remove = useDeleteReference()
  const refresh = useRefreshFigma()
  return (
    <li
      className={cn(
        "group/item hover:bg-muted/70 flex items-center gap-2 rounded-md p-1.5",
        active && "bg-muted ring-primary/40 ring-1",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        onClick={() => {
          pp.select(active ? null : r.id)
          onPicked()
        }}
      >
        <Thumb reference={r} className="size-10" />
        <span className="grid min-w-0">
          <span className="truncate text-sm font-medium" title={r.name}>
            {r.name}
          </span>
          <span className="text-muted-foreground truncate text-xs">
            {r.figma ? "Figma · " : ""}
            {r.width}×{r.height}
            {thisApp ? " · this app" : ""} · used {formatRelative(r.lastUsedAt)}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100">
        {r.figma && (
          <IconButton
            label="Update from Figma"
            disabled={refresh.isPending}
            onClick={() =>
              refresh.mutate(
                { id: r.id, token: browserFigmaToken() },
                {
                  onSuccess: () => toast.success(`“${r.name}” is up to date with Figma`),
                  onError: (e) => toast.error("Could not update from Figma", { description: e.message }),
                },
              )
            }
          >
            <RefreshCwIcon className={cn(refresh.isPending && "animate-spin")} />
          </IconButton>
        )}
        <IconButton
          label="Delete"
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

function ReferenceTabs({
  pp,
  reference: r,
  session,
}: {
  pp: PixelPerfect
  reference: ReferenceView
  session: SessionView
}) {
  const state = usePixelState(pp)
  const result = state.result?.referenceId === r.id ? state.result : null
  const draft = pp.draft(r)
  const skipped = draft.hidden.length + draft.ignore.length
  return (
    <Tabs value={state.tab} onValueChange={(v) => pp.set({ tab: v as Tab })} className="gap-0">
      <TabsList variant="line" className="h-10 w-full justify-start gap-3 border-b px-3">
        <TabsTrigger value="layout">Layout</TabsTrigger>
        <TabsTrigger value="components">
          {r.components ? "Components" : "Skip areas"}
          {skipped > 0 && (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
              {skipped}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="compare">
          Differences
          {result && (
            <Badge
              variant={result.analysis.regions.length ? "destructive" : "secondary"}
              className="h-4 px-1.5 text-[10px]"
            >
              {result.analysis.regions.length}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="layout">
        <LayoutTab pp={pp} reference={r} session={session} />
      </TabsContent>
      <TabsContent value="components">
        <SkipTab pp={pp} reference={r} />
      </TabsContent>
      <TabsContent value="compare">
        <DifferencesTab pp={pp} reference={r} session={session} result={result} />
      </TabsContent>
    </Tabs>
  )
}

function SkipTab({ pp, reference: r }: { pp: PixelPerfect; reference: ReferenceView }) {
  const state = usePixelState(pp)
  const layers = useReferenceLayers(r)
  const draft = pp.draft(r)
  return (
    <div className="grid">
      {r.components > 0 && (
        <Block>
          <BlockHead title="Components" />
          {layers.data ? (
            <ComponentsList
              layers={layers.data}
              hidden={draft.hidden}
              onChange={(hidden) => pp.edit(r, { hidden })}
              onHover={(id) => pp.hoverComponent(id)}
            />
          ) : (
            <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
          )}
          <p className="text-muted-foreground text-xs">
            A hidden component is left out of the overlay
            {state.skipHidden ? " and its place out of the comparison" : ""}; the frame is drawn again without it.
          </p>
        </Block>
      )}
      <Block>
        <BlockHead title="Ignored areas">
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
        </BlockHead>
        <p className="text-muted-foreground text-xs">
          Drag over the screen to always skip an area for this reference, such as a player or a map. They move with the
          reference.
        </p>
      </Block>
    </div>
  )
}

function DifferencesTab({
  pp,
  reference: r,
  session,
  result,
}: {
  pp: PixelPerfect
  reference: ReferenceView
  session: SessionView
  result: Result | null
}) {
  const state = usePixelState(pp)
  const [exporting, setExporting] = useState(false)

  if (!result) {
    return (
      <div className="text-muted-foreground grid place-items-center gap-3 p-8 text-center text-sm">
        <ScanSearchIcon className="size-8 opacity-50" />
        <p className="max-w-xs">
          Line the reference up on the Layout tab, then press <strong>Find differences</strong>. Freeze the screen first
          to compare something that is only there for a moment.
        </p>
        <Button
          size="sm"
          disabled={state.analyzing}
          onClick={() => void pp.analyze(session.capabilities?.screen, true)}
        >
          {state.analyzing ? <Loader2Icon className="animate-spin" /> : <ScanSearchIcon />}
          Find differences
        </Button>
      </div>
    )
  }

  const exportReport = async () => {
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
        elements: result.matches.map((m) => {
          const parts = [
            m.element?.label ?? m.view?.label,
            m.layer && `◆ ${m.layer.name}`,
            m.measures.map((x) => `${x.label} ${x.actual}≠${x.design}`).join(" "),
          ].filter(Boolean)
          return parts.length ? { label: parts.join(" · ") } : null
        }),
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
    <div className="grid gap-3 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <Summary result={result} devtools={state.devtools} views={state.views} />
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={exporting}
          onClick={() => void exportReport()}
        >
          {exporting ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
          Report
        </Button>
      </div>
      <Compare pp={pp} result={result} hovered={state.hovered} />
    </div>
  )
}

function Summary({ result, devtools, views }: { result: Result; devtools: boolean; views: boolean }) {
  const a = result.analysis
  const pct = (a.match * 100).toFixed(a.match > 0.999 && a.match < 1 ? 2 : 1)
  const from = { screenshot: "a screenshot", frozen: "the frozen frame", stream: "the stream" }[result.source]
  const notes = [
    result.motion && "moving content skipped",
    result.media.length > 0 &&
      `${result.media.length} media ${result.media.length === 1 ? "element" : "elements"} skipped`,
    devtools &&
      (result.webview
        ? `WebView “${result.webview.target.title || result.webview.target.url}”`
        : "no inspectable WebView"),
    views &&
      (result.views.length
        ? `${result.views.length} native views`
        : `views unread${result.viewsError ? ` (${result.viewsError})` : ""}`),
    result.layers.length > 0 && `${result.layers.length} Figma layers`,
  ].filter(Boolean)
  return (
    <div className="grid min-w-0 gap-0.5">
      <div className="flex items-baseline gap-2">
        <span
          className={cn("text-2xl font-semibold tabular-nums", a.regions.length ? "text-red-500" : "text-green-600")}
        >
          {pct}%
        </span>
        <span className="text-sm">
          {a.regions.length === 0
            ? "No differences"
            : a.regions.length === 1
              ? "1 difference"
              : `${a.regions.length} differences`}
        </span>
      </div>
      <span className="text-muted-foreground text-xs">
        Compared with {from}
        {notes.length ? ` · ${notes.join(" · ")}` : ""}
      </span>
    </div>
  )
}
