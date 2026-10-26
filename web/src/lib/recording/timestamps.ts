export type StampUnit = "s" | "ms" | "µs" | "ns" | "iso" | "date" | "http"

/** A point in time found in a value: milliseconds since the epoch and how it was written. */
export type Stamp = { ms: number; unit: StampUnit; zoneless?: boolean }

const earliest = Date.UTC(2000, 0, 1)
const latest = Date.UTC(2100, 0, 1)
const fiveYears = 5 * 365 * 86_400_000

const isoDate = /^\d{4}-\d{2}-\d{2}$/
const isoDateTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d{1,9})?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/i
const httpDate = /^[A-Z][a-z]{2}, \d{1,2}[ -][A-Z][a-z]{2}[ -]\d{2,4} \d{2}:\d{2}:\d{2} (?:GMT|UTC|[+-]\d{4})$/
const numeric = /^\d{9,19}(?:\.\d+)?$/
const timeWord = /time|date|stamp|expir|created|updated|modified|deadline|since|until|when/i
const timeKey = /^ts$|_ts$|^ts_|Ts$|At$|_at$|^at$|^exp$|^iat$|^nbf$|^t$/
const hinted = (key: string | undefined) => !!key && (timeWord.test(key) || timeKey.test(key))

const inRange = (ms: number) => ms >= earliest && ms < latest

function fromNumber(n: number, key: string | undefined, ref: number | undefined): Stamp | null {
  if (!Number.isFinite(n) || n <= 0) return null
  const units: [StampUnit, number][] = [
    ["s", n * 1000],
    ["ms", n],
    ["µs", n / 1000],
    ["ns", n / 1_000_000],
  ]
  for (const [unit, ms] of units) {
    if (!inRange(ms)) continue
    if (unit === "s" && !hinted(key) && !(ref !== undefined && Math.abs(ms - ref) < fiveYears)) return null
    return { ms, unit }
  }
  return null
}

/**
 * Finds a point in time in a JSON value: Unix seconds, milliseconds,
 * microseconds or nanoseconds between 2000 and 2100 (seconds only when the key
 * says it is a time or it lies within five years of ref), ISO 8601 and HTTP
 * dates. ref is the device clock at that moment.
 */
export function detectStamp(value: unknown, key?: string, ref?: number): Stamp | null {
  if (typeof value === "number") return fromNumber(value, key, ref)
  if (typeof value !== "string") return null
  const s = value.trim()
  if (s.length < 9 || s.length > 40) return null
  if (numeric.test(s)) return fromNumber(Number(s), key, ref)
  if (isoDate.test(s)) {
    const ms = Date.parse(`${s}T00:00:00Z`)
    return inRange(ms) ? { ms, unit: "date" } : null
  }
  const iso = isoDateTime.exec(s)
  if (iso) {
    const ms = Date.parse(
      s
        .replace(" ", "T")
        .replace(",", ".")
        .replace(/(\.\d{3})\d+/, "$1") + (iso[1] ? "" : "Z"),
    )
    return inRange(ms) ? { ms, unit: "iso", ...(iso[1] ? {} : { zoneless: true }) } : null
  }
  if (httpDate.test(s)) {
    const ms = Date.parse(s)
    return Number.isFinite(ms) && inRange(ms) ? { ms, unit: "http" } : null
  }
  return null
}

export const unitNames: Record<StampUnit, string> = {
  s: "Unix time, seconds",
  ms: "Unix time, milliseconds",
  µs: "Unix time, microseconds",
  ns: "Unix time, nanoseconds",
  iso: "ISO 8601",
  date: "ISO 8601 date",
  http: "HTTP date",
}

const spans: [string, number][] = [
  ["y", 365 * 86_400_000],
  ["d", 86_400_000],
  ["h", 3_600_000],
  ["min", 60_000],
  ["s", 1000],
]

/** A span as its two largest units: "3 h 12 min", "4.2 s", "180 ms". */
export function formatSpan(ms: number) {
  const abs = Math.abs(ms)
  if (abs < 1000) return `${Math.round(abs)} ms`
  if (abs < 60_000) return `${(abs / 1000).toFixed(abs < 10_000 ? 1 : 0)} s`
  let rest = Math.round(abs / 1000) * 1000
  const parts: string[] = []
  for (const [unit, size] of spans) {
    const n = Math.floor(rest / size)
    if (n > 0 && parts.length < 2) {
      parts.push(`${n} ${unit}`)
      rest -= n * size
    } else if (parts.length > 0) {
      break
    }
  }
  return parts.join(" ")
}

/** How a stamp stands against the clock it is compared with: "3.2 s ago", "in 1 h", "now". */
export function relative(ms: number, now: number) {
  const d = ms - now
  if (Math.abs(d) < 1000) return "now"
  return d < 0 ? `${formatSpan(d)} ago` : `in ${formatSpan(d)}`
}

function knownZone(zone: string) {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone !== ""
  } catch {
    return false
  }
}

/** The same moment written every way the hint shows. */
export function stampFormats(ms: number, zone?: string) {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone
  const fmt = (timeZone: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      timeZoneName: "short",
      hour12: false,
    }).format(ms)
  const out: { label: string; value: string }[] = [{ label: "UTC", value: new Date(ms).toISOString() }]
  if (zone && zone !== "UTC" && zone !== "Etc/UTC" && knownZone(zone))
    out.push({ label: "Device zone", value: fmt(zone) })
  if (local !== zone && local !== "UTC") out.push({ label: "Your zone", value: fmt(local) })
  out.push({ label: "Unix seconds", value: String(Math.floor(ms / 1000)) })
  out.push({ label: "Unix milliseconds", value: String(Math.round(ms)) })
  return out
}
