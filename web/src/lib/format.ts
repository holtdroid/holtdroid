export function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`
  return `${s}s`
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })

export function formatRelative(date: string | number | Date, now = Date.now()) {
  const diff = new Date(date).getTime() - now
  const abs = Math.abs(diff)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ]
  for (const [unit, size] of units) {
    if (abs >= size) return relative.format(Math.round(diff / size), unit)
  }
  return "just now"
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

export function countryFlag(code: string | undefined) {
  if (!code || !/^[a-z]{2}$/i.test(code)) return ""
  const upper = code.toUpperCase()
  return String.fromCodePoint(0x1f1e6 + upper.charCodeAt(0) - 65, 0x1f1e6 + upper.charCodeAt(1) - 65)
}

export function formatClockOffset(ms: number) {
  const abs = Math.abs(ms)
  if (abs < 1500) return "in sync with real time"
  const units: [string, number][] = [
    ["y", 365 * 86_400_000],
    ["d", 86_400_000],
    ["h", 3_600_000],
    ["min", 60_000],
    ["s", 1000],
  ]
  let rest = Math.round(abs / 1000) * 1000
  const parts: string[] = []
  for (const [unit, size] of units) {
    const n = Math.floor(rest / size)
    if (n > 0 && parts.length < 2) {
      parts.push(`${n} ${unit}`)
      rest -= n * size
    }
  }
  return `${parts.join(" ")} ${ms > 0 ? "ahead" : "behind"}`
}

export function browserTimeZone() {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function safeLink(raw: string | undefined) {
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return (url.protocol === "https:" || url.protocol === "http:") && url.host && !url.username ? url : undefined
  } catch {
    return undefined
  }
}
