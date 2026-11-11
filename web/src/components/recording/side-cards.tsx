import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import type { Row, Summary, Tone } from "@/lib/recording/summary"
import { cn } from "@/lib/utils"

const tones: Record<Tone, string> = { warn: "text-warning", bad: "text-danger" }

function Card({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-3 rounded-2xl border bg-card p-4">
      <h3 className="text-xs font-semibold tracking-[.06em] text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}

function Pairs({ rows }: { rows: { label: string; value: ReactNode; tone?: Tone; mono?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-y-2 text-[13px]">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className={cn("min-w-0 break-words", r.mono && "font-mono text-xs leading-5", r.tone && tones[r.tone])}>
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

const mono = (rows: Row[], labels: string[]) => rows.map((r) => ({ ...r, mono: labels.includes(r.label) }))

/** The recording's state at the playhead: the moment, the network, the device and the load, as plain cards. */
export function SideCards({
  summary: s,
  screen,
  traffic,
  className,
}: {
  summary: Summary
  /** what the screen showed at the playhead: Portrait, Off, … */
  screen?: string
  /** device traffic per sample over the last minute, oldest first */
  traffic: { t: number; v: number }[]
  className?: string
}) {
  const bars = traffic.slice(-30)
  const top = Math.max(1, ...bars.map((b) => b.v))
  const on = s.tiles.filter((t) => t.on)
  return (
    <div className={cn("grid content-start gap-3", className)}>
      <Card title={`At ${s.elapsed.now}`}>
        <Pairs
          rows={[
            { label: "Real time", value: s.realTime },
            {
              label: "Device clock",
              value: (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {s.clock.time} · {s.clock.date}
                  {s.clock.offset && <Badge variant="warning">{s.clock.offset}</Badge>}
                </span>
              ),
            },
            ...(s.clock.zone ? [{ label: "Time zone", value: s.clock.zone }] : []),
            ...(screen ? [{ label: "Screen", value: screen }] : []),
            ...(s.app.state
              ? [
                  {
                    label: "App",
                    value: (
                      <Badge variant={s.app.running ? "success" : s.app.state === "Closed" ? "warning" : "info"}>
                        {s.app.state}
                      </Badge>
                    ),
                  },
                ]
              : []),
            ...(s.battery
              ? [
                  {
                    label: "Battery",
                    value: `${s.battery.level}%${s.battery.charging ? " · charging" : ""}${s.battery.saver ? " · saver" : ""}`,
                  },
                ]
              : []),
          ]}
        />
      </Card>

      <Card title="Network">
        <Pairs rows={mono(s.network, ["Traffic"])} />
        {bars.length > 1 && (
          <div className="flex h-[34px] items-end gap-0.5" aria-hidden>
            {bars.map((b, i) => (
              <span
                key={b.t}
                className={cn("flex-1 rounded-[2px]", i === bars.length - 1 ? "bg-foreground" : "bg-border")}
                style={{ height: `${Math.max(2, (b.v / top) * 34)}px` }}
              />
            ))}
          </div>
        )}
      </Card>

      <Card title="Device">
        <Pairs
          rows={[
            { label: "Package", value: s.app.subtitle, mono: true },
            ...(s.app.version ? [{ label: "Version", value: s.app.version, mono: true }] : []),
            ...mono(s.device, ["WebView", "Screen"]),
          ]}
        />
        {on.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {on.map((t) => (
              <Badge key={t.id} variant={t.tone === "warn" ? "warning" : "secondary"}>
                {t.label}
              </Badge>
            ))}
          </div>
        )}
      </Card>

      {s.resources.length > 0 && (
        <Card title="Load">
          <div className="grid gap-2.5">
            {s.resources.map((b) => (
              <div key={b.icon + b.label} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="text-muted-foreground">{b.label}</span>
                  <span className={cn("font-mono text-xs", b.tone && tones[b.tone])}>{b.value}</span>
                </div>
                {b.chart !== "none" && (
                  <span className="h-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        b.tone === "bad" ? "bg-danger" : b.tone === "warn" ? "bg-warning" : "bg-foreground/70",
                      )}
                      style={{ width: `${Math.min(100, Math.max(0, b.fraction * 100))}%` }}
                    />
                  </span>
                )}
                {b.detail && <span className="text-xs text-muted-foreground">{b.detail}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
