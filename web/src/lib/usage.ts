import type { components } from "@/api/schema"

export type UsageSession = components["schemas"]["StatsSession"]
export type Ended = NonNullable<UsageSession["ended"]> | "open"

export type Bucket = { start: number; launches: number; people: number; seconds: number }
export type Ranked = { key: string; label: string; actor?: string; named: boolean; launches: number; seconds: number }

export type Usage = {
  unit: "day" | "week"
  buckets: Bucket[]
  launches: number
  people: number
  seconds: number
  median: number
  p90: number
  ended: Record<Ended, number>
  durations: { label: string; count: number }[]
  heatmap: number[][]
  topPeople: Ranked[]
  topApps: Ranked[]
}

const DAY = 86_400_000

export const durationBuckets: [string, number][] = [
  ["< 5 min", 300],
  ["5–15 min", 900],
  ["15–30 min", 1800],
  ["30–60 min", 3600],
  ["1–2 h", 7200],
  ["> 2 h", Infinity],
]

function startOf(ms: number, unit: Usage["unit"]) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  if (unit === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

function next(ms: number, unit: Usage["unit"]) {
  const d = new Date(ms)
  d.setDate(d.getDate() + (unit === "week" ? 7 : 1))
  return d.getTime()
}

function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
}

export function appKey(s: UsageSession) {
  return s.package || (s.artifact ?? "").replace(/@[0-9a-f]+$/, "") || "unknown"
}

function rank(map: Map<string, Ranked>, limit: number) {
  return [...map.values()].toSorted((a, b) => b.launches - a.launches || b.seconds - a.seconds).slice(0, limit)
}

export function summarize(items: UsageSession[], since: number, until: number, limit = 8): Usage {
  const unit = until - since > 45 * DAY ? "week" : "day"
  const buckets: Bucket[] = []
  const bucketActors = new Map<number, Set<string>>()
  for (let t = startOf(since, unit); t <= until; t = next(t, unit)) {
    buckets.push({ start: t, launches: 0, people: 0, seconds: 0 })
    bucketActors.set(t, new Set())
  }

  const actors = new Set<string>()
  const lengths: number[] = []
  const ended: Record<Ended, number> = { stopped: 0, idle: 0, ttl: 0, reaped: 0, open: 0 }
  const durations = durationBuckets.map(([label]) => ({ label, count: 0 }))
  const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  const people = new Map<string, Ranked>()
  const apps = new Map<string, Ranked>()

  for (const s of items) {
    const start = Date.parse(s.start)
    const seconds = s.end ? Math.max(0, (Date.parse(s.end) - start) / 1000) : 0
    const actor = s.actor ?? ""
    if (actor) actors.add(actor)
    ended[s.ended ?? "open"]++
    if (s.end) {
      lengths.push(seconds)
      const i = durationBuckets.findIndex(([, upTo]) => seconds < upTo)
      const d = durations[i]
      if (d) d.count++
    }
    const d = new Date(start)
    const row = heatmap[(d.getDay() + 6) % 7]
    if (row) row[d.getHours()] = (row[d.getHours()] ?? 0) + 1

    const bucketStart = startOf(start, unit)
    const b = buckets.find((x) => x.start === bucketStart)
    if (b) {
      b.launches++
      b.seconds += seconds
      if (actor) bucketActors.get(bucketStart)?.add(actor)
    }

    const who = actor || "—"
    const p = people.get(who) ?? {
      key: who,
      label: s.actorName || who,
      actor: actor || undefined,
      named: !!s.actorName,
      launches: 0,
      seconds: 0,
    }
    p.launches++
    p.seconds += seconds
    people.set(who, p)

    const app = appKey(s)
    const a = apps.get(app) ?? { key: app, label: app, named: false, launches: 0, seconds: 0 }
    a.launches++
    a.seconds += seconds
    apps.set(app, a)
  }

  for (const b of buckets) b.people = bucketActors.get(b.start)?.size ?? 0
  const sorted = lengths.toSorted((a, b) => a - b)
  return {
    unit,
    buckets,
    launches: items.length,
    people: actors.size,
    seconds: sorted.reduce((sum, s) => sum + s, 0),
    median: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    ended,
    durations,
    heatmap,
    topPeople: rank(people, limit),
    topApps: rank(apps, limit),
  }
}

export function formatHours(seconds: number) {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  const h = seconds / 3600
  return `${h < 10 ? h.toFixed(1) : Math.round(h).toLocaleString()} h`
}
