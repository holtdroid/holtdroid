import type { DNSQuery, DNSRewrite, DNSSettings } from "@/api/client"

const label = /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/

export function normalizeName(s: string) {
  return s.trim().toLowerCase().replace(/\.$/, "")
}

export function validName(s: string) {
  return s.length > 0 && s.length <= 253 && s.split(".").every((l) => label.test(l))
}

/** A name, or `*.name` for every name under it. */
export function validPattern(s: string) {
  return validName(s.replace(/^\*\./, ""))
}

export function validIPv4(s: string) {
  const parts = s.split(".")
  return parts.length === 4 && parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255)
}

export function parseAddresses(s: string) {
  return s
    .split(/[\s,]+/)
    .map((a) => a.trim())
    .filter(Boolean)
}

export function matches(pattern: string, name: string) {
  return pattern.startsWith("*.") ? name.endsWith(pattern.slice(1)) : pattern === name
}

/** The enabled rewrite that answers name, by the agent's precedence. */
export function ruleFor(rules: DNSRewrite[], name: string) {
  let best: DNSRewrite | undefined
  for (const r of rules) {
    if (!r.enabled) continue
    if (r.pattern === name) return r
    if (matches(r.pattern, name) && (!best || r.pattern.length > best.pattern.length)) best = r
  }
  return best
}

/** Patterns worth offering for a name seen in the log: itself, its siblings and what is under it. */
export function patternChoices(name: string) {
  const labels = name.split(".")
  const out = [name]
  if (labels.length > 2) out.push(`*.${labels.slice(1).join(".")}`)
  out.push(`*.${name}`)
  return out
}

export const blocked = "0.0.0.0"

export type RewriteAnswer = "address" | "block" | "cname" | "nxdomain"

export function answerOf(r: DNSRewrite): RewriteAnswer {
  if (r.kind === "address" && r.addresses?.length === 1 && r.addresses[0] === blocked) return "block"
  return r.kind
}

export function describeRewrite(r: DNSRewrite) {
  switch (answerOf(r)) {
    case "block":
      return "blocked (0.0.0.0)"
    case "nxdomain":
      return "NXDOMAIN"
    case "cname":
      return `CNAME ${r.target ?? ""}`
    default:
      return (r.addresses ?? []).join(", ")
  }
}

/** Adds incoming rewrites to current ones; a pattern in both takes the incoming one. */
export function mergeRewrites(current: DNSRewrite[], incoming: DNSRewrite[]) {
  const byPattern = new Map(incoming.map((r) => [r.pattern, r]))
  const kept = current.map((r) => byPattern.get(r.pattern) ?? r)
  const known = new Set(current.map((r) => r.pattern))
  return [...kept, ...incoming.filter((r) => !known.has(r.pattern))]
}

export const exportFormat = "holtdroid-dns/1"

