import { ExternalLinkIcon, RocketIcon, SearchIcon } from "lucide-react"
import { useMemo, useState } from "react"
import type { ArtifactView } from "@/api/client"
import { useArtifacts, useSources } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useNow } from "@/hooks/use-now"
import { formatBytes, formatRelative } from "@/lib/format"

const ALL = "__all__"

export function ArtifactList({ onLaunch }: { onLaunch: (artifact: ArtifactView) => void }) {
  const [source, setSource] = useState(ALL)
  const [query, setQuery] = useState("")
  const sources = useSources()
  const artifacts = useArtifacts(source === ALL ? "" : source)
  const now = useNow(30_000)

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = artifacts.data?.items ?? []
    if (!q) return all
    return all.filter((a) =>
      [a.artifact.fileName, a.meta?.label, a.meta?.package, a.meta?.versionName, a.artifact.uploadedBy, a.artifact.note]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    )
  }, [artifacts.data, query])

  return (
    <section className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, package, version, uploader…"
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
            {query ? "Nothing matches your search." : "No APKs found in the configured sources yet."}
          </p>
        ) : (
          <ul className="grid gap-2">
            {items.map((a) => (
              <ArtifactRow key={`${a.source}/${a.artifact.id}`} artifact={a} now={now} onLaunch={onLaunch} />
            ))}
          </ul>
        )}
      </div>
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
  const title = a.meta?.label || a.artifact.fileName
  return (
    <li className="bg-card hover:bg-accent/40 flex items-start gap-3 rounded-xl border p-3 transition-colors">
      <AppIcon source={a.source} id={a.artifact.id} hasIcon={a.hasIcon} className="size-12" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-medium">{title}</span>
          {a.meta?.versionName && <Badge variant="secondary">{a.meta.versionName}</Badge>}
          {a.meta?.abis.map((abi) => (
            <Badge key={abi} variant="outline" className="font-mono text-[10px]">
              {abi}
            </Badge>
          ))}
        </div>
        <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 text-xs">
          {a.meta ? <span className="font-mono">{a.meta.package}</span> : <span>Reading package info…</span>}
          {title !== a.artifact.fileName && <span>{a.artifact.fileName}</span>}
          <span>{formatBytes(a.artifact.size)}</span>
          <span title={new Date(a.artifact.uploadedAt).toLocaleString()}>
            {formatRelative(a.artifact.uploadedAt, now)}
            {a.artifact.uploadedBy ? ` by ${a.artifact.uploadedBy}` : ""}
          </span>
          <span>{a.source}</span>
        </div>
        {a.artifact.note && <p className="mt-1.5 line-clamp-2 text-sm whitespace-pre-line">{a.artifact.note}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {a.artifact.link && (
          <Button variant="ghost" size="icon" asChild>
            <a href={a.artifact.link} target="_blank" rel="noreferrer" aria-label="Open original message">
              <ExternalLinkIcon />
            </a>
          </Button>
        )}
        <Button onClick={() => onLaunch(a)}>
          <RocketIcon />
          Launch
        </Button>
      </div>
    </li>
  )
}
