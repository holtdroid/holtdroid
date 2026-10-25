import {
  BatteryChargingIcon,
  BatteryFullIcon,
  BatteryLowIcon,
  BatteryMediumIcon,
  MoonIcon,
  PlaneIcon,
  SmartphoneIcon,
  WifiIcon,
  ZapIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { AppIcon } from "@/components/app-icon"
import { series } from "@/lib/recording/android"
import type { Block, Row, Summary, Tile, Tone } from "@/lib/recording/summary"
import { cn } from "@/lib/utils"

const tones: Record<Tone, string> = { warn: "text-[#f2c162]", bad: "text-[#ffb4ab]" }

const tileIcons: Record<Tile["id"], ReactNode> = {
  wifi: <WifiIcon />,
  mobile: <SmartphoneIcon />,
  airplane: <PlaneIcon />,
  saver: <ZapIcon />,
  dark: <MoonIcon />,
}

function Card({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-[24px] bg-[#1c211e] px-4 py-3", className)}>
      {title && <h2 className="mb-1.5 text-xs font-medium tracking-wide text-[#c0c9c1]">{title}</h2>}
      {children}
    </section>
  )
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid gap-1 text-[13px] leading-snug">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-[#8a938c]">{r.label}</dt>
          <dd className={cn("min-w-0 text-right break-words text-[#e0e3de]", r.tone && tones[r.tone])}>{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function BatteryGlyph({ level, charging }: { level: number; charging: boolean }) {
  const Icon = charging
    ? BatteryChargingIcon
    : level > 70
      ? BatteryFullIcon
      : level > 25
        ? BatteryMediumIcon
        : BatteryLowIcon
  return <Icon className="size-4" />
}

function Meter({ block: b }: { block: Block }) {
  const color = b.tone === "bad" ? series.error : series[b.series]
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-3 text-[13px] leading-snug">
        <span className="shrink-0 text-[#8a938c]">{b.label}</span>
        <span className={cn("min-w-0 text-right break-words text-[#e0e3de]", b.tone && tones[b.tone])}>{b.value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#313633]">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${Math.min(1, Math.max(0, b.fraction)) * 100}%`, background: color }}
        />
      </div>
    </div>
  )
}

export function InfoView({ summary: s, iconUrl }: { summary: Summary; iconUrl?: string }) {
  return (
    <div className="grid content-start gap-2">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[38px] leading-none font-light tracking-tight tabular-nums">{s.clock.time}</div>
            <div className="mt-1.5 truncate text-[13px] text-[#c0c9c1]" title={`${s.clock.date} · ${s.clock.zone}`}>
              {s.clock.date}
              {s.clock.zone ? ` · ${s.clock.zone}` : ""}
            </div>
            {s.clock.offset && (
              <div className={cn("text-[13px]", s.clock.offsetTone && tones[s.clock.offsetTone])}>
                Clock {s.clock.offset}
              </div>
            )}
          </div>
          {s.battery && (
            <div
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[13px]",
                s.battery.saver ? "bg-[#4a3a0a] text-[#f2c162]" : "bg-[#262b28] text-[#c0c9c1]",
              )}
              title={s.battery.saver ? "Battery Saver is on" : undefined}
            >
              <BatteryGlyph level={s.battery.level} charging={s.battery.charging} />
              {s.battery.level}%
            </div>
          )}
        </div>
        <div className="mt-2 truncate border-t border-[#404943]/60 pt-2 text-xs text-[#8a938c]" title={s.realTime}>
          Real time {s.realTime}
        </div>
      </Card>

      <Card className="py-2.5">
        <div className="flex items-center gap-2.5">
          <AppIcon src={iconUrl} className="size-10 rounded-xl bg-[#262b28] text-[#8a938c]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium" title={s.app.title}>
              {s.app.title}
            </div>
            <div
              className="truncate font-mono text-[11px] text-[#8a938c]"
              title={`${s.app.subtitle}${s.app.version ? ` · ${s.app.version}` : ""}`}
            >
              {s.app.subtitle}
              {s.app.version ? ` · ${s.app.version}` : ""}
            </div>
          </div>
          {s.app.state && (
            <span
              className={cn(
                "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
                s.app.running ? "bg-[#0a5230] text-[#94f7b5]" : "bg-[#313633] text-[#c0c9c1]",
              )}
            >
              {s.app.state}
            </span>
          )}
        </div>
      </Card>

      {s.tiles.length > 0 && (
        <div className="grid grid-cols-5 gap-1.5">
          {s.tiles.map((t) => (
            <div
              key={t.id}
              title={t.label}
              className={cn(
                "flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-[18px] px-0.5 py-1.5 text-xs leading-tight font-medium [&_svg]:size-5 [&_svg]:shrink-0",
                t.on
                  ? t.tone === "warn"
                    ? "bg-[#4a3a0a] text-[#f2c162]"
                    : "bg-[#0a5230] text-[#94f7b5]"
                  : "bg-[#262b28] text-[#8a938c]",
              )}
            >
              {tileIcons[t.id]}
              <span className="w-full truncate text-center">{t.label}</span>
            </div>
          ))}
        </div>
      )}

      <Card title="Device">
        <Rows rows={s.device} />
        <h2 className="mt-2 mb-1.5 border-t border-[#404943]/60 pt-2 text-xs font-medium tracking-wide text-[#c0c9c1]">
          Network
        </h2>
        <Rows rows={s.network} />
      </Card>

      <Card title="Resources">
        <div className="grid gap-2">
          {s.resources.map((b) => (
            <Meter key={b.label} block={b} />
          ))}
        </div>
        {s.temperature && (
          <div className="mt-2 border-t border-[#404943]/60 pt-2">
            <Rows rows={[s.temperature]} />
          </div>
        )}
      </Card>
    </div>
  )
}
