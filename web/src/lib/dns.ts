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
      rewrites,
    },
  }
}

const rewriteKey = (r: DNSRewrite) =>
  [r.pattern, r.kind, (r.addresses ?? []).join(","), r.target ?? "", r.ttl, r.enabled].join("|")

export function sameRewrites(a: DNSRewrite[], b: DNSRewrite[]) {
  return a.length === b.length && a.every((r, i) => rewriteKey(r) === rewriteKey(b[i]!))
}

export function firstAnswer(q: DNSQuery) {
  const a = q.answers.find((x) => x.type === "A") ?? q.answers[0]
  return a ? `${a.type === "A" ? "" : `${a.type} `}${a.data}` : ""
}

export function ttlLabel(q: DNSQuery) {
  if (q.answers.length === 0) return ""
  const served = Math.min(...q.answers.map((a) => a.ttl))
  const original = Math.min(...q.answers.map((a) => a.originalTtl))
  return served === original ? `${served}s` : `${served}s (${original}s)`
}
