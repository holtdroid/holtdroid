import { Link, useNavigate } from "@tanstack/react-router"
import {
  ChevronLeftIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FlagIcon,
  Link2OffIcon,
  LinkIcon,
  Loader2Icon,
  SquareIcon,
  TimerResetIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { Location, SessionState, SessionView } from "@/api/client"
import {
  useAddSessionMarker,
  useExtendSession,
  useRecordings,
  useSessionRecording,
  useShareRecording,
  useStopSession,
} from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { VersionSwitcher } from "@/components/session/version-switcher"
import { SessionStateBadge } from "@/components/session-state-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatDuration } from "@/lib/format"
import { locationFlag } from "@/lib/location"
import { clock } from "@/lib/recording/timeline"
import { idleWarning } from "@/lib/session-tone"
import { countdown } from "@/lib/session-countdown"
import { cn } from "@/lib/utils"

export function SessionHeader({
  session,
  state,
  manage,
  now,
  locations,
  location: current,
  recording,
  recordedAt,
}: {
  session: SessionView
  state: SessionState
  manage: boolean
  now: number
  locations: Location[]
  location?: string
  recording?: string
  recordedAt?: string
}) {
  const stop = useStopSession()
  const extend = useExtendSession()
  const navigate = useNavigate()
  const caps = session.capabilities
  const screen = caps?.screen
  const location = locations.find((l) => l.id === current)
  const left = countdown(session, now)
  const device = [caps?.model || screen?.label, screen && `${screen.width}×${screen.height}`]
    .filter(Boolean)
    .join(" · ")

  return (
    <header className="flex flex-wrap items-center gap-3.5">
      <Button variant="outline" size="icon" asChild>
        <Link to="/" aria-label="Back to apps">
          <ChevronLeftIcon />
        </Link>
      </Button>
      <VersionSwitcher session={session} disabled={state !== "ready" || !manage}>
        <AppIcon src={session.iconUrl} className="size-10 rounded-[11px]" />
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-lg font-semibold">{session.label || session.package}</span>
          {session.versionName && (
            <span className="shrink-0 font-mono text-[15px] text-muted-foreground">{session.versionName}</span>
          )}
          <SessionStateBadge state={state} />
        </span>
      </VersionSwitcher>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {device && <Badge variant="secondary">{device}</Badge>}
        {caps?.android && <Badge variant="secondary">Android {caps.android}</Badge>}
        {session.webview && <Badge variant="secondary">WebView {session.webview}</Badge>}
        {location && (
          <Badge variant="secondary">
            {locationFlag(location)} {location.label}
          </Badge>
        )}
        <span className="ml-1 truncate font-mono text-xs text-muted-foreground" title={session.package}>
          {session.slotLabel || session.slot}
        </span>
      </div>
      <span className="flex-1" />
      <div className="flex w-44 flex-col gap-1.5" title={left.idle ? "Any input on the device resets it" : undefined}>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{left.idle ? "Stops when idle in" : "Stops in"}</span>
          <span className={cn("font-mono", left.ms <= idleWarning && "text-warning")}>{formatDuration(left.ms)}</span>
        </div>
        <div className="flex gap-0.5" aria-hidden>
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full",
                i < left.segments ? (left.ms <= idleWarning ? "bg-warning" : "bg-foreground") : "bg-border",
              )}
            />
          ))}
        </div>
      </div>
      <RecordControls session={session} manage={manage} now={now} recording={recording} recordedAt={recordedAt} />
      <Button
        variant="outline"
        disabled={!manage || extend.isPending}
        onClick={() =>
          extend.mutate(session, {
            onSuccess: () => toast("Session extended"),
            onError: (e) => toast.error("Could not extend", { description: e.message }),
          })
        }
      >
        <TimerResetIcon />
        Extend
      </Button>
      <Button
        variant="destructive"
        disabled={!manage || stop.isPending}
        onClick={() =>
          stop.mutate(session, {
            onSuccess: () => void navigate({ to: "/" }),
            onError: (e) => toast.error("Could not stop", { description: e.message }),
          })
        }
      >
        {stop.isPending ? <Loader2Icon className="animate-spin" /> : <SquareIcon />}
        {stop.isPending && session.saveAppData && state === "ready" ? "Saving app data…" : "Stop"}
      </Button>
    </header>
  )
}

function RecordControls({
  session,
  manage,
  now,
  recording,
  recordedAt,
}: {
  session: SessionView
  manage: boolean
  now: number
  recording?: string
  recordedAt?: string
}) {
  const list = useRecordings()
  const toggle = useSessionRecording()
  const mark = useAddSessionMarker()
  const share = useShareRecording()
  const navigate = useNavigate()
  const rules = list.data
  if (!rules?.enabled) return null
  const { provider, id } = session
  const always = rules.mode === "always"
  const item = recording ? rules.items.find((r) => r.id === recording) : undefined
  const elapsed = recording && recordedAt ? Math.max(0, now - new Date(recordedAt).getTime()) : 0
  const open = (rid: string) => void navigate({ to: "/recordings/$id", params: { id: rid } })

  const addMarker = () =>
    mark.mutate(
      { provider, id },
      {
        onSuccess: (r) =>
          toast.success("Marker added", {
            description: `at ${clock(r.marker.t)}`,
            action: { label: "Open", onClick: () => open(r.recording) },
          }),
        onError: (e) => toast.error("Could not add a marker", { description: e.message }),
      },
    )

  const setRecording = (on: boolean) =>
    toggle.mutate(
      { provider, id, on },
      {
        onSuccess: () => {
          if (!on && recording) toast("Recording saved", { action: { label: "Watch", onClick: () => open(recording) } })
        },
        onError: (e) =>
          toast.error(on ? "Could not start recording" : "Could not stop the recording", { description: e.message }),
      },
    )

  const copyLink = async () => {
    if (!item) return
    try {
      const v = item.share ? item : await share.mutateAsync({ id: item.id, share: true })
      if (!v.share) return
      await navigator.clipboard.writeText(v.share.url)
      toast.success("Link copied", {
        description: "Anyone with it can watch. The recording is kept while it is shared.",
      })
    } catch (e) {
      toast.error("Could not share", { description: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <>
      {recording ? (
        <Button
          variant="outline"
          disabled={!manage || mark.isPending}
          title="Recording: click to mark this moment"
          onClick={addMarker}
        >
          <span className="size-[7px] animate-pulse rounded-full bg-danger" />
          <span className="font-mono">{clock(elapsed)}</span>
          <FlagIcon />
        </Button>
      ) : (
        !always && (
          <Button variant="outline" disabled={!manage || toggle.isPending} onClick={() => setRecording(true)}>
            <span className="size-[7px] rounded-full bg-danger" />
            Record
          </Button>
        )
      )}
      {item && (
        <Button variant="outline" disabled={!manage || share.isPending} onClick={() => void copyLink()}>
          <LinkIcon />
          Share
        </Button>
      )}
      {item && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="More actions">
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem disabled={!manage} onSelect={addMarker}>
              <FlagIcon />
              Add a marker here
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => open(item.id)}>
              <ExternalLinkIcon />
              Open the recording
            </DropdownMenuItem>
            {item.share && (
              <DropdownMenuItem disabled={!manage} onSelect={() => share.mutate({ id: item.id, share: false })}>
                <Link2OffIcon />
                Stop sharing
              </DropdownMenuItem>
            )}
            {!always && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!manage} onSelect={() => setRecording(false)}>
                  <SquareIcon />
                  Stop recording
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  )
}
