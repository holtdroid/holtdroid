import type { Metrics } from "@/api/client"
import type { SeriesName } from "@/lib/recording/android"
import { countryFlag, formatBytes, formatClockOffset } from "@/lib/format"
import { clock, type Snapshot } from "@/lib/recording/timeline"

export type Tone = "warn" | "bad"
export type Row = { label: string; value: string; tone?: Tone }
export type Tile = {
  id: "wifi" | "mobile" | "airplane" | "saver" | "dark"
  label: string
  on: boolean
  tone?: Tone
}
export type BlockIcon = "cpu" | "memory" | "app" | "frames" | "container" | "temperature"
export type Block = {
  icon: BlockIcon
  label: string
  value: string
  detail?: string
  values: number[]
  max: number
  fraction: number
  series: SeriesName
  tone?: Tone
  chart: "spark" | "bar" | "none"
  wide?: boolean
}

export type Summary = {
  app: { title: string; subtitle: string; version?: string; state: string; running: boolean }
  clock: { time: string; date: string; zone: string; offset?: string; offsetTone?: Tone }
  battery: { level: number; charging: boolean; saver: boolean } | null
  elapsed: { now: string; total: string }
  realTime: string
  tiles: Tile[]
  device: Row[]
  network: Row[]
  resources: Block[]
}

export type SummaryInput = {
  t: number
  duration: number
  startedAt: number
  snap: Snapshot
  app: { title: string; subtitle: string; version?: string }
}

const formats = new Map<string, Intl.DateTimeFormat>()

function format(key: string, timeZone: string | undefined, options: Intl.DateTimeFormatOptions) {
  const id = `${key}|${timeZone ?? ""}`
  let f = formats.get(id)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(undefined, { ...options, timeZone })
    } catch {
      f = new Intl.DateTimeFormat(undefined, options)
    }
    formats.set(id, f)
  }
  return f
}

const hourMinute = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const
const weekdayDate = { weekday: "short", day: "numeric", month: "short" } as const
const fullDate = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
} as const

function percent(v: number | undefined) {
  return v === undefined ? "—" : `${v.toFixed(v < 10 ? 1 : 0)}%`
}

function rate(bytes: number) {
  return `${formatBytes(Math.round(bytes))}/s`
}

function appCPU(m: Metrics | undefined) {
  return m?.app?.processes.reduce((sum, p) => sum + p.cpu, 0)
}

function appMemory(m: Metrics | undefined) {
  return m?.app?.processes.reduce((sum, p) => sum + p.memory, 0)
}

function kbit(v: number) {
  return v >= 1000 ? `${v / 1000} Mbit/s` : `${v} kbit/s`
}

