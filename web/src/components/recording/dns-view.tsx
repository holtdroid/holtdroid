import { useLayoutEffect, useRef, useState } from "react"
import type { DNSEvent, DNSSettings } from "@/api/client"
import { QueryDetails, Status } from "@/components/session/dns-panel"
import { describeRewrite, firstAnswer, ttlLabel } from "@/lib/dns"
import { type At, clock } from "@/lib/recording/timeline"
import { cn } from "@/lib/utils"

const maxRows = 500

const cols = "grid-cols-[84px_minmax(0,2fr)_52px_88px_minmax(0,1.4fr)_80px]"

function summary(s: DNSSettings) {
  const on = s.rewrites.filter((r) => r.enabled)
  const ttl = s.ttlMode === "limit" ? `TTL at most ${s.maxTtl} s` : "TTL as answered"
  const rules = on.map((r) => `${r.pattern} → ${describeRewrite(r)}`).join(", ")
  return `${on.length === 0 ? "No rewrites" : `${on.length} rewrite${on.length === 1 ? "" : "s"}: ${rules}`} · ${ttl}`
}

/** The device's DNS queries up to the playhead, with the rewrites and cache clears between them. */
export function DNSView({
  events,
  time,
  onSeek,
}: {
  events: At<DNSEvent>[]
  time: number
  onSeek: (t: number) => void
}) {
  const [picked, setPicked] = useState<number | null>(null)
  const end = events.findIndex((e) => e.t > time)
  const upto = end < 0 ? events.length : end
  const from = Math.max(0, upto - maxRows)
  const shown = events.slice(from, upto)
  const listRef = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && follow.current) el.scrollTop = el.scrollHeight
  })
  const selected = picked === null ? undefined : events[picked]
  const settingsAt = (t: number) => events.findLast((e) => e.v.settings && e.t <= t)?.v.settings

  if (shown.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">No DNS query yet at this point of the recording.</p>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col text-[12px]">
      <div className={cn("grid shrink-0 border-b bg-muted/40 px-2 py-1 text-muted-foreground", cols)}>
        <span>Time</span>
        <span>Name</span>
        <span>Type</span>
        <span>Status</span>
        <span>Answer</span>
        <span>TTL</span>
      </div>
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="min-h-0 flex-1 overflow-auto font-mono"
      >
        {shown.map((e, n) => {
          const i = from + n
          const q = e.v.query
          if (!q) {
            return (
              <button
                key={i}
                type="button"
                onClick={() => onSeek(e.t)}
                className="flex w-full items-baseline gap-2 border-b border-border/50 bg-violet-500/10 px-2 py-0.5 text-left font-sans text-violet-800 dark:text-violet-200"
              >
                <span className="w-[76px] shrink-0 font-mono tabular-nums">{clock(e.t, true)}</span>
                <span className="truncate">
                  {e.v.flushed ? "DNS cache cleared" : e.v.settings ? summary(e.v.settings) : ""}
                </span>
              </button>
            )
          }
          return (
            <button
              key={i}
              type="button"
              onClick={() => {
                setPicked(picked === i ? null : i)
                onSeek(e.t)
              }}
              className={cn(
                "grid w-full items-center border-b border-border/50 px-2 py-0.5 text-left hover:bg-accent/50",
                cols,
                picked === i && "bg-accent",
                q.result === "failed" && "text-stage-error",
              )}
            >
              <span className="text-muted-foreground tabular-nums">{clock(e.t, true)}</span>
              <span className="truncate" title={q.name}>
                {q.name}
              </span>
              <span className="text-muted-foreground">{q.type}</span>
              <Status q={q} />
              <span className="truncate text-muted-foreground">
                {firstAnswer(q)}
                {q.answers.length > 1 && <span className="opacity-60"> +{q.answers.length - 1}</span>}
              </span>
              <span className="truncate text-muted-foreground tabular-nums">{ttlLabel(q)}</span>
            </button>
          )
        })}
      </div>
      {selected?.v.query && <QueryDetails q={selected.v.query} rewrites={settingsAt(selected.t)?.rewrites} />}
    </div>
  )
}
