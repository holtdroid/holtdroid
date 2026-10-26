import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CopyIcon,
  InfoIcon,
  type LucideIcon,
  RadioIcon,
  SearchIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { type ReactNode, useLayoutEffect, useRef, useState } from "react"
import type { DevToolsRequest } from "@/api/client"
import { AtMoment, BodyView, copy, InlineValue, JsonView, Pairs } from "@/components/recording/json-view"
import { formatBytes } from "@/lib/format"
import { decodeBase64, parseJSON, parsePackets, textOf } from "@/lib/recording/body"
import {
  type ConsoleLine,
  curlOf,
  fetchOf,
  localScheme,
  type DevToolsLog,
  framesUntil,
  type NetRequest,
  type RequestPhase,
  requestPhase,
  type ResourceGroup,
  resourceGroup,
  type SocketFrame,
  socketAt,
  type SocketTrack,
  splitURL,
} from "@/lib/recording/devtools"
import { clock } from "@/lib/recording/timeline"
import { cn } from "@/lib/utils"

const shown = 400

/**
 * Keeps a list scrolled to its end while the user hasn't scrolled away from
 * it; the row with data-key reveal is scrolled to once it shows up.
 */
function useFollow(reveal?: string) {
  const ref = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const revealed = useRef(!reveal)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (!revealed.current && reveal) {
      const row = el.querySelector(`[data-key="${CSS.escape(reveal)}"]`)
      if (row) {
        revealed.current = true
        follow.current = false
        row.scrollIntoView({ block: "center" })
        return
      }
    }
    if (follow.current) el.scrollTop = el.scrollHeight
  })
  const onScroll = () => {
    const el = ref.current
    if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
  }
  return [ref, onScroll] as const
}

function Search({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <label className="flex min-w-40 flex-1 items-center gap-2 rounded-full bg-stage-surface-container px-3 py-1.5 text-sm">
      <SearchIcon className="size-4 shrink-0 text-stage-outline" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-stage-on-surface outline-none placeholder:text-stage-outline"
      />
    </label>
  )
}

/** Picks one tab, iframe or worker; shown only when there is more than one. */
function ContextSelect({ log, value, onChange }: { log: DevToolsLog; value: string; onChange: (v: string) => void }) {
  const contexts = log.contexts()
  if (contexts.length < 2) return null
  return (
    <label className="relative">
      <span className="sr-only">Context</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-52 appearance-none truncate rounded-full bg-stage-surface-container py-1.5 pr-8 pl-3 text-sm text-stage-on-surface outline-none hover:bg-stage-surface-container-hover [&>option]:bg-stage-surface-container"
      >
        <option value="">All contexts</option>
        {contexts.map((c) => (
          <option key={c.target} value={c.target}>
            {c.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-stage-outline" />
    </label>
  )
}

/** Where a line came from, unless it is a tab: the iframe or worker. */
function ContextTag({ log, target }: { log: DevToolsLog; target: string }) {
  const c = log.context(target)
  if (!c || !c.page.type || c.page.type === "page") return null
  return (
    <span
      className="mr-1.5 inline-block max-w-40 truncate rounded bg-stage-surface-high px-1 align-[1px] font-sans text-[10.5px] leading-4 text-stage-outline"
      title={c.page.url}
    >
      {c.label}
    </span>
  )
}

export function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={cn(
        "h-7 rounded-full px-2.5 text-xs font-medium whitespace-nowrap transition-colors",
        active
          ? "bg-stage-secondary-container text-stage-on-secondary-container"
          : "text-stage-outline hover:bg-stage-surface-container hover:text-stage-on-surface-variant",
      )}
    >
      {children}
    </button>
  )
}

function TimeButton({ t, onSeek }: { t: number; onSeek: (t: number) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onSeek(t)
      }}
      className="w-14 shrink-0 cursor-pointer text-left font-mono text-[12px] text-stage-outline-dim tabular-nums hover:text-stage-primary"
      title={`Go to ${clock(t, true)}`}
    >
      {clock(t)}
    </button>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-8 text-center text-sm text-stage-outline">{children}</p>
}

/** The lower half of a panel once a row is picked. */
function Details({
  title,
  onClose,
  actions,
  children,
}: {
  title: ReactNode
  onClose: () => void
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-[1_1_58%] flex-col border-t border-stage-outline-variant/70">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1">{title}</div>
        {actions}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="grid size-8 shrink-0 place-items-center rounded-full text-stage-on-surface-variant hover:bg-stage-surface-container"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">{children}</div>
    </div>
  )
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mt-3 first:mt-0">
      <h3 className="mb-1.5 flex items-center gap-2 text-xs font-medium tracking-wide text-stage-outline uppercase">
        {title}
        {aside}
      </h3>
      {children}
    </section>
  )
}

