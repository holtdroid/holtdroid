import {
  DownloadIcon,
  ExternalLinkIcon,
  FrameIcon,
  ImageIcon,
  ImagePlusIcon,
  InfoIcon,
  Loader2Icon,
  PencilIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"
import type { ReferenceView } from "@/api/client"
import {
  useDeleteReference,
  useReferences,
  useRefreshFigma,
  useUpdateReference,
  useUploadReference,
} from "@/api/queries"
import { FigmaTokenSection } from "@/components/figma-token"
import { IconButton } from "@/components/session/icon-button"
import { FigmaImport } from "@/components/session/pixel-perfect/figma-import"
import { type Blend, defaultPrefs, loadPrefs, type Prefs, savePrefs } from "@/components/session/pixel-perfect/state"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useNow } from "@/hooks/use-now"
import { browserFigmaToken } from "@/lib/figma-token"
import { formatBytes, formatRelative, formatSpan } from "@/lib/format"
import { makeThumbnail } from "@/lib/pixel-perfect/capture"

const accepted = ["image/svg+xml", "image/png", "image/jpeg", "image/webp"]

export function PixelPerfectPage() {
  const refs = useReferences()
  const upload = useUploadReference()
  const input = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [query, setQuery] = useState("")
  const now = useNow(60_000)
  const data = refs.data
  const q = query.trim().toLowerCase()
  const items = (data?.items ?? []).filter(
    (r) => !q || r.name.toLowerCase().includes(q) || (r.package ?? "").toLowerCase().includes(q),
  )
  const groups = new Map<string, ReferenceView[]>()
  for (const r of items) groups.set(r.package ?? "", [...(groups.get(r.package ?? "") ?? []), r])
  const hasToken = !!(data?.figmaToken || data?.figmaSaved || browserFigmaToken())

  const add = async (file: File) => {
    if (!accepted.includes(file.type)) {
      toast.error("Only SVG, PNG, JPEG and WebP images can be references")
      return
    }
    const thumbnail = await makeThumbnail(file)
    upload.mutate(
      { file, thumbnail, name: file.name.replace(/\.[^.]+$/, ""), pkg: "" },
      { onError: (e) => toast.error("Could not add the reference", { description: e.message }) },
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-7xl gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:p-6">
        <div className="grid content-start gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Pixel perfect</h1>
            <p className="text-muted-foreground max-w-xl text-sm">
              Your design references for the Pixel perfect tab of a session, your Figma token and how the tab starts.
              Only you can see your references.
            </p>
          </div>

          {data && !data.enabled && (
            <Alert>
              <InfoIcon />
              <AlertTitle>Pixel perfect is turned off on this server</AlertTitle>
              <AlertDescription>References can&apos;t be added or compared.</AlertDescription>
            </Alert>
          )}
          {refs.isError && (
            <Alert variant="destructive">
              <AlertDescription>Could not load references: {refs.error.message}</AlertDescription>
            </Alert>
          )}

          {data?.enabled && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-48 flex-1">
                <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find by name or app"
                  className="pl-8"
                />
              </div>
              <Button variant={importing ? "secondary" : "outline"} onClick={() => setImporting(!importing)}>
                <FrameIcon />
                Import from Figma
              </Button>
              <Button variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}>
                {upload.isPending ? <Loader2Icon className="animate-spin" /> : <ImagePlusIcon />}
                Add image
              </Button>
              <input
                ref={input}
                type="file"
                accept={accepted.join(",")}
                multiple
                hidden
                onChange={(e) => {
                  for (const f of Array.from(e.target.files ?? [])) void add(f)
                  e.target.value = ""
                }}
              />
            </div>
          )}
          {importing && (
            <FigmaImport
              pkg=""
              hasToken={hasToken}
              onDone={(v) => {
                setImporting(false)
                if (v) toast.success(`“${v.name}” imported with ${v.layers} layers`)
              }}
            />
          )}

          {refs.isPending ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : data?.enabled && groups.size === 0 ? (
            <div className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
              {q
                ? "Nothing matches."
                : "No references yet. Import a frame from Figma or add an image here, or do it from a session's Pixel perfect tab, where it is tied to the app."}
            </div>
          ) : (
            [...groups.entries()]
              .toSorted(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
              .map(([pkg, list]) => (
                <section key={pkg || "-"} className="grid gap-2">
                  <div className="flex items-baseline gap-2">
                    <h2 className="truncate font-semibold">{pkg ? <code>{pkg}</code> : "Not tied to an app"}</h2>
                    <span className="text-muted-foreground text-xs">
                      {list.length} · {formatBytes(list.reduce((n, r) => n + r.size, 0))}
                    </span>
                  </div>
                  <ul className="divide-y rounded-xl border">
                    {list.map((r) => (
                      <ReferenceRow key={r.id} reference={r} now={now} />
                    ))}
                  </ul>
                </section>
              ))
          )}
        </div>

        {data?.enabled && (
          <aside className="grid content-start gap-6 self-start lg:sticky lg:top-6">
            <section className="grid gap-2 rounded-xl border p-4 text-sm">
              <h2 className="font-semibold">Storage</h2>
              {data.quota > 0 ? (
                <>
                  <Progress value={Math.min(100, (data.used / data.quota) * 100)} className="h-1.5" />
                  <span className="text-muted-foreground">
                    {formatBytes(data.used)} of {formatBytes(data.quota)} used
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">{formatBytes(data.used)} used, no limit</span>
              )}
              {data.maxAge > 0 && (
                <span className="text-muted-foreground">
                  A reference nobody opened for {formatSpan(data.maxAge)} is deleted; laying it over a screen counts as
                  opening it.
                </span>
              )}
              <span className="text-muted-foreground">Images up to {formatBytes(data.maxFileSize)}.</span>
            </section>

            <section className="grid gap-3 rounded-xl border p-4">
              <h2 className="font-semibold">Figma token</h2>
              <FigmaTokenSection guideOpen={!hasToken} />
            </section>

            <Defaults />
          </aside>
        )}
      </div>
    </div>
  )
}

