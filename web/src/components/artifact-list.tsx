import { Link } from "@tanstack/react-router"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  DownloadIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  EyeIcon,
  GitBranchIcon,
  HourglassIcon,
  InfinityIcon,
  LockIcon,
  PinIcon,
  PlayIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import type { ArtifactView } from "@/api/client"
import {
  artifactDownloadURL,
  useApps,
  useArtifacts,
  useDeleteArtifact,
  usePinApp,
  useSessions,
  useSources,
  useUpdateArtifact,
  useUploads,
} from "@/api/queries"
import { paragraphs } from "@/components/app-description"
import { AppIcon } from "@/components/app-icon"
import { Count } from "@/components/launch/choice-card"
import { QuickLaunchButton } from "@/components/quick-launch-button"
import { UploadDialog } from "@/components/upload-dialog"
import { UserAvatar } from "@/components/user-avatar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useNow } from "@/hooks/use-now"
import { groupVariants } from "@/lib/abi"
import { formatBytes, formatRelative, safeLink } from "@/lib/format"
import { pinnedFirst } from "@/lib/pinned"
import { cn } from "@/lib/utils"

const ALL = "__all__"
const TIMELINE = 5

export function artifactTitle(a: ArtifactView) {
  return a.meta.title || a.app?.label || a.fileName
}

export function appTitle(a: ArtifactView) {
  return a.app?.label || artifactTitle(a)
}

const newestCode = (builds: ArtifactView[]) => Math.max(...builds.map((b) => b.app?.versionCode ?? 0))

const byNewest = (a: ArtifactView[], b: ArtifactView[]) =>
  newestCode(b) - newestCode(a) || b[0]!.uploadedAt.localeCompare(a[0]!.uploadedAt)

type AppGroup = { key: string; pkg?: string; items: ArtifactView[] }

function groupByPackage(items: ArtifactView[]) {
  const groups = new Map<string, AppGroup>()
  for (const a of items) {
    const pkg = a.app?.package
    const key = pkg ?? `${a.source}/${a.id}`
    const group = groups.get(key)
    if (group) group.items.push(a)
    else groups.set(key, { key, pkg, items: [a] })
  }
  return [...groups.values()]
}

function matches(a: ArtifactView, q: string) {
  return [
    a.fileName,
    a.meta.title,
    a.app?.label,
    a.app?.package,
    a.app?.versionName,
    a.meta.uploadedBy,
    a.meta.note,
    a.meta.changelog,
    ...Object.values(a.meta.tags ?? {}),
  ]
    .filter(Boolean)
    .some((v) => v!.toLowerCase().includes(q))
}

function editable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  )
}

