import { Link } from "@tanstack/react-router"
import { ArrowLeftIcon, LinkIcon, PinIcon, PinOffIcon } from "lucide-react"
import { toast } from "sonner"
import { type RecordingSource, useKeepRecording, useRecordingDetail, useShareRecording } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { RecordingPlayer } from "@/components/recording/recording-player"
import { RecordingState } from "@/components/recording/recording-state"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatBytes } from "@/lib/format"
import logo from "@/logo.svg"

export function RecordingPage({ source }: { source: RecordingSource }) {
  const detail = useRecordingDetail(source)
  const keep = useKeepRecording()
  const share = useShareRecording()
  const d = detail.data
  const r = d?.recording

  const copyShare = async () => {
    if (!r) return
    try {
      const v = r.share ? r : await share.mutateAsync({ id: r.id, share: true })
      if (!v.share) return
      await navigator.clipboard.writeText(v.share.url)
      toast.success("Share link copied", { description: "Anyone with the link can watch this recording." })
      void detail.refetch()
    } catch (e) {
      toast.error("Could not share", { description: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-[1600px] gap-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-center gap-3">
          {source.kind === "own" ? (
            <Button variant="ghost" size="icon-sm" asChild>
              <Link to="/recordings" aria-label="Back">
                <ArrowLeftIcon />
              </Link>
            </Button>
          ) : (
            <span className="flex items-center gap-2 font-semibold tracking-tight">
              <img src={logo} alt="" className="size-7" />
              Holtdroid
            </span>
          )}
          {r && (
            <div className="flex min-w-0 items-center gap-2">
              <AppIcon src={r.iconUrl} className="size-8" />
              <div className="grid min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{r.label || r.package}</span>
                  <RecordingState state={r.state} />
                </span>
                <span className="text-muted-foreground truncate font-mono text-xs">
                  {r.package}
                  {r.versionName ? ` · ${r.versionName}` : ""} · {new Date(r.createdAt).toLocaleString()}
                  {r.owner ? ` · ${r.owner}` : ""} · {formatBytes(r.size)}
                </span>
              </div>
            </div>
          )}
          {r && source.kind === "own" && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={keep.isPending}
                onClick={() => keep.mutate({ id: r.id, keep: !r.keep }, { onSuccess: () => void detail.refetch() })}
              >
                {r.keep ? <PinOffIcon /> : <PinIcon />}
                {r.keep ? "Kept" : "Keep"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void copyShare()}>
                <LinkIcon />
                {r.share ? "Copy link" : "Share"}
              </Button>
              {r.share && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => share.mutate({ id: r.id, share: false }, { onSuccess: () => void detail.refetch() })}
                >
                  Stop sharing
                </Button>
              )}
            </div>
          )}
        </div>

        {detail.isPending ? (
          <Skeleton className="aspect-video rounded-xl" />
        ) : detail.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {source.kind === "shared"
                ? "This link doesn't open a recording any more."
                : `Could not load the recording: ${detail.error.message}`}
            </AlertDescription>
          </Alert>
        ) : d?.manifest ? (
          <RecordingPlayer key={d.recording.id} source={source} detail={d} manifest={d.manifest} />
        ) : (
          <div className="text-muted-foreground grid aspect-video place-items-center rounded-xl border border-dashed text-sm">
            Nothing recorded yet: the session is still starting.
          </div>
        )}
        {r?.reason && <p className="text-destructive text-sm">{r.reason}</p>}
      </div>
    </div>
  )
}
