import { CopyIcon, WandSparklesIcon } from "lucide-react"
import { useLayoutEffect, useRef } from "react"
import { toast } from "sonner"
import type { DNSQuery, DNSRewrite } from "@/api/client"
import { Button } from "@/components/ui/button"
import { describeRewrite, formatTTL, type Lookup, lookupAnswer, lookupBadges, lookupTTL, type Tone } from "@/lib/dns"
import { wallClock } from "@/lib/format"
import { cn } from "@/lib/utils"

export type LookupRow =
  | { kind: "lookup"; key: string; lookup: Lookup; time: string }
  | { kind: "note"; key: string; time: string; text: string }

const cols = "grid-cols-[72px_minmax(0,2fr)_104px_minmax(0,1.4fr)_76px_44px_28px]"

const tones: Record<Tone, string> = {
  rewrite: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  error: "bg-stage-error/15 text-stage-error",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  muted: "bg-muted text-muted-foreground",
}

/** Lookups one per row, each with the types it asked for, and the picked one's records below. */
export function LookupTable({
  rows,
  picked,
  onPick,
  onRewrite,
  onNote,
  rewrites,
  empty,
}: {
  rows: LookupRow[]
  picked: string | null
  onPick: (key: string | null) => void
  onNote?: (key: string) => void
  onRewrite?: (l: Lookup) => void
  rewrites?: DNSRewrite[]
  empty: string
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && follow.current) el.scrollTop = el.scrollHeight
  })
  const selected = rows.find((r) => r.kind === "lookup" && r.key === picked)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("grid shrink-0 border-b bg-muted/40 px-2 py-1 text-muted-foreground", cols)}>
        <span>Time</span>
        <span>Name</span>
        <span>Asked</span>
        <span>Answer</span>
        <span title="How long the device may cache the answer">TTL</span>
        <span className="text-right" title="Milliseconds until the slowest answer">
          ms
        </span>
        <span />
      </div>
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="min-h-0 flex-1 overflow-auto"
      >
        {rows.length === 0 && <p className="p-4 text-center text-muted-foreground">{empty}</p>}
        {rows.map((r) =>
          r.kind === "note" ? (
            <button
              key={r.key}
              type="button"
              onClick={() => onNote?.(r.key)}
              className="flex w-full items-baseline gap-2 border-b border-border/50 bg-violet-500/10 px-2 py-1 text-left text-violet-800 dark:text-violet-200"
            >
              <span className="w-16 shrink-0 font-mono tabular-nums">{r.time}</span>
              <span className="truncate">{r.text}</span>
            </button>
          ) : (
            <Row
              key={r.key}
              lookup={r.lookup}
              time={r.time}
              active={picked === r.key}
              onPick={() => onPick(picked === r.key ? null : r.key)}
              onRewrite={onRewrite && (() => onRewrite(r.lookup))}
            />
          ),
        )}
      </div>
      {selected?.kind === "lookup" && (
        <LookupDetails
          lookup={selected.lookup}
          rewrites={rewrites}
          onRewrite={onRewrite && (() => onRewrite(selected.lookup))}
        />
      )}
    </div>
  )
}

function Row({
  lookup,
  time,
  active,
  onPick,
  onRewrite,
}: {
  lookup: Lookup
  time: string
  active: boolean
  onPick: () => void
  onRewrite?: () => void
}) {
  const answer = lookupAnswer(lookup)
  const ttl = lookupTTL(lookup)
  const ms = Math.max(...lookup.queries.map((q) => q.duration))
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onPick()
      }}
      className={cn(
        "group grid cursor-default items-center border-b border-border/50 px-2 py-1 hover:bg-accent/50",
        cols,
        active && "bg-accent",
      )}
    >
      <span className="font-mono text-muted-foreground tabular-nums">{time}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-mono" title={lookup.name}>
          {lookup.name}
        </span>
        {lookupBadges(lookup).map((b) => (
          <Badge key={b.label} tone={b.tone} title={b.title}>
            {b.label}
          </Badge>
        ))}
      </span>
      <span className="flex min-w-0 gap-1 overflow-hidden">
        {lookup.queries.map((q) => (
          <TypeChip key={q.type} q={q} />
        ))}
      </span>
      <span className="truncate font-mono text-muted-foreground" title={answer.text}>
        {answer.text}
        {answer.more > 0 && <span className="opacity-60"> +{answer.more}</span>}
      </span>
      <span className="truncate font-mono text-muted-foreground tabular-nums">
        {ttl && (
          <span title={ttl.served === ttl.original ? undefined : `The upstream said ${formatTTL(ttl.original)}`}>
            {formatTTL(ttl.served)}
            {ttl.served !== ttl.original && <span className="opacity-50"> / {formatTTL(ttl.original)}</span>}
          </span>
        )}
      </span>
      <span className="text-right font-mono text-muted-foreground tabular-nums">{Math.round(ms)}</span>
      {onRewrite ? (
        <button
          type="button"
          title={lookup.queries.some((q) => q.rule) ? "Edit the rewrite" : "Rewrite this name"}
          aria-label="Rewrite this name"
          onClick={(e) => {
            e.stopPropagation()
            onRewrite()
          }}
          className="invisible grid size-5 place-items-center rounded-sm text-muted-foreground group-hover:visible hover:bg-background hover:text-foreground [&_svg]:size-3.5"
        >
          <WandSparklesIcon />
        </button>
      ) : (
        <span />
      )}
    </div>
  )
}