export function ArtifactList({
  onLaunch,
  pkg,
  upload,
  onUploadClose,
  aside,
}: {
  onLaunch: (artifact: ArtifactView) => void
  pkg?: string
  upload?: boolean
  onUploadClose?: () => void
  aside?: ReactNode
}) {
  const [source, setSource] = useState(ALL)
  const [query, setQuery] = useState("")
  const [uploading, setUploading] = useState<{ file: File | null } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [showParsing, setShowParsing] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const sources = useSources()
  const uploads = useUploads()
  const artifacts = useArtifacts("")
  const sessions = useSessions()
  const apps = useApps()
  const now = useNow(30_000)
  const canUpload = !!uploads.data?.enabled

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || editable(e.target)) return
      e.preventDefault()
      search.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const visible = useMemo(
    () => (artifacts.data?.items ?? []).filter((a) => !pkg || a.app?.package === pkg),
    [artifacts.data, pkg],
  )
  const perSource = useMemo(() => {
    const counts = new Map<string, number>()
    for (const g of groupByPackage(visible)) {
      for (const s of new Set(g.items.map((a) => a.source))) counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    return counts
  }, [visible])
  const all = useMemo(() => visible.filter((a) => source === ALL || a.source === source), [visible, source])
  const q = query.trim().toLowerCase()
  const items = useMemo(() => (q ? all.filter((a) => matches(a, q)) : all), [all, q])
  const rows = useMemo(() => groupVariants(items).toSorted(byNewest), [items])
  const groups = useMemo(
    () => (pkg ? [] : groupByPackage(all).filter((g) => !q || g.items.some((a) => matches(a, q)))),
    [all, pkg, q],
  )
  const ready = useMemo(
    () =>
      pinnedFirst(
        groups.filter((g) => g.pkg),
        (p) => !!apps.data?.get(p)?.pinned,
      ),
    [groups, apps.data],
  )
  const parsing = useMemo(() => groups.filter((g) => !g.pkg), [groups])
  const running = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of sessions.data?.items ?? []) counts.set(s.package, (counts.get(s.package) ?? 0) + 1)
    return counts
  }, [sessions.data])
  const empty = pkg ? items.length === 0 : groups.length === 0
  const buildCount = groupVariants(all).length
  const sourceNames = sources.data?.map((s) => s.name) ?? []

  return (
    <div
      className="flex flex-col gap-5"
      onDragOver={(e) => {
        if (!canUpload || !e.dataTransfer.types.includes("Files")) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        if (!canUpload) return
        e.preventDefault()
        setDragging(false)
        setUploading({ file: e.dataTransfer.files[0] ?? null })
      }}
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {!pkg && (
          <div className="mr-2 flex items-baseline gap-2.5">
            <h1 className="text-[22px] font-semibold tracking-[-.01em]">Apps</h1>
            {artifacts.data && (
              <span className="text-muted-foreground text-xs">
                {ready.length} {ready.length === 1 ? "app" : "apps"} · {buildCount}{" "}
                {buildCount === 1 ? "build" : "builds"}
              </span>
            )}
          </div>
        )}
        {sourceNames.length > 1 && (
          <Tabs value={source} onValueChange={setSource}>
            <TabsList aria-label="Source" className="max-w-full overflow-x-auto">
              <TabsTrigger value={ALL}>All</TabsTrigger>
              {sourceNames.map((s) => (
                <TabsTrigger key={s} value={s}>
                  {s}
                  {(perSource.get(s) ?? 0) > 0 && <Count>{perSource.get(s)}</Count>}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
        <span className="hidden flex-1 sm:block" />
        <label className="bg-card text-muted-foreground focus-within:ring-ring/50 flex h-9 w-[300px] max-w-full items-center gap-2 rounded-[10px] border px-3 focus-within:ring-3">
          <SearchIcon className="size-4 shrink-0" />
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={pkg ? "Version, branch, uploader or changelog" : "App, package or branch"}
            aria-label={pkg ? "Search builds" : "Search apps"}
            className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          <kbd className="rounded-[5px] border px-[5px] py-px font-sans text-[11px]">/</kbd>
        </label>
        {canUpload && (
          <Button className="h-9" onClick={() => setUploading({ file: null })}>
            <UploadIcon />
            Upload APK
          </Button>
        )}
      </header>

      {artifacts.data?.errors.map((e) => (
        <Alert key={e.source} variant="destructive">
          <AlertTitle>Source “{e.source}” is unavailable</AlertTitle>
          <AlertDescription>{e.message}</AlertDescription>
        </Alert>
      ))}

      <div className="flex flex-wrap items-start gap-5">
        <section
          aria-label={pkg ? "Builds" : "Apps"}
          className={cn(
            "bg-card min-w-0 flex-[999_1_640px] rounded-2xl border px-5 pt-1.5 pb-2",
            dragging && "outline-foreground outline-2 outline-dashed",
          )}
        >
          {artifacts.isPending ? (
            <div className="grid gap-3 py-3">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          ) : empty ? (
            <p className="text-muted-foreground py-12 text-center text-sm">
              {query
                ? "Nothing matches your search."
                : pkg
                  ? "No builds of this app in the selected sources."
                  : canUpload
                    ? "No APKs yet. Drop one here or press Upload APK."
                    : "No APKs found in the configured sources yet."}
            </p>
          ) : pkg ? (
            <ul className="flex flex-col">
              {rows.map((variants, i) => (
                <BuildRow
                  key={`${variants[0]!.source}/${variants[0]!.id}`}
                  variants={variants}
                  latest={i === 0 && !q && source === ALL}
                  now={now}
                  onLaunch={onLaunch}
                  detailed
                />
              ))}
            </ul>
          ) : (
            <ul className="flex flex-col">
              {ready.map((g) => (
                <AppRow
                  key={g.key}
                  group={g}
                  running={g.pkg ? (running.get(g.pkg) ?? 0) : 0}
                  now={now}
                  onLaunch={onLaunch}
                />
              ))}
              {parsing.length > 0 && (
                <li className="py-3">
                  <button
                    type="button"
                    aria-expanded={showParsing}
                    onClick={() => setShowParsing((v) => !v)}
                    className="text-muted-foreground hover:bg-muted flex w-full items-center gap-2 rounded-xl border border-dashed p-3 text-left text-sm transition-colors"
                  >
                    <ChevronRightIcon className={cn("size-4 transition-transform", showParsing && "rotate-90")} />
                    Reading package info for {parsing.length} more {parsing.length === 1 ? "app" : "apps"}…
                  </button>
                  {showParsing && (
                    <ul className="mt-1 flex flex-col">
                      {parsing.map((g) => (
                        <AppRow key={g.key} group={g} running={0} now={now} onLaunch={onLaunch} />
                      ))}
                    </ul>
                  )}
                </li>
              )}
            </ul>
          )}
        </section>
        {aside && <aside className="flex min-w-0 flex-[1_1_360px] flex-col gap-4">{aside}</aside>}
      </div>

      <UploadDialog
        open={!!uploading || (!!upload && canUpload)}
        initialFile={uploading?.file ?? null}
        onClose={() => {
          setUploading(null)
          onUploadClose?.()
        }}
        onUploaded={onLaunch}
      />
    </div>
  )
}

function AppRow({
  group: { pkg, items },
  running,
  now,
  onLaunch,
}: {
  group: AppGroup
  running: number
  now: number
  onLaunch: (a: ArtifactView) => void
}) {
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const builds = useMemo(() => groupVariants(items).toSorted(byNewest), [items])
  const latest = builds[0]?.[0] ?? items[0]!
  const title = appTitle(latest)
  const sources = [...new Set(items.map((a) => a.source))]
  const apps = useApps()
  const description = pkg ? apps.data?.get(pkg)?.description : undefined
  const shown = all ? builds : builds.slice(0, TIMELINE)
  const hidden = builds.length - shown.length
  return (
    <li className="border-b border-dashed py-3.5 last:border-0">
      <div className="flex items-center gap-3.5">
        <AppIcon src={latest.iconUrl} className="size-9 rounded-[10px]" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {pkg ? (
              <Link
                to="/apps/$pkg"
                params={{ pkg }}
                className="max-w-full truncate text-[15px] font-semibold underline-offset-4 hover:underline"
              >
                {title}
              </Link>
            ) : (
              <span className="max-w-full truncate text-[15px] font-semibold">{title}</span>
            )}
            {latest.app?.versionName && (
              <Badge variant="secondary" className="max-w-48 font-mono" title={latest.app.versionName}>
                <span className="truncate">{latest.app.versionName}</span>
              </Badge>
            )}
            {sources.map((s) => (
              <Badge key={s} variant="secondary" className="max-w-40" title={s}>
                <span className="truncate">{s}</span>
              </Badge>
            ))}
            {running > 0 && (
              <Badge variant="success" dot>
                {running} running
              </Badge>
            )}
          </div>
          <div className="text-muted-foreground mt-0.5 truncate font-mono text-xs">
            {pkg ?? "Reading package info…"}
          </div>
          {description && (
            <p className="text-muted-foreground mt-1 line-clamp-1 text-xs" title={description}>
              {paragraphs(description).join(" ")}
            </p>
          )}
        </div>
        <div className="hidden min-w-[110px] shrink-0 flex-col items-end gap-0.5 whitespace-nowrap md:flex">
          <span className="text-[13px]">
            {builds.length} {builds.length === 1 ? "build" : "builds"}
          </span>
          <span className="text-muted-foreground text-xs" title={new Date(latest.uploadedAt).toLocaleString()}>
            {formatRelative(latest.uploadedAt, now)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {pkg && <PinButton pkg={pkg} title={title} pinned={!!apps.data?.get(pkg)?.pinned} />}
          <QuickLaunchButton artifact={latest} />
          <Button onClick={() => onLaunch(latest)}>
            <PlayIcon />
            Launch
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-expanded={open}
            aria-label={open ? "Hide builds" : "Show builds"}
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </Button>
        </div>
      </div>
      {open && (
        <div className="mt-3.5 mb-0.5 flex flex-col border-l pl-4 sm:ml-[50px]">
          <ul className="flex flex-col">
            {shown.map((variants, i) => (
              <BuildRow
                key={`${variants[0]!.source}/${variants[0]!.id}`}
                variants={variants}
                latest={i === 0}
                now={now}
                onLaunch={onLaunch}
              />
            ))}
          </ul>
          <div className="mt-1.5 flex gap-1">
            {hidden > 0 && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setAll(true)}>
                Show {hidden} older {hidden === 1 ? "build" : "builds"}
              </Button>
            )}
            {pkg && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
                <Link to="/apps/$pkg" params={{ pkg }}>
                  Notes and changelogs
                  <ChevronRightIcon />
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

function PinButton({ pkg, title, pinned }: { pkg: string; title: string; pinned: boolean }) {
  const pin = usePinApp()
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("max-sm:hidden", !pinned && "text-muted-foreground")}
      aria-label={`${pinned ? "Unpin" : "Pin"} ${title}`}
      aria-pressed={pinned}
      title={pinned ? "Unpin" : "Pin for everyone"}
      disabled={pin.isPending}
      onClick={() =>
        pin.mutate(
          { pkg, pinned: !pinned },
          { onError: (err) => toast.error("Couldn't change the pin", { description: err.message }) },
        )
      }
    >
      <PinIcon className={cn(pinned && "fill-current")} />
    </Button>
  )
}

function BuildRow({
  variants,
  latest,
  now,
  onLaunch,
  detailed = false,
}: {
  variants: ArtifactView[]
  latest: boolean
  now: number
  onLaunch: (a: ArtifactView) => void
  detailed?: boolean
}) {
  const a = variants[0]!
  const abis = [...new Set(variants.flatMap((v) => v.app?.abis ?? []))]
  const title = artifactTitle(a)
  const branch = a.meta.tags?.branch
  const tags = Object.entries(a.meta.tags ?? {}).filter(([k]) => k !== "branch")
  return (
    <li className={cn("flex flex-col", detailed && "border-b border-dashed py-2 last:border-0")}>
      <div className="flex min-h-11 items-center gap-3 text-[13px]">
        {detailed && <AppIcon src={a.iconUrl} className="size-7 rounded-lg" />}
        <span className="w-28 shrink-0 truncate font-mono font-medium" title={a.app?.versionName || title}>
          {a.app?.versionName || (a.app ? "—" : "…")}
        </span>
        <span className="text-muted-foreground hidden w-20 shrink-0 truncate font-mono text-xs tabular-nums sm:inline">
          {a.app?.versionCode ?? ""}
        </span>
        <span className="flex min-w-14 flex-1 items-center gap-1.5 overflow-hidden">
          {latest && <Badge variant="info">Latest</Badge>}
          {branch && (
            <Badge variant="secondary" className="min-w-0 max-w-[220px] shrink justify-start" title={branch}>
              <GitBranchIcon />
              <span className="truncate">{branch}</span>
            </Badge>
          )}
          {a.meta.visibility === "private" && (
            <Badge variant="secondary">
              <LockIcon />
              private
            </Badge>
          )}
          {a.expiresAt && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="warning">
                  <HourglassIcon />
                  temporary
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                Deleted {formatRelative(a.expiresAt, now)} unless launched again
                <span className="block opacity-70">{new Date(a.expiresAt).toLocaleString()}</span>
              </TooltipContent>
            </Tooltip>
          )}
          {detailed && title !== a.app?.label && (
            <span className="text-muted-foreground truncate text-xs">{title}</span>
          )}
        </span>
        {a.meta.uploadedBy && (
          <span className="hidden max-w-36 items-center gap-1.5 xl:inline-flex">
            <UserAvatar user={a.meta.uploadedBy} className="size-[22px]" />
            <span className="truncate">{a.meta.uploadedBy}</span>
          </span>
        )}
        <span className="text-muted-foreground hidden w-16 shrink-0 text-right text-xs sm:inline">
          {formatBytes(a.size)}
        </span>
        <span
          className="text-muted-foreground w-[72px] shrink-0 text-right text-xs"
          title={new Date(a.uploadedAt).toLocaleString()}
        >
          {formatRelative(a.uploadedAt, now)}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <QuickLaunchButton artifact={a} size="icon-sm" />
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={`Launch ${title} ${a.app?.versionName ?? ""}`}
            onClick={() => onLaunch(a)}
          >
            <PlayIcon />
          </Button>
          <BuildMenu variants={variants} title={title} />
        </span>
      </div>
      {detailed && (
        <div className="text-muted-foreground grid gap-1.5 pb-1 pl-10 text-xs">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span>{a.fileName}</span>
            <span>{a.meta.origin ? `${a.source} · ${a.meta.origin}` : a.source}</span>
            {abis.length > 0 && <span className="font-mono">{abis.join(", ")}</span>}
            {tags.map(([k, v]) => (
              <span key={k} className="font-mono">
                {k}: {v}
              </span>
            ))}
          </div>
          {a.meta.note && <p className="text-foreground line-clamp-2 text-sm whitespace-pre-line">{a.meta.note}</p>}
          {a.meta.changelog && (
            <details className="text-sm">
              <summary className="hover:text-foreground cursor-pointer text-xs select-none">Changelog</summary>
              <p className="bg-muted text-foreground mt-1 max-h-60 overflow-y-auto rounded-lg p-2 font-mono text-xs whitespace-pre-wrap">
                {a.meta.changelog}
              </p>
            </details>
          )}
        </div>
      )}
    </li>
  )
}

function BuildMenu({ variants, title }: { variants: ArtifactView[]; title: string }) {
  const artifact = variants[0]!
  const update = useUpdateArtifact()
  const remove = useDeleteArtifact()
  const [confirming, setConfirming] = useState(false)
  const downloads = variants.filter((v) => v.canDownload)
  const link = safeLink(artifact.meta.link)
  const isPrivate = artifact.meta.visibility === "private"
  const isTemporary = !!artifact.meta.temporary
  if (!link && downloads.length === 0 && !artifact.canManage) return null

  const toggle = () =>
    update.mutate(
      { artifact, visibility: isPrivate ? "public" : "private" },
      { onError: (err) => toast.error("Could not change visibility", { description: err.message }) },
    )
  const toggleTemporary = () =>
    update.mutate(
      { artifact, temporary: !isTemporary },
      { onError: (err) => toast.error("Could not change it", { description: err.message }) },
    )
  const confirmDelete = () =>
    remove.mutate(artifact, {
      onSuccess: () => {
        setConfirming(false)
        toast.success("Deleted", { description: title })
      },
      onError: (err) => toast.error("Could not delete", { description: err.message }),
    })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label="More">
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {link && (
            <DropdownMenuItem asChild>
              <a href={link.href} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon />
                Open where it came from
                <span className="text-muted-foreground ml-auto font-mono text-xs">{link.host}</span>
              </a>
            </DropdownMenuItem>
          )}
          {downloads.length > 0 && (
            <>
              {downloads.length > 1 && <DropdownMenuLabel>Download an APK</DropdownMenuLabel>}
              {downloads.map((v) => (
                <DropdownMenuItem key={v.id} asChild>
                  <a href={artifactDownloadURL(v)} download={v.fileName}>
                    <DownloadIcon />
                    {downloads.length > 1 ? (
                      <span className="font-mono text-xs">{v.app?.abis.join(", ") || v.fileName}</span>
                    ) : (
                      "Download the APK"
                    )}
                    <span className="text-muted-foreground ml-auto text-xs">{formatBytes(v.size)}</span>
                  </a>
                </DropdownMenuItem>
              ))}
            </>
          )}
          {artifact.canManage && (
            <>
              {(link || downloads.length > 0) && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={toggle} disabled={update.isPending}>
                {isPrivate ? <EyeIcon /> : <LockIcon />}
                {isPrivate ? "Make public" : "Make private"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={toggleTemporary} disabled={update.isPending}>
                {isTemporary ? <InfinityIcon /> : <HourglassIcon />}
                {isTemporary ? "Make permanent" : "Make temporary"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
                <Trash2Icon />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {title}?</DialogTitle>
            <DialogDescription>
              {artifact.fileName} and its metadata are removed from “{artifact.source}”. Running sessions keep working.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={remove.isPending}>
              <Trash2Icon />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
