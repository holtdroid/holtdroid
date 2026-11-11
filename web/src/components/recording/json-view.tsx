import { ChevronRightIcon, ClockIcon, CopyIcon, HistoryIcon, type LucideIcon } from "lucide-react"
import { createContext, type ReactNode, useContext, useMemo, useState } from "react"
import { toast } from "sonner"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { formatBytes } from "@/lib/format"
import { decodeBase64, hexDump, type Packet, type ParsedBody, parseBody, parseJSON, textOf } from "@/lib/recording/body"
import { detectStamp, formatSpan, relative, type Stamp, stampFormats, unitNames } from "@/lib/recording/timestamps"
import { clock } from "@/lib/recording/timeline"
import { cn } from "@/lib/utils"

/** The clocks of the recording: real time is startedAt + t, the device's is that plus its offset then. */
export type Clocks = {
  startedAt: number
  offsetAt: (t: number) => number
  zoneAt: (t: number) => string | undefined
  /** how a time on this clock is shown; the recording's clock by default */
  label?: (t: number) => string
  /** the recording's length and a way to go to a moment in it, when there is a player */
  duration?: number
  seek?: (t: number) => void
}

export const ClocksContext = createContext<Clocks>({ startedAt: 0, offsetAt: () => 0, zoneAt: () => undefined })

/** The player's position, in recording time. */
export const PlayheadContext = createContext(0)

type Moment = { t: number; real: number; device: number; zone?: string }

const MomentContext = createContext<Moment | null>(null)

/** Values inside are compared with the clocks at recording time t. */
export function AtMoment({ t, children }: { t: number; children: ReactNode }) {
  const clocks = useContext(ClocksContext)
  const real = clocks.startedAt + t
  const device = real + clocks.offsetAt(t)
  const zone = clocks.zoneAt(t)
  const moment = useMemo(() => ({ t, real, device, zone }), [t, real, device, zone])
  return <MomentContext value={moment}>{children}</MomentContext>
}

export function copy(text: string, what = "Copied") {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(what),
    () => toast.error("Could not copy"),
  )
}

export function useStamp(value: unknown, key?: string): Stamp | null {
  const m = useContext(MomentContext)
  return m ? detectStamp(value, key, m.device) : null
}

/** A value that is a point in time: dotted, with how far it is from the device clock then and every format on hover. */
function Chip({ d, icon: Icon, title }: { d: number; icon: LucideIcon; title: string }) {
  return (
    <span
      title={title}
      className={cn(
        "ml-1 inline-flex translate-y-[-1px] items-center gap-0.5 rounded-full px-1.5 align-middle font-sans text-[10.5px] leading-4 font-medium whitespace-nowrap no-underline first-of-type:ml-1.5",
        Math.abs(d) < 5000
          ? "bg-success-soft text-success"
          : d > 0
            ? "bg-accent text-accent-foreground"
            : "bg-accent text-muted-foreground",
      )}
    >
      <Icon className="size-2.5" />
      {relative(d, 0)}
    </span>
  )
}

function versus(d: number, clock: string) {
  return Math.abs(d) < 1000 ? `same as ${clock}` : `${formatSpan(d)} ${d < 0 ? "before" : "after"} ${clock}`
}

/**
 * A value that is a point in time: dotted, with a chip saying how far it is
 * from the device clock at the player's position, and on hover from the
 * moment it was recorded too, with every format.
 */
