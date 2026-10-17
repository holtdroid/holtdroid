import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CpuIcon,
  GlobeIcon,
  HardDriveIcon,
  type LucideIcon,
  MemoryStickIcon,
  MonitorPlayIcon,
  ServerIcon,
  ThermometerIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react"
import { type Metrics, type Network, sessionBase, type Temperature } from "@/api/client"
import type { LiveScreen } from "@/components/session/live-screen"
import { useNetwork } from "@/components/session/use-device"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useEventSource } from "@/hooks/use-event-source"
import { countryFlag, formatBytes } from "@/lib/format"
import type { ScreenConnection, StreamStats } from "@/lib/scrcpy"
import { cn } from "@/lib/utils"

const historySize = 30

type Level = "ok" | "warn" | "crit"

const levels: Level[] = ["ok", "warn", "crit"]
const levelText: Record<Level, string> = {
  ok: "text-muted-foreground",
  warn: "text-amber-500",
  crit: "text-destructive",
}
const levelFill: Record<Level, string> = {
  ok: "bg-muted-foreground/60",
  warn: "bg-amber-500",
  crit: "bg-destructive",
}

function level(value: number, warn: number, crit: number): Level {
  if (value >= crit) return "crit"
  return value >= warn ? "warn" : "ok"
}

function worst(...ls: Level[]): Level {
  return levels[Math.max(...ls.map((l) => levels.indexOf(l)))] ?? "ok"
}

export function MetricsBar({
  provider,
  id,
  live,
  network,
}: {
  provider: string
  id: string
  live: LiveScreen
  network: boolean
}) {
  const visible = useDocumentVisible()
  const [history, setHistory] = useState<Metrics[]>([])
  useEventSource<{ metrics: Metrics }>(visible ? `${sessionBase(provider, id)}/v1/metrics` : null, {
    metrics: (m) => setHistory((h) => [...h.slice(1 - historySize), m]),
  })
  const stream = useStreamRate(live)
  const egress = useNetwork(provider, id, network).data
  const m = history.at(-1)

  return (
    <footer className="bg-muted/30 flex h-7 shrink-0 items-center gap-4 overflow-hidden border-t px-3 text-xs whitespace-nowrap">
      {m ? (
        <>
          <CPUStat m={m} history={history} />
          <MemoryStat m={m} />
          <FramesStat m={m} history={history} />
          <NetworkStat m={m} history={history} />
          <StorageStat m={m} />
          <ThermalStat m={m} />
        </>
      ) : (
        <span className="text-muted-foreground">Measuring the device…</span>
      )}
      <div className="ml-auto flex items-center gap-4">
        {stream && <StreamStat rate={stream} />}
        {m?.host && <HostStat host={m.host} />}
        {network && egress?.externalIp && <EgressStat network={egress} />}
      </div>
    </footer>
  )
}

type Props = { m: Metrics; history: Metrics[] }

function CPUStat({ m, history }: Props) {
  const cpu = m.device.cpu
  const l = level(cpu, 70, 90)
  const processes = m.app?.processes ?? []
  return (
    <Stat
      icon={CpuIcon}
      level={l}
      tip={
        <>
          <Title>Device CPU</Title>
          <Row label={`All ${m.device.cores} cores`} value={percent(cpu)} />
          {m.app && <Row label="App" value={percent(sum(processes.map((p) => p.cpu)))} />}
          {processes.map((p) => (
            <Row key={p.pid} label={processLabel(p.name)} value={percent(p.cpu)} sub />
          ))}
        </>
      }
    >
      <Value className="w-8 text-right">{percent(cpu)}</Value>
      <Sparkline values={history.map((h) => h.device.cpu)} max={100} level={l} />
    </Stat>
  )
}