const phaseStyle: Record<RequestPhase, string> = {
  pending: "bg-stage-surface-high text-stage-outline",
  failed: "bg-stage-error-container text-stage-error",
  redirect: "bg-stage-secondary-container text-stage-on-secondary-container",
  ok: "bg-stage-primary-container text-stage-on-primary-container",
  "client-error": "bg-stage-amber-container text-stage-amber",
  "server-error": "bg-stage-error-container text-stage-error",
}

function StatusBadge({ r, t }: { r: DevToolsRequest; t: number }) {
  const phase = requestPhase(r, t)
  const label =
    phase === "pending"
      ? "…"
      : phase === "failed"
        ? r.canceled
          ? "canceled"
          : "failed"
        : r.status
          ? String(r.status)
          : (localScheme(r.url) ?? "done")
  return (
    <span
      className={cn(
        "inline-grid h-[18px] min-w-9 shrink-0 place-items-center rounded-[6px] px-1 font-mono text-[11px] leading-none font-semibold",
        phaseStyle[phase],
        phase === "pending" && "animate-pulse",
      )}
      title={r.error || r.statusText || (phase === "pending" ? "Still loading at this moment" : undefined)}
    >
      {label}
    </span>
  )
}

const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`)

const groups: { id: ResourceGroup | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "fetch", label: "Fetch/XHR" },
  { id: "doc", label: "Doc" },
  { id: "js", label: "JS" },
  { id: "css", label: "CSS" },
  { id: "img", label: "Img" },
  { id: "media", label: "Media" },
  { id: "font", label: "Font" },
  { id: "other", label: "Other" },
]

export function NetworkView({
  log,
  time,
  onSeek,
  picked,
  onPick,
}: {
  log: DevToolsLog
  time: number
  onSeek: (t: number) => void
  picked?: string
  onPick: (key: string | undefined) => void
}) {
  const [query, setQuery] = useState("")
  const [group, setGroup] = useState<ResourceGroup | "all">("all")
  const [errors, setErrors] = useState(false)
  const [context, setContext] = useState("")
  const [listRef, onListScroll] = useFollow(picked)
  const needle = query.trim().toLowerCase()
  const all = log.requestsUntil(time).filter((r) => !context || r.target === context)
  const present = new Set(all.map((r) => resourceGroup(r.resourceType)))
  const rows = all
    .filter(
      (r) =>
        (group === "all" || resourceGroup(r.resourceType) === group) &&
        (!errors || ["failed", "client-error", "server-error"].includes(requestPhase(r, time))) &&
        (!needle || r.url.toLowerCase().includes(needle) || r.method.toLowerCase() === needle),
    )
    .slice(-shown)
  const selected = picked ? log.requests.find((r) => r.key === picked) : undefined

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
        <Search value={query} onChange={setQuery} placeholder="Filter by URL or method" />
        <ContextSelect log={log} value={context} onChange={setContext} />
        <Chip active={errors} onClick={() => setErrors((v) => !v)} title="Only failed requests and 4xx/5xx">
          Errors
        </Chip>
      </div>
      <div className="flex gap-0.5 overflow-x-auto px-3 pb-2">
        {groups
          .filter((g) => g.id === "all" || present.has(g.id))
          .map((g) => (
            <Chip key={g.id} active={group === g.id} onClick={() => setGroup(g.id)}>
              {g.label}
            </Chip>
          ))}
      </div>
      <div
        ref={listRef}
        onScroll={onListScroll}
        className="min-h-0 flex-[1_1_42%] overflow-auto px-2 pb-2 text-[12.5px] leading-[1.45]"
      >
        {rows.length === 0 ? (
          <Empty>{all.length ? "No requests match" : "No requests yet"}</Empty>
        ) : (
          rows.map((r) => {
            const u = splitURL(r.url)
            const done = r.end && r.end <= time
            const preflight = r.resourceType === "Preflight"
            return (
              <div
                key={r.key}
                data-key={r.key}
                role="button"
                tabIndex={0}
                onClick={() => onPick(r.key === picked ? undefined : r.key)}
                onKeyDown={(e) => e.key === "Enter" && onPick(r.key)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-[3px] hover:bg-stage-surface-container",
                  r.key === picked && "bg-stage-secondary-container/70 hover:bg-stage-secondary-container",
                  preflight && "opacity-60",
                )}
              >
                <TimeButton t={r.start} onSeek={onSeek} />
                <span className="w-[4.25rem] shrink-0">
                  <StatusBadge r={r} t={time} />
                </span>
                <span
                  className="w-[3.75rem] shrink-0 truncate font-mono text-[11.5px] text-stage-outline"
                  title={r.method}
                >
                  {r.method}
                </span>
                <span className="min-w-0 flex-1 truncate" title={r.url}>
                  <ContextTag log={log} target={r.target} />
                  {preflight && (
                    <span className="mr-1.5 rounded bg-stage-surface-high px-1 font-sans text-[10.5px] text-stage-outline">
                      preflight
                    </span>
                  )}
                  <span
                    className={cn(requestPhase(r, time) === "failed" ? "text-stage-error" : "text-stage-on-surface")}
                  >
                    {u.name}
                  </span>
                  <span className="ml-2 text-stage-outline-dim">{u.host}</span>
                </span>
                <span className="hidden w-16 shrink-0 text-right text-xs text-stage-outline tabular-nums sm:block">
                  {r.size ? formatBytes(r.size) : r.cached ? r.cached : ""}
                </span>
                <span className="w-14 shrink-0 text-right text-xs text-stage-outline tabular-nums">
                  {done ? ms(r.end! - r.start) : ""}
                </span>
              </div>
            )
          })
        )}
      </div>
      {selected && (
        <RequestDetails r={selected} time={time} onClose={() => onPick(undefined)} onSeek={onSeek} log={log} />
      )}
    </>
  )
}

const timingParts: { key: keyof NonNullable<DevToolsRequest["timing"]>; label: string; color: string }[] = [
  { key: "blocked", label: "Queued, stalled", color: "var(--stage-outline-variant)" },
  { key: "dns", label: "DNS", color: "#7fdcd0" },
  { key: "connect", label: "Connect", color: "#f2a65a" },
  { key: "send", label: "Send", color: "#a8c8ff" },
  { key: "wait", label: "Waiting (TTFB)", color: "#78dc9a" },
  { key: "receive", label: "Download", color: "#d0bcff" },
]

function Timing({ r }: { r: DevToolsRequest }) {
  const t = r.timing
  if (!t) return <p className="text-sm text-stage-outline">No timing for this request.</p>
  const parts = timingParts.map((p) => ({ ...p, v: Math.max(0, t[p.key]) })).filter((p) => p.v > 0)
  const total = parts.reduce((a, p) => a + p.v, 0) || 1
  return (
    <div className="grid gap-2">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-stage-surface-high">
        {parts.map((p) => (
          <span
            key={p.key}
            style={{ width: `${(p.v / total) * 100}%`, background: p.color }}
            title={`${p.label}: ${ms(p.v)}`}
          />
        ))}
      </div>
      <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 text-sm">
        {parts.map((p) => (
          <div key={p.key} className="contents">
            <span className="size-2.5 rounded-full" style={{ background: p.color }} />
            <dt className="text-stage-on-surface-variant">
              {p.label}
              {p.key === "connect" && t.ssl > 0 && <span className="text-stage-outline"> · TLS {ms(t.ssl)}</span>}
            </dt>
            <dd className="font-mono text-[12.5px] tabular-nums">{ms(p.v)}</dd>
          </div>
        ))}
        <div className="contents font-medium">
          <span />
          <dt>Total</dt>
          <dd className="font-mono text-[12.5px] tabular-nums">{ms(total)}</dd>
        </div>
      </dl>
    </div>
  )
}

type RequestTab = "headers" | "payload" | "response" | "timing"

function RequestDetails({
  r,
  time,
  log,
  onClose,
  onSeek,
}: {
  r: NetRequest
  time: number
  log: DevToolsLog
  onClose: () => void
  onSeek: (t: number) => void
}) {
  const [tab, setTab] = useState<RequestTab>("response")
  const tabs: { id: RequestTab; label: string; show: boolean }[] = [
    { id: "headers", label: "Headers", show: true },
    { id: "payload", label: "Payload", show: !!r.postData || r.url.includes("?") },
    { id: "response", label: "Response", show: true },
    { id: "timing", label: "Timing", show: true },
  ]
  const current = tabs.find((x) => x.id === tab && x.show) ? tab : "headers"
  const page = log.pageAt(r.target, r.start)
  const u = splitURL(r.url)
  let query: [string, string][] = []
  try {
    query = [...new URL(r.url).searchParams]
  } catch {
    query = []
  }
  const general: [string, string][] = [
    ["URL", r.url],
    ["Method", r.method],
    ["Status", [r.status ? `${r.status} ${r.statusText ?? ""}`.trim() : "", r.error ?? ""].filter(Boolean).join(" · ")],
    ...(r.redirect ? ([["Redirected to", r.redirect]] as [string, string][]) : []),
    ...(r.resourceType ? ([["Type", r.resourceType]] as [string, string][]) : []),
    ...(r.remoteAddress ? ([["Remote address", r.remoteAddress]] as [string, string][]) : []),
    ...(r.protocol ? ([["Protocol", r.protocol]] as [string, string][]) : []),
    ...(r.cached ? ([["Served from", `${r.cached} cache`]] as [string, string][]) : []),
    ...(r.wall ? ([["Sent (device clock)", new Date(r.wall).toISOString()]] as [string, string][]) : []),
    ...(page ? ([["Page", page.url ?? page.title ?? ""]] as [string, string][]) : []),
  ]
  return (
    <Details
      onClose={onClose}
      title={
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusBadge r={r} t={Number.POSITIVE_INFINITY} />
            <span className="truncate font-mono text-[13px] font-medium" title={r.url}>
              {r.method} {u.path}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-stage-outline">
            <span>{u.host}</span>
            <button type="button" className="hover:text-stage-primary" onClick={() => onSeek(r.start)}>
              sent {clock(r.start, true)}
            </button>
            {r.response ? <span>headers +{ms(r.response - r.start)}</span> : null}
            {r.end ? <span>done +{ms(r.end - r.start)}</span> : <span>still loading at the end</span>}
          </div>
        </div>
      }
      actions={
        <>
          <button
            type="button"
            title="Copy as cURL"
            onClick={() => copy(curlOf(r), "Copied as cURL")}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs text-stage-on-surface-variant hover:bg-stage-surface-container"
          >
            <CopyIcon className="size-3.5" />
            cURL
          </button>
          <button
            type="button"
            title="Copy as fetch()"
            onClick={() => copy(fetchOf(r), "Copied as fetch")}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs text-stage-on-surface-variant hover:bg-stage-surface-container"
          >
            <CopyIcon className="size-3.5" />
            fetch
          </button>
        </>
      }
    >
      <div className="sticky top-0 z-10 -mx-4 mb-3 flex gap-1 bg-stage-surface-low px-4 pb-2">
        {tabs
          .filter((x) => x.show)
          .map((x) => (
            <Chip key={x.id} active={current === x.id} onClick={() => setTab(x.id)}>
              {x.label}
            </Chip>
          ))}
      </div>
      {current === "headers" && (
        <AtMoment t={r.start}>
          <Section title="General">
            <Pairs pairs={general} />
          </Section>
          <AtMoment t={r.response || r.start}>
            <Section title="Response headers">
              <Pairs pairs={Object.entries(r.responseHeaders ?? {})} empty="No response" />
            </Section>
          </AtMoment>
          <Section title="Request headers">
            <Pairs pairs={Object.entries(r.requestHeaders ?? {})} />
          </Section>
        </AtMoment>
      )}
      {current === "payload" && (
        <AtMoment t={r.start}>
          {query.length > 0 && (
            <Section title="Query string">
              <Pairs pairs={query} />
            </Section>
          )}
          {r.postData && (
            <Section title="Body">
              <BodyView
                body={r.postData}
                mime={Object.entries(r.requestHeaders ?? {}).find(([k]) => k.toLowerCase() === "content-type")?.[1]}
                truncated={r.postDataTruncated}
                size={r.postData.length}
              />
            </Section>
          )}
          {!r.postData && r.postDataTruncated && (
            <p className="text-sm text-stage-outline">The body was too big to record.</p>
          )}
        </AtMoment>
      )}
      {current === "response" && (
        <AtMoment t={r.response || r.end || r.start}>
          {r.body ? (
            <BodyView
              body={r.body}
              base64={r.bodyBase64}
              mime={r.mimeType}
              truncated={r.bodyTruncated}
              size={r.bodyBase64 ? Math.floor((r.body.length * 3) / 4) : r.body.length}
            />
          ) : (
            <p className="text-sm text-stage-outline">
              {r.error
                ? `No response: ${r.error}`
                : r.bodySkipped === "type"
                  ? "Images, media and fonts are recorded without their bodies."
                  : r.bodySkipped === "size"
                    ? `The body (${formatBytes(r.size ?? 0)}) was over the 1 MB limit.`
                    : r.bodySkipped === "unavailable"
                      ? localScheme(r.url)
                        ? `The WebView doesn't hand out the bodies of ${localScheme(r.url)}: URLs.`
                        : "The WebView no longer had this body when it was asked for it."
                      : !r.end
                        ? "It was still loading when the recording ended."
                        : "No body."}
            </p>
          )}
        </AtMoment>
      )}
      {current === "timing" && <Timing r={r} />}
      {r.end && r.end > time && (
        <p className="mt-3 text-xs text-stage-outline">
          This request finishes later in the recording, at {clock(r.end, true)}.
        </p>
      )}
    </Details>
  )
}

