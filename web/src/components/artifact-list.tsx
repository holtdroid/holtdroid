import {
  EllipsisVerticalIcon,
  ExternalLinkIcon,
  EyeIcon,
  HourglassIcon,
  InfinityIcon,
  LockIcon,
  RocketIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { ArtifactView } from "@/api/client"
import { useArtifacts, useDeleteArtifact, useSources, useUpdateArtifact, useUploads } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { QuickLaunchButton } from "@/components/quick-launch-button"
import { UploadDialog } from "@/components/upload-dialog"
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useNow } from "@/hooks/use-now"
import { formatBytes, formatRelative, safeLink } from "@/lib/format"
import { cn } from "@/lib/utils"

const ALL = "__all__"

export function artifactTitle(a: ArtifactView) {
  return a.meta.title || a.app?.label || a.fileName
}

export function ArtifactList({ onLaunch }: { onLaunch: (artifact: ArtifactView) => void }) {
  const [source, setSource] = useState(ALL)
  const [query, setQuery] = useState("")
  const [uploading, setUploading] = useState<{ file: File | null } | null>(null)
  const [dragging, setDragging] = useState(false)
  const sources = useSources()
  const uploads = useUploads()
  const artifacts = useArtifacts(source === ALL ? "" : source)
  const now = useNow(30_000)
  const canUpload = !!uploads.data?.enabled

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = artifacts.data?.items ?? []
    if (!q) return all
    return all.filter((a) =>
      [
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
        .some((v) => v!.toLowerCase().includes(q)),
    )
  }, [artifacts.data, query])

  return (
    <section
      className={cn("flex min-h-0 flex-col gap-3 rounded-xl", dragging && "outline-primary outline-2 outline-dashed")}
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
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, package, version, uploader, changelog…"
            className="pl-8"
          />
        </div>
        {(sources.data?.length ?? 0) > 1 && (
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All sources</SelectItem>
              {sources.data?.map((s) => (
                <SelectItem key={s.name} value={s.name}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {canUpload && (
          <Button variant="outline" onClick={() => setUploading({ file: null })}>
            <UploadIcon />
            Upload
          </Button>
        )}
      </div>

      {artifacts.data?.errors.map((e) => (
        <Alert key={e.source} variant="destructive">
          <AlertTitle>Source “{e.source}” is unavailable</AlertTitle>
          <AlertDescription>{e.message}</AlertDescription>
        </Alert>
      ))}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {artifacts.isPending ? (
          <div className="grid gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground py-12 text-center text-sm">
            {query
              ? "Nothing matches your search."
              : canUpload
                ? "No APKs yet. Drop one here or press Upload."
                : "No APKs found in the configured sources yet."}
          </p>
        ) : (
          <ul className="grid gap-2">
            {items.map((a) => (
              <ArtifactRow key={`${a.source}/${a.id}`} artifact={a} now={now} onLaunch={onLaunch} />
            ))}
          </ul>
        )}
      </div>

      <UploadDialog
        open={!!uploading}
        initialFile={uploading?.file ?? null}
        onClose={() => setUploading(null)}
        onUploaded={onLaunch}
      />
    </section>
  )
}

function ArtifactRow({
  artifact: a,
  now,
  onLaunch,
}: {
  artifact: ArtifactView
  now: number
  onLaunch: (a: ArtifactView) => void
}) {
  const title = artifactTitle(a)
  const isPrivate = a.meta.visibility === "private"
  const tags = Object.entries(a.meta.tags ?? {})
  const link = safeLink(a.meta.link)
  return (
    <li className="bg-card hover:bg-accent/40 flex items-start gap-3 rounded-xl border p-3 transition-colors">
      <AppIcon src={a.iconUrl} className="size-12" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-medium">{title}</span>
          {a.app?.versionName && <Badge variant="secondary">{a.app.versionName}</Badge>}
          {isPrivate && (
            <Badge variant="outline" className="gap-1">
              <LockIcon className="size-3" />
              private
            </Badge>
          )}
          {a.expiresAt && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="gap-1">
                  <HourglassIcon className="size-3" />
                  temporary
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                Deleted {formatRelative(a.expiresAt, now)} unless launched again
                <span className="block opacity-70">{new Date(a.expiresAt).toLocaleString()}</span>
              </TooltipContent>
            </Tooltip>
          )}
          {a.app?.abis.map((abi) => (
            <Badge key={abi} variant="outline" className="font-mono text-[10px]">
              {abi}
            </Badge>
          ))}
        </div>
        <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 text-xs">
          {a.app ? <span className="font-mono">{a.app.package}</span> : <span>Reading package info…</span>}
          {title !== a.fileName && <span>{a.fileName}</span>}
          <span>{formatBytes(a.size)}</span>
          <span title={new Date(a.uploadedAt).toLocaleString()}>
            {formatRelative(a.uploadedAt, now)}
            {a.meta.uploadedBy ? ` by ${a.meta.uploadedBy}` : ""}
          </span>
          <span>{a.meta.origin ? `${a.source} · ${a.meta.origin}` : a.source}</span>
        </div>
        {tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {tags.map(([k, v]) => (
              <Badge key={k} variant="outline" className="font-mono text-[10px] font-normal">
                {k}: {v}
              </Badge>
            ))}
          </div>
        )}
        {a.meta.note && <p className="mt-1.5 line-clamp-2 text-sm whitespace-pre-line">{a.meta.note}</p>}
        {a.meta.changelog && (
          <details className="mt-1.5 text-sm">
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs select-none">
              Changelog
            </summary>
            <p className="bg-muted/50 mt-1 max-h-60 overflow-y-auto rounded-lg p-2 font-mono text-xs whitespace-pre-wrap">
              {a.meta.changelog}
            </p>
          </details>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {link && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" asChild>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open where this build came from"
                >
                  <ExternalLinkIcon />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-center">
              Open where this build came from{a.meta.origin ? ` (${a.meta.origin})` : ""}
              <span className="block font-mono opacity-70">{link.host}</span>
            </TooltipContent>
          </Tooltip>
        )}
        {a.canManage && <ManageMenu artifact={a} title={title} />}
        <QuickLaunchButton artifact={a} />
        <Button onClick={() => onLaunch(a)}>
          <RocketIcon />
          Launch
        </Button>
      </div>
    </li>
  )
}

function ManageMenu({ artifact, title }: { artifact: ArtifactView; title: string }) {
  const update = useUpdateArtifact()
  const remove = useDeleteArtifact()
  const [confirming, setConfirming] = useState(false)
  const isPrivate = artifact.meta.visibility === "private"
  const isTemporary = !!artifact.meta.temporary

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
          <Button variant="ghost" size="icon" aria-label="Manage">
            <EllipsisVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
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