function MemoryStat({ m }: { m: Metrics }) {
  const { memoryUsed, memoryTotal } = m.device
  const ratio = memoryTotal > 0 ? memoryUsed / memoryTotal : 0
  const l = level(ratio * 100, 80, 92)
  const processes = m.app?.processes ?? []
  return (
    <Stat
      icon={MemoryStickIcon}
      level={l}
      tip={
        <>
          <Title>Device memory</Title>
          <Row label="In use" value={`${formatBytes(memoryUsed)} of ${formatBytes(memoryTotal)}`} />
          {m.app && <Row label="App (PSS)" value={formatBytes(sum(processes.map((p) => p.memory)))} />}
          {processes.map((p) => (
            <Row key={p.pid} label={processLabel(p.name)} value={formatBytes(p.memory)} sub />
          ))}
        </>
      }
    >
      <Value>{bytesPair(memoryUsed, memoryTotal)}</Value>
      <Meter ratio={ratio} level={l} />
    </Stat>
  )
}

function FramesStat({ m, history }: Props) {
  const app = m.app
  if (!app) {
    return (
      <Stat icon={ActivityIcon} tip="The app is closed">
        <span className="text-muted-foreground">app closed</span>
      </Stat>
    )
  }
  const jank = level(app.jank, 10, 25)
  return (
    <Stat
      icon={ActivityIcon}
      level={app.fps > 0 ? jank : "ok"}
      tip={
        <>
          <Title>App frames</Title>
          <Row label="Rendered" value={`${app.fps.toFixed(0)} fps`} />
          <Row label="Janky" value={app.fps > 0 ? percent(app.jank) : "—"} />
          <Note>Over the last {m.interval.toFixed(0)} s. 0 fps means nothing on the screen changed.</Note>
        </>
      }
    >
      {app.fps > 0 ? (
        <Value>
          {app.fps.toFixed(0)} fps
          <span className={cn("ml-1", jank === "ok" ? "text-muted-foreground" : levelText[jank])}>
            · {percent(app.jank)} jank
          </span>
        </Value>
      ) : (
        <span className="text-muted-foreground">idle</span>
      )}
      <Sparkline values={history.map((h) => h.app?.fps ?? 0)} max={60} level="ok" />
    </Stat>
  )
}

function NetworkStat({ m, history }: Props) {
  const { rxRate, txRate } = m.device
  return (
    <Stat
      icon={ArrowDownIcon}
      tip={
        <>
          <Title>Device network</Title>
          <Row label="Download" value={byteRate(rxRate)} />
          <Row label="Upload" value={byteRate(txRate)} />
        </>
      }
    >
      <Value className="w-16">{byteRate(rxRate)}</Value>
      <ArrowUpIcon className="text-muted-foreground size-3.5 shrink-0" />
      <Value className="w-16">{byteRate(txRate)}</Value>
      <Sparkline values={history.map((h) => h.device.rxRate + h.device.txRate)} level="ok" />
    </Stat>
  )
}

function StorageStat({ m }: { m: Metrics }) {
  const { storageUsed, storageTotal } = m.device
  if (storageTotal <= 0) return null
  const ratio = storageUsed / storageTotal
  const l = level(ratio * 100, 85, 95)
  return (
    <Stat
      icon={HardDriveIcon}
      level={l}
      className="hidden xl:flex"
      tip={
        <>
          <Title>Storage</Title>
          <Row label="/data" value={`${formatBytes(storageUsed)} of ${formatBytes(storageTotal)}`} />
        </>
      }
    >
      <Value>{bytesPair(storageUsed, storageTotal)}</Value>
      <Meter ratio={ratio} level={l} />
    </Stat>
  )
}

