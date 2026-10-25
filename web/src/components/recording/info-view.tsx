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
    <section className={cn("rounded-[28px] bg-[#1c211e] px-5 py-4", className)}>
      {title && <h2 className="mb-2 text-sm font-medium tracking-wide text-[#c0c9c1]">{title}</h2>}
      {children}
    </section>
  )
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid gap-1.5 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-4">
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
  return <Icon className="size-5" />
}

function Spark({ values, max, color }: { values: number[]; max: number; color: string }) {
  if (values.length < 2 || max <= 0) return <div className="h-7" />
  const w = 100
  const h = 28
  const pts = values.map(
    (v, i) => `${(i / (values.length - 1)) * w},${h - Math.min(1, Math.max(0, v / max)) * (h - 2) - 1}`,
  )
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-7 w-full" aria-hidden>
      <polygon points={`0,${h} ${pts.join(" ")} ${w},${h}`} fill={color} opacity={0.14} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Meter({ block: b }: { block: Block }) {
  const color = b.tone === "bad" ? series.error : series[b.series]
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-[#8a938c]">{b.label}</span>
        <span className={cn("text-right text-[#e0e3de]", b.tone && tones[b.tone])}>{b.value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#313633]">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${Math.min(1, Math.max(0, b.fraction)) * 100}%`, background: color }}
        />
      </div>
      <Spark values={b.values} max={b.max} color={color} />
    </div>
  )
}

export function InfoView({ summary: s, iconUrl }: { summary: Summary; iconUrl?: string }) {
  return (
    <div className="grid content-start gap-3">
      <Card className="py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[44px] leading-none font-light tracking-tight tabular-nums">{s.clock.time}</div>
            <div className="mt-1.5 text-sm text-[#c0c9c1]">
              {s.clock.date}
              {s.clock.zone ? ` · ${s.clock.zone}` : ""}
            </div>
            {s.clock.offset && (
              <div className={cn("mt-0.5 text-sm", s.clock.offsetTone && tones[s.clock.offsetTone])}>
                Clock {s.clock.offset}
              </div>
            )}
          </div>
          {s.battery && (
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-sm",
                s.battery.saver ? "bg-[#4a3a0a] text-[#f2c162]" : "bg-[#262b28] text-[#c0c9c1]",
              )}
              title={s.battery.saver ? "Battery Saver is on" : undefined}
            >
              <BatteryGlyph level={s.battery.level} charging={s.battery.charging} />
              {s.battery.level}%
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 border-t border-[#404943]/60 pt-3 text-sm">
          <span className="text-[#8a938c]">Recording</span>
          <span className="font-mono tabular-nums">
            {s.elapsed.now} <span className="text-[#8a938c]">/ {s.elapsed.total}</span>
          </span>
          <span className="ml-auto text-[#c0c9c1]">{s.realTime}</span>
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-3">
          <AppIcon src={iconUrl} className="size-12 rounded-2xl bg-[#262b28] text-[#8a938c]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-medium">{s.app.title}</div>
            <div className="truncate font-mono text-xs text-[#8a938c]">
              {s.app.subtitle}
              {s.app.version ? ` · ${s.app.version}` : ""}
            </div>
          </div>
          {s.app.state && (
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium",
                s.app.running ? "bg-[#0a5230] text-[#94f7b5]" : "bg-[#313633] text-[#c0c9c1]",
              )}
            >
              {s.app.state}
            </span>
          )}
        </div>
      </Card>

      {s.tiles.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {s.tiles.map((t) => (
            <div
              key={t.id}
              className={cn(
                "flex min-h-14 items-center gap-2 rounded-[22px] px-3 py-2 text-sm leading-tight [&_svg]:size-4 [&_svg]:shrink-0",
                t.on
                  ? t.tone === "warn"
                    ? "bg-[#4a3a0a] text-[#f2c162]"
                    : "bg-[#0a5230] text-[#94f7b5]"
                  : "bg-[#262b28] text-[#8a938c]",
              )}
            >
              {tileIcons[t.id]}
              <span>{t.label}</span>
            </div>
          ))}
        </div>
      )}

      <Card title="Device">
        <Rows rows={s.device} />
      </Card>
      <Card title="Network">
        <Rows rows={s.network} />
      </Card>
      <Card title="Resources">
        <div className="grid gap-3">
          {s.resources.map((b) => (
            <Meter key={b.label} block={b} />
          ))}
          {s.temperature && <Rows rows={[s.temperature]} />}
        </div>
      </Card>
    </div>
  )
}
