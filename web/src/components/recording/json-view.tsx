import { ChevronRightIcon, ClockIcon, CopyIcon } from "lucide-react"
import { createContext, type ReactNode, useContext, useMemo, useState } from "react"
import { toast } from "sonner"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { formatBytes } from "@/lib/format"
import { hexDump, parseBody, parseJSON } from "@/lib/recording/body"
import { detectStamp, formatSpan, relative, type Stamp, stampFormats, unitNames } from "@/lib/recording/timestamps"
import { cn } from "@/lib/utils"

/** The clocks of the recording: real time is startedAt + t, the device's is that plus its offset then. */
export type Clocks = {
  startedAt: number
  offsetAt: (t: number) => number
  zoneAt: (t: number) => string | undefined
}

export const ClocksContext = createContext<Clocks>({ startedAt: 0, offsetAt: () => 0, zoneAt: () => undefined })

type Moment = { real: number; device: number; zone?: string }

const MomentContext = createContext<Moment | null>(null)

/** Values inside are compared with the clocks at recording time t. */
export function AtMoment({ t, children }: { t: number; children: ReactNode }) {
  const clocks = useContext(ClocksContext)
  const real = clocks.startedAt + t
  const device = real + clocks.offsetAt(t)
  const zone = clocks.zoneAt(t)
  const moment = useMemo(() => ({ real, device, zone }), [real, device, zone])
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
export function TimeHint({ stamp, children }: { stamp: Stamp; children: ReactNode }) {
  const m = useContext(MomentContext)!
  const d = stamp.ms - m.device
  const near = Math.abs(d) < 5000
  const offset = m.device - m.real
  return (
    <HoverCard openDelay={120} closeDelay={60}>
      <HoverCardTrigger asChild>
        <span className="cursor-help underline decoration-stage-outline decoration-dotted underline-offset-[3px]">
          {children}
          <span
            className={cn(
              "ml-1.5 inline-flex translate-y-[-1px] items-center gap-0.5 rounded-full px-1.5 align-middle font-sans text-[10.5px] leading-4 font-medium whitespace-nowrap no-underline",
              near
                ? "bg-stage-primary-container text-stage-on-primary-container"
                : d > 0
                  ? "bg-stage-secondary-container text-stage-on-secondary-container"
                  : "bg-stage-surface-high text-stage-on-surface-variant",
            )}
          >
            <ClockIcon className="size-2.5" />
            {relative(stamp.ms, m.device)}
          </span>
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        className="w-[23rem] rounded-[20px] border-0 bg-stage-surface-container p-4 font-sans text-stage-on-surface shadow-2xl ring-1 ring-black/10 dark:ring-white/10"
      >
        <p className="text-xs font-medium tracking-wide text-stage-outline uppercase">{unitNames[stamp.unit]}</p>
        <p className="mt-1 text-base font-medium">
          {Math.abs(d) < 1000
            ? "Same as the device clock"
            : `${formatSpan(d)} ${d < 0 ? "before" : "after"} the device clock`}
        </p>
        <p className="text-xs text-stage-outline">
          at that moment of the recording
          {Math.abs(offset) >= 1500 && (
            <>
              {" "}
              · {Math.abs(stamp.ms - m.real) < 1000
                ? "same as"
                : relative(stamp.ms, m.real).replace("ago", "before")}{" "}
              real time (the device was {formatSpan(offset)} {offset > 0 ? "ahead" : "behind"})
            </>
          )}
        </p>
        {stamp.zoneless && (
          <p className="mt-2 rounded-xl bg-stage-amber-container px-3 py-1.5 text-xs text-stage-on-surface">
            No time zone in the value: read as your browser's.
          </p>
        )}
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          {stampFormats(stamp.ms, m.zone).map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-stage-outline">{f.label}</dt>
              <dd>
                <button
                  type="button"
                  className="max-w-full truncate text-left font-mono text-[12.5px] hover:text-stage-primary"
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
          <button type="button" className="ml-1 font-sans text-xs text-stage-primary" onClick={() => setAll(true)}>
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
        <span className="text-stage-tag">{/^\d+$/.test(name) ? name : `"${name}"`}</span>
        <span className="text-stage-outline">: </span>
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
        className="group flex w-full items-start text-left hover:bg-stage-surface-container/60"
      >
        <ChevronRightIcon
          className={cn("mt-[3px] size-3.5 shrink-0 text-stage-outline transition-transform", open && "rotate-90")}
        />
        <span className="ml-1 min-w-0">
          {key}
          {inner && (
            <span className="mr-1 rounded bg-stage-surface-high px-1 font-sans text-[10px] text-stage-outline">
              JSON string
            </span>
          )}
          <span className="text-stage-outline">{l}</span>
          {!open && (
            <>
              <span className="mx-1 font-sans text-xs text-stage-outline-dim">{summary}</span>
              <span className="text-stage-outline">{r}</span>
            </>
          )}
        </span>
      </button>
      {open && (
        <>
          <div className="ml-[7px] border-l border-stage-outline-variant/60 pl-2">
            {entries.slice(0, shown).map(([k, v]) => (
              <Node key={k} name={k} value={v} depth={depth + 1} open={initial} />
            ))}
            {entries.length > shown && (
              <button
                type="button"
                className="pl-[18px] font-sans text-xs text-stage-primary"
                onClick={() => setShown((n) => n + pageSize * 5)}
              >
                Show {Math.min(pageSize * 5, entries.length - shown)} more of {entries.length - shown}
              </button>
            )}
          </div>
          <div className="pl-[18px] text-stage-outline">{r}</div>
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
        "font-mono text-[12.5px] leading-[1.55] [--json-keyword:var(--stage-amber)] [--json-number:var(--stage-blue)] [--json-string:var(--stage-primary)]",
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
  if (pairs.length === 0) return <p className="text-sm text-stage-outline">{empty}</p>
  return (
    <dl className="grid grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)] gap-x-4 gap-y-0.5 font-mono text-[12.5px] leading-[1.55]">
      {pairs.map(([k, v], i) => (
        <div key={`${k}${i}`} className="contents">
          <dt className="truncate text-stage-tag" title={k}>
            {k}
          </dt>
          <dd className="break-all text-stage-on-surface">
            <InlineValue value={v} name={k} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex rounded-full bg-stage-surface-container p-0.5 text-xs" role="group" aria-label="View">
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
            value === v
              ? "bg-stage-secondary-container text-stage-on-secondary-container"
              : "text-stage-outline hover:text-stage-on-surface-variant",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** A request, response or frame payload: JSON as a tree, a form as pairs, bytes as hex, or text. */
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
  const raw =
    parsed.kind === "json" ? JSON.stringify(parsed.value, null, 2) : parsed.kind === "binary" ? body : body.trim()
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-stage-outline">
        <span className="rounded-full bg-stage-surface-high px-2 py-0.5 font-medium text-stage-on-surface-variant">
          {parsed.kind === "json"
            ? "JSON"
            : parsed.kind === "form"
              ? "Form"
              : parsed.kind === "binary"
                ? "Binary"
                : "Text"}
        </span>
        {size !== undefined && <span>{formatBytes(size)}</span>}
        {truncated && <span className="text-stage-amber">cut at the recording limit</span>}
        <span className="ml-auto flex items-center gap-1">
          {(parsed.kind === "json" || parsed.kind === "form") && <Toggle value={pretty} onChange={setPretty} />}
          <button
            type="button"
            title={parsed.kind === "binary" ? "Copy as base64" : "Copy"}
            className="grid size-7 place-items-center rounded-full hover:bg-stage-surface-container"
            onClick={() => copy(raw)}
          >
            <CopyIcon className="size-3.5" />
          </button>
        </span>
      </div>
      {parsed.kind === "json" && pretty ? (
        <JsonView value={parsed.value} />
      ) : parsed.kind === "form" && pretty ? (
        <Pairs pairs={parsed.pairs} />
      ) : parsed.kind === "binary" ? (
        <pre className="overflow-x-auto font-mono text-[12px] leading-[1.5] text-stage-on-surface-variant">
          {hexDump(parsed.bytes)}
          {parsed.bytes.length > 4096 && `\n… ${formatBytes(parsed.bytes.length - 4096)} more`}
        </pre>
      ) : (
        <pre className="font-mono text-[12.5px] leading-[1.55] break-all whitespace-pre-wrap text-stage-on-surface">
          {parsed.kind === "json" ? raw : parsed.kind === "text" ? parsed.text : body}
        </pre>
      )}
    </div>
  )
}
