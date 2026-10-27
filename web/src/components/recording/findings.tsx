import { CircleAlertIcon, InfoIcon, type LucideIcon, TriangleAlertIcon } from "lucide-react"
import { Fragment, type ReactNode, useState } from "react"
import { Chip, Empty } from "@/components/recording/devtools-view"
import { formatBytes } from "@/lib/format"
import type { Severity } from "@/lib/recording/images"
import { cn } from "@/lib/utils"

export const severityInfo: Record<Severity, { icon: LucideIcon; tone: string; label: string }> = {
  error: { icon: CircleAlertIcon, tone: "text-stage-error", label: "Errors" },
  warning: { icon: TriangleAlertIcon, tone: "text-stage-amber", label: "Warnings" },
  info: { icon: InfoIcon, tone: "text-stage-outline", label: "Hints" },
}

/** Text with `code` spans. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 ? (
          <code key={i} className="rounded bg-stage-surface-high px-1 font-mono text-[0.92em]">
            {part}
          </code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

export function Stat({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-stage-surface-container px-3 py-1.5" title={title}>
      <div className="text-[11px] text-stage-outline">{label}</div>
      <div className="truncate text-sm font-medium text-stage-on-surface tabular-nums">{value}</div>
    </div>
  )
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1.5 px-4 pb-2">{children}</div>
}

export type FindingRow = {
  id: string
  severity: Severity
  title: string
  saving?: number
  savingTitle?: string
  count?: number
  countTitle?: string
}

/** Findings by severity with a filter, the picked one highlighted. */
export function FindingList({
  findings,
  picked,
  onPick,
  empty,
}: {
  findings: FindingRow[]
  picked?: string
  onPick: (id: string | undefined) => void
  empty: ReactNode
}) {
  const [level, setLevel] = useState<Severity | "all">("all")
  const rows = findings.filter((f) => level === "all" || f.severity === level)
  return (
    <>
      <div className="flex gap-0.5 overflow-x-auto px-3 pb-2">
        <Chip active={level === "all"} onClick={() => setLevel("all")}>
          All {findings.length || ""}
        </Chip>
        {(["error", "warning", "info"] as const).map((v) => {
          const count = findings.filter((f) => f.severity === v).length
          return count ? (
            <Chip key={v} active={level === v} onClick={() => setLevel(v)}>
              {severityInfo[v].label} {count}
            </Chip>
          ) : null
        })}
      </div>
      <div className="min-h-0 flex-[1_1_42%] overflow-auto px-2 pb-2 text-[12.5px] leading-[1.45]">
        {rows.length === 0 ? (
          <Empty>{empty}</Empty>
        ) : (
          rows.map((f) => {
            const info = severityInfo[f.severity]
            return (
              <div
                key={f.id}
                role="button"
                tabIndex={0}
                onClick={() => onPick(f.id === picked ? undefined : f.id)}
                onKeyDown={(e) => e.key === "Enter" && onPick(f.id)}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1 hover:bg-stage-surface-container",
                  f.id === picked && "bg-stage-secondary-container/70 hover:bg-stage-secondary-container",
                )}
              >
                <info.icon className={cn("mt-0.5 size-3.5 shrink-0", info.tone)} aria-label={f.severity} />
                <span className="min-w-0 flex-1 text-stage-on-surface">
                  <Rich text={f.title} />
                </span>
                {f.saving ? (
                  <span className="shrink-0 text-xs text-stage-outline tabular-nums" title={f.savingTitle}>
                    {formatBytes(f.saving)}
                  </span>
                ) : null}
                {f.count !== undefined && (
                  <span
                    className="w-8 shrink-0 text-right text-xs text-stage-outline tabular-nums"
                    title={f.countTitle}
                  >
                    ×{f.count}
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>
    </>
  )
}

export function FindingTitle({ severity, title }: { severity: Severity; title: string }) {
  const info = severityInfo[severity]
  return (
    <div className="flex items-start gap-2 text-sm font-medium text-stage-on-surface">
      <info.icon className={cn("mt-0.5 size-4 shrink-0", info.tone)} />
      <span className="min-w-0">
        <Rich text={title} />
      </span>
    </div>
  )
}

export const percent = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–")