type ConsoleFilter = "all" | "error" | "warning" | "info" | "debug"

const levelInfo: Record<string, { icon: LucideIcon; tone: string; row: string }> = {
  error: { icon: CircleAlertIcon, tone: "text-stage-error", row: "bg-stage-error-container/45" },
  warning: { icon: TriangleAlertIcon, tone: "text-stage-amber", row: "bg-stage-amber-container/45" },
  info: { icon: InfoIcon, tone: "text-stage-outline", row: "" },
  debug: { icon: InfoIcon, tone: "text-stage-blue", row: "" },
}

const consoleRank: Record<string, number> = { debug: 0, info: 1, warning: 2, error: 3 }

const shortURL = (url: string | undefined, line?: number) => {
  if (!url) return ""
  const name = url.split(/[?#]/)[0]!.split("/").findLast(Boolean) ?? url
  return line ? `${name}:${line}` : name
}

export function ConsoleView({
  log,
  time,
  onSeek,
  picked,
  onPick,
}: {
  log: DevToolsLog
  time: number
  onSeek: (t: number) => void
  picked?: string
  onPick: (key: string | undefined) => void
}) {
  const [query, setQuery] = useState("")
  const [level, setLevel] = useState<ConsoleFilter>("all")
  const [context, setContext] = useState("")
  const [open, setOpen] = useState<Set<string>>(() => new Set(picked ? [picked] : []))
  const [listRef, onListScroll] = useFollow(picked)
  const needle = query.trim().toLowerCase()
  const all = log.consoleUntil(time).filter((c) => !context || c.target === context)
  const counts = { error: 0, warning: 0 }
  for (const c of all) if (c.level === "error" || c.level === "warning") counts[c.level]++
  const rows = all
    .filter(
      (c) =>
        (level === "all" || (consoleRank[c.level] ?? 1) >= consoleRank[level]!) &&
        (!needle || c.text.toLowerCase().includes(needle) || (c.url ?? "").toLowerCase().includes(needle)),
    )
    .slice(-shown)
  const toggle = (key: string) => {
    const next = new Set(open)
    const closing = next.delete(key)
    if (!closing) next.add(key)
    setOpen(next)
    onPick(closing ? (picked === key ? undefined : picked) : key)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
        <Search value={query} onChange={setQuery} placeholder="Filter messages" />
        <ContextSelect log={log} value={context} onChange={setContext} />
        <div className="flex gap-0.5">
          <Chip active={level === "all"} onClick={() => setLevel("all")}>
            All
          </Chip>
          <Chip active={level === "error"} onClick={() => setLevel("error")}>
            Errors{counts.error ? ` ${counts.error}` : ""}
          </Chip>
          <Chip active={level === "warning"} onClick={() => setLevel("warning")}>
            Warnings{counts.warning ? ` ${counts.warning}` : ""}
          </Chip>
          <Chip active={level === "info"} onClick={() => setLevel("info")} title="Info and above, without debug">
            Info
          </Chip>
        </div>
      </div>
      <div
        ref={listRef}
        onScroll={onListScroll}
        className="min-h-0 flex-1 overflow-auto px-2 pb-3 font-mono text-[12.5px] leading-[1.45]"
      >
        {rows.length === 0 ? (
          <Empty>{all.length ? "No messages match" : "No console messages yet"}</Empty>
        ) : (
          rows.map((c) => (
            <ConsoleRow
              picked={picked === c.key}
              key={c.key}
              c={c}
              log={log}
              open={open.has(c.key)}
              onToggle={() => toggle(c.key)}
              onSeek={onSeek}
            />
          ))
        )}
      </div>
    </>
  )
}

function ConsoleRow({
  picked,
  c,
  log,
  open,
  onToggle,
  onSeek,
}: {
  picked: boolean
  c: ConsoleLine
  log: DevToolsLog
  open: boolean
  onToggle: () => void
  onSeek: (t: number) => void
}) {
  const info = levelInfo[c.level] ?? levelInfo.info!
  const Icon = info.icon
  const structured = (c.args ?? []).some((a) => a.json || (a.type === "string" && parseJSON(a.text).ok))
  const expandable = structured || !!c.stack || c.text.length > 160 || c.text.includes("\n")
  return (
    <div data-key={c.key} className={cn("rounded-lg", info.row, picked && "ring-1 ring-stage-primary/60")}>
      <div
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        onClick={expandable ? onToggle : undefined}
        onKeyDown={expandable ? (e) => e.key === "Enter" && onToggle() : undefined}
        className={cn(
          "flex items-start gap-2 px-2 py-[3px]",
          expandable && "cursor-pointer hover:bg-stage-surface-container",
        )}
      >
        <TimeButton t={c.t} onSeek={onSeek} />
        <Icon className={cn("mt-[2px] size-3.5 shrink-0", info.tone)} />
        <span
          className={cn(
            "min-w-0 flex-1 break-words whitespace-pre-wrap",
            c.level === "error"
              ? "text-stage-error"
              : c.level === "warning"
                ? "text-stage-amber"
                : "text-stage-on-surface",
            !open && "line-clamp-2",
          )}
        >
          <ContextTag log={log} target={c.target} />
          {c.source === "browser" && c.kind && (
            <span className="mr-1.5 rounded bg-stage-surface-high px-1 font-sans text-[10.5px] text-stage-outline">
              {c.kind}
            </span>
          )}
          {c.text}
        </span>
        {c.url && (
          <span
            className="hidden max-w-36 shrink-0 truncate text-[11.5px] text-stage-outline-dim sm:block"
            title={`${c.url}:${c.line}:${c.column}`}
          >
            {shortURL(c.url, c.line)}
          </span>
        )}
      </div>
      {open && (
        <AtMoment t={c.t}>
          <div className="grid gap-2 pt-1 pr-3 pb-2 pl-[5.25rem]">
            {(c.args ?? []).map((a, i) => {
              const nested = a.json
                ? parseJSON(a.json)
                : a.type === "string"
                  ? parseJSON(a.text)
                  : ({ ok: false } as const)
              if (nested.ok && typeof nested.value === "object" && nested.value !== null)
                return <JsonView key={i} value={nested.value} open={1} />
              if (a.type !== "number") return null
              return (
                <div key={i} className="text-stage-on-surface-variant">
                  <InlineValue value={a.text} />
                </div>
              )
            })}
            {c.stack && <pre className="text-[12px] whitespace-pre-wrap text-stage-outline">{c.stack}</pre>}
            <div className="flex gap-3 font-sans text-xs text-stage-outline">
              {c.wall ? <span>device clock {new Date(c.wall).toISOString()}</span> : null}
              <button
                type="button"
                className="hover:text-stage-primary"
                onClick={() => copy(`${c.text}${c.stack ? `\n${c.stack}` : ""}`)}
              >
                Copy
              </button>
            </div>
          </div>
        </AtMoment>
      )}
    </div>
  )
}

const socketTone: Record<string, string> = {
  connecting: "bg-stage-surface-high text-stage-outline",
  open: "bg-stage-primary-container text-stage-on-primary-container",
  closed: "bg-stage-surface-high text-stage-on-surface-variant",
  error: "bg-stage-error-container text-stage-error",
  stream: "bg-stage-amber-container text-stage-amber",
}

type FrameLine = { label?: string; text: string; json: boolean; binary: boolean; bytes: boolean }

const summaries = new WeakMap<SocketFrame, FrameLine>()

const clip = (s: string) => (s.length > 240 ? `${s.slice(0, 240)}…` : s)

/**
 * A frame on one line: what its protocol calls it and its payload as compact
 * JSON or text. A binary frame that holds UTF-8 text shows the text.
 */
function summarize(f: SocketFrame): FrameLine {
  let out = summaries.get(f)
  if (out) return out
  const binary = f.opcode === 2
  const text = !f.data ? null : binary ? textOf(decodeBase64(f.data)) : f.data
  if (text === null) out = { text: `${formatBytes(f.size)}`, json: false, binary, bytes: true }
  else {
    const p = parsePackets(text)
    if (p?.kind === "json") out = { text: clip(JSON.stringify(p.value)), json: true, binary, bytes: false }
    else if (p?.kind === "packets") {
      const first = p.packets[0]!
      const label = p.packets.length > 1 ? `${p.format} · ${p.packets.length}` : first.label
      const body = first.json
        ? JSON.stringify(first.value)
        : typeof first.value === "string"
          ? first.value
          : first.value !== undefined
            ? JSON.stringify(first.value)
            : ""
      out = { label: label ?? p.format, text: clip(body), json: first.json, binary, bytes: false }
    } else out = { text: clip(text), json: false, binary, bytes: false }
  }
  summaries.set(f, out)
  return out
}

export function FrameSummary({ f }: { f: SocketFrame }) {
  const s = summarize(f)
  return (
    <span className={cn("min-w-0 flex-1 truncate", s.bytes ? "text-stage-outline" : "text-stage-on-surface")}>
      {s.binary && (
        <span
          className="mr-1.5 rounded bg-stage-surface-high px-1 font-sans text-[10.5px] text-stage-outline"
          title={s.bytes ? "Binary frame" : "Binary frame that holds UTF-8 text"}
        >
          bin
        </span>
      )}
      {s.label && (
        <span className="mr-1.5 rounded-full bg-stage-secondary-container px-1.5 py-px font-sans text-[11px] font-medium text-stage-on-secondary-container">
          {s.label}
        </span>
      )}
      <span className={cn(s.json && "text-stage-on-surface-variant")}>{s.text}</span>
    </span>
  )
}

export function SocketsView({
  log,
  time,
  onSeek,
  socket: picked,
  frame: frameKey,
  onPick,
}: {
  log: DevToolsLog
  time: number
  onSeek: (t: number) => void
  socket?: string
  frame?: string
  onPick: (socket: string | undefined, frame: string | undefined) => void
}) {
  const sockets = log.socketsUntil(time)
  const [query, setQuery] = useState("")
  const [direction, setDirection] = useState<"all" | "sent" | "received">("all")
  const [listRef, onListScroll] = useFollow(frameKey)
  const socket = sockets.find((s) => s.key === picked) ?? sockets.at(-1)
  const needle = query.trim().toLowerCase()
  const frames = socket
    ? framesUntil(socket, time)
        .filter(
          (f) =>
            (direction === "all" || (direction === "sent") === !!f.sent) &&
            (!needle ||
              summarize(f).text.toLowerCase().includes(needle) ||
              (f.opcode === 1 && (f.data ?? "").toLowerCase().includes(needle))),
        )
        .slice(-shown)
    : []
  const frame = socket?.frames.find((f) => f.key === frameKey)

  if (sockets.length === 0) return <Empty>No WebSockets or event streams yet</Empty>
  return (
    <>
      <div className="flex max-h-[30%] shrink-0 flex-col gap-0.5 overflow-auto px-2 pb-2">
        {sockets.map((s) => (
          <SocketRow
            key={s.key}
            s={s}
            log={log}
            time={time}
            active={s.key === socket?.key}
            onPick={() => {
              onPick(s.key, undefined)
            }}
          />
        ))}
      </div>
      {socket && (
        <>
          <StreamNote s={socket} time={time} />
          <div className="flex flex-wrap items-center gap-1.5 border-t border-stage-outline-variant/70 px-4 pt-2 pb-2">
            <Search value={query} onChange={setQuery} placeholder="Filter text frames" />
            <div className="flex gap-0.5">
              <Chip active={direction === "all"} onClick={() => setDirection("all")}>
                All
              </Chip>
              <Chip active={direction === "sent"} onClick={() => setDirection("sent")}>
                Sent
              </Chip>
              <Chip active={direction === "received"} onClick={() => setDirection("received")}>
                Received
              </Chip>
            </div>
          </div>
          <div
            ref={listRef}
            onScroll={onListScroll}
            className="min-h-0 flex-[1_1_40%] overflow-auto px-2 pb-2 font-mono text-[12.5px] leading-[1.45]"
          >
            {frames.length === 0 ? (
              <Empty>No frames yet</Empty>
            ) : (
              frames.map((f) => (
                <div
                  key={f.key}
                  role="button"
                  tabIndex={0}
                  data-key={f.key}
                  onClick={() => onPick(socket?.key, f.key === frameKey ? undefined : f.key)}
                  onKeyDown={(e) => e.key === "Enter" && onPick(socket?.key, f.key)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-[3px] hover:bg-stage-surface-container",
                    f.key === frameKey && "bg-stage-secondary-container/70 hover:bg-stage-secondary-container",
                  )}
                >
                  <TimeButton t={f.t} onSeek={onSeek} />
                  {f.sent ? (
                    <ArrowUpIcon className="size-3.5 shrink-0 text-stage-blue" aria-label="Sent" />
                  ) : (
                    <ArrowDownIcon className="size-3.5 shrink-0 text-stage-primary" aria-label="Received" />
                  )}
                  <FrameSummary f={f} />
                  <span className="w-14 shrink-0 text-right font-sans text-xs text-stage-outline tabular-nums">
                    {formatBytes(f.size)}
                  </span>
                </div>
              ))
            )}
          </div>
          {frame && (
            <Details
              onClose={() => onPick(socket?.key, undefined)}
              title={
                <div className="flex items-center gap-2 text-sm">
                  {frame.sent ? (
                    <ArrowUpIcon className="size-4 text-stage-blue" />
                  ) : (
                    <ArrowDownIcon className="size-4 text-stage-primary" />
                  )}
                  <span className="font-medium">{frame.sent ? "Sent" : "Received"}</span>
                  <button
                    type="button"
                    className="text-xs text-stage-outline hover:text-stage-primary"
                    onClick={() => onSeek(frame.t)}
                  >
                    {clock(frame.t, true)}
                  </button>
                </div>
              }
            >
              <AtMoment t={frame.t}>
                {frame.data ? (
                  <BodyView
                    body={frame.data}
                    base64={frame.opcode === 2}
                    truncated={frame.truncated}
                    size={frame.size}
                  />
                ) : (
                  <p className="text-sm text-stage-outline">The payload looked like media and wasn't recorded.</p>
                )}
              </AtMoment>
            </Details>
          )}
        </>
      )}
    </>
  )
}

function SocketRow({
  s,
  log,
  time,
  active,
  onPick,
}: {
  s: SocketTrack
  log: DevToolsLog
  time: number
  active: boolean
  onPick: () => void
}) {
  const state = socketAt(s, time)
  const u = splitURL(s.url)
  const sse = !!s.url && !s.url.startsWith("ws")
  const count = framesUntil(s, time).length
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "flex items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-stage-surface-container",
        active && "bg-stage-secondary-container/70 hover:bg-stage-secondary-container",
      )}
    >
      <RadioIcon className="size-4 shrink-0 text-stage-outline" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[12.5px]" title={s.url}>
          {s.url ? (
            <>
              {u.host}
              <span className="text-stage-outline">{u.path === "/" ? "" : u.path}</span>
            </>
          ) : (
            <span
              className="font-sans text-stage-on-surface-variant"
              title="Its address isn't known: it opened before Holtdroid attached to the page"
            >
              Opened before Holtdroid attached
            </span>
          )}
        </span>
        <span className="text-xs text-stage-outline">
          <ContextTag log={log} target={s.target} />
          {sse ? "Event stream" : "WebSocket"} · {count} frames recorded
        </span>
      </span>
      {state && (
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", socketTone[state.state])}>
          {state.state === "stream" ? "media stream" : state.state}
        </span>
      )}
    </button>
  )
}

function StreamNote({ s, time }: { s: SocketTrack; time: number }) {
  const stream = s.states.find((x) => x.v.state === "stream")
  if (!stream || stream.t > time) return null
  const last = socketAt(s, time)
  return (
    <p className="mx-4 mb-2 rounded-2xl bg-stage-amber-container/70 px-3 py-2 text-xs text-stage-on-surface">
      From {clock(stream.t, true)} this socket looked like video or another media stream, so its frames aren't recorded
      {last?.frames ? ` (${last.frames} frames, ${formatBytes(last.bytes ?? 0)} seen)` : ""}.
    </p>
  )
}
