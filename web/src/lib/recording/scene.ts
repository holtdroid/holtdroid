import type { VideoSample } from "mediabunny"
import type { DeviceState, Metrics } from "@/api/client"
import { countryFlag, formatBytes, formatClockOffset } from "@/lib/format"
import { clock, type LogLine, type Snapshot } from "@/lib/recording/timeline"

export const sceneWidth = 1920
export const sceneHeight = 1080

export type SceneApp = { title: string; subtitle: string; version?: string; icon?: HTMLImageElement | null }

export type SceneInput = {
  t: number
  duration: number
  startedAt: number
  frame: VideoSample | null
  snap: Snapshot
  logcat: LogLine[]
  app: SceneApp
}

const pad = 28
const side = 600
const sans = '"Geist Variable", system-ui, sans-serif'
const mono = 'ui-monospace, "SF Mono", Menlo, monospace'
const color = {
  bg: "#07090d",
  glow: "rgba(61, 220, 132, 0.10)",
  card: "rgba(255, 255, 255, 0.045)",
  border: "rgba(255, 255, 255, 0.09)",
  text: "#f3f5f7",
  muted: "#8a94a6",
  faint: "#5b6475",
  accent: "#3ddc84",
  warn: "#f5b041",
  bad: "#ef4444",
}
const levels: Record<string, string> = {
  V: "#6b7385",
  D: "#7fb4ff",
  I: "#d7dde7",
  W: "#f5b041",
  E: "#ff6b6b",
  F: "#ff5fd2",
  A: "#ff5fd2",
}

type Ctx = CanvasRenderingContext2D

function font(ctx: Ctx, size: number, weight = 400, family = sans) {
  ctx.font = `${weight} ${size}px ${family}`
}

function text(ctx: Ctx, s: string, x: number, y: number, size: number, fill: string, weight = 400, family = sans) {
  font(ctx, size, weight, family)
  ctx.fillStyle = fill
  ctx.fillText(s, x, y)
}

function fit(ctx: Ctx, s: string, width: number) {
  if (ctx.measureText(s).width <= width) return s
  let lo = 0
  let hi = s.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(s.slice(0, mid) + "…").width <= width) lo = mid
    else hi = mid - 1
  }
  return s.slice(0, lo) + "…"
}

function card(ctx: Ctx, x: number, y: number, w: number, h: number, title?: string) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 18)
  ctx.fillStyle = color.card
  ctx.fill()
  ctx.strokeStyle = color.border
  ctx.lineWidth = 1
  ctx.stroke()
  if (title) text(ctx, title.toUpperCase(), x + 20, y + 30, 13, color.muted, 600)
}

function row(ctx: Ctx, x: number, y: number, w: number, label: string, value: string, fill = color.text) {
  text(ctx, label, x, y, 16, color.muted)
  font(ctx, 16, 500)
  const lw = ctx.measureText(label).width
  const v = fit(ctx, value, w - lw - 24)
  ctx.textAlign = "right"
  text(ctx, v, x + w, y, 16, fill, 500)
  ctx.textAlign = "left"
}

function sparkline(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  values: number[],
  max: number,
  stroke: string,
) {
  if (values.length < 2 || max <= 0) return
  ctx.save()
  ctx.beginPath()
  values.forEach((v, i) => {
    const px = x + (i / (values.length - 1)) * w
    const py = y + h - Math.min(1, Math.max(0, v / max)) * h
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  ctx.strokeStyle = stroke
  ctx.lineWidth = 2
  ctx.lineJoin = "round"
  ctx.stroke()
  ctx.lineTo(x + w, y + h)
  ctx.lineTo(x, y + h)
  ctx.closePath()
  ctx.globalAlpha = 0.12
  ctx.fillStyle = stroke
  ctx.fill()
  ctx.restore()
}

const formats = new Map<string, Intl.DateTimeFormat>()

function dateFormat(timeZone: string | undefined, withDate: boolean) {
  const key = `${timeZone ?? ""}|${withDate}`
  let f = formats.get(key)
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      ...(withDate ? { day: "numeric", month: "short", year: "numeric" } : {}),
    }
    try {
      f = new Intl.DateTimeFormat(undefined, { ...opts, timeZone })
    } catch {
      f = new Intl.DateTimeFormat(undefined, opts)
    }
    formats.set(key, f)
  }
  return f
}