export function TimeHint({ stamp, children }: { stamp: Stamp; children: ReactNode }) {
  const m = useContext(MomentContext)!
  const clocks = useContext(ClocksContext)
  const now = useContext(PlayheadContext)
  const playhead = clocks.startedAt + now + clocks.offsetAt(now)
  const d = stamp.ms - playhead
  const atEvent = stamp.ms - m.device
  const offset = m.device - m.real
  const at = Math.round(stamp.ms - clocks.offsetAt(now) - clocks.startedAt)
  const inRecording =
    !!clocks.seek && clocks.duration !== undefined && at >= 0 && at <= clocks.duration && Math.abs(at - now) >= 1000
  return (
    <HoverCard openDelay={120} closeDelay={60}>
      <HoverCardTrigger asChild>
        <span className="cursor-help underline decoration-muted-foreground decoration-dotted underline-offset-[3px]">
          {children}
          <Chip
            d={atEvent}
            icon={HistoryIcon}
            title={`Against the device clock when it was seen (${(clocks.label ?? clock)(m.t)})`}
          />
          <Chip d={d} icon={ClockIcon} title={`Against the device clock now (${(clocks.label ?? clock)(now)})`} />
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        className="w-[24rem] rounded-[20px] border-0 bg-muted p-4 font-sans text-foreground shadow-2xl ring-1 ring-black/10 dark:ring-white/10"
      >
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{unitNames[stamp.unit]}</p>
        {inRecording && (
          <button
            type="button"
            onClick={() => clocks.seek?.(at)}
            className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-3 text-sm font-medium text-accent-foreground hover:bg-border"
          >
            <ClockIcon className="size-3.5" />
            Go to {clock(at)} in the recording
            <span className="font-normal opacity-70">
              ({at < now ? `${formatSpan(now - at)} back` : `${formatSpan(at - now)} ahead`})
            </span>
          </button>
        )}
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
          <dt className="text-xs text-muted-foreground">Now, {(clocks.label ?? clock)(now)}</dt>
          <dd className="text-base font-medium">{versus(d, "the device clock")}</dd>
          <dt className="text-xs text-muted-foreground">When seen, {(clocks.label ?? clock)(m.t)}</dt>
          <dd className="text-sm">{versus(atEvent, "the device clock")}</dd>
          {Math.abs(offset) >= 1500 && (
            <>
              <dt className="text-xs text-muted-foreground">Real time then</dt>
              <dd className="text-sm">
                {versus(stamp.ms - m.real, "real time")}{" "}
                <span className="text-xs text-muted-foreground">
                  (device {formatSpan(offset)} {offset > 0 ? "ahead" : "behind"})
                </span>
              </dd>
            </>
          )}
        </dl>
        {stamp.zoneless && (
          <p className="mt-2 rounded-xl bg-warning-soft px-3 py-1.5 text-xs text-foreground">
            No time zone in the value: read as UTC.
          </p>
        )}
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          {stampFormats(stamp.ms, m.zone).map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd>
                <button
                  type="button"
                  className="max-w-full truncate text-left font-mono text-[12.5px] hover:text-foreground"
                  title="Copy"
                  onClick={() => copy(f.value)}
                >
                  {f.value}
                </button>
              </dd>
            </div>
          ))}
        </dl>
      </HoverCardContent>
    </HoverCard>
  )
}

function Primitive({ value, name }: { value: unknown; name?: string }) {
  const stamp = useStamp(value, name)
  const [all, setAll] = useState(false)
  let body: ReactNode
  if (typeof value === "string") {
    const long = value.length > 600 && !all
    body = (
      <span className="break-all whitespace-pre-wrap text-[var(--json-string)]">
        "{long ? value.slice(0, 600) : value}"
        {long && (
          <button type="button" className="ml-1 font-sans text-xs text-info" onClick={() => setAll(true)}>
            … {formatBytes(value.length - 600)} more
          </button>
        )}
      </span>
    )
  } else if (typeof value === "number") {
    body = <span className="text-[var(--json-number)]">{String(value)}</span>
  } else {
    body = <span className="text-[var(--json-keyword)]">{String(value)}</span>
  }
  return stamp ? <TimeHint stamp={stamp}>{body}</TimeHint> : body
}

const pageSize = 100