function ThermalStat({ m }: { m: Metrics }) {
  const device = m.thermal.filter((t) => t.source === "device")
  const host = m.thermal.filter((t) => t.source === "host")
  const headline = hottest(device.filter((t) => t.type === "cpu")) ?? hottest(device) ?? hottest(host)
  if (!headline) return null
  const l = worst(...m.thermal.map(temperatureLevel))
  return (
    <Stat
      icon={ThermometerIcon}
      level={l}
      tip={
        <>
          {device.length > 0 && <Title>Device sensors</Title>}
          {device.map((t) => (
            <Row key={t.name} label={sensorLabel(t)} value={celsius(t.celsius)} />
          ))}
          {host.length > 0 && <Title>Node sensors</Title>}
          {host.map((t) => (
            <Row key={t.name} label={t.type} value={celsius(t.celsius)} />
          ))}
          {m.host && device.length > 0 && <Note>An emulator makes its own sensor values up; the node's are real.</Note>}
        </>
      }
    >
      <Value>{celsius(headline.celsius)}</Value>
      {headline.source === "host" && <span className="text-muted-foreground">node</span>}
    </Stat>
  )
}

type StreamRate = { fps: number; bitrate: number; dropped: number }

function StreamStat({ rate }: { rate: StreamRate }) {
  return (
    <Stat
      icon={MonitorPlayIcon}
      level={rate.dropped > 0 ? "warn" : "ok"}
      className="hidden lg:flex"
      tip={
        <>
          <Title>Screen stream</Title>
          <Row label="Frames shown" value={`${rate.fps.toFixed(0)} fps`} />
          <Row label="Bitrate" value={bitRate(rate.bitrate)} />
          <Row label="Dropped" value={String(rate.dropped)} />
          <Note>Decoded in this browser; the device only sends frames when the screen changes.</Note>
        </>
      }
    >
      <Value>{rate.fps.toFixed(0)} fps</Value>
      <span className="text-muted-foreground">{bitRate(rate.bitrate)}</span>
    </Stat>
  )
}

function HostStat({ host }: { host: NonNullable<Metrics["host"]> }) {
  const cpu = level(host.cpuLimit > 0 ? (host.cpu / host.cpuLimit) * 100 : 0, 80, 95)
  const mem = level(host.memoryLimit > 0 ? (host.memoryUsed / host.memoryLimit) * 100 : 0, 85, 95)
  const throttled = level(host.throttled, 1, 10)
  return (
    <Stat
      icon={ServerIcon}
      level={worst(cpu, mem, throttled)}
      tip={
        <>
          <Title>Emulator container</Title>
          <Row label="CPU" value={`${host.cpu.toFixed(1)} of ${host.cpuLimit.toFixed(0)} cores`} />
          <Row label="Memory" value={`${formatBytes(host.memoryUsed)} of ${formatBytes(host.memoryLimit)}`} />
          <Row label="Throttled" value={percent(host.throttled)} />
          <Note>Throttling makes the software-rendered screen drop frames.</Note>
        </>
      }
    >
      <Value>
        {host.cpu.toFixed(1)}/{host.cpuLimit.toFixed(0)} cores
      </Value>
      <Value className="hidden md:inline">{bytesPair(host.memoryUsed, host.memoryLimit)}</Value>
      {host.throttled >= 1 && (
        <span className={cn("flex items-center gap-1", levelText[throttled])}>
          <TriangleAlertIcon className="size-3.5" />
          throttled {percent(host.throttled)}
        </span>
      )}
    </Stat>
  )
}

function EgressStat({ network }: { network: Network }) {
  return (
    <Stat
      icon={GlobeIcon}
      tip={
        <>
          <Title>Device egress</Title>
          <Row label="External IP" value={network.externalIp ?? "—"} />
          {network.country && <Row label="Country" value={network.country.toUpperCase()} />}
          <Row label="Location" value={network.location} />
        </>
      }
    >
      <Value className="font-mono">
        {countryFlag(network.country)} {network.externalIp}
      </Value>
    </Stat>
  )
}

function Stat({
  icon: Icon,
  level: l = "ok",
  tip,
  className,
  children,
}: {
  icon: LucideIcon
  level?: Level
  tip: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          className={cn(
            "focus-visible:ring-ring flex items-center gap-1.5 rounded-sm outline-none focus-visible:ring-1",
            className,
          )}
        >
          <Icon className={cn("size-3.5 shrink-0", levelText[l])} />
          {children}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="block min-w-44">
        <div className="grid gap-0.5">{tip}</div>
      </TooltipContent>
    </Tooltip>
  )
}

function Value({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("text-foreground tabular-nums", className)}>{children}</span>
}

function Title({ children }: { children: ReactNode }) {
  return <div className="mt-1 font-medium first:mt-0">{children}</div>
}

function Row({ label, value, sub }: { label: string; value: string; sub?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-6", sub && "pl-3")}>
      <span className="truncate opacity-70">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="mt-1 max-w-56 whitespace-normal opacity-60">{children}</p>
}

function Sparkline({ values, max, level: l }: { values: number[]; max?: number; level: Level }) {
  const w = 36
  const h = 14
  const step = w / (historySize - 1)
  const top = Math.max(max ?? 0, ...values) || 1
  const x0 = w - (values.length - 1) * step
  const points = values.map((v, i) => `${(x0 + i * step).toFixed(1)},${(h - 1 - (v / top) * (h - 2)).toFixed(1)}`)
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={cn("shrink-0", levelText[l])} aria-hidden>
      {values.length > 1 && (
        <>
          <polygon points={`${x0},${h} ${points.join(" ")} ${w},${h}`} fill="currentColor" fillOpacity={0.15} />
          <polyline
            points={points.join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  )
}

function Meter({ ratio, level: l }: { ratio: number; level: Level }) {
  return (
    <span className="bg-muted relative h-1.5 w-8 shrink-0 overflow-hidden rounded-full">
      <span
        className={cn("absolute inset-y-0 left-0 rounded-full", levelFill[l])}
        style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
      />
    </span>
  )
}

function useDocumentVisible() {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener("visibilitychange", onChange)
      return () => document.removeEventListener("visibilitychange", onChange)
    },
    () => document.visibilityState === "visible",
  )
}

function useStreamRate(live: LiveScreen) {
  const [rate, setRate] = useState<StreamRate | null>(null)
  useEffect(() => {
    let prev: { at: number; stats: StreamStats; connection: ScreenConnection } | null = null
    const timer = window.setInterval(() => {
      const connection = live.connection
      if (!connection) {
        prev = null
        setRate(null)
        return
      }
      const at = performance.now()
      const stats = connection.stats()
      if (prev?.connection === connection) {
        const secs = (at - prev.at) / 1000
        setRate({
          fps: (stats.frames - prev.stats.frames) / secs,
          bitrate: ((stats.bytes - prev.stats.bytes) * 8) / secs,
          dropped: stats.skipped - prev.stats.skipped,
        })
      }
      prev = { at, stats, connection }
    }, 2000)
    return () => window.clearInterval(timer)
  }, [live])
  return rate
}

function hottest(ts: Temperature[]) {
  return ts.reduce<Temperature | undefined>((a, t) => (a && a.celsius >= t.celsius ? a : t), undefined)
}

function temperatureLevel(t: Temperature): Level {
  if (t.source === "device" && (t.type === "battery" || t.type === "skin")) return level(t.celsius, 40, 45)
  return level(t.celsius, 75, 90)
}

function sensorLabel(t: Temperature) {
  return t.name === t.type ? t.name : `${t.name} (${t.type})`
}

function processLabel(name: string) {
  if (name.includes(":sandboxed_process")) return "WebView renderer"
  const i = name.indexOf(":")
  return i < 0 ? "main process" : name.slice(i)
}

function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0)
}

function percent(v: number) {
  return `${Math.round(v)}%`
}

function celsius(v: number) {
  return `${Math.round(v)} °C`
}

const gib = 1024 ** 3

function bytesPair(used: number, total: number) {
  if (total >= gib) return `${(used / gib).toFixed(1)}/${(total / gib).toFixed(1)} GB`
  return `${Math.round(used / 1024 ** 2)}/${Math.round(total / 1024 ** 2)} MB`
}

function byteRate(bps: number) {
  return `${formatBytes(Math.round(bps))}/s`
}

function bitRate(bps: number) {
  return bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} Mb/s` : `${Math.round(bps / 1e3)} kb/s`
}