function rate(bytes: number) {
  return `${formatBytes(Math.round(bytes))}/s`
}

function percent(v: number | undefined) {
  return v === undefined ? "—" : `${v.toFixed(v < 10 ? 1 : 0)}%`
}

function background(ctx: Ctx) {
  ctx.fillStyle = color.bg
  ctx.fillRect(0, 0, sceneWidth, sceneHeight)
  const glow = ctx.createRadialGradient(sceneWidth / 2, 0, 0, sceneWidth / 2, 0, sceneWidth * 0.7)
  glow.addColorStop(0, color.glow)
  glow.addColorStop(1, "rgba(0, 0, 0, 0)")
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, sceneWidth, sceneHeight)
}

function drawLogcat(ctx: Ctx, x: number, y: number, w: number, h: number, lines: LogLine[], t: number) {
  card(ctx, x, y, w, h, "Logcat")
  const lh = 19
  const top = y + 52
  const room = Math.floor((h - 64) / lh)
  const shown = lines.slice(-room)
  ctx.save()
  ctx.beginPath()
  ctx.rect(x + 12, top - 4, w - 24, h - 60)
  ctx.clip()
  font(ctx, 13.5, 400, mono)
  shown.forEach((l, i) => {
    const ly = top + i * lh
    const age = t - l.t
    if (age >= 0 && age < 1200) {
      ctx.globalAlpha = 0.18 * (1 - age / 1200)
      ctx.fillStyle = levels[l.level] ?? color.text
      ctx.fillRect(x + 12, ly - 2, w - 24, lh)
      ctx.globalAlpha = 1
    }
    ctx.fillStyle = color.faint
    ctx.fillText(clock(l.t), x + 20, ly + 13)
    ctx.fillStyle = levels[l.level] ?? color.text
    ctx.fillText(l.level, x + 74, ly + 13)
    const tag = l.tag ? `${l.tag}: ` : ""
    ctx.fillStyle = color.muted
    ctx.fillText(fit(ctx, tag, 170), x + 92, ly + 13)
    const tagW = Math.min(170, ctx.measureText(tag).width)
    ctx.fillStyle = levels[l.level] ?? color.text
    ctx.fillText(fit(ctx, l.message, w - 92 - tagW - 32), x + 92 + tagW, ly + 13)
  })
  ctx.restore()
  if (shown.length === 0) text(ctx, "No logcat yet", x + 20, top + 14, 15, color.faint)
}

function drawPhone(ctx: Ctx, x: number, y: number, w: number, h: number, frame: VideoSample | null) {
  const fw = frame?.displayWidth ?? 9
  const fh = frame?.displayHeight ?? 19.5
  const bezel = 12
  const scale = Math.min((w - bezel * 2) / fw, (h - bezel * 2) / fh)
  const sw = fw * scale
  const sh = fh * scale
  const sx = x + (w - sw) / 2
  const sy = y + (h - sh) / 2
  const radius = Math.min(sw, sh) * 0.07
  ctx.save()
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)"
  ctx.shadowBlur = 40
  ctx.beginPath()
  ctx.roundRect(sx - bezel, sy - bezel, sw + bezel * 2, sh + bezel * 2, radius + bezel)
  ctx.fillStyle = "#151922"
  ctx.fill()
  ctx.restore()
  ctx.beginPath()
  ctx.roundRect(sx - bezel, sy - bezel, sw + bezel * 2, sh + bezel * 2, radius + bezel)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)"
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(sx, sy, sw, sh, radius)
  ctx.clip()
  ctx.fillStyle = "#000"
  ctx.fillRect(sx, sy, sw, sh)
  if (frame) frame.draw(ctx, sx, sy, sw, sh)
  else {
    ctx.textAlign = "center"
    text(ctx, "No picture", sx + sw / 2, sy + sh / 2, 18, color.faint)
    ctx.textAlign = "left"
  }
  ctx.restore()
}

function appCPU(m: Metrics | undefined) {
  return m?.app?.processes.reduce((sum, p) => sum + p.cpu, 0)
}

function appMemory(m: Metrics | undefined) {
  return m?.app?.processes.reduce((sum, p) => sum + p.memory, 0)
}

