import { Link } from "@tanstack/react-router"
import {
  ArrowRightIcon,
  ClapperboardIcon,
  FlagIcon,
  FolderOpenIcon,
  InfoIcon,
  LinkIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import type { RecordingView } from "@/api/client"
import { useDeleteRecording, useKeepRecording, useRecordings, useShareRecording } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { recordingName, RenameButton } from "@/components/recording/rename-button"
import { RecordingState } from "@/components/recording/recording-state"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useNow } from "@/hooks/use-now"
import { formatBytes, formatDuration, formatRelative, formatSpan } from "@/lib/format"
import { cn } from "@/lib/utils"

export function RecordingsPage() {
  const list = useRecordings()
  const now = useNow(30_000)
  const rules = list.data
  const items = rules?.items ?? []

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-6">
        <div className="grid content-start gap-4">
          <header className="flex flex-wrap items-center gap-3">
            <div className="grid gap-0.5">
              <h1 className="text-xl font-semibold tracking-tight">Recordings</h1>
              <p className="text-sm text-muted-foreground">
                {rules?.enabled
                  ? `${items.length} ${items.length === 1 ? "recording" : "recordings"} · ${formatBytes(rules.used)} used`
                  : "Sessions recorded on the server, to watch, download or share"}
              </p>
            </div>
            <span className="flex-1" />
            <Button variant="outline" asChild>
              <Link to="/open">
                <FolderOpenIcon />
                Open a file
              </Link>
            </Button>
          </header>

          {rules && !rules.enabled && (
            <Alert>
              <InfoIcon />
              <AlertTitle>Recordings are turned off on this server</AlertTitle>
              <AlertDescription>Sessions aren&apos;t recorded.</AlertDescription>
            </Alert>
          )}
          {list.isError && (
            <Alert variant="destructive">
              <AlertDescription>Could not load recordings: {list.error.message}</AlertDescription>
            </Alert>
          )}

          {list.isPending ? (
            <Skeleton className="h-60 rounded-2xl" />
          ) : rules?.enabled && items.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              Nothing recorded yet. Sessions are recorded from their start unless you turn it off at launch.
            </div>
          ) : (
            items.length > 0 && (
              <ul className="overflow-hidden rounded-2xl border bg-card">
                {items.map((r) => (
                  <RecordingRow key={r.id} recording={r} now={now} canShare={!!rules?.share} />
                ))}
              </ul>
            )
          )}
        </div>

        {rules?.enabled && (
          <aside className="grid content-start gap-3 self-start rounded-2xl border bg-card p-4 text-sm lg:sticky lg:top-5">
            <h2 className="text-xs font-semibold tracking-[.06em] text-muted-foreground uppercase">Storage</h2>
            {rules.quota > 0 ? (
              <div className="grid gap-1.5">
                <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      rules.used / rules.quota > 0.9 ? "bg-danger" : "bg-foreground",
                    )}
                    style={{ width: `${Math.min(100, (rules.used / rules.quota) * 100)}%` }}
                  />
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {formatBytes(rules.used)} of {formatBytes(rules.quota)}
                </span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">{formatBytes(rules.used)} used, no limit</span>
            )}
            <ul className="grid gap-2 text-[13px] text-muted-foreground">
              <li>
                {rules.maxAge > 0
                  ? `Deleted ${formatSpan(rules.maxAge)} after recording unless you keep them`
                  : "Kept until you delete them"}
              </li>
              {rules.minDuration > 0 && (
                <li>
                  Recordings shorter than {formatSpan(rules.minDuration)} aren&apos;t kept, unless they have a marker or
                  you kept them
                </li>
              )}
              {rules.quota > 0 && <li>When the space runs out, the oldest ones that aren&apos;t kept go first</li>}
              {rules.share && <li>A share link opens the recording without signing in, until you turn it off</li>}
            </ul>
          </aside>
        )}
      </div>
    </div>
  )
}

