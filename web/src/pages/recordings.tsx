import { Link } from "@tanstack/react-router"
import { ClapperboardIcon, FolderOpenIcon, InfoIcon, LinkIcon, PinIcon, PinOffIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import type { RecordingView } from "@/api/client"
import { useDeleteRecording, useKeepRecording, useRecordings, useShareRecording } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { recordingName, RenameButton } from "@/components/recording/rename-button"
import { RecordingState } from "@/components/recording/recording-state"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useNow } from "@/hooks/use-now"
import { formatBytes, formatDuration, formatRelative, formatSpan } from "@/lib/format"

export function RecordingsPage() {
  const list = useRecordings()
  const now = useNow(30_000)
  const rules = list.data

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-7xl gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:p-6">
        <div className="grid content-start gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">Recordings</h1>
              <Button variant="outline" size="sm" asChild>
                <Link to="/open">
                  <FolderOpenIcon />
                  Open a file
                </Link>
              </Button>
            </div>
            <p className="text-muted-foreground max-w-xl text-sm">
              Sessions recorded on the server: the screen with logcat, the device, the network and the load beside it.
              Watch them here, download them as a video or share a link.
            </p>
          </div>

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
            <Skeleton className="h-60 rounded-xl" />
          ) : rules?.enabled && rules.items.length === 0 ? (
            <div className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
              Nothing recorded yet. Sessions are recorded from their start unless you turn it off at launch.
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {rules?.items.map((r) => (
                <RecordingCard key={r.id} recording={r} now={now} canShare={rules.share} />
              ))}
            </ul>
          )}
        </div>

        {rules?.enabled && (
          <aside className="grid content-start gap-3 self-start rounded-xl border p-4 text-sm lg:sticky lg:top-6 lg:max-h-[calc(100dvh-6.5rem)] lg:overflow-y-auto">
            <h2 className="font-semibold">Storage</h2>
            {rules.quota > 0 ? (
              <div className="grid gap-1.5">
                <Progress value={Math.min(100, (rules.used / rules.quota) * 100)} />
                <span className="text-muted-foreground text-xs">
                  {formatBytes(rules.used)} of {formatBytes(rules.quota)}
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground text-xs">{formatBytes(rules.used)} used, no limit</span>
            )}
            <ul className="text-muted-foreground grid list-disc gap-1 pl-4">
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

function RecordingCard({ recording: r, now, canShare }: { recording: RecordingView; now: number; canShare: boolean }) {
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
    <li className="bg-card group grid overflow-hidden rounded-xl border">
      <Link to="/recordings/$id" params={{ id: r.id }} className="relative block aspect-video bg-black">
        {r.thumbnailUrl ? (
          <img src={r.thumbnailUrl} alt="" className="size-full object-contain" loading="lazy" />
        ) : (
          <span className="text-muted-foreground grid size-full place-items-center">
            <ClapperboardIcon className="size-8" />
          </span>
        )}
        <span className="absolute top-2 left-2">
          <RecordingState state={r.state} />
        </span>
        <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-xs text-white tabular-nums">
          {formatDuration(r.duration)}
        </span>
      </Link>
      <div className="grid gap-2 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <AppIcon src={r.iconUrl} className="size-7" />
          <div className="grid min-w-0">
            <span className="truncate text-sm font-medium" title={recordingName(r)}>
              {recordingName(r)}
            </span>
            <span className="text-muted-foreground truncate font-mono text-xs">
              {r.versionName ? `${r.versionName} · ` : ""}
              {formatBytes(r.size)}
            </span>
          </div>
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
          <span title={new Date(r.createdAt).toLocaleString()}>{formatRelative(r.createdAt, now)}</span>
          {r.keep ? <span>kept</span> : r.expiresAt && <span>deleted {formatRelative(r.expiresAt, now)}</span>}
          {r.share && <span>shared</span>}
        </div>
        {r.reason && <p className="text-destructive text-xs">{r.reason}</p>}
        <div className="-mx-1 flex items-center gap-0.5">
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
              className="text-muted-foreground"
              onClick={() => share.mutate({ id: r.id, share: false })}
            >
              Stop sharing
            </Button>
          )}
          <RenameButton recording={r} />
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label="Delete"
            onClick={() => setConfirming(true)}
          >
            <Trash2Icon />
          </Button>
        </div>
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
