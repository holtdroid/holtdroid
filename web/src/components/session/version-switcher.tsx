import { ArrowDownIcon, CheckIcon, ChevronDownIcon, HistoryIcon, Loader2Icon, SearchIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { ArtifactView, SessionView } from "@/api/client"
import { useArtifacts, useInstallBuild } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { artifactTitle } from "@/components/artifact-list"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { useNow } from "@/hooks/use-now"
import { formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"

export function VersionSwitcher({ session, disabled }: { session: SessionView; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [keepData, setKeepData] = useState(true)
  const artifacts = useArtifacts("")
  const install = useInstallBuild()
  const now = useNow(30_000)

  const builds = useMemo(
    () =>
      (artifacts.data?.items ?? [])
        .filter((a) => a.app?.package === session.package)
        .toSorted((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()),
    [artifacts.data, session.package],
  )
  const current = builds.find((a) => a.source === session.source && a.id === session.artifactId)
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return builds
    return builds.filter((a) =>
      [
        a.fileName,
        a.meta.title,
        a.app?.versionName,
        String(a.app?.versionCode ?? ""),
        a.meta.uploadedBy,
        a.meta.changelog,
        ...Object.values(a.meta.tags ?? {}),
      ]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    )
  }, [builds, query])

  const choose = (artifact: ArtifactView) => {
    setOpen(false)
    const version = artifact.app?.versionName || artifact.fileName
    toast(`Installing ${version}`, { description: keepData ? "Keeping the app's data" : "Clean install" })
    install.mutate(
      { session, artifact, keepData },
      {
        onSuccess: () => toast.success(`Now running ${version}`),
        onError: (e) =>
          toast.error(`Could not install ${version}`, {
            description: e.message.includes("INSTALL_FAILED_UPDATE_INCOMPATIBLE")
              ? "It is signed with a different key. Turn off “Keep app data” to install it cleanly."
              : e.message,
          }),
      },
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled || install.isPending}>
          {install.isPending ? <Loader2Icon className="animate-spin" /> : <HistoryIcon />}
          {session.versionName || "Version"}
          <ChevronDownIcon className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-[28rem] max-w-[calc(100vw-2rem)] gap-3 p-3">
        <div className="grid gap-1">
          <span className="text-sm font-medium">Switch version</span>
          <span className="text-muted-foreground text-xs">
            Install another build of this app into the running device, e.g. to test how its data migrates.
          </span>
        </div>
        <div className="relative">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Version, branch, uploader…"
            className="pl-8"
            autoFocus
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">App ID</span>
          <Badge variant="secondary" className="font-mono">
            {session.package}
          </Badge>
          <span className="text-muted-foreground ml-auto">
            {builds.length} build{builds.length === 1 ? "" : "s"}
          </span>
        </div>
        <ul className="-mx-1 grid max-h-80 gap-1 overflow-y-auto px-1">
          {artifacts.isPending && <li className="text-muted-foreground py-6 text-center text-sm">Loading builds…</li>}
          {!artifacts.isPending && shown.length === 0 && (
            <li className="text-muted-foreground py-6 text-center text-sm">
              {query ? "Nothing matches your search." : "No other builds of this app yet."}
            </li>
          )}
          {shown.map((a) => {
            const installed = a === current
            const downgrade = keepData && !installed && (a.app?.versionCode ?? 0) < (current?.app?.versionCode ?? 0)
            return (
              <li key={`${a.source}/${a.id}`}>
                <button
                  type="button"
                  disabled={installed}
                  onClick={() => choose(a)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors",
                    installed ? "bg-accent/60 cursor-default" : "hover:bg-accent/40",
                  )}
                >
                  <AppIcon src={a.iconUrl} className="size-9" />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{a.app?.versionName || a.fileName}</span>
                      {a.app?.versionCode !== undefined && (
                        <span className="text-muted-foreground font-mono text-xs">({a.app.versionCode})</span>
                      )}
                      {installed && (
                        <Badge variant="secondary" className="gap-1">
                          <CheckIcon className="size-3" />
                          installed
                        </Badge>
                      )}
                      {downgrade && (
                        <Badge variant="outline" className="gap-1">
                          <ArrowDownIcon className="size-3" />
                          downgrade
                        </Badge>
                      )}
                    </span>
                    <span className="text-muted-foreground truncate text-xs">
                      {artifactTitle(a)} · {formatRelative(a.uploadedAt, now)}
                      {a.meta.uploadedBy ? ` by ${a.meta.uploadedBy}` : ""} · {a.source}
                    </span>
                    {Object.keys(a.meta.tags ?? {}).length > 0 && (
                      <span className="flex flex-wrap gap-1">
                        {Object.entries(a.meta.tags ?? {}).map(([k, v]) => (
                          <Badge key={k} variant="outline" className="font-mono text-[10px] font-normal">
                            {k}: {v}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <div className="flex items-start gap-2 border-t pt-3">
          <Switch id="keep-data" checked={keepData} onCheckedChange={setKeepData} className="mt-0.5" />
          <Label htmlFor="keep-data" className="grid gap-0.5 font-normal">
            <span className="text-sm font-medium">Keep app data</span>
            <span className="text-muted-foreground text-xs">
              {keepData
                ? "Installed over the current build, upgrade or downgrade, so its storage migrates."
                : "The current build and its data are removed first."}
            </span>
          </Label>
        </div>
      </PopoverContent>
    </Popover>
  )
}
