import {
  BugIcon,
  GlobeIcon,
  HourglassIcon,
  LoaderIcon,
  LockIcon,
  MoonIcon,
  PackageIcon,
  PackageXIcon,
  RotateCwIcon,
  SmartphoneIcon,
  VideoOffIcon,
  WifiIcon,
  WifiLowIcon,
  WifiOffIcon,
  type LucideIcon,
} from "lucide-react"
import { type FocusEvent, type KeyboardEvent, memo, type PointerEvent, useMemo, useState } from "react"
import type { RecordingMarker } from "@/api/client"
import { MarkerPin } from "@/components/recording/markers"
import {
  type AppKind,
  type Crash,
  type Issue,
  type NetworkKind,
  type ScreenKind,
  type Span,
  spanAt,
  thin,
  type Tick,
} from "@/lib/recording/lanes"
import { clock } from "@/lib/recording/timeline"
import { cn } from "@/lib/utils"

export type Lanes = {
  screen: Span<ScreenKind>[]
  app: Span<AppKind>[]
  crashes: Crash[]
  network: Span<NetworkKind>[]
  dns: Tick[]
  taps: { t: number }[]
  issues: Issue[]
}

export const screenIcons: Partial<Record<ScreenKind, LucideIcon>> = {
  portrait: SmartphoneIcon,
  landscape: RotateCwIcon,
  off: MoonIcon,
  locked: LockIcon,
}

const screenTones: Record<ScreenKind, string> = {
  portrait: "text-muted-foreground",
  landscape: "text-info",
  off: "text-foreground",
  locked: "text-violet",
  novideo: "text-muted-foreground",
}

const appIcons: Record<AppKind, LucideIcon> = { running: PackageIcon, closed: PackageXIcon, starting: LoaderIcon }
const appTones: Record<AppKind, string> = {
  running: "text-success",
  closed: "text-muted-foreground",
  starting: "text-info",
}

const networkIcons: Record<NetworkKind, LucideIcon> = { normal: WifiIcon, throttled: WifiLowIcon, offline: WifiOffIcon }
const networkTones: Record<NetworkKind, string> = {
  normal: "text-muted-foreground",
  throttled: "text-warning",
  offline: "text-danger",
}

type Change = { t: number; icon: LucideIcon; tone: string; title: string }

/** Pins past this share of the timeline open to the left, so their label stays inside it. */
export function pinFlips(t: number, duration: number) {
  return duration > 0 && t / duration > 0.7
}

function changesOf(lanes: Lanes): Change[] {
  const out: Change[] = lanes.crashes.map((c) => ({
    t: c.t,
    icon: c.kind === "anr" ? HourglassIcon : BugIcon,
    tone: c.kind === "anr" ? "text-warning" : "text-danger",
    title: c.title,
  }))
  const add = <K extends string>(
    what: string,
    spans: Span<K>[],
    icon: (k: K) => LucideIcon,
    tone: Record<K, string>,
    fallback: string,
  ) => {
    spans.forEach((s, i) => {
      if (i > 0)
        out.push({ t: s.start, icon: icon(s.kind), tone: tone[s.kind], title: `${what}: ${s.label || fallback}` })
    })
  }
  add("Screen", lanes.screen, (k) => screenIcons[k] ?? VideoOffIcon, screenTones, "No video")
  add("App", lanes.app, (k) => appIcons[k], appTones, "")
  add("Network", lanes.network, (k) => networkIcons[k], networkTones, "")
  out.push(...lanes.dns.map((d) => ({ t: d.t, icon: GlobeIcon, tone: "text-violet", title: d.title })))
  return out
}

function niceStep(duration: number) {
  const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200].map((s) => s * 1000)
  return steps.find((s) => duration / s <= 7) ?? steps.at(-1)!
}

function percent(duration: number) {
  return (t: number) => `${duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0}%`
}

const Marks = memo(function Marks({ duration, lanes }: { duration: number; lanes: Lanes }) {
  const pct = percent(duration)
  const changes = thin(changesOf(lanes), duration, 160).toReversed()
  const taps = thin(lanes.taps, duration)
  const issues = thin(lanes.issues, duration, 400)
  return (
    <>
      {taps.map((t) => (
        <span
          key={`tap-${t.t}`}
          className="absolute bottom-1.5 h-1.5 w-0.5 rounded-[1px] bg-muted-foreground/50"
          style={{ left: pct(t.t) }}
        />
      ))}
      {issues.map((m) => (
        <span
          key={m.id}
          className={cn(
            "absolute bottom-1 h-2.5 w-0.5 rounded-[1px]",
            m.level === "error" ? "bg-danger" : "bg-warning",
          )}
          style={{ left: pct(m.t) }}
        />
      ))}
      {changes.map((c) => (
        <span
          key={`${c.t}-${c.title}`}
          className={cn("absolute inset-y-0 flex -translate-x-1/2 flex-col items-center", c.tone)}
          style={{ left: pct(c.t) }}
        >
          <span className="mt-1 grid size-4 shrink-0 place-items-center rounded-full border border-current bg-card [&_svg]:size-2.5">
            <c.icon />
          </span>
          <span className="w-px flex-1 bg-current opacity-50" />
        </span>
      ))}
    </>
  )
})

