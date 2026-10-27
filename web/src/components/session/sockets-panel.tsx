import {
  ArrowDownIcon,
  ArrowUpIcon,
  ExternalLinkIcon,
  PauseIcon,
  PlayIcon,
  RadioIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { type DevToolsEntry, type DevToolsSocket, type MarkerIcon, sessionBase } from "@/api/client"
import { useAddSessionMarker } from "@/api/queries"
import { FrameSummary } from "@/components/recording/devtools-view"
import { AtMoment, BodyView, type Clocks, ClocksContext, PlayheadContext } from "@/components/recording/json-view"
import { MarkerBadge, markerIcons } from "@/components/recording/markers"
import { useDevice } from "@/components/session/use-device"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { useEventSource } from "@/hooks/use-event-source"
import { useNow } from "@/hooks/use-now"
import { setDevToolsPrefs, useDevToolsPrefs } from "@/lib/devtools-prefs"
import { formatBytes, wallClock } from "@/lib/format"
import type { SocketFrame } from "@/lib/recording/devtools"
import { splitURL } from "@/lib/recording/devtools"
import { viewHash } from "@/lib/recording/link"
import { clock } from "@/lib/recording/timeline"
import { cn } from "@/lib/utils"

const maxFrames = 5000
const shortFrame = 15

type LiveFrame = SocketFrame & { wall: number; rec?: string; at?: number }
type LiveSocket = { key: string; target: string; state: DevToolsSocket; frames: LiveFrame[] }

/**
 * The WebViews' WebSockets and event streams as they happen, in DevTools'
 * look. While the session records, a frame's time puts a marker on the
 * recording at that moment.
 */
export function SocketsPanel({ provider, id }: { provider: string; id: string }) {
  const [sockets, setSockets] = useState<Map<string, LiveSocket>>(() => new Map())
  const [paused, setPaused] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [frameKey, setFrameKey] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const { hideShortFrames } = useDevToolsPrefs()
  const counter = useRef(0)
  const lastSeq = useRef(0)
  const device = useDevice(provider, id)
  const now = useNow(1000)

  useEventSource<{ line: DevToolsEntry }>(paused ? null : `${sessionBase(provider, id)}/v1/devtools/live`, {
    line: (e) => {
      if (e.seq) {
        if (e.seq <= lastSeq.current) return
        lastSeq.current = e.seq
      }
      setSockets((prev) => {
        const target = e.target ?? ""
        const sid = e.socket?.id ?? e.frame?.socket
        if (!sid) return prev
        const key = `${target}/${sid}`
        const next = new Map(prev)
        const s = next.get(key) ?? {
          key,
          target,
          state: e.socket ?? { id: sid, url: "", state: "open" },
          frames: [],
        }
        if (e.socket) next.set(key, { ...s, state: { ...e.socket, url: e.socket.url || s.state.url } })
        else if (e.frame) {
          const f: LiveFrame = {
            ...e.frame,
            key: `l${++counter.current}`,
            t: e.wall ?? Date.now(),
            wall: e.wall ?? Date.now(),
            rec: e.recording,
            at: e.recording ? e.t : undefined,
          }
          next.set(key, { ...s, frames: [...s.frames.slice(-(maxFrames - 1)), f] })
        }
        return next
      })
    },
  })

  const list = [...sockets.values()]
  const socket = list.find((s) => s.key === picked) ?? list.at(-1)
  const needle = query.trim().toLowerCase()
  const frames = (socket?.frames ?? [])
    .filter((f) => !hideShortFrames || f.size >= shortFrame)
    .filter((f) => !needle || (f.data ?? "").toLowerCase().includes(needle))
    .slice(-500)
  const frame = socket?.frames.find((f) => f.key === frameKey)
  const offset = device.data?.timeOffset ?? 0
  const clocks = useMemo<Clocks>(
    () => ({ startedAt: 0, offsetAt: () => offset, zoneAt: () => device.data?.timeZone, label: wallClock }),
    [offset, device.data?.timeZone],
  )

  const listRef = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && follow.current) el.scrollTop = el.scrollHeight
  })

  return (
    <div className="devtools-skin flex h-full flex-col bg-background text-[12px]">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b px-2">
        <ToolbarButton label={paused ? "Resume" : "Pause"} onClick={() => setPaused((v) => !v)}>
          {paused ? <PlayIcon /> : <PauseIcon />}
        </ToolbarButton>
        <ToolbarButton
          label="Clear"
          onClick={() => {
            setSockets(new Map())
            setFrameKey(null)
          }}
        >
          <Trash2Icon />
        </ToolbarButton>
        <span className="mx-1 h-4 w-px bg-border" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter"
          className="h-6 w-48 rounded-sm border bg-transparent px-2 outline-none focus:border-ring"
        />
        <label className="ml-2 flex items-center gap-1.5 text-muted-foreground select-none">
          <input
            type="checkbox"
            checked={hideShortFrames}
            onChange={(e) => setDevToolsPrefs({ hideShortFrames: e.target.checked })}
            className="size-3.5"
          />
          Hide under {shortFrame} B
        </label>
        <span className="ml-auto text-muted-foreground">
          {list.length} sockets · {socket ? `${socket.frames.length} frames` : "no frames"}
        </span>
      </div>
      {list.length === 0 ? (
        <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">
          {paused
            ? "Paused."
            : "No WebSocket or event stream in the app's WebViews yet. Everything they send during the session shows up here, also after a reload."}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="w-60 shrink-0 overflow-auto border-r">
            {list.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  setPicked(s.key)
                  setFrameKey(null)
                }}
                className={cn(
                  "flex w-full items-center gap-2 border-b px-2 py-1 text-left hover:bg-accent",
                  s.key === socket?.key && "bg-accent",
                )}
              >
                <RadioIcon
                  className={cn(
                    "size-3.5 shrink-0",
                    s.state.state === "closed" ? "text-muted-foreground" : "text-emerald-600",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono" title={s.state.url}>
                    {s.state.url
                      ? splitURL(s.state.url).host + splitURL(s.state.url).path
                      : "opened before Holtdroid attached"}
                  </span>
                  <span className="text-muted-foreground">
                    {s.state.state === "stream" ? "media stream, not shown" : s.state.state} · {s.frames.length}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="grid shrink-0 grid-cols-[1.5rem_minmax(0,1fr)_4.5rem_6.5rem] border-b bg-muted/50 px-2 py-1 text-muted-foreground">
              <span />
              <span>Data</span>
              <span className="text-right">Length</span>
              <span className="text-right">Time</span>
            </div>
            <ClocksContext value={clocks}>
              <PlayheadContext value={now}>
                <div
                  ref={listRef}
                  onScroll={(e) => {
                    const el = e.currentTarget
                    follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
                  }}
                  className={cn("min-h-0 overflow-auto font-mono", frame ? "flex-[1_1_45%]" : "flex-1")}
                >
                  {frames.map((f) => (
                    <div
                      key={f.key}
                      role="button"
                      tabIndex={0}
                      onClick={() => setFrameKey(f.key === frameKey ? null : f.key)}
                      onKeyDown={(e) => e.key === "Enter" && setFrameKey(f.key)}
                      className={cn(
                        "grid cursor-pointer grid-cols-[1.5rem_minmax(0,1fr)_4.5rem_6.5rem] items-center border-b border-border/50 px-2 py-[2px] hover:bg-accent/60",
                        f.sent ? "bg-emerald-500/5" : "",
                        f.key === frameKey && "bg-accent",
                      )}
                    >
                      {f.sent ? (
                        <ArrowUpIcon className="size-3.5 text-emerald-600" aria-label="Sent" />
                      ) : (
                        <ArrowDownIcon className="size-3.5 text-red-500" aria-label="Received" />
                      )}
                      <FrameSummary f={f} />
                      <span className="text-right text-muted-foreground tabular-nums">{formatBytes(f.size)}</span>
                      <FrameTime provider={provider} id={id} frame={f} socket={socket!} />
                    </div>
                  ))}
                </div>
                {frame && (
                  <div className="flex min-h-0 flex-[1_1_55%] flex-col border-t">
                    <div className="flex h-7 shrink-0 items-center gap-2 border-b bg-muted/50 px-2">
                      {frame.sent ? (
                        <ArrowUpIcon className="size-3.5 text-emerald-600" />
                      ) : (
                        <ArrowDownIcon className="size-3.5 text-red-500" />
                      )}
                      <span className="font-medium">{frame.sent ? "Sent" : "Received"}</span>
                      <span className="text-muted-foreground">{wallClock(frame.wall)}</span>
                      <button
                        type="button"
                        aria-label="Close"
                        onClick={() => setFrameKey(null)}
                        className="ml-auto grid size-6 place-items-center rounded-sm hover:bg-accent"
                      >
                        <XIcon className="size-3.5" />
                      </button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto p-2">
                      <AtMoment t={frame.wall}>
                        {frame.data ? (
                          <BodyView
                            body={frame.data}
                            base64={frame.opcode === 2}
                            truncated={frame.truncated}
                            size={frame.size}
                          />
                        ) : (
                          <p className="text-muted-foreground">The payload looked like media and isn't kept.</p>
                        )}
                      </AtMoment>
                    </div>
                  </div>
                )}
              </PlayheadContext>
            </ClocksContext>
          </div>
        </div>
      )}
    </div>
  )
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
    >
      {children}
    </button>
  )
}

