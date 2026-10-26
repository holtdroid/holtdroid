import { DownloadIcon, HardDriveIcon, InfoIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import type { AppDataView } from "@/api/client"
import { appDataDownloadURL, useAppData, useDeleteAppData } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
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
import { Skeleton } from "@/components/ui/skeleton"
import { useNow } from "@/hooks/use-now"
import { formatBytes, formatRelative, formatSpan } from "@/lib/format"

export function AppDataPage() {
  const list = useAppData()
  const now = useNow(30_000)
  const rules = list.data
  const groups = new Map<string, AppDataView[]>()
  for (const d of rules?.items ?? []) groups.set(d.package, [...(groups.get(d.package) ?? []), d])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:p-6">
        <div className="grid content-start gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">App data</h1>
            <p className="text-muted-foreground max-w-xl text-sm">
              When you stop a session, the app&apos;s private data is saved here. Pick a save when launching the same
              app to continue where you left off. Only you can see your saves.
            </p>
          </div>

          {rules && !rules.enabled && (
            <Alert>
              <InfoIcon />
              <AlertTitle>Saving app data is turned off on this server</AlertTitle>
              <AlertDescription>Sessions start from a fresh install and nothing is kept after them.</AlertDescription>
            </Alert>
          )}
          {list.isError && (
            <Alert variant="destructive">
              <AlertDescription>Could not load app data: {list.error.message}</AlertDescription>
            </Alert>
          )}

          {list.isPending ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : rules?.enabled && groups.size === 0 ? (
            <div className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
              Nothing saved yet. Launch an app, use it, and stop the session.
            </div>
          ) : (
            [...groups.entries()].map(([pkg, items]) => (
              <section key={pkg} className="grid gap-2">
                <div className="flex items-center gap-2">
                  <AppIcon src={items.find((d) => d.iconUrl)?.iconUrl} className="size-7" />
                  <h2 className="truncate font-semibold">{items[0]?.label || pkg}</h2>
                  <span className="text-muted-foreground truncate font-mono text-xs">{pkg}</span>
                </div>
                <ul className="divide-y rounded-xl border">
                  {items.map((d) => (
                    <AppDataRow key={d.id} data={d} now={now} canDownload={!!rules?.export} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>

        {rules?.enabled && (
          <aside className="grid content-start gap-2 self-start rounded-xl border p-4 text-sm lg:sticky lg:top-6 lg:max-h-[calc(100dvh-6.5rem)] lg:overflow-y-auto">
            <h2 className="font-semibold">How long saves are kept</h2>
            <ul className="text-muted-foreground grid list-disc gap-1 pl-4">
              <li>{rules.keep > 0 ? `The ${rules.keep} most recently used per app` : "Every save, no count limit"}</li>
              <li>
                {rules.maxAge > 0
                  ? `Deleted ${formatSpan(rules.maxAge)} after their last use`
                  : "Never deleted for being unused"}
              </li>
              <li>{rules.cache ? "Saved with the app's cache when it isn't too big" : "Without the app's cache"}</li>
            </ul>
            <p className="text-muted-foreground text-xs">
              Data the app encrypted with Android Keystore keys can&apos;t be read on another device, so such apps may
              sign you out after a restore.
            </p>
          </aside>
        )}
      </div>
    </div>
  )
}

function AppDataRow({ data: d, now, canDownload }: { data: AppDataView; now: number; canDownload: boolean }) {
  const remove = useDeleteAppData()
  const [confirming, setConfirming] = useState(false)

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <div className="grid min-w-0 flex-1 gap-0.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium" title={new Date(d.createdAt).toLocaleString()}>
            Saved {formatRelative(d.createdAt, now)}
          </span>
          {d.versionName && <span className="text-muted-foreground font-mono text-xs">{d.versionName}</span>}
          {d.cache && (
            <Badge variant="secondary" className="gap-1">
              <HardDriveIcon className="size-3" />
              with cache
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
          <span>
            {formatBytes(d.size)} on the device · {formatBytes(d.compressed)} stored
          </span>
          <span>Last used {formatRelative(d.lastUsedAt, now)}</span>
          {d.expiresAt && <span>Deleted {formatRelative(d.expiresAt, now)} unless used</span>}
        </div>
      </div>
      {canDownload && (
        <Button variant="outline" size="sm" asChild>
          <a href={appDataDownloadURL(d)} download>
            <DownloadIcon />
            Download
          </a>
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => setConfirming(true)}>
        <Trash2Icon />
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this save?</DialogTitle>
            <DialogDescription>
              {d.label || d.package}, saved {formatRelative(d.createdAt, now)}. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(d, {
                  onSuccess: () => setConfirming(false),
                  onError: (e) => toast.error("Could not delete", { description: e.message }),
                })
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  )
}