function Node({ name, value, depth, open: initial }: { name?: string; value: unknown; depth: number; open: number }) {
  const nested = typeof value === "string" && value.length > 1 ? parseJSON(value) : ({ ok: false } as const)
  const inner = nested.ok && typeof nested.value === "object" && nested.value !== null ? nested.value : null
  const isObject = typeof value === "object" && value !== null
  const [open, setOpen] = useState(depth < initial)
  const [shown, setShown] = useState(pageSize)
  const key =
    name === undefined ? null : (
      <>
        <span className="text-info">{/^\d+$/.test(name) ? name : `"${name}"`}</span>
        <span className="text-muted-foreground">: </span>
      </>
    )

  if (!isObject && !inner) {
    return (
      <div className="pl-[18px]">
        {key}
        <Primitive value={value} name={name} />
      </div>
    )
  }
  const target = (inner ?? value) as Record<string, unknown> | unknown[]
  const array = Array.isArray(target)
  const entries = array ? target.map((v, i) => [String(i), v] as const) : Object.entries(target)
  const [l, r] = array ? ["[", "]"] : ["{", "}"]
  const summary = array ? `${entries.length} items` : `${entries.length} keys`
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-start text-left hover:bg-muted/60"
      >
        <ChevronRightIcon
          className={cn("mt-[3px] size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        <span className="ml-1 min-w-0">
          {key}
          {inner && (
            <span className="mr-1 rounded bg-accent px-1 font-sans text-[10px] text-muted-foreground">JSON string</span>
          )}
          <span className="text-muted-foreground">{l}</span>
          {!open && (
            <>
              <span className="mx-1 font-sans text-xs text-muted-foreground">{summary}</span>
              <span className="text-muted-foreground">{r}</span>
            </>
          )}
        </span>
      </button>
      {open && (
        <>
          <div className="ml-[7px] border-l border-border/60 pl-2">
            {entries.slice(0, shown).map(([k, v]) => (
              <Node key={k} name={k} value={v} depth={depth + 1} open={initial} />
            ))}
            {entries.length > shown && (
              <button
                type="button"
                className="pl-[18px] font-sans text-xs text-info"
                onClick={() => setShown((n) => n + pageSize * 5)}
              >
                Show {Math.min(pageSize * 5, entries.length - shown)} more of {entries.length - shown}
              </button>
            )}
          </div>
          <div className="pl-[18px] text-muted-foreground">{r}</div>
        </>
      )}
    </div>
  )
}

/** A JSON value as a tree that opens to `open` levels; times in it get hints. */
export function JsonView({ value, open = 2, className }: { value: unknown; open?: number; className?: string }) {
  return (
    <div
      className={cn(
        "font-mono text-[12.5px] leading-[1.55] [--json-keyword:var(--warning)] [--json-number:var(--info)] [--json-string:var(--success)]",
        className,
      )}
    >
      <Node value={value} depth={0} open={open} />
    </div>
  )
}

/** A short value on one line, with a hint when it is a time. */
export function InlineValue({ value, name }: { value: string; name?: string }) {
  const stamp = useStamp(value, name)
  return stamp ? <TimeHint stamp={stamp}>{value}</TimeHint> : <>{value}</>
}

export function Pairs({ pairs, empty = "None" }: { pairs: [string, string][]; empty?: string }) {
  if (pairs.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <dl className="grid grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)] gap-x-4 gap-y-0.5 font-mono text-[12.5px] leading-[1.55]">
      {pairs.map(([k, v], i) => (
        <div key={`${k}${i}`} className="contents">
          <dt className="truncate text-info" title={k}>
            {k}
          </dt>
          <dd className="break-all text-foreground">
            <InlineValue value={v} name={k} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex rounded-full bg-muted p-0.5 text-xs" role="group" aria-label="View">
      {[
        [true, "Pretty"],
        [false, "Raw"],
      ].map(([v, label]) => (
        <button
          key={String(label)}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v as boolean)}
          className={cn(
            "h-6 rounded-full px-2.5 transition-colors",
            value === v ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-muted-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** A request, response or frame payload: JSON as a tree, a form as pairs, bytes as hex, or text. */
const kindLabel = (p: ParsedBody) =>
  p.kind === "json"
    ? "JSON"
    : p.kind === "packets"
      ? p.format
      : p.kind === "form"
        ? "Form"
        : p.kind === "binary"
          ? "Binary"
          : "Text"

/** One packet of a framed message as its label and a tree, or its text. */
export function PacketView({ packet, index }: { packet: Packet; index?: number }) {
  return (
    <div className="grid gap-1 rounded-2xl bg-muted/60 px-3 py-2">
      {(index !== undefined || packet.label) && (
        <div className="flex items-center gap-2 font-sans text-xs">
          {index !== undefined && <span className="text-muted-foreground tabular-nums">#{index + 1}</span>}
          {packet.label && (
            <span className="rounded-full bg-accent px-2 py-px font-medium text-accent-foreground">{packet.label}</span>
          )}
        </div>
      )}
      {packet.json ? (
        <JsonView value={packet.value} open={2} />
      ) : packet.value !== undefined ? (
        <pre className="font-mono text-[12.5px] break-all whitespace-pre-wrap">
          <InlineValue value={typeof packet.value === "string" ? packet.value : JSON.stringify(packet.value)} />
        </pre>
      ) : null}
    </div>
  )
}

const visibleSeparators = (s: string) => s.replaceAll("\x1e", "␞\n")

/** A request, response or frame payload: JSON and framed protocols as trees, a form as pairs, bytes as hex, or text. */
export function BodyView({
  body,
  base64,
  mime,
  truncated,
  size,
}: {
  body: string
  base64?: boolean
  mime?: string
  truncated?: boolean
  size?: number
}) {
  const parsed = parseBody(body, base64, mime)
  const [pretty, setPretty] = useState(true)
  const text = base64 && parsed.kind !== "binary" ? (textOf(decodeBase64(body)) ?? body) : body
  const raw = parsed.kind === "binary" ? body : text.trim()
  const structured = parsed.kind === "json" || parsed.kind === "packets" || parsed.kind === "form"
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-muted-foreground">
          {kindLabel(parsed)}
          {parsed.kind === "packets" && parsed.packets.length > 1 && ` · ${parsed.packets.length}`}
        </span>
        {base64 && parsed.kind !== "binary" && (
          <span
            className="rounded-full bg-accent px-2 py-0.5"
            title="The bytes were sent as binary and read as UTF-8 text"
          >
            binary · UTF-8
          </span>
        )}
        {size !== undefined && <span>{formatBytes(size)}</span>}
        {truncated && <span className="text-warning">cut at the recording limit</span>}
        <span className="ml-auto flex items-center gap-1">
          {structured && <Toggle value={pretty} onChange={setPretty} />}
          <button
            type="button"
            title={parsed.kind === "binary" ? "Copy as base64" : "Copy"}
            className="grid size-7 place-items-center rounded-full hover:bg-muted"
            onClick={() => copy(raw)}
          >
            <CopyIcon className="size-3.5" />
          </button>
        </span>
      </div>
      {parsed.kind === "json" && pretty ? (
        <JsonView value={parsed.value} />
      ) : parsed.kind === "packets" && pretty ? (
        <div className="grid gap-1.5">
          {parsed.packets.slice(0, 500).map((p, i) => (
            <PacketView key={`${i}:${p.raw.length}`} packet={p} index={parsed.packets.length > 1 ? i : undefined} />
          ))}
          {parsed.packets.length > 500 && (
            <p className="text-xs text-muted-foreground">… {parsed.packets.length - 500} more; Raw shows them all</p>
          )}
        </div>
      ) : parsed.kind === "form" && pretty ? (
        <Pairs pairs={parsed.pairs} />
      ) : parsed.kind === "binary" ? (
        <pre className="overflow-x-auto font-mono text-[12px] leading-[1.5] text-muted-foreground">
          {hexDump(parsed.bytes)}
          {parsed.bytes.length > 4096 && `\n… ${formatBytes(parsed.bytes.length - 4096)} more`}
        </pre>
      ) : (
        <pre className="font-mono text-[12.5px] leading-[1.55] break-all whitespace-pre-wrap text-foreground">
          {visibleSeparators(raw)}
        </pre>
      )}
    </div>
  )
}