function Badge({ tone, title, children }: { tone: Tone; title?: string; children: string }) {
  return (
    <span title={title} className={cn("shrink-0 rounded-sm px-1 text-[10.5px] leading-4", tones[tone])}>
      {children}
    </span>
  )
}

function typeTitle(q: DNSQuery) {
  if (q.result === "ipv4-only") return `${q.type}: empty, the sidecar resolves IPv4 only`
  if (q.result === "blocked") return `${q.type}: blocked, an encrypted DNS server`
  if (q.result === "failed") return `${q.type}: ${q.error ?? q.rcode}`
  const n = q.answers.length
  return `${q.type}: ${q.rcode}, ${n === 0 ? "no records" : `${n} record${n === 1 ? "" : "s"}`}`
}

function TypeChip({ q }: { q: DNSQuery }) {
  return (
    <span
      title={typeTitle(q)}
      className={cn(
        "shrink-0 rounded-sm border px-1 font-mono text-[10.5px] leading-4",
        q.result === "failed" && "border-stage-error/40 text-stage-error",
        q.result === "rewritten" && "border-violet-500/40 text-violet-700 dark:text-violet-300",
        q.result === "blocked" && "border-amber-500/40 text-amber-700 dark:text-amber-400",
        (q.result === "ipv4-only" || (q.answers.length === 0 && q.result === "answered")) &&
          "border-dashed text-muted-foreground opacity-70",
      )}
    >
      {q.type}
    </span>
  )
}

export function LookupDetails({
  lookup,
  rewrites,
  onRewrite,
}: {
  lookup: Lookup
  rewrites?: DNSRewrite[]
  onRewrite?: () => void
}) {
  const ruleName = lookup.queries.find((q) => q.rule)?.rule
  const rule = ruleName ? rewrites?.find((r) => r.pattern === ruleName) : undefined
  return (
    <div className="max-h-[50%] shrink-0 overflow-auto border-t bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-[13px] font-medium break-all">{lookup.name}</span>
        <span className="text-muted-foreground">{wallClock(lookup.at)}</span>
        <div className="ml-auto flex gap-1">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void navigator.clipboard.writeText(lookup.name).then(() => toast.success("Name copied"))}
          >
            <CopyIcon />
            Copy
          </Button>
          {onRewrite && (
            <Button size="xs" variant="outline" onClick={onRewrite}>
              <WandSparklesIcon />
              {ruleName ? "Edit the rewrite" : "Rewrite this name…"}
            </Button>
          )}
        </div>
      </div>
      {ruleName && (
        <p className="mt-1 text-violet-700 dark:text-violet-300">
          Answered by the rewrite <span className="font-mono">{ruleName}</span>
          {rule ? ` → ${describeRewrite(rule)}` : rewrites ? " (changed since)" : ""}
        </p>
      )}
      <div className="mt-2 grid gap-2.5">
        {lookup.queries.map((q) => (
          <section key={q.type}>
            <h4 className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <TypeChip q={q} />
              <span
                className={cn(
                  q.result === "failed" && "text-stage-error",
                  q.rcode === "NXDOMAIN" && "text-amber-700 dark:text-amber-400",
                )}
              >
                {q.rcode}
              </span>
              <span>
                {q.duration.toFixed(q.duration < 10 ? 1 : 0)} ms over {q.protocol.toUpperCase()}
              </span>
            </h4>
            {q.error && <p className="mt-0.5 text-stage-error">{q.error}</p>}
            {q.answers.length === 0 ? (
              <p className="mt-0.5 text-muted-foreground">
                {q.result === "ipv4-only"
                  ? "Empty on purpose: the sidecar resolves IPv4 only, so apps connect over IPv4."
                  : q.result === "blocked"
                    ? "A DNS-over-HTTPS or DNS-over-TLS server, answered as missing on purpose so the app falls back to the device's DNS and its lookups stay in this log. Allow DoH in the toolbar to let it through."
                    : q.rcode === "NXDOMAIN"
                      ? "The name doesn't exist."
                      : q.result === "failed"
                        ? ""
                        : "No records of this type."}
              </p>
            ) : (
              <ul className="mt-0.5 grid gap-0.5">
                {q.answers.map((a) => (
                  <li
                    key={`${a.name} ${a.type} ${a.data}`}
                    className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-baseline gap-2"
                  >
                    <span className="font-mono text-muted-foreground">{a.type}</span>
                    <span className="min-w-0 font-mono break-all" title={a.data}>
                      {a.name !== lookup.name && <span className="text-muted-foreground">{a.name} </span>}
                      {a.data}
                    </span>
                    <span
                      className="font-mono text-muted-foreground tabular-nums"
                      title={`The device may cache it for ${a.ttl} s; the upstream said ${a.originalTtl} s`}
                    >
                      {formatTTL(a.ttl)}
                      {a.ttl !== a.originalTtl && <span className="opacity-50"> / {formatTTL(a.originalTtl)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