function ReferenceRow({ reference: r, now }: { reference: ReferenceView; now: number }) {
  const rename = useUpdateReference()
  const remove = useDeleteReference()
  const refresh = useRefreshFigma()
  const [name, setName] = useState<string | null>(null)

  const save = () => {
    if (name === null) return
    const next = name.trim()
    setName(null)
    if (next && next !== r.name)
      rename.mutate(
        { ref: r, name: next },
        { onError: (e) => toast.error("Could not rename", { description: e.message }) },
      )
  }

  return (
    <li className="flex items-center gap-3 p-3">
      <div className="bg-muted size-14 shrink-0 overflow-hidden rounded-md ring-1 ring-black/10">
        {r.thumbnailUrl ? (
          <img src={r.thumbnailUrl} alt="" loading="lazy" width={160} className="size-full object-cover object-top" />
        ) : (
          <ImageIcon className="text-muted-foreground m-auto mt-4 size-5" />
        )}
      </div>
      <div className="grid min-w-0 flex-1 gap-0.5">
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
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium" title={r.name}>
              {r.name}
            </span>
            {r.figma && <Badge variant="outline">Figma</Badge>}
          </div>
        )}
        <span className="text-muted-foreground truncate text-xs">
          {r.width}×{r.height} · {r.contentType.replace("image/", "").replace("+xml", "").toUpperCase()} ·{" "}
          {formatBytes(r.size)}
          {r.figma ? ` · ${r.layers} layers · synced ${formatRelative(r.figma.syncedAt, now)}` : ""}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          Used {formatRelative(r.lastUsedAt, now)}
          {r.expiresAt ? ` · deleted ${formatRelative(r.expiresAt, now)} unless opened` : ""}
        </span>
      </div>
      <div className="flex shrink-0 items-center">
        {r.figma && (
          <>
            <IconButton label="Open in Figma" asChild>
              <a href={r.figma.url} target="_blank" rel="noreferrer">
                <ExternalLinkIcon />
              </a>
            </IconButton>
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
              <RefreshCwIcon className={refresh.isPending ? "animate-spin" : undefined} />
            </IconButton>
          </>
        )}
        <IconButton label="Download the image" asChild>
          <a href={r.imageUrl} download={r.name}>
            <DownloadIcon />
          </a>
        </IconButton>
        <IconButton label="Rename" onClick={() => setName(r.name)}>
          <PencilIcon />
        </IconButton>
        <IconButton
          label="Delete"
          disabled={remove.isPending}
          onClick={() => {
            if (!window.confirm(`Delete the reference “${r.name}”?`)) return
            remove.mutate(r.id, { onError: (e) => toast.error("Could not delete", { description: e.message }) })
          }}
        >
          <Trash2Icon />
        </IconButton>
      </div>
    </li>
  )
}

const blends: { value: Blend; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "difference", label: "Difference" },
  { value: "invert", label: "Invert" },
]

const switches: { key: keyof Prefs; label: string; hint: string }[] = [
  { key: "ignoreMotion", label: "Skip what moves", hint: "Leave video and animations under the interface out." },
  { key: "views", label: "Native views", hint: "Name differences by the app's views (uiautomator)." },
  {
    key: "devtools",
    label: "DevTools for WebView pages",
    hint: "Name differences by page elements. Experimental.",
  },
  { key: "ignoreMedia", label: "Skip video, canvas and frames in WebViews", hint: "With DevTools on." },
  { key: "showRegions", label: "Differences on the screen", hint: "Outline and number them over the device." },
]

function Defaults() {
  const [prefs, setPrefs] = useState(loadPrefs)
  const update = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    savePrefs(next)
  }
  return (
    <section className="grid gap-4 rounded-xl border p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">How the tab starts</h2>
        <Button size="sm" variant="ghost" onClick={() => update(defaultPrefs)}>
          Reset
        </Button>
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Overlay opacity</span>
          <span className="font-mono tabular-nums">{Math.round(prefs.opacity * 100)}%</span>
        </div>
        <Slider
          value={[Math.round(prefs.opacity * 100)]}
          onValueChange={([v]) => update({ opacity: (v ?? 50) / 100 })}
          aria-label="Overlay opacity"
        />
      </div>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={prefs.blend}
        onValueChange={(v) => v && update({ blend: v as Blend })}
        className="flex-wrap"
      >
        {blends.map((b) => (
          <ToggleGroupItem key={b.value} value={b.value}>
            {b.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {switches.map((s) => (
        <div key={s.key} className="flex items-start gap-3">
          <Switch id={`pp-default-${s.key}`} checked={!!prefs[s.key]} onCheckedChange={(v) => update({ [s.key]: v })} />
          <Label htmlFor={`pp-default-${s.key}`} className="grid gap-0.5 font-normal">
            <span>{s.label}</span>
            <span className="text-muted-foreground text-xs">{s.hint}</span>
          </Label>
        </div>
      ))}
      <p className="text-muted-foreground text-xs">
        Kept in this browser, and changed by the tab too: it remembers what you last used.
      </p>
    </section>
  )
}
