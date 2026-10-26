import {
  ActivityIcon,
  BatteryChargingIcon,
  BatteryFullIcon,
  BatteryLowIcon,
  BatteryMediumIcon,
  ClockIcon,
  CpuIcon,
  GlobeIcon,
  type LucideIcon,
  MemoryStickIcon,
  ServerIcon,
  SmartphoneIcon,
  ThermometerIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { AppIcon } from "@/components/app-icon"
import { MetricTile } from "@/components/session/load"
import { CardLine, ShadeCard, ShadePanel, ShadeRoot } from "@/components/session/shade"
import { HoverCardTrigger } from "@/components/ui/hover-card"
import { series } from "@/lib/recording/android"
import type { Block, Row, Summary, Tone } from "@/lib/recording/summary"
import { cn } from "@/lib/utils"

export const cardWidth = 200

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

const blockIcons: Record<Block["icon"], LucideIcon> = {
  cpu: CpuIcon,
  memory: MemoryStickIcon,
  app: SmartphoneIcon,
  frames: ActivityIcon,
  container: ServerIcon,
  temperature: ThermometerIcon,
}

function Tile({ block: b }: { block: Block }) {
  return (
    <MetricTile
      icon={blockIcons[b.icon]}
      label={b.label}
      value={b.value}
      detail={b.detail}
      level={b.tone === "bad" ? "crit" : b.tone === "warn" ? "warn" : "ok"}
      ratio={b.chart === "bar" ? b.fraction : undefined}
      history={b.chart === "spark" ? b.values : undefined}
      max={b.max}
      wide={b.wide}
    />
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
  const cpu = s.resources.find((b) => b.icon === "cpu") ?? s.resources[0]
  const temperature = s.resources.find((b) => b.icon === "temperature")
  const memory = s.resources.find((b) => b.icon === "memory")
  return (
    <div className={cn("flex gap-2.5 lg:flex-col", className)}>
      <ShadeRoot>
        <HoverCardTrigger asChild>
          <ShadeCard style={{ width: cardWidth }} aria-label="Time" changed={!!s.clock.offset}>
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
          <ShadeCard style={{ width: cardWidth }} aria-label="App" changed={!s.app.running && !!s.app.state}>
            <span className="flex min-w-0 items-center gap-2">
              <AppIcon src={iconUrl} className="size-6 shrink-0" />
              <span className="truncate text-sm font-medium">{s.app.title}</span>
            </span>
            {s.app.version && <span className="truncate font-mono text-[11px] text-neutral-400">{s.app.version}</span>}
            {s.app.state && (
              <span className={cn("text-xs", s.app.running ? "text-emerald-300" : "text-amber-300")}>
                {s.app.state}
              </span>
            )}
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
          <ShadeCard style={{ width: cardWidth }} aria-label="Device">
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
          <ShadeCard style={{ width: cardWidth }} aria-label="Network" changed={s.network.some((r) => r.tone)}>
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
            <ShadeCard
              style={{ width: cardWidth }}
              aria-label="Load"
              changed={s.resources.some((b) => b.tone === "bad")}
            >
              {[cpu, memory].filter(Boolean).map((b) => (
                <span key={b!.label} className="grid gap-1">
                  <span className="flex items-baseline justify-between gap-2 text-xs text-neutral-300">
                    <span className="min-w-0 truncate">{b!.label}</span>
                    <span className="shrink-0 whitespace-nowrap tabular-nums">{b!.value}</span>
                  </span>
                  <span className="h-1 overflow-hidden rounded-full bg-neutral-700">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${Math.min(100, b!.fraction * 100)}%`, background: series[b!.series] }}
                    />
                  </span>
                </span>
              ))}
              {temperature && (
                <CardLine icon={ThermometerIcon}>
                  {temperature.value} {temperature.detail?.split(" · ")[0]}
                </CardLine>
              )}
            </ShadeCard>
          </HoverCardTrigger>
          <ShadePanel>
            <Panel title="Load" icon={ActivityIcon}>
              <div className="grid grid-cols-2 gap-2">
                {s.resources.map((b) => (
                  <Tile key={b.icon + b.label} block={b} />
                ))}
              </div>
            </Panel>
          </ShadePanel>
        </ShadeRoot>
      )}
    </div>
  )
}
