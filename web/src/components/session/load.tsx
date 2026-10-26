import type { LucideIcon } from "lucide-react"
import type { Metrics } from "@/api/client"
import { historySize } from "@/components/session/metrics"
import { InfoList } from "@/components/session/shade"
import { formatBytes } from "@/lib/format"
import { type Level, level } from "@/lib/thermal"
import { cn } from "@/lib/utils"

const tone: Record<Level, { text: string; fill: string; line: string }> = {
  ok: { text: "text-neutral-100", fill: "bg-sky-300", line: "stroke-sky-300 fill-sky-300/15" },
  warn: { text: "text-amber-300", fill: "bg-amber-400", line: "stroke-amber-400 fill-amber-400/15" },
  crit: { text: "text-red-300", fill: "bg-red-400", line: "stroke-red-400 fill-red-400/15" },
}

export function percent(v: number) {
  return `${Math.round(v)}%`
}

export function bytesPair(used: number, total: number) {
  const gib = 1024 ** 3
  if (total >= gib) return `${(used / gib).toFixed(1)} of ${(total / gib).toFixed(1)} GB`
  return `${Math.round(used / 1024 ** 2)} of ${Math.round(total / 1024 ** 2)} MB`
}

export function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0)
}

export function cpuLevel(v: number) {
  return level(v, 70, 90)
}

export function processLabel(name: string) {
  if (name.includes(":sandboxed_process")) return "WebView renderer"
  const i = name.indexOf(":")
  return i < 0 ? "Main process" : name.slice(i)
}

export function MetricTile({
  icon: Icon,
  label,
  value,
  detail,
  level: l = "ok",
  ratio,
  history,
  max,
  wide = false,
}: {
  icon: LucideIcon
  label: string
  value: string
  detail?: string
  level?: Level
  ratio?: number
  history?: number[]
  max?: number
  wide?: boolean
}) {
  const t = tone[l]
  return (
    <div className={cn("grid gap-1.5 rounded-3xl bg-neutral-800 px-4 py-3", wide && "col-span-2")}>
      <span className="flex items-center gap-1.5 text-xs text-neutral-400">
        <Icon className="size-3.5" />
        {label}
      </span>
      <span className={cn("text-lg leading-none font-medium tabular-nums", t.text)}>{value}</span>
      {detail && <span className="truncate text-xs text-neutral-400 tabular-nums">{detail}</span>}
      {ratio !== undefined && (
        <span className="h-1.5 overflow-hidden rounded-full bg-neutral-700">
          <span
            className={cn("block h-full rounded-full transition-[width]", t.fill)}
            style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
          />
        </span>
      )}
      {history && history.length > 1 && <Spark values={history} max={max} className={t.line} />}
    </div>
  )
}

function Spark({ values, max, className }: { values: number[]; max?: number; className: string }) {
  const top = Math.max(max ?? 0, ...values) || 1
  const step = 100 / (historySize - 1)
  const x0 = 100 - (values.length - 1) * step
  const points = values.map((v, i) => `${(x0 + i * step).toFixed(1)},${(29 - (v / top) * 27).toFixed(1)}`)
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={cn("h-8 w-full", className)} aria-hidden>
      <polygon points={`${x0},30 ${points.join(" ")} 100,30`} strokeWidth={0} />
      <polyline
        points={points.join(" ")}
        fill="none"
        vectorEffect="non-scaling-stroke"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ProcessList({ m }: { m: Metrics }) {
  const processes = m.app?.processes ?? []
  if (processes.length === 0) return null
  return (
    <InfoList
      items={processes.map((p) => [processLabel(p.name), `${percent(p.cpu)} · ${formatBytes(p.memory)}`, p.pid])}
    />
  )
}