function RecordingRow({ recording: r, now, canShare }: { recording: RecordingView; now: number; canShare: boolean }) {
  const keep = useKeepRecording()
  const share = useShareRecording()
  const remove = useDeleteRecording()
  const [confirming, setConfirming] = useState(false)

  const copyShare = async () => {
    try {
      const v = r.share ? r : await share.mutateAsync({ id: r.id, share: true })
      if (!("share" in v) || !v.share) return
      await navigator.clipboard.writeText(v.share.url)
      toast.success("Share link copied", { description: "Anyone with the link can watch this recording." })
    } catch (e) {
      toast.error("Could not share", { description: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <li className="flex items-center gap-3 border-b border-dashed px-4 py-3 last:border-b-0">
      <Link
        to="/recordings/$id"
        params={{ id: r.id }}
        className="relative grid h-[72px] w-[44px] shrink-0 place-items-center overflow-hidden rounded-lg bg-frame"
        aria-label={`Open ${recordingName(r)}`}
      >
        {r.thumbnailUrl ? (
          <img src={r.thumbnailUrl} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <ClapperboardIcon className="size-5 text-white/60" />
        )}
      </Link>
      <AppIcon src={r.iconUrl} className="hidden size-9 sm:grid" />
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to="/recordings/$id"
            params={{ id: r.id }}
            className="truncate font-medium hover:underline"
            title={recordingName(r)}
          >
            {recordingName(r)}
          </Link>
          <RecordingState state={r.state} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {r.versionName && (
            <Badge variant="secondary" className="font-mono">
              {r.versionName}
            </Badge>
          )}
          {r.markers > 0 && (
            <Badge variant="secondary" title={`${r.markers} ${r.markers === 1 ? "marker" : "markers"}`}>
              <FlagIcon />
              {r.markers}
            </Badge>
          )}
          {r.share ? <Badge variant="info">Shared</Badge> : r.keep ? <Badge variant="success">Kept</Badge> : null}
          <span className="truncate text-xs text-muted-foreground">
            <span title={new Date(r.createdAt).toLocaleString()}>{formatRelative(r.createdAt, now)}</span> ·{" "}
            <span className="font-mono">{formatDuration(r.duration)}</span> · {formatBytes(r.size)}
            {!r.keep && !r.share && r.expiresAt && ` · deleted ${formatRelative(r.expiresAt, now)}`}
          </span>
        </div>
        {r.reason && <p className="text-xs text-danger">{r.reason}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={keep.isPending}
              aria-label={r.keep ? "Let it expire" : "Keep"}
              onClick={() => keep.mutate({ id: r.id, keep: !r.keep })}
            >
              {r.keep ? <PinOffIcon /> : <PinIcon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{r.keep ? "Let retention delete it" : "Keep past the retention period"}</TooltipContent>
        </Tooltip>
        {canShare && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Copy share link" onClick={() => void copyShare()}>
                <LinkIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{r.share ? "Copy the share link" : "Make and copy a share link"}</TooltipContent>
          </Tooltip>
        )}
        {r.share && (
          <Button
            variant="ghost"
            size="sm"
            className="hidden text-muted-foreground md:inline-flex"
            onClick={() => share.mutate({ id: r.id, share: false })}
          >
            Stop sharing
          </Button>
        )}
        <RenameButton recording={r} />
        <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => setConfirming(true)}>
          <Trash2Icon />
        </Button>
        <Button variant="outline" size="icon-sm" asChild>
          <Link to="/recordings/$id" params={{ id: r.id }} aria-label="Open">
            <ArrowRightIcon />
          </Link>
        </Button>
      </div>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this recording?</DialogTitle>
            <DialogDescription>
              {recordingName(r)}, recorded {formatRelative(r.createdAt, now)}. Its share link stops working. This
              can&apos;t be undone.
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
                remove.mutate(r.id, {
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