const TimeTicks = memo(function TimeTicks({ duration }: { duration: number }) {
  const pct = percent(duration)
  const step = niceStep(duration)
  const ticks: number[] = []
  for (let t = 0; t < duration - step * 0.4; t += step) ticks.push(t)
  return (
    <div className="relative h-4 font-mono text-[11px] text-muted-foreground">
      {ticks.map((t, i) => (
        <span key={t} className={cn("absolute", i > 0 && "-translate-x-1/2")} style={{ left: pct(t) }}>
          {clock(t)}
        </span>
      ))}
      <span className="absolute right-0">{clock(duration)}</span>
    </div>
  )
})

function statesAt(lanes: Lanes, t: number) {
  const screen = spanAt(lanes.screen, t)
  return [screen?.label || (screen ? "No video" : ""), spanAt(lanes.app, t)?.label, spanAt(lanes.network, t)?.label]
    .filter(Boolean)
    .join(" · ")
}

/** The recording at a glance on one track: markers above it, what changed and what happened on it, by time. */
export function Timeline({
  duration,
  time,
  lanes,
  markers,
  editable,
  editing,
  onEditing,
  onMarkers,
  onSeek,
}: {
  duration: number
  time: number
  lanes: Lanes
  markers: RecordingMarker[]
  editable: boolean
  editing: string | null
  onEditing: (id: string | null) => void
  onMarkers: (items: RecordingMarker[]) => void
  onSeek: (t: number) => void
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [keyboard, setKeyboard] = useState(false)
  const pct = percent(duration)
  const points = useMemo(
    () => [...lanes.issues, ...changesOf(lanes), ...markers.map((m) => ({ t: m.t, title: m.label || "Marker" }))],
    [lanes, markers],
  )
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * duration
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const big = Math.max(30_000, duration / 10)
    const next: Record<string, number> = {
      ArrowLeft: time - 5000,
      ArrowDown: time - 5000,
      ArrowRight: time + 5000,
      ArrowUp: time + 5000,
      PageDown: time - big,
      PageUp: time + big,
      Home: 0,
      End: duration,
    }
    const t = next[e.key]
    if (t === undefined) return
    e.preventDefault()
    e.stopPropagation()
    setKeyboard(true)
    onSeek(Math.min(duration, Math.max(0, t)))
  }
  const onFocus = (e: FocusEvent<HTMLDivElement>) => setKeyboard(e.currentTarget.matches(":focus-visible"))
  const shown = hover ?? (keyboard ? time : null)
  const near =
    shown === null
      ? undefined
      : points
          .filter((x) => Math.abs(x.t - shown) < duration * 0.006)
          .toSorted((a, b) => Math.abs(a.t - shown) - Math.abs(b.t - shown))[0]?.title
  const states = shown === null ? "" : statesAt(lanes, shown)
  const share = shown === null || duration <= 0 ? 0 : shown / duration

  return (
    <div className="relative pt-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-6">
        {markers.map((m) => (
          <MarkerPin
            key={m.id}
            marker={m}
            left={(m.t / Math.max(1, duration)) * 100}
            flip={pinFlips(m.t, duration)}
            open={editing === m.id}
            editable={editable}
            onOpen={(open) => {
              if (open) onSeek(m.t)
              onEditing(open ? m.id : null)
            }}
            onChange={(next) => onMarkers(markers.map((x) => (x.id === m.id ? next : x)))}
            onRemove={() => {
              onEditing(null)
              onMarkers(markers.filter((x) => x.id !== m.id))
            }}
          />
        ))}
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={time}
        aria-valuetext={[clock(time), statesAt(lanes, time)].filter(Boolean).join(" · ")}
        className="grid cursor-pointer touch-none gap-1 rounded-md outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onKeyDown={onKey}
        onFocus={onFocus}
        onBlur={() => setKeyboard(false)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setKeyboard(false)
          onSeek(at(e))
        }}
        onPointerMove={(e) => {
          setHover(at(e))
          if (e.buttons === 1) onSeek(at(e))
        }}
        onPointerLeave={() => setHover(null)}
      >
        <div className="relative h-9">
          <div className="absolute inset-0 overflow-hidden rounded-md bg-muted">
            <div className="absolute inset-y-0 left-0 bg-foreground/[0.06]" style={{ width: pct(time) }} />
            <div className="absolute bottom-0 left-0 h-0.5 bg-foreground" style={{ width: pct(time) }} />
          </div>
          <Marks duration={duration} lanes={lanes} />
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-[1px] bg-foreground"
            style={{ left: pct(time) }}
          />
          {shown !== null && (
            <span
              className={cn(
                "pointer-events-none absolute bottom-full z-30 mb-1.5 max-w-[min(32rem,100%)] truncate rounded-lg border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-float",
                share < 0.2 ? "translate-x-0" : share > 0.8 ? "-translate-x-full" : "-translate-x-1/2",
              )}
              style={{ left: pct(shown) }}
            >
              <span className="font-mono">{clock(shown)}</span>
              {near && <span className="font-medium"> · {near}</span>}
              {states && <span className="text-muted-foreground"> · {states}</span>}
            </span>
          )}
        </div>
        <TimeTicks duration={duration} />
      </div>
    </div>
  )
}
