import { Link } from "@tanstack/react-router"
import { ArrowLeftIcon, GlobeIcon, SmartphoneIcon } from "lucide-react"
import { type ServerRecording, useRecordingDetail } from "@/api/queries"
import type { RecordingView } from "@/api/client"
import { AppIcon } from "@/components/app-icon"
import { useInShell } from "@/components/shell-context"
import { RecordingHeader, RecordingPlayer } from "@/components/recording/recording-player"
import { recordingName, RenameButton } from "@/components/recording/rename-button"
import { RecordingState } from "@/components/recording/recording-state"
import { UserAvatar } from "@/components/user-avatar"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatBytes, formatDuration } from "@/lib/format"
import logo from "@/logo.svg"

const created = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

export function Title({ r, back, rename }: { r: RecordingView; back: boolean; rename?: boolean }) {
  const owner = r.ownerName || r.owner
  return (
    <div className="flex min-w-0 items-center gap-3.5">
      {back && (
        <Button variant="outline" size="icon" asChild>
          <Link to="/recordings" aria-label="Back to recordings">
            <ArrowLeftIcon />
          </Link>
        </Button>
      )}
      <AppIcon src={r.iconUrl} className="size-10 rounded-[11px]" />
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-lg font-semibold">{recordingName(r)}</h1>
          {rename && <RenameButton recording={r} />}
          <RecordingState state={r.state} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {r.versionName && (
            <Badge variant="secondary" className="font-mono">
              {r.versionName}
            </Badge>
          )}
          {r.screen && (
            <Badge variant="secondary">
              <SmartphoneIcon />
              {r.screen.label}
            </Badge>
          )}
          {r.location && (
            <Badge variant="secondary">
              <GlobeIcon />
              {r.location}
            </Badge>
          )}
          <span className="ml-1 inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {owner && <UserAvatar user={owner} className="size-[18px]" />}
            <span className="truncate">
              {owner ? `${owner} · ` : ""}
              {created.format(new Date(r.createdAt))} · {formatDuration(r.duration)} · {formatBytes(r.size)}
            </span>
          </span>
          {r.reason && <span className="text-xs text-danger">{r.reason}</span>}
        </div>
      </div>
    </div>
  )
}

function Brand() {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
      <img src={logo} alt="" className="size-6" />
      Holtdroid
    </Link>
  )
}

export function RecordingPage({ source }: { source: ServerRecording }) {
  const detail = useRecordingDetail(source)
  const d = detail.data
  const r = d?.recording
  const own = source.kind === "own"
  const inShell = useInShell()
  const title = r ? <Title r={r} back={own && inShell} rename={own && inShell} /> : null
  const brand = inShell ? undefined : <Brand />
  const header = (
    <RecordingHeader>
      {title}
      <span className="flex-1" />
      {brand}
    </RecordingHeader>
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-4 px-4 pt-5 pb-(--dock-space) lg:h-full lg:min-h-[52rem] lg:px-6">
        {detail.isPending ? (
          <>
            {header}
            <Skeleton className="aspect-video rounded-2xl" />
          </>
        ) : detail.isError ? (
          <>
            {header}
            <Alert variant="destructive">
              <AlertDescription>
                {source.kind === "shared"
                  ? "This link doesn't open a recording any more."
                  : `Could not load the recording: ${detail.error.message}`}
              </AlertDescription>
            </Alert>
          </>
        ) : d?.manifest ? (
          <RecordingPlayer
            key={d.recording.id}
            source={source}
            detail={d}
            manifest={d.manifest}
            title={title}
            extra={brand}
          />
        ) : (
          <>
            {header}
            <div className="grid aspect-video place-items-center rounded-2xl border border-dashed text-sm text-muted-foreground">
              Nothing recorded yet: the session is still starting.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