const icons = Object.keys(markerIcons) as MarkerIcon[]

/** A frame's time: a click marks that moment on the recording, hovering offers an icon or the recording itself. */
function FrameTime({
  provider,
  id,
  frame,
  socket,
}: {
  provider: string
  id: string
  frame: LiveFrame
  socket: LiveSocket
}) {
  const add = useAddSessionMarker()
  const recorded = frame.rec !== undefined && frame.at !== undefined
  const mark = (icon: MarkerIcon) => {
    if (!recorded) return
    add.mutate(
      {
        provider,
        id,
        icon,
        t: frame.at,
        recording: frame.rec,
        label: `${frame.sent ? "Sent" : "Received"} on ${splitURL(socket.state.url).host || "a socket"}`,
      },
      {
        onSuccess: () => toast.success(`Marker at ${clock(frame.at!)} of the recording`),
        onError: (e) => toast.error("Could not add the marker", { description: e.message }),
      },
    )
  }
  const link = recorded
    ? `/recordings/${frame.rec}${viewHash({ t: Math.max(0, frame.at! - 500), tab: "sockets", socket: socket.key })}`
    : undefined
  return (
    <HoverCard openDelay={250} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            mark("pin")
          }}
          className={cn(
            "text-right text-muted-foreground tabular-nums",
            recorded && "hover:text-foreground hover:underline",
          )}
        >
          {wallClock(frame.wall)}
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        align="end"
        side="left"
        sideOffset={8}
        className="w-72 rounded-[24px] border-0 bg-stage-surface-container p-4 text-stage-on-surface shadow-2xl ring-1 ring-black/10 dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {recorded ? (
          <div className="grid gap-3">
            <div>
              <p className="text-xs font-medium tracking-wide text-stage-outline uppercase">Mark this moment</p>
              <p className="mt-0.5 text-base font-medium">
                {clock(frame.at!, true)}{" "}
                <span className="text-sm font-normal text-stage-outline">of the recording</span>
              </p>
            </div>
            <div className="grid grid-cols-6 gap-1">
              {icons.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  title={markerIcons[icon].name}
                  aria-label={`Add a ${markerIcons[icon].name} marker`}
                  disabled={add.isPending}
                  onClick={() => mark(icon)}
                  className="grid justify-items-center gap-1 rounded-2xl py-1.5 text-[10.5px] text-stage-on-surface-variant transition-colors hover:bg-stage-surface-high disabled:opacity-50"
                >
                  <MarkerBadge icon={icon} className="size-8 [&_svg]:size-4" />
                  {markerIcons[icon].name}
                </button>
              ))}
            </div>
            <p className="text-xs text-stage-outline">A click on the frame's time pins it right away.</p>
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-stage-secondary-container px-4 text-sm font-medium text-stage-on-secondary-container transition-colors hover:bg-stage-secondary-container-hover"
            >
              <ExternalLinkIcon className="size-4" />
              Open the recording from here
            </a>
          </div>
        ) : (
          <p className="text-sm text-stage-on-surface-variant">This frame came while nothing was being recorded.</p>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}
