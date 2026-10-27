import { CircleAlertIcon, InfoIcon, type LucideIcon, TriangleAlertIcon } from "lucide-react"
import { Fragment, type ReactNode, useState } from "react"
import { Chip, Details, Empty, Section, StatusBadge, TimeButton } from "@/components/recording/devtools-view"
import { Pairs } from "@/components/recording/json-view"
import { formatBytes } from "@/lib/format"
import {
  type CacheEntry,
  type CacheFinding,
  type CacheReport,
  type CacheServed,
  type CacheSeverity,
  header,
} from "@/lib/recording/cache"
import { splitURL } from "@/lib/recording/devtools"
import { cn } from "@/lib/utils"

const severityInfo: Record<CacheSeverity, { icon: LucideIcon; tone: string; label: string }> = {
  error: { icon: CircleAlertIcon, tone: "text-stage-error", label: "Errors" },
  warning: { icon: TriangleAlertIcon, tone: "text-stage-amber", label: "Warnings" },
  info: { icon: InfoIcon, tone: "text-stage-outline", label: "Hints" },
}

const servedLabel: Record<CacheServed, string> = {
  memory: "memory cache",
  disk: "disk cache",
  "service-worker": "service worker",
  prefetch: "prefetch cache",
  revalidated: "304",
  network: "network",
}

const responseHeaders = [
  "cache-control",
  "cdn-cache-control",
  "cloudflare-cdn-cache-control",
  "expires",
  "pragma",
  "etag",
  "last-modified",
  "vary",
  "age",
  "date",
  "cf-cache-status",
  "x-cache",
  "x-cache-status",
  "set-cookie",
]
const requestHeaders = ["cache-control", "pragma", "if-none-match", "if-modified-since", "authorization"]

const pick = (h: Record<string, string> | undefined, names: string[]) =>
  names.flatMap((n): [string, string][] => {
    const v = header(h, n)
    return v === undefined ? [] : [[n, n === "authorization" ? "…" : v]]
  })

/** Text with `code` spans. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 ? (
          <code key={i} className="rounded bg-stage-surface-high px-1 font-mono text-[0.92em]">
            {part}
          </code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

function Stat({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-stage-surface-container px-3 py-1.5" title={title}>
      <div className="text-[11px] text-stage-outline">{label}</div>
      <div className="truncate text-sm font-medium text-stage-on-surface tabular-nums">{value}</div>
    </div>
  )
}

const percent = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–")

/**
 * How the WebViews' requests use the browser's cache and a CDN, as findings
 * with the requests behind each. In a recording a request's time seeks there
 * and a click opens it in Network; live, the device clock is shown.
 */
export function CacheView({
  report,
  picked,
  onPick,
  onSeek,
  onReveal,
  wallClock,
  empty,
}: {
  report: CacheReport
  picked?: string
  onPick: (id: string | undefined) => void
  onSeek?: (t: number) => void
  onReveal?: (request: string) => void
  wallClock?: (ms: number) => string
  empty: string
}) {
  const [level, setLevel] = useState<CacheSeverity | "all">("all")
  const { summary: s, findings } = report
  const rows = findings.filter((f) => level === "all" || f.severity === level)
  const selected = picked ? findings.find((f) => f.id === picked) : undefined
  const cdn = s.cdn.hit + s.cdn.miss + s.cdn.uncached

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1.5 px-4 pb-2">
        <Stat label="Cacheable requests" value={s.requests} />
        <Stat
          label="From the WebView"
          value={percent(s.browser + s.revalidated, s.requests)}
          title={`${s.browser} from its caches, ${s.revalidated} revalidated with 304, ${s.network} over the network`}
        />
        {cdn > 0 && (
          <Stat
            label="CDN hits"
            value={percent(s.cdn.hit, s.cdn.hit + s.cdn.miss)}
            title={`${s.cdn.hit} hits, ${s.cdn.miss} misses, ${s.cdn.uncached} not cached by the CDN`}
          />
        )}
        <Stat label="Downloaded" value={formatBytes(s.bytes)} />
        {s.wasted > 0 && (
          <Stat
            label="Could be cached"
            value={formatBytes(s.wasted)}
            title="Bytes downloaded again that a cache could have served"
          />
        )}
      </div>
      <div className="flex gap-0.5 overflow-x-auto px-3 pb-2">
        <Chip active={level === "all"} onClick={() => setLevel("all")}>
          All {findings.length || ""}
        </Chip>
        {(["error", "warning", "info"] as const).map((v) => {
          const count = v === "error" ? s.errors : v === "warning" ? s.warnings : s.infos
          return count ? (
            <Chip key={v} active={level === v} onClick={() => setLevel(v)}>
              {severityInfo[v].label} {count}
            </Chip>
          ) : null
        })}
      </div>
      <div className="min-h-0 flex-[1_1_42%] overflow-auto px-2 pb-2 text-[12.5px] leading-[1.45]">
        {rows.length === 0 ? (
          <Empty>{s.requests ? "Nothing to improve in how these requests are cached" : empty}</Empty>
        ) : (
          rows.map((f) => {
            const info = severityInfo[f.severity]
            return (
              <div
                key={f.id}
                role="button"
                tabIndex={0}
                onClick={() => onPick(f.id === picked ? undefined : f.id)}
                onKeyDown={(e) => e.key === "Enter" && onPick(f.id)}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1 hover:bg-stage-surface-container",
                  f.id === picked && "bg-stage-secondary-container/70 hover:bg-stage-secondary-container",
                )}
              >
                <info.icon className={cn("mt-0.5 size-3.5 shrink-0", info.tone)} aria-label={f.severity} />
                <span className="min-w-0 flex-1 text-stage-on-surface">
                  <Rich text={f.title} />
                </span>
                {f.wasted ? (
                  <span className="shrink-0 text-xs text-stage-outline tabular-nums" title="Could be cached">
                    {formatBytes(f.wasted)}
                  </span>
                ) : null}
                <span className="w-8 shrink-0 text-right text-xs text-stage-outline tabular-nums" title="Requests">
                  ×{f.requests.length}
                </span>
              </div>
            )
          })
        )}
      </div>
      {selected && (
        <FindingDetails
          key={selected.id}
          f={selected}
          report={report}
          onClose={() => onPick(undefined)}
          onSeek={onSeek}
          onReveal={onReveal}
          wallClock={wallClock}
        />
      )}
    </>
  )
}