export function exportSettings(name: string, settings: DNSSettings) {
  return JSON.stringify({ format: exportFormat, name, settings }, null, 2)
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null

const kinds = new Set(["address", "cname", "nxdomain"])

/** Reads an export, or a bare settings object or rewrite list. */
export function importSettings(text: string): { name?: string; settings: DNSSettings } {
  const raw: unknown = JSON.parse(text)
  let name: string | undefined
  let s: unknown = raw
  if (isObject(raw) && isObject(raw.settings)) {
    name = typeof raw.name === "string" ? raw.name : undefined
    s = raw.settings
  }
  const list = Array.isArray(s) ? s : isObject(s) && Array.isArray(s.rewrites) ? s.rewrites : null
  if (!list) throw new Error("No rewrites in this file")
  const rewrites: DNSRewrite[] = list.map((r: unknown, i) => {
    if (!isObject(r) || typeof r.pattern !== "string" || typeof r.kind !== "string" || !kinds.has(r.kind))
      throw new Error(`Rewrite ${i + 1} is not a rewrite`)
    return {
      pattern: normalizeName(r.pattern),
      kind: r.kind as DNSRewrite["kind"],
      addresses: Array.isArray(r.addresses) ? r.addresses.map(String) : undefined,
      target: typeof r.target === "string" ? r.target : undefined,
      ttl: typeof r.ttl === "number" ? r.ttl : 0,
      enabled: r.enabled !== false,
    }
  })
  const limit = isObject(s) && s.ttlMode === "limit"
  return {
    name,
    settings: {
      ttlMode: limit ? "limit" : "keep",
      maxTtl: limit && isObject(s) && typeof s.maxTtl === "number" ? s.maxTtl : 0,
      allowEncrypted: isObject(s) && s.allowEncrypted === true,
      rewrites,
    },
  }
}

const rewriteKey = (r: DNSRewrite) =>
  [r.pattern, r.kind, (r.addresses ?? []).join(","), r.target ?? "", r.ttl, r.enabled].join("|")

export function sameRewrites(a: DNSRewrite[], b: DNSRewrite[]) {
  return a.length === b.length && a.every((r, i) => rewriteKey(r) === rewriteKey(b[i]!))
}

/** One lookup of a name: the A, AAAA and HTTPS queries an app sends for it at once. */
export type Lookup = { key: string; name: string; at: number; queries: DNSQuery[] }

export function groupLookups(queries: DNSQuery[], window = 2000): Lookup[] {
  const out: Lookup[] = []
  const open = new Map<string, Lookup>()
  for (const q of queries) {
    const at = Date.parse(q.at)
    const g = open.get(q.name)
    if (g && Math.abs(at - g.at) <= window && !g.queries.some((x) => x.type === q.type)) {
      g.queries.push(q)
      g.at = Math.min(g.at, at)
      continue
    }
    const n = { key: `${q.id}@${q.at}`, name: q.name, at, queries: [q] }
    out.push(n)
    open.set(q.name, n)
  }
  return out
}

export type Tone = "rewrite" | "error" | "warn" | "muted"

/** What stands out about a lookup; an ordinary answer has no badges. */
export function lookupBadges(l: Lookup): { label: string; tone: Tone; title: string }[] {
  const out: { label: string; tone: Tone; title: string }[] = []
  const blocked = l.queries.some((q) => q.result === "blocked")
  if (blocked)
    out.push({
      label: "DoH blocked",
      tone: "warn",
      title: "An encrypted DNS server: its name doesn't resolve, so apps fall back to the device's DNS",
    })
  const rule = l.queries.find((q) => q.rule && q.result === "rewritten")?.rule
  if (rule) out.push({ label: "rewrite", tone: "rewrite", title: `Answered by the rewrite ${rule}` })
  const failed = l.queries.find((q) => q.result === "failed")
  if (failed)
    out.push({ label: failed.rcode || "failed", tone: "error", title: failed.error ?? "The upstream didn't answer" })
  if (blocked) return out
  if (l.queries.some((q) => q.rcode === "NXDOMAIN"))
    out.push({ label: "NXDOMAIN", tone: "warn", title: "The name doesn't exist" })
  else if (!failed && l.queries.every((q) => q.answers.length === 0))
    out.push({ label: "no records", tone: "muted", title: "The name exists but has no records of these types" })
  return out
}

const answers = (l: Lookup) => l.queries.flatMap((q) => q.answers)

/** The addresses a lookup found, else where it points, else what its HTTPS record offers. */
export function lookupAnswer(l: Lookup): { text: string; more: number } {
  const all = answers(l)
  const addrs = [...new Set(all.filter((a) => a.type === "A" || a.type === "AAAA").map((a) => a.data))]
  if (addrs.length > 0) return { text: addrs[0]!, more: addrs.length - 1 }
  const cname = all.findLast((a) => a.type === "CNAME")
  if (cname) return { text: `→ ${cname.data}`, more: 0 }
  const https = all.find((a) => a.type === "HTTPS" || a.type === "SVCB")
  if (https) return { text: describeSVCB(https.data), more: 0 }
  return { text: all[0]?.data ?? "", more: 0 }
}

/** `1 . alpn=h3,h2 ipv4hint=…` as `h3, h2`; an alias form as where it points. */
export function describeSVCB(data: string) {
  const [priority, target, ...params] = data.split(" ")
  if (priority === "0") return `alias → ${target}`
  const alpn = params
    .find((p) => p.startsWith("alpn="))
    ?.slice(5)
    .split(",")
    .join(", ")
  const via = target && target !== "." ? `via ${target}` : ""
  return [alpn ? `alpn ${alpn}` : "", via].filter(Boolean).join(" · ") || "service binding"
}

/** Seconds as the coarsest unit that still says it: 42s, 5m, 6h, 2d. */
export function formatTTL(s: number) {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86_400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86_400)}d`
}

/** The shortest TTL of a lookup's addresses (or of all its records), as served and as the upstream sent it. */
export function lookupTTL(l: Lookup): { served: number; original: number } | undefined {
  const all = answers(l)
  const addrs = all.filter((a) => a.type === "A" || a.type === "AAAA")
  const pick = addrs.length > 0 ? addrs : all
  if (pick.length === 0) return undefined
  return { served: Math.min(...pick.map((a) => a.ttl)), original: Math.min(...pick.map((a) => a.originalTtl)) }
}

export function lookupMatches(
  l: Lookup,
  text: string,
  filter: "all" | "rewritten" | "blocked" | "failed" | "nxdomain",
) {
  const byText = !text || l.name.includes(text) || answers(l).some((a) => a.data.includes(text))
  const byResult =
    filter === "all" ||
    (filter === "rewritten" && l.queries.some((q) => q.result === "rewritten")) ||
    (filter === "failed" && l.queries.some((q) => q.result === "failed")) ||
    (filter === "blocked" && l.queries.some((q) => q.result === "blocked")) ||
    (filter === "nxdomain" && l.queries.some((q) => q.rcode === "NXDOMAIN"))
  return byText && byResult
}
