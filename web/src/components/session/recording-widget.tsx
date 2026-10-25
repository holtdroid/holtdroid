import { useNavigate } from "@tanstack/react-router"
import {
  ClapperboardIcon,
  ClockIcon,
  ExternalLinkIcon,
  Link2OffIcon,
  LinkIcon,
  PinIcon,
  SquareIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { RecordingView } from "@/api/client"
import {
  useAddSessionMarker,
  useKeepRecording,
  useRecordings,
  useSessionRecording,
  useShareRecording,
} from "@/api/queries"
import {
  CardLine,
  Note,
  ShadeButton,
  ShadeCard,
  ShadeHeader,
  ShadePanel,
  ShadeRoot,
  Tile,
} from "@/components/session/shade"
import { HoverCardTrigger } from "@/components/ui/hover-card"
import { useNow } from "@/hooks/use-now"
import { formatBytes, formatRelative, formatSpan } from "@/lib/format"
import { clock } from "@/lib/recording/timeline"
import { cn } from "@/lib/utils"

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 rounded-2xl bg-neutral-800 px-3 py-2">
      <span className="text-[11px] text-neutral-400">{label}</span>
      <span className="truncate text-sm font-medium tabular-nums">{value}</span>
    </div>
  )
}

const states: Record<RecordingView["state"], string> = {
  pending: "Starting",
  recording: "Recording",
  done: "Saved",
  failed: "Stopped",
  interrupted: "Cut off",
}

export function RecordingWidget({
  provider,
  id,
  recording,
  since,
  manage,
}: {
  provider: string
  id: string
  recording?: string
  since?: string
  manage: boolean
}) {
  const list = useRecordings()
  const now = useNow()
  const mark = useAddSessionMarker()
  const toggle = useSessionRecording()
  const keep = useKeepRecording()
  const share = useShareRecording()
  const navigate = useNavigate()
  const rules = list.data
  if (!rules?.enabled) return null

  const item = recording ? rules.items.find((r) => r.id === recording) : undefined
  const elapsed = recording && since ? Math.max(0, now - new Date(since).getTime()) : 0
  const always = rules.mode === "always"

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

  const click = () => {
    if (!manage) return
    if (recording) addMarker()
    else if (!always) {
      toggle.mutate(
        { provider, id, on: true },
        { onError: (e) => toast.error("Could not start recording", { description: e.message }) },
      )
    }
  }

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

  const retention = item
    ? item.keep
      ? item.share
        ? "Kept while it is shared"
        : "Never deleted"
      : item.expiresAt
        ? `Deleted ${formatRelative(item.expiresAt, now)}`
        : "Kept"
    : ""

  return (
    <ShadeRoot>
      <HoverCardTrigger asChild>
        <ShadeCard aria-label="Recording" onClick={click} disabled={!manage && !recording}>
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <span
              className={cn(
                "size-2.5 shrink-0 rounded-full",
                recording ? "animate-pulse bg-red-500" : "bg-neutral-500",
              )}
            />
            Recording
          </span>
          <CardLine icon={ClockIcon}>{recording ? clock(elapsed) : "Not recording"}</CardLine>
          <CardLine icon={PinIcon}>
            {recording ? "Click to mark" : always ? "Starts with the device" : manage ? "Click to start" : "Off"}
          </CardLine>
        </ShadeCard>
      </HoverCardTrigger>
      <ShadePanel>
        <ShadeHeader
          title="Recording"
          summary={
            recording
              ? `${item ? states[item.state] : "Recording"} · ${always ? "always on" : "started by you"}`
              : always
                ? "Starts when the device is ready"
                : "Not recording"
          }
        />
        {recording && (
          <div className="grid grid-cols-3 gap-1.5">
            <Stat label="Duration" value={clock(elapsed)} />
            <Stat label="Size" value={item ? formatBytes(item.size) : "—"} />
            <Stat
              label="Storage"
              value={
                rules.quota > 0 ? `${Math.round((rules.used / rules.quota) * 100)}% used` : formatBytes(rules.used)
              }
            />
          </div>
        )}
        {recording && (
          <ShadeButton primary disabled={!manage || mark.isPending} onClick={addMarker}>
            <PinIcon />
            Add a marker here
          </ShadeButton>
        )}
        {item && (
          <>
            <Tile
              icon={PinIcon}
              label="Keep forever"
              status={retention}
              on={item.keep}
              wide
              disabled={!manage || !!item.share || keep.isPending}
              onClick={() => keep.mutate({ id: item.id, keep: !item.keep })}
            />
            <div className="grid gap-2">
              <ShadeButton disabled={!manage || share.isPending} onClick={() => void copyLink()}>
                <LinkIcon />
                {item.share ? "Copy the share link" : "Share: make a link and copy it"}
              </ShadeButton>
              {item.share && (
                <ShadeButton
                  disabled={!manage || share.isPending}
                  onClick={() => share.mutate({ id: item.id, share: false })}
                >
                  <Link2OffIcon />
                  Stop sharing
                </ShadeButton>
              )}
              <ShadeButton onClick={() => open(item.id)}>
                <ExternalLinkIcon />
                Open the recording
              </ShadeButton>
            </div>
          </>
        )}
        {!recording && !always && (
          <ShadeButton primary disabled={!manage || toggle.isPending} onClick={click}>
            <ClapperboardIcon />
            Start recording
          </ShadeButton>
        )}
        {recording && !always && (
          <ShadeButton
            disabled={!manage || toggle.isPending}
            onClick={() =>
              toggle.mutate(
                { provider, id, on: false },
                {
                  onSuccess: () =>
                    toast("Recording saved", { action: { label: "Watch", onClick: () => open(recording) } }),
                  onError: (e) => toast.error("Could not stop the recording", { description: e.message }),
                },
              )
            }
          >
            <SquareIcon />
            Stop recording
          </ShadeButton>
        )}
        <Note>
          {recording ? "Click the card to pin this moment on the recording's timeline. " : ""}
          {always
            ? "This server records every session from the start, and a recording can't be stopped."
            : rules.mode === "auto"
              ? "Sessions are recorded unless you turn it off when launching."
              : "Sessions are recorded only when you start it."}{" "}
          {rules.maxAge > 0
            ? `Recordings are deleted ${formatSpan(rules.maxAge)} after they were made unless kept. `
            : ""}
          {rules.quota > 0 ? `You have ${formatBytes(rules.quota)} of space; ${formatBytes(rules.used)} is used.` : ""}
        </Note>
      </ShadePanel>
    </ShadeRoot>
  )
}
