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
export type Block = {
  label: string
  value: string
  values: number[]
  max: number
  fraction: number
  series: SeriesName
  tone?: Tone
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
  temperature?: Row
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
  const resources: Block[] = [
    {
      label: "Device CPU",
      value: percent(metrics?.device.cpu),
      values: series((m) => m.device.cpu),
      max: 100,
      fraction: (metrics?.device.cpu ?? 0) / 100,
      series: "primary",
    },
    {
      label: "App",
      value: metrics?.app ? `${percent(appCPU(metrics))} · ${formatBytes(appMemory(metrics) ?? 0)}` : "not running",
      values: series(appCPU),
      max: 100,
      fraction: (appCPU(metrics) ?? 0) / 100,
      series: "blue",
    },
    {
      label: "Memory",
      value: metrics ? `${formatBytes(metrics.device.memoryUsed)} of ${formatBytes(metrics.device.memoryTotal)}` : "—",
      values: series((m) => m.device.memoryUsed),
      max: metrics?.device.memoryTotal ?? 1,
      fraction: metrics ? metrics.device.memoryUsed / Math.max(1, metrics.device.memoryTotal) : 0,
      series: "purple",
    },
    {
      label: "Frames",
      value: metrics?.app ? `${Math.round(metrics.app.fps)} fps · ${percent(metrics.app.jank)} jank` : "—",
      values: series((m) => m.app?.fps),
      max: 60,
      fraction: (metrics?.app?.fps ?? 0) / 60,
      series: "amber",
    },
  ]
  if (metrics?.host) {
    const h = metrics.host
    resources.push({
      label: "Container",
      value: `${h.cpu.toFixed(1)} of ${h.cpuLimit} cores${h.throttled > 0 ? ` · ${percent(h.throttled)} throttled` : ""}`,
      values: series((m) => m.host?.cpu),
      max: h.cpuLimit,
      fraction: h.cpu / Math.max(0.1, h.cpuLimit),
      series: "teal",
      tone: h.throttled > 5 ? "bad" : undefined,
    })
  }

  const temps = metrics?.thermal.filter((tp) => tp.source === "device") ?? []
  const hottest = temps.reduce<(typeof temps)[number] | undefined>(
    (a, b) => (!a || b.celsius > a.celsius ? b : a),
    undefined,
  )
  const battery = temps.find((tp) => tp.type === "battery")

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
            { label: "Screen", value: `${device.screenWidth}×${device.screenHeight} · ${device.density} dpi` },
            { label: "Locale", value: device.locale },
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
    temperature: hottest
      ? {
          label: "Temperature",
          value: `${hottest.type} ${Math.round(hottest.celsius)}°C${battery && battery !== hottest ? ` · battery ${Math.round(battery.celsius)}°C` : ""}`,
          tone: hottest.celsius >= 70 ? "bad" : undefined,
        }
      : undefined,
  }
}
