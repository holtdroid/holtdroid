import { Link } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { type ServerRecording, useRecordingDetail } from "@/api/queries"
import type { RecordingView } from "@/api/client"
import { AppIcon } from "@/components/app-icon"
import { HeaderSlot } from "@/components/header-slot"
import { RecordingPlayer } from "@/components/recording/recording-player"
import { recordingName, RenameButton } from "@/components/recording/rename-button"
import { RecordingState } from "@/components/recording/recording-state"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatBytes } from "@/lib/format"
import logo from "@/logo.svg"

export function Title({ r, back, rename }: { r: RecordingView; back: boolean; rename?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {back && (
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/recordings" aria-label="Back to recordings">
            <ArrowLeftIcon />
          </Link>
        </Button>
      )}
      <AppIcon src={r.iconUrl} className="size-9" />
      <div className="grid min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{recordingName(r)}</span>
          <RecordingState state={r.state} />
        </span>
        <span className="text-muted-foreground truncate font-mono text-xs">
          {r.package}
          {r.versionName ? ` · ${r.versionName}` : ""} · {new Date(r.createdAt).toLocaleString()}
          {r.owner ? ` · ${r.owner}` : ""} · {formatBytes(r.size)}
          {r.reason && <span className="text-destructive"> · {r.reason}</span>}
        </span>
      </div>
      {rename && <RenameButton recording={r} />}
    </div>
  )
}

export function RecordingPage({ source }: { source: ServerRecording }) {
  const detail = useRecordingDetail(source)
  const d = detail.data
  const r = d?.recording
  const own = source.kind === "own"

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:overflow-hidden">
      {own && r && (
        <HeaderSlot>
          <Title r={r} back rename />
        </HeaderSlot>
      )}
      {!own && (
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          {r && <Title r={r} back={false} />}
          <span className="ml-auto flex shrink-0 items-center gap-2 font-semibold tracking-tight">
            <img src={logo} alt="" className="size-6" />
            Holtdroid
          </span>
        </header>
      )}
      <div className="min-h-0 flex-1 p-2 lg:p-3">
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
      </div>
    </div>
  )
}