function FindingDetails({
  f,
  report,
  onClose,
  onSeek,
  onReveal,
  wallClock,
}: {
  f: CacheFinding
  report: CacheReport
  onClose: () => void
  onSeek?: (t: number) => void
  onReveal?: (request: string) => void
  wallClock?: (ms: number) => string
}) {
  const byKey = new Map(report.entries.map((e) => [e.r.key, e]))
  const entries = f.requests.flatMap((k) => byKey.get(k) ?? []).slice(-200)
  const [current, setCurrent] = useState(entries.at(-1)?.r.key)
  const e = entries.find((x) => x.r.key === current) ?? entries.at(-1)
  const info = severityInfo[f.severity]

  return (
    <Details
      onClose={onClose}
      title={
        <div className="flex items-start gap-2 text-sm font-medium text-stage-on-surface">
          <info.icon className={cn("mt-0.5 size-4 shrink-0", info.tone)} />
          <span className="min-w-0">
            <Rich text={f.title} />
          </span>
        </div>
      }
    >
      <p className="text-sm text-stage-on-surface-variant">
        <Rich text={f.detail} />
      </p>
      <Section title={`Requests · ${f.requests.length}`}>
        <div className="max-h-48 overflow-auto text-[12.5px]">
          {entries.map((x) => (
            <RequestRow
              key={x.r.key}
              e={x}
              active={x.r.key === e?.r.key}
              onClick={() => setCurrent(x.r.key)}
              onSeek={onSeek}
              wallClock={wallClock}
            />
          ))}
        </div>
      </Section>
      {e && (
        <>
          <Section
            title="Response headers"
            aside={
              onReveal && (
                <button
                  type="button"
                  onClick={() => onReveal(e.r.key)}
                  className="ml-auto text-xs font-normal tracking-normal text-stage-primary normal-case hover:underline"
                >
                  Open in Network
                </button>
              )
            }
          >
            <Pairs pairs={pick(e.r.responseHeaders, responseHeaders)} empty="No caching headers" />
          </Section>
          <Section title="Request headers">
            <Pairs pairs={pick(e.r.requestHeaders, requestHeaders)} empty="None that change caching" />
          </Section>
        </>
      )}
    </Details>
  )
}

function RequestRow({
  e,
  active,
  onClick,
  onSeek,
  wallClock,
}: {
  e: CacheEntry
  active: boolean
  onClick: () => void
  onSeek?: (t: number) => void
  wallClock?: (ms: number) => string
}) {
  const u = splitURL(e.r.url)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(ev) => ev.key === "Enter" && onClick()}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-[3px] hover:bg-stage-surface-container",
        active && "bg-stage-secondary-container/70 hover:bg-stage-secondary-container",
      )}
    >
      {onSeek ? (
        <TimeButton t={e.r.start} onSeek={onSeek} />
      ) : (
        <span className="w-24 shrink-0 font-mono text-[12px] text-stage-outline-dim tabular-nums">
          {e.r.wall && wallClock ? wallClock(e.r.wall) : ""}
        </span>
      )}
      <span className="w-[4.25rem] shrink-0">
        <StatusBadge r={e.r} t={Number.POSITIVE_INFINITY} />
      </span>
      <span className="min-w-0 flex-1 truncate" title={e.r.url}>
        {u.name}
        <span className="ml-2 text-stage-outline-dim">{u.host}</span>
      </span>
      {e.cdn && (
        <span className="hidden shrink-0 font-mono text-[11px] text-stage-outline sm:block" title={e.cdn.name}>
          {e.cdn.status}
        </span>
      )}
      <span className="w-24 shrink-0 text-right text-xs text-stage-outline tabular-nums">
        {e.served === "network" && e.r.size ? formatBytes(e.r.size) : servedLabel[e.served]}
      </span>
    </div>
  )
}