function profile(d: DeviceState | undefined) {
  if (!d?.networkProfile) return undefined
  const p = d.networkProfiles?.find((x) => x.id === d.networkProfile)
  if (!p || p.id === "full") return { name: p?.name ?? "Full speed", detail: "no throttling" }
  const parts = [
    p.rtt ? `+${p.rtt}${p.jitter ? `±${p.jitter}` : ""} ms` : "",
    p.down ? `↓ ${p.down >= 1000 ? `${p.down / 1000} Mbit/s` : `${p.down} kbit/s`}` : "",
    p.up ? `↑ ${p.up >= 1000 ? `${p.up / 1000} Mbit/s` : `${p.up} kbit/s`}` : "",
    p.loss ? `${p.loss}% loss` : "",
    p.scenario ? "scenario" : "",
  ].filter(Boolean)
  return { name: p.name, detail: parts.join(" · ") || p.description }
}

function drawInfo(ctx: Ctx, x: number, y: number, w: number, h: number, input: SceneInput) {
  const { snap, app, t } = input
  const { info, device, network, metrics, history, status } = snap
  const inner = w - 40
  let cy = y

  card(ctx, x, cy, w, 112)
  const icon = app.icon
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x + 20, cy + 20, 72, 72, 16)
  ctx.fillStyle = "rgba(255, 255, 255, 0.06)"
  ctx.fill()
  ctx.clip()
  if (icon && icon.complete && icon.naturalWidth > 0) ctx.drawImage(icon, x + 20, cy + 20, 72, 72)
  ctx.restore()
  font(ctx, 26, 600)
  text(ctx, fit(ctx, app.title, inner - 92), x + 112, cy + 50, 26, color.text, 600)
  font(ctx, 15, 400, mono)
  const version = info?.versionName || app.version
  text(
    ctx,
    fit(ctx, app.subtitle + (version ? ` · ${version}` : ""), inner - 92),
    x + 112,
    cy + 78,
    15,
    color.muted,
    400,
    mono,
  )
  cy += 112 + 14

  card(ctx, x, cy, w, 150, "Time")
  text(ctx, clock(t), x + 20, cy + 84, 44, color.text, 600, mono)
  font(ctx, 44, 600, mono)
  const cw = ctx.measureText(clock(t)).width
  text(ctx, `/ ${clock(input.duration)}`, x + 28 + cw, cy + 84, 20, color.faint, 500, mono)
  const real = input.startedAt + t
  const offset = device?.timeOffset ?? 0
  row(ctx, x + 20, cy + 112, inner, "Real time", dateFormat(undefined, true).format(real))
  row(
    ctx,
    x + 20,
    cy + 136,
    inner,
    "Device clock",
    `${dateFormat(device?.timeZone, false).format(real + offset)} ${device?.timeZone ?? ""}${Math.abs(offset) >= 1500 ? ` · ${formatClockOffset(offset)}` : ""}`,
    Math.abs(offset) >= 1500 ? color.warn : color.text,
  )
  cy += 150 + 14

  const deviceRows: [string, string][] = [
    ["Model", [info?.manufacturer, info?.model].filter(Boolean).join(" ") || "—"],
    ["Android", info?.android ? `${info.android}${info.sdk ? ` (SDK ${info.sdk})` : ""}` : "—"],
    ["WebView", info?.webview?.replace(/^\S+ /, "") || "—"],
  ]
  if (device) {
    deviceRows.push(
      ["Screen", `${device.screenWidth}×${device.screenHeight} · ${device.density} dpi`],
      ["Locale", `${device.locale}${device.darkMode ? " · dark" : " · light"}`],
      [
        "Battery",
        `${device.batteryLevel}%${device.charging ? " · charging" : ""}${device.batterySaver ? " · saver" : ""}`,
      ],
    )
  }
  if (status)
    deviceRows.push(["App", status.appRunning ? "running" : status.state === "ready" ? "closed" : status.state])
  const dh = 50 + deviceRows.length * 25
  card(ctx, x, cy, w, dh, "Device")
  deviceRows.forEach(([k, v], i) => row(ctx, x + 20, cy + 62 + i * 25, inner, k, v))
  cy += dh + 14

  const p = profile(device)
  const netRows: [string, string, string?][] = [
    [
      "VPN",
      network
        ? `${countryFlag(network.country)} ${network.location || "direct"}${network.externalIp ? ` · ${network.externalIp}` : ""}`
        : "—",
    ],
  ]
  if (p)
    netRows.push([
      "Throttling",
      `${p.name}${p.detail ? ` · ${p.detail}` : ""}`,
      p.detail === "no throttling" ? undefined : color.warn,
    ])
  if (device) {
    const links = [device.airplaneMode && "airplane", device.wifi && "Wi-Fi", device.mobileData && "mobile"].filter(
      Boolean,
    )
    netRows.push(["Links", links.join(" · ") || "none", device.airplaneMode ? color.warn : undefined])
  }
  if (metrics) netRows.push(["Traffic", `↓ ${rate(metrics.device.rxRate)}  ↑ ${rate(metrics.device.txRate)}`])
  const nh = 50 + netRows.length * 25
  card(ctx, x, cy, w, nh, "Network")
  netRows.forEach(([k, v, fill], i) => row(ctx, x + 20, cy + 62 + i * 25, inner, k, v, fill))
  cy += nh + 14

  const rh = y + h - cy
  card(ctx, x, cy, w, rh, "Resources")
  const series = (f: (m: Metrics) => number | undefined) => history.map((m) => f(m.v) ?? 0)
  const blocks: { label: string; value: string; values: number[]; max: number; stroke: string }[] = [
    {
      label: "Device CPU",
      value: percent(metrics?.device.cpu),
      values: series((m) => m.device.cpu),
      max: 100,
      stroke: color.accent,
    },
    {
      label: "App CPU",
      value: metrics?.app ? `${percent(appCPU(metrics))} · ${formatBytes(appMemory(metrics) ?? 0)}` : "not running",
      values: series(appCPU),
      max: 100,
      stroke: "#7fb4ff",
    },
    {
      label: "Memory",
      value: metrics ? `${formatBytes(metrics.device.memoryUsed)} of ${formatBytes(metrics.device.memoryTotal)}` : "—",
      values: series((m) => m.device.memoryUsed),
      max: metrics?.device.memoryTotal ?? 1,
      stroke: "#c084fc",
    },
    {
      label: "Frames",
      value: metrics?.app ? `${Math.round(metrics.app.fps)} fps · ${percent(metrics.app.jank)} jank` : "—",
      values: series((m) => m.app?.fps),
      max: 60,
      stroke: color.warn,
    },
  ]
  if (metrics?.host) {
    blocks.push({
      label: "Container",
      value: `${metrics.host.cpu.toFixed(1)} of ${metrics.host.cpuLimit} cores${metrics.host.throttled > 0 ? ` · ${percent(metrics.host.throttled)} throttled` : ""}`,
      values: series((m) => m.host?.cpu),
      max: metrics.host.cpuLimit,
      stroke: metrics.host.throttled > 5 ? color.bad : "#5eead4",
    })
  }
  const blockH = Math.min(62, (rh - 100) / blocks.length)
  blocks.forEach((b, i) => {
    const by = cy + 50 + i * blockH
    row(ctx, x + 20, by + 14, inner, b.label, b.value)
    sparkline(ctx, x + 20, by + 22, inner, blockH - 30, b.values, b.max, b.stroke)
  })
  const temps = metrics?.thermal.filter((tp) => tp.source === "device") ?? []
  const hottest = temps.reduce<(typeof temps)[number] | undefined>(
    (a, b) => (!a || b.celsius > a.celsius ? b : a),
    undefined,
  )
  const battery = temps.find((tp) => tp.type === "battery")
  if (hottest) {
    row(
      ctx,
      x + 20,
      y + h - 22,
      inner,
      "Temperature",
      `${hottest.type} ${Math.round(hottest.celsius)}°C${battery && battery !== hottest ? ` · battery ${Math.round(battery.celsius)}°C` : ""}`,
      hottest.celsius >= 70 ? color.bad : color.text,
    )
  }
}

export function drawScene(ctx: Ctx, input: SceneInput) {
  ctx.textBaseline = "alphabetic"
  ctx.textAlign = "left"
  background(ctx)
  const h = sceneHeight - pad * 2
  drawLogcat(ctx, pad, pad, side, h, input.logcat, input.t)
  const cx = pad + side + pad
  const cw = sceneWidth - (pad + side) * 2 - pad * 2
  drawPhone(ctx, cx, pad, cw, h, input.frame)
  drawInfo(ctx, sceneWidth - pad - side, pad, side, h, input)
}

export function loadIcon(src: string | undefined) {
  if (!src) return null
  const img = new Image()
  img.decoding = "async"
  img.src = src
  return img
}
