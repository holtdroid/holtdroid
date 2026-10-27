import { useMemo, useState } from "react"
import type { DNSEvent, DNSQuery, DNSSettings } from "@/api/client"
import { LookupTable, type LookupRow } from "@/components/session/dns-lookups"
import { describeRewrite, groupLookups } from "@/lib/dns"
import { type At, clock } from "@/lib/recording/timeline"

const maxRows = 500

function summary(s: DNSSettings) {
  const on = s.rewrites.filter((r) => r.enabled)
  const ttl = s.ttlMode === "limit" ? `TTL at most ${s.maxTtl} s` : "TTL as answered"
  const rules = on.map((r) => `${r.pattern} → ${describeRewrite(r)}`).join(", ")
  const doh = s.allowEncrypted ? " · DoH allowed" : ""
  return `${on.length === 0 ? "No rewrites" : `${on.length} rewrite${on.length === 1 ? "" : "s"}: ${rules}`} · ${ttl}${doh}`
}

/** The device's DNS lookups up to the playhead, with the rewrites and cache clears between them. */
export function DNSView({
  events,
  time,
  onSeek,
}: {
  events: At<DNSEvent>[]
  time: number
  onSeek: (t: number) => void
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const all = useMemo(() => {
    const rows: (LookupRow & { t: number })[] = []
    const at = new Map<DNSQuery, number>()
    let run: DNSQuery[] = []
    const close = () => {
      for (const l of groupLookups(run)) {
        const t = at.get(l.queries[0]!) ?? 0
        rows.push({ kind: "lookup", key: l.key, lookup: l, time: clock(t), t })
      }
      run = []
    }
    for (const [i, e] of events.entries()) {
      if (e.v.query) {
        at.set(e.v.query, e.t)
        run.push(e.v.query)
        continue
      }
      close()
      const text = e.v.flushed ? "DNS cache cleared" : e.v.settings ? summary(e.v.settings) : ""
      if (text) rows.push({ kind: "note", key: `n${i}`, time: clock(e.t), text, t: e.t })
    }
    close()
    return rows
  }, [events])
  const shown = all.filter((r) => r.t <= time).slice(-maxRows)
  const seekTo = (key: string | null) => {
    const r = all.find((x) => x.key === key)
    if (r) onSeek(r.t)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[12px]">
      <LookupTable
        rows={shown}
        picked={picked}
        onPick={(key) => {
          setPicked(key)
          seekTo(key)
        }}
        onNote={seekTo}
        empty="No DNS query yet at this point of the recording."
      />
    </div>
  )
}
