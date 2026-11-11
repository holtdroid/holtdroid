import {
  FlagIcon,
  LockIcon,
  MoonIcon,
  PackageIcon,
  RotateCwIcon,
  SignalIcon,
  SmartphoneIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"
import { type KeyboardEvent, memo, type PointerEvent, type ReactNode, useMemo, useState } from "react"
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

const screenTones: Record<ScreenKind, string> = {
  portrait: "bg-accent text-muted-foreground",
  landscape: "bg-info-soft text-info",
  off: "bg-screen-off text-screen-off-foreground",
  locked: "bg-violet-soft text-violet",
  novideo: "bg-[repeating-linear-gradient(135deg,var(--border)_0_4px,transparent_4px_8px)] text-muted-foreground",
}

export const screenIcons: Partial<Record<ScreenKind, LucideIcon>> = {
  portrait: SmartphoneIcon,
  landscape: RotateCwIcon,
  off: MoonIcon,
  locked: LockIcon,
}

const appTones: Record<AppKind, string> = {
  running: "bg-success-soft text-success",
  closed: "bg-accent text-muted-foreground",
  starting: "bg-info-soft text-info",
}

const networkTones: Record<NetworkKind, string> = {
  normal: "bg-accent text-muted-foreground",
  throttled: "bg-warning-soft text-warning",
  offline: "bg-danger-soft text-danger",
}

const rowHeights = "grid-rows-[50px_22px_22px_22px_22px_16px_auto]"

function niceStep(duration: number) {
  const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200].map((s) => s * 1000)
  return steps.find((s) => duration / s <= 7) ?? steps.at(-1)!
}

function LaneLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  )
}

function Lane<K extends string>({
  spans,
  tones,
  icons,
  pct,
  children,
}: {
  spans: Span<K>[]
  tones: Record<K, string>
  icons?: Partial<Record<K, LucideIcon>>
  pct: (t: number) => string
  children?: ReactNode
}) {
  return (
    <div className="relative h-[22px] overflow-hidden rounded-md bg-muted">
      {spans.map((s) => {
        const Icon: LucideIcon | undefined = icons?.[s.kind]
        return (
          <span
            key={`${s.start}-${s.kind}`}
            className={cn(
              "absolute inset-y-0 flex items-center gap-1 overflow-hidden px-1.5 text-[11px] font-medium whitespace-nowrap",
              tones[s.kind],
            )}
            style={{ left: pct(s.start), width: `max(2px, ${pct(s.end - s.start)})` }}
          >
            {Icon && <Icon className="size-3 shrink-0" />}
            {s.label}
          </span>
        )
      })}
      {children}
    </div>
  )
}

function percent(duration: number) {
  return (t: number) => `${duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0}%`
}

const LaneRows = memo(function LaneRows({ duration, lanes }: { duration: number; lanes: Lanes }) {
  const pct = percent(duration)
  const taps = thin(lanes.taps, duration)
  const marks = thin(lanes.issues, duration, 400)
  const crashes = thin(lanes.crashes, duration, 400)
  const dns = thin(lanes.dns, duration, 400)
  return (
    <>
      <LaneLabel icon={SmartphoneIcon}>Screen</LaneLabel>
      <Lane spans={lanes.screen} tones={screenTones} icons={screenIcons} pct={pct} />

      <LaneLabel icon={PackageIcon}>App</LaneLabel>
      <Lane spans={lanes.app} tones={appTones} pct={pct}>
        {crashes.map((c) => (
          <span
            key={`crash-${c.t}`}
            className={cn("absolute inset-y-0 w-[3px] -translate-x-1/2", c.kind === "anr" ? "bg-warning" : "bg-danger")}
            style={{ left: pct(c.t) }}
          />
        ))}
      </Lane>

      <LaneLabel icon={SignalIcon}>Network</LaneLabel>
      <Lane spans={lanes.network} tones={networkTones} pct={pct}>
        {dns.map((d) => (
          <span
            key={`dns-${d.t}`}
            className="absolute inset-y-[3px] w-[3px] -translate-x-1/2 rounded-sm bg-violet"
            style={{ left: pct(d.t) }}
          />
        ))}
      </Lane>

      <LaneLabel icon={TriangleAlertIcon}>Events</LaneLabel>
      <div className="relative h-[22px] rounded-md border border-border-subtle">
        {taps.map((t) => (
          <span
            key={`tap-${t.t}`}
            className="absolute inset-y-1.5 w-0.5 rounded-[1px] bg-muted-foreground/50"
            style={{ left: pct(t.t) }}
          />
        ))}
        {marks.map((m) => (
          <span
            key={m.id}
            className={cn("absolute inset-y-0.5 w-0.5 rounded-[1px]", m.level === "error" ? "bg-danger" : "bg-warning")}
            style={{ left: pct(m.t) }}
          />
        ))}
      </div>
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

/** The recording at a glance: markers, then lanes for the screen, the app, the network and what happened. */
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
  const pct = percent(duration)
  const points = useMemo(() => [...lanes.issues, ...lanes.crashes, ...lanes.dns], [lanes])
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
    onSeek(Math.min(duration, Math.max(0, t)))
  }
  const screen = hover === null ? undefined : spanAt(lanes.screen, hover)
  const hovered =
    hover === null
      ? []
      : [
          screen?.label || (screen ? "No video" : ""),
          spanAt(lanes.app, hover)?.label,
          spanAt(lanes.network, hover)?.label,
          points.find((x) => Math.abs(x.t - hover) < duration * 0.006)?.title,
        ].filter(Boolean)

  return (
    <div className={cn("grid grid-cols-[92px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5", rowHeights)}>
      <span className="flex items-end pb-1">
        <LaneLabel icon={FlagIcon}>Markers</LaneLabel>
      </span>
      <div className="relative z-20 col-start-2 row-start-1">
        {markers.map((m) => (
          <MarkerPin
            key={m.id}
            marker={m}
            left={pct(m.t)}
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

      <LaneRows duration={duration} lanes={lanes} />

      <span />
      <div className="relative">
        <div className="absolute inset-x-0 top-1.5 h-1 rounded-full bg-border" />
        <div className="absolute top-1.5 left-0 h-1 rounded-full bg-foreground" style={{ width: pct(time) }} />
      </div>

      <span />
      <TimeTicks duration={duration} />

      <div
        role="slider"
        tabIndex={0}
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={time}
        aria-valuetext={clock(time)}
        className="relative z-10 col-start-2 row-span-6 row-start-2 cursor-pointer touch-none rounded-md outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          onSeek(at(e))
        }}
        onPointerMove={(e) => {
          setHover(at(e))
          if (e.buttons === 1) onSeek(at(e))
        }}
        onPointerLeave={() => setHover(null)}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -top-[62px] bottom-5 w-0.5 -translate-x-1/2 rounded-[1px] bg-foreground"
          style={{ left: pct(time) }}
        />
        {hover !== null && (
          <span
            className="pointer-events-none absolute bottom-full mb-[60px] -translate-x-1/2 rounded-lg border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-float"
            style={{ left: pct(hover) }}
          >
            <span className="font-mono">{clock(hover)}</span>
            {hovered.length > 0 && <span className="text-muted-foreground"> · {hovered.join(" · ")}</span>}
          </span>
        )}
      </div>
    </div>
  )
}