export function summarize(input: SummaryInput): Summary {
  const { t, duration, startedAt, snap, app } = input
  const { info, device, network, metrics, history, status } = snap
  const real = startedAt + t
  const offset = device?.timeOffset ?? 0
  const skewed = Math.abs(offset) >= 1500
  const zone = device?.timeZone

  const profile = device?.networkProfile
    ? device.networkProfiles?.find((p) => p.id === device.networkProfile)
    : undefined
  const throttled = profile && profile.id !== "full"
  const profileDetail = profile
    ? [
        profile.rtt ? `+${profile.rtt}${profile.jitter ? `±${profile.jitter}` : ""} ms` : "",
        profile.down ? `↓ ${kbit(profile.down)}` : "",
        profile.up ? `↑ ${kbit(profile.up)}` : "",
        profile.loss ? `${profile.loss}% loss` : "",
        profile.scenario ? "scenario" : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : ""

  const series = (f: (m: Metrics) => number | undefined) => history.map((m) => f(m.v) ?? 0)
  const m = metrics
  const resources: Block[] = [
    {
      icon: "cpu",
      label: "CPU",
      value: percent(m?.device.cpu),
      detail: m?.device.cores ? `${m.device.cores} cores` : undefined,
      values: series((x) => x.device.cpu),
      max: 100,
      fraction: (m?.device.cpu ?? 0) / 100,
      series: "primary",
      tone: (m?.device.cpu ?? 0) >= 90 ? "bad" : (m?.device.cpu ?? 0) >= 70 ? "warn" : undefined,
      chart: "spark",
    },
    {
      icon: "memory",
      label: "Memory",
      value: m ? percent((m.device.memoryUsed / Math.max(1, m.device.memoryTotal)) * 100) : "—",
      detail: m ? `${formatBytes(m.device.memoryUsed)} of ${formatBytes(m.device.memoryTotal)}` : undefined,
      values: [],
      max: 1,
      fraction: m ? m.device.memoryUsed / Math.max(1, m.device.memoryTotal) : 0,
      series: "purple",
      tone: m && m.device.memoryUsed / Math.max(1, m.device.memoryTotal) >= 0.92 ? "bad" : undefined,
      chart: "bar",
    },
    {
      icon: "app",
      label: "App",
      value: m?.app ? percent(appCPU(m)) : "Closed",
      detail: m?.app ? `${formatBytes(appMemory(m) ?? 0)} PSS` : "not running",
      values: series(appCPU),
      max: 100,
      fraction: (appCPU(m) ?? 0) / 100,
      series: "blue",
      chart: "spark",
    },
    {
      icon: "frames",
      label: "Frames",
      value: m?.app ? (m.app.fps > 0 ? `${Math.round(m.app.fps)} fps` : "Idle") : "—",
      detail: m?.app ? (m.app.fps > 0 ? `${percent(m.app.jank)} janky` : "Nothing on the screen changed") : undefined,
      values: series((x) => x.app?.fps),
      max: 60,
      fraction: (m?.app?.fps ?? 0) / 60,
      series: "amber",
      tone: (m?.app?.jank ?? 0) >= 25 ? "bad" : (m?.app?.jank ?? 0) >= 10 ? "warn" : undefined,
      chart: "spark",
    },
  ]
  if (m?.host) {
    const h = m.host
    resources.push({
      icon: "container",
      label: "Container",
      value: `${h.cpu.toFixed(1)} cores`,
      detail: `of ${h.cpuLimit.toFixed(0)}${h.throttled > 0 ? ` · ${percent(h.throttled)} throttled` : ""}`,
      values: [],
      max: h.cpuLimit,
      fraction: h.cpu / Math.max(0.1, h.cpuLimit),
      series: "teal",
      tone: h.throttled > 5 ? "bad" : undefined,
      chart: "bar",
    })
  }

  const temps = m?.thermal.filter((tp) => tp.source === "device") ?? []
  const hottest = temps.reduce<(typeof temps)[number] | undefined>(
    (a, b) => (!a || b.celsius > a.celsius ? b : a),
    undefined,
  )
  const battery = temps.find((tp) => tp.type === "battery")
  if (hottest) {
    resources.push({
      icon: "temperature",
      label: "Temperature",
      value: `${Math.round(hottest.celsius)}°C`,
      detail: `${hottest.type}${battery && battery !== hottest ? ` · battery ${Math.round(battery.celsius)}°C` : ""}`,
      values: [],
      max: 1,
      fraction: 0,
      series: "amber",
      tone: hottest.celsius >= 70 ? "bad" : hottest.celsius >= 55 ? "warn" : undefined,
      chart: "none",
    })
  }
  if (resources.length % 2 === 1) resources[resources.length - 1]!.wide = true

  return {
    app: {
      ...app,
      version: info?.versionName || app.version,
      running: status?.appRunning ?? false,
      state: !status ? "" : status.appRunning ? "Running" : status.state === "ready" ? "Closed" : status.state,
    },
    clock: {
      time: format("hm", zone, hourMinute).format(real + offset),
      date: format("date", zone, weekdayDate).format(real + offset),
      zone: zone ?? "",
      offset: skewed ? formatClockOffset(offset) : undefined,
      offsetTone: skewed ? "warn" : undefined,
    },
    battery: device ? { level: device.batteryLevel, charging: device.charging, saver: device.batterySaver } : null,
    elapsed: { now: clock(t), total: clock(duration) },
    realTime: format("full", undefined, fullDate).format(real),
    tiles: device
      ? [
          { id: "wifi", label: "Wi-Fi", on: device.wifi },
          { id: "mobile", label: "Mobile", on: device.mobileData },
          {
            id: "airplane",
            label: "Airplane",
            on: device.airplaneMode,
            tone: device.airplaneMode ? "warn" : undefined,
          },
          { id: "saver", label: "Saver", on: device.batterySaver },
          { id: "dark", label: "Dark", on: device.darkMode },
        ]
      : [],
    device: [
      { label: "Model", value: [info?.manufacturer, info?.model].filter(Boolean).join(" ") || "—" },
      { label: "Android", value: info?.android ? `${info.android}${info.sdk ? ` (SDK ${info.sdk})` : ""}` : "—" },
      { label: "WebView", value: info?.webview?.replace(/^\S+ /, "") || "—" },
      ...(device
        ? [
            {
              label: "Screen",
              value: `${device.screenWidth}×${device.screenHeight} · ${device.density} dpi · ${device.locale}`,
            },
          ]
        : []),
    ],
    network: [
      {
        label: "VPN",
        value: network
          ? `${countryFlag(network.country)} ${network.location || "direct"}${network.externalIp ? ` · ${network.externalIp}` : ""}`.trim()
          : "—",
      },
      ...(profile
        ? [
            {
              label: "Throttling",
              value: throttled ? `${profile.name}${profileDetail ? ` · ${profileDetail}` : ""}` : "Full speed",
              tone: throttled ? ("warn" as const) : undefined,
            },
          ]
        : []),
      ...(metrics
        ? [{ label: "Traffic", value: `↓ ${rate(metrics.device.rxRate)}  ↑ ${rate(metrics.device.txRate)}` }]
        : []),
    ],
    resources,
  }
}
