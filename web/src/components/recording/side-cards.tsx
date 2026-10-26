import {
  ActivityIcon,
  BatteryChargingIcon,
  BatteryFullIcon,
  BatteryLowIcon,
  BatteryMediumIcon,
  ClockIcon,
  GlobeIcon,
  type LucideIcon,
  SmartphoneIcon,
  ThermometerIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { AppIcon } from "@/components/app-icon"
import { CardLine, ShadeCard, ShadePanel, ShadeRoot } from "@/components/session/shade"
import { HoverCardTrigger } from "@/components/ui/hover-card"
import { series } from "@/lib/recording/android"
import type { Block, Row, Summary, Tone } from "@/lib/recording/summary"
import { cn } from "@/lib/utils"

const tones: Record<Tone, string> = { warn: "text-amber-300", bad: "text-red-300" }

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid gap-1.5 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-4">
          <dt className="shrink-0 text-neutral-400">{r.label}</dt>
          <dd className={cn("min-w-0 text-right break-words", r.tone && tones[r.tone])}>{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Panel({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <>
      <h3 className="flex items-center gap-2 text-sm font-medium text-neutral-300">
        <Icon className="size-4" />
        {title}
      </h3>
      {children}
    </>
  )
}

function Meter({ block: b }: { block: Block }) {
  const color = b.tone === "bad" ? series.error : series[b.series]
  const top = Math.max(b.max, ...b.values) || 1
  const points = b.values.map((v, i) => `${(i / Math.max(1, b.values.length - 1)) * 100},${29 - (v / top) * 27}`)
  return (
    <div className="grid gap-1.5 rounded-3xl bg-neutral-800 px-4 py-3">
      <span className="flex items-baseline justify-between gap-2 text-xs text-neutral-400">
        {b.label}
        <span className={cn("text-sm font-medium text-neutral-100 tabular-nums", b.tone && tones[b.tone])}>
          {b.value}
        </span>
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-neutral-700">
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.min(100, b.fraction * 100)}%`, background: color }}
        />
      </span>
      {points.length > 1 && (
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-7 w-full" aria-hidden>
          <polyline
            points={points.join(" ")}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </div>
  )
}

function Battery({ level, charging }: { level: number; charging: boolean }) {
  const Icon = charging
    ? BatteryChargingIcon
    : level > 70
      ? BatteryFullIcon
      : level > 25
        ? BatteryMediumIcon
        : BatteryLowIcon
  return <Icon className="size-3.5 shrink-0" />
}

/**
 * The recording's state at the playhead as the session page's cards: small
 * dark tiles beside the phone, each opening its details on hover.
 */
export function SideCards({
  summary: s,
  iconUrl,
  className,
}: {
  summary: Summary
  iconUrl?: string
  className?: string
}) {
  const cpu = s.resources.find((b) => b.label === "Device CPU") ?? s.resources[0]
  const memory = s.resources.find((b) => b.label.includes("memory") || b.label.includes("Memory"))
  return (
    <div className={cn("flex gap-2.5 lg:flex-col", className)}>
      <ShadeRoot>
        <HoverCardTrigger asChild>
          <ShadeCard aria-label="Time" changed={!!s.clock.offset}>
            <span className="text-2xl leading-none font-medium tabular-nums">{s.clock.time}</span>
            <span className="truncate text-xs text-neutral-300">{s.clock.date}</span>
            <CardLine icon={ClockIcon}>
              {s.elapsed.now} / {s.elapsed.total}
            </CardLine>
          </ShadeCard>
        </HoverCardTrigger>
        <ShadePanel>
          <Panel title="Time" icon={ClockIcon}>
            <Rows
              rows={[
                { label: "Device clock", value: `${s.clock.time} · ${s.clock.date}` },
                ...(s.clock.zone ? [{ label: "Time zone", value: s.clock.zone }] : []),
                { label: "Offset", value: s.clock.offset ?? "in sync with real time", tone: s.clock.offsetTone },
                { label: "Real time", value: s.realTime },
                { label: "Recording", value: `${s.elapsed.now} of ${s.elapsed.total}` },
              ]}
            />
          </Panel>
        </ShadePanel>
      </ShadeRoot>

      <ShadeRoot>
        <HoverCardTrigger asChild>
          <ShadeCard aria-label="App" changed={!s.app.running && !!s.app.state}>
            <span className="flex min-w-0 items-center gap-2">
              <AppIcon src={iconUrl} className="size-6 shrink-0" />
              <span className="truncate text-sm font-medium">{s.app.title}</span>
            </span>
            {s.app.version && <span className="truncate font-mono text-[11px] text-neutral-400">{s.app.version}</span>}
            <span className={cn("text-xs", s.app.running ? "text-emerald-300" : "text-amber-300")}>
              {s.app.state || "—"}
            </span>
          </ShadeCard>
        </HoverCardTrigger>
        <ShadePanel>
          <Panel title="App" icon={SmartphoneIcon}>
            <Rows
              rows={[
                { label: "Name", value: s.app.title },
                { label: "Package", value: s.app.subtitle },
                ...(s.app.version ? [{ label: "Version", value: s.app.version }] : []),
                { label: "State", value: s.app.state || "—", tone: s.app.running ? undefined : ("warn" as const) },
              ]}
            />
          </Panel>
        </ShadePanel>
      </ShadeRoot>

      <ShadeRoot>
        <HoverCardTrigger asChild>
          <ShadeCard aria-label="Device">
            <span className="truncate text-sm font-medium">{s.device[0]?.value ?? "Device"}</span>
            <span className="truncate text-xs text-neutral-300">Android {s.device[1]?.value ?? "—"}</span>
            {s.battery && (
              <span className="flex items-center gap-1.5 text-xs text-neutral-300">
                <Battery level={s.battery.level} charging={s.battery.charging} />
                {s.battery.level}%{s.battery.saver ? " · saver" : ""}
              </span>
            )}
          </ShadeCard>
        </HoverCardTrigger>
        <ShadePanel>
          <Panel title="Device" icon={SmartphoneIcon}>
            <Rows rows={s.device} />
            {s.tiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {s.tiles.map((t) => (
                  <span
                    key={t.id}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs",
                      t.on ? "bg-sky-300 text-neutral-900" : "bg-neutral-800 text-neutral-400",
                    )}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            )}
          </Panel>
        </ShadePanel>
      </ShadeRoot>

      <ShadeRoot>
        <HoverCardTrigger asChild>
          <ShadeCard aria-label="Network" changed={s.network.some((r) => r.tone)}>
            <span className="truncate text-sm font-medium">{s.network[0]?.value ?? "—"}</span>
            {s.network
              .slice(1)
              .filter((r) => r.label !== "Traffic")
              .map((r) => (
                <span key={r.label} className={cn("truncate text-xs text-neutral-300", r.tone && tones[r.tone])}>
                  {r.value}
                </span>
              ))}
            {s.network.find((r) => r.label === "Traffic") && (
              <CardLine icon={GlobeIcon}>{s.network.find((r) => r.label === "Traffic")!.value}</CardLine>
            )}
          </ShadeCard>
        </HoverCardTrigger>
        <ShadePanel>
          <Panel title="Network" icon={GlobeIcon}>
            <Rows rows={s.network} />
          </Panel>
        </ShadePanel>
      </ShadeRoot>

      {s.resources.length > 0 && (
        <ShadeRoot>
          <HoverCardTrigger asChild>
            <ShadeCard aria-label="Load" changed={s.resources.some((b) => b.tone === "bad")}>
              {[cpu, memory].filter(Boolean).map((b) => (
                <span key={b!.label} className="grid gap-1">
                  <span className="flex justify-between gap-2 text-xs text-neutral-300">
                    <span className="truncate">{b!.label}</span>
                    <span className="tabular-nums">{b!.value}</span>
                  </span>
                  <span className="h-1 overflow-hidden rounded-full bg-neutral-700">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${Math.min(100, b!.fraction * 100)}%`, background: series[b!.series] }}
                    />
                  </span>
                </span>
              ))}
              {s.temperature && <CardLine icon={ThermometerIcon}>{s.temperature.value}</CardLine>}
            </ShadeCard>
          </HoverCardTrigger>
          <ShadePanel>
            <Panel title="Load" icon={ActivityIcon}>
              <div className="grid gap-2">
                {s.resources.map((b) => (
                  <Meter key={b.label} block={b} />
                ))}
              </div>
              {s.temperature && <Rows rows={[s.temperature]} />}
            </Panel>
          </ShadePanel>
        </ShadeRoot>
      )}
    </div>
  )
}
