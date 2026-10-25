import type { VideoSample } from "mediabunny"
import { logLevels, md, mono, sans, series } from "@/lib/recording/android"
import { summarize, type Block, type Row, type Summary, type Tone } from "@/lib/recording/summary"
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

const pad = 32
const gap = 12
const side = 608
const radius = 28

type Ctx = CanvasRenderingContext2D

const toneColor: Record<Tone, string> = { warn: md.warn, bad: md.error }

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
    if (ctx.measureText(`${s.slice(0, mid)}…`).width <= width) lo = mid
    else hi = mid - 1
  }
  return `${s.slice(0, lo)}…`
}

function card(ctx: Ctx, x: number, y: number, w: number, h: number, title?: string) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, radius)
  ctx.fillStyle = md.container
  ctx.fill()
  if (title) text(ctx, title, x + 20, y + 30, 14, md.onSurfaceVariant, 500)
}

function rows(ctx: Ctx, x: number, y: number, w: number, list: Row[], step = 23) {
  list.forEach((r, i) => {
    const ly = y + i * step
    text(ctx, r.label, x, ly, 15, md.outline)
    font(ctx, 15)
    const lw = ctx.measureText(r.label).width
    ctx.textAlign = "right"
    text(ctx, fit(ctx, r.value, w - lw - 20), x + w, ly, 15, r.tone ? toneColor[r.tone] : md.onSurface)
    ctx.textAlign = "left"
  })
}

function spark(ctx: Ctx, x: number, y: number, w: number, h: number, values: number[], max: number, color: string) {
  if (values.length < 2 || max <= 0) return
  const point = (v: number, i: number): [number, number] => [
    x + (i / (values.length - 1)) * w,
    y + h - Math.min(1, Math.max(0, v / max)) * h,
  ]
  ctx.save()
  ctx.beginPath()
  values.forEach((v, i) => {
    const [px, py] = point(v, i)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  ctx.strokeStyle = color
  ctx.lineWidth = 1.8
  ctx.lineJoin = "round"
  ctx.stroke()
  ctx.lineTo(x + w, y + h)
  ctx.lineTo(x, y + h)
  ctx.closePath()
  ctx.globalAlpha = 0.14
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}

function meter(ctx: Ctx, x: number, y: number, w: number, h: number, b: Block) {
  const color = b.tone === "bad" ? series.error : series[b.series]
  text(ctx, b.label, x, y + 14, 15, md.outline)
  ctx.textAlign = "right"
  text(ctx, fit(ctx, b.value, w - 110), x + w, y + 14, 15, b.tone ? toneColor[b.tone] : md.onSurface)
  ctx.textAlign = "left"
  ctx.beginPath()
  ctx.roundRect(x, y + 22, w, 6, 3)
  ctx.fillStyle = md.containerHighest
  ctx.fill()
  const fill = Math.min(1, Math.max(0, b.fraction)) * w
  if (fill > 0) {
    ctx.beginPath()
    ctx.roundRect(x, y + 22, Math.max(6, fill), 6, 3)
    ctx.fillStyle = color
    ctx.fill()
  }
  if (h > 44) spark(ctx, x, y + 34, w, h - 42, b.values, b.max, color)
}

function pill(ctx: Ctx, x: number, y: number, w: number, h: number, label: string, on: boolean, tone?: Tone) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, h / 2.2)
  ctx.fillStyle = on ? (tone === "warn" ? md.warnContainer : md.primaryContainer) : md.containerHigh
  ctx.fill()
  const fg = on ? (tone === "warn" ? md.warn : md.onPrimaryContainer) : md.outline
  ctx.beginPath()
  ctx.arc(x + 22, y + h / 2, 5, 0, Math.PI * 2)
  ctx.fillStyle = fg
  ctx.fill()
  font(ctx, 14, 500)
  text(ctx, fit(ctx, label, w - 50), x + 38, y + h / 2 + 5, 14, fg, 500)
}

function drawLogcat(ctx: Ctx, x: number, y: number, w: number, h: number, lines: LogLine[], t: number) {
  card(ctx, x, y, w, h, "Logcat")
  const lh = 21
  const top = y + 56
  const room = Math.floor((h - 70) / lh)
  const shown = lines.slice(-room)
  ctx.save()
  ctx.beginPath()
  ctx.rect(x + 8, top - 6, w - 16, h - 62)
  ctx.clip()
  shown.forEach((l, i) => {
    const ly = top + i * lh
    const info = logLevels[l.level]
    const color = info?.color ?? "#bbbbbb"
    const loud = l.level === "W" || l.level === "E" || l.level === "F" || l.level === "A"
    const age = t - l.t
    if (age >= 0 && age < 1200) {
      ctx.globalAlpha = 0.16 * (1 - age / 1200)
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(x + 8, ly - 3, w - 16, lh, 8)
      ctx.fill()
      ctx.globalAlpha = 1
    }
    text(ctx, clock(l.t), x + 20, ly + 12, 13, "#6f7872", 400, mono)
    ctx.beginPath()
    ctx.roundRect(x + 70, ly - 1, 18, 18, 5)
    ctx.fillStyle = `${color}26`
    ctx.fill()
    ctx.textAlign = "center"
    text(ctx, l.level, x + 79, ly + 12.5, 12, color, 700, mono)
    ctx.textAlign = "left"
    const tag = l.tag ? `${l.tag} ` : ""
    font(ctx, 13, 400, mono)
    const tagW = Math.min(150, ctx.measureText(tag).width)
    text(ctx, fit(ctx, tag, 150), x + 98, ly + 12, 13, loud ? color : "#7fb2e5", 400, mono)
    text(
      ctx,
      fit(ctx, l.message, w - 98 - tagW - 24),
      x + 98 + tagW,
      ly + 12,
      13,
      loud ? color : md.onSurface,
      400,
      mono,
    )
  })
  ctx.restore()
  if (shown.length === 0) text(ctx, "No logcat yet", x + 20, top + 14, 15, md.outline)
}

function drawPhone(ctx: Ctx, x: number, y: number, w: number, h: number, frame: VideoSample | null) {
  const fw = frame?.displayWidth ?? 9
  const fh = frame?.displayHeight ?? 19.5
  const bezel = 10
  const scale = Math.min((w - bezel * 2) / fw, (h - bezel * 2) / fh)
  const sw = fw * scale
  const sh = fh * scale
  const sx = x + (w - sw) / 2
  const sy = y + (h - sh) / 2
  const r = Math.min(sw, sh) * 0.07 + bezel
  ctx.save()
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)"
  ctx.shadowBlur = 50
  ctx.shadowOffsetY = 20
  ctx.beginPath()
  ctx.roundRect(sx - bezel, sy - bezel, sw + bezel * 2, sh + bezel * 2, r)
  ctx.fillStyle = "#000"
  ctx.fill()
  ctx.restore()
  ctx.beginPath()
  ctx.roundRect(sx - bezel, sy - bezel, sw + bezel * 2, sh + bezel * 2, r)
  ctx.strokeStyle = md.outlineVariant
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(sx, sy, sw, sh, r - bezel)
  ctx.clip()
  ctx.fillStyle = "#000"
  ctx.fillRect(sx, sy, sw, sh)
  if (frame) frame.draw(ctx, sx, sy, sw, sh)
  ctx.restore()
}

function drawInfo(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  s: Summary,
  icon: HTMLImageElement | null | undefined,
) {
  const inner = w - 40
  let cy = y

  card(ctx, x, cy, w, 150)
  text(ctx, s.clock.time, x + 22, cy + 66, 56, md.onSurface, 300)
  text(ctx, `${s.clock.date}${s.clock.zone ? ` · ${s.clock.zone}` : ""}`, x + 24, cy + 92, 16, md.onSurfaceVariant)
  if (s.clock.offset)
    text(
      ctx,
      `Clock ${s.clock.offset}`,
      x + 24,
      cy + 114,
      15,
      s.clock.offsetTone ? toneColor[s.clock.offsetTone] : md.onSurface,
    )
  if (s.battery) {
    const label = `${s.battery.charging ? "⚡ " : ""}${s.battery.level}%`
    font(ctx, 16, 500)
    const bw = ctx.measureText(label).width + 32
    ctx.beginPath()
    ctx.roundRect(x + w - 20 - bw, cy + 22, bw, 34, 17)
    ctx.fillStyle = s.battery.saver ? md.warnContainer : md.containerHigh
    ctx.fill()
    ctx.textAlign = "center"
    text(ctx, label, x + w - 20 - bw / 2, cy + 44, 16, s.battery.saver ? md.warn : md.onSurfaceVariant, 500)
    ctx.textAlign = "left"
  }
  ctx.fillStyle = `${md.outlineVariant}99`
  ctx.fillRect(x + 20, cy + 124, inner, 1)
  text(ctx, `Recording ${s.elapsed.now} / ${s.elapsed.total}`, x + 24, cy + 143, 14, md.onSurfaceVariant, 400, mono)
  ctx.textAlign = "right"
  text(ctx, s.realTime, x + w - 20, cy + 143, 14, md.onSurfaceVariant)
  ctx.textAlign = "left"
  cy += 150 + gap

  card(ctx, x, cy, w, 84)
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x + 20, cy + 18, 48, 48, 14)
  ctx.fillStyle = md.containerHigh
  ctx.fill()
  ctx.clip()
  if (icon && icon.complete && icon.naturalWidth > 0) ctx.drawImage(icon, x + 20, cy + 18, 48, 48)
  ctx.restore()
  font(ctx, 18, 500)
  const stateW = s.app.state ? ctx.measureText(s.app.state).width + 28 : 0
  text(ctx, fit(ctx, s.app.title, inner - 64 - stateW), x + 82, cy + 40, 18, md.onSurface, 500)
  font(ctx, 13, 400, mono)
  text(
    ctx,
    fit(ctx, `${s.app.subtitle}${s.app.version ? ` · ${s.app.version}` : ""}`, inner - 64 - stateW),
    x + 82,
    cy + 62,
    13,
    md.outline,
    400,
    mono,
  )
  if (s.app.state) {
    ctx.beginPath()
    ctx.roundRect(x + w - 20 - stateW, cy + 28, stateW, 28, 14)
    ctx.fillStyle = s.app.running ? md.primaryContainer : md.containerHighest
    ctx.fill()
    ctx.textAlign = "center"
    text(
      ctx,
      s.app.state,
      x + w - 20 - stateW / 2,
      cy + 47,
      13,
      s.app.running ? md.onPrimaryContainer : md.onSurfaceVariant,
      500,
    )
    ctx.textAlign = "left"
  }
  cy += 84 + gap

  if (s.tiles.length > 0) {
    const tw = (w - 16) / 3
    s.tiles.forEach((tile, i) => {
      pill(ctx, x + (i % 3) * (tw + 8), cy + Math.floor(i / 3) * 52, tw, 44, tile.label, tile.on, tile.tone)
    })
    cy += Math.ceil(s.tiles.length / 3) * 52 - 8 + gap
  }

  const dh = 48 + s.device.length * 23
  card(ctx, x, cy, w, dh, "Device")
  rows(ctx, x + 20, cy + 62, inner, s.device)
  cy += dh + gap

  const nh = 48 + s.network.length * 23
  card(ctx, x, cy, w, nh, "Network")
  rows(ctx, x + 20, cy + 62, inner, s.network)
  cy += nh + gap

  const rh = y + h - cy
  card(ctx, x, cy, w, rh, "Resources")
  const tempH = s.temperature ? 26 : 0
  const blockH = Math.min(62, (rh - 54 - tempH) / s.resources.length)
  s.resources.forEach((b, i) => meter(ctx, x + 20, cy + 46 + i * blockH, inner, blockH - 6, b))
  if (s.temperature) rows(ctx, x + 20, y + h - 18, inner, [s.temperature])
}

export function drawScene(ctx: Ctx, input: SceneInput) {
  ctx.textBaseline = "alphabetic"
  ctx.textAlign = "left"
  ctx.fillStyle = md.surface
  ctx.fillRect(0, 0, sceneWidth, sceneHeight)
  const h = sceneHeight - pad * 2
  const summary = summarize({
    t: input.t,
    duration: input.duration,
    startedAt: input.startedAt,
    snap: input.snap,
    app: input.app,
  })
  drawLogcat(ctx, pad, pad, side, h, input.logcat, input.t)
  const cx = pad + side + gap
  const cw = sceneWidth - (cx + side + gap + pad)
  drawPhone(ctx, cx, pad, cw, h, input.frame)
  drawInfo(ctx, sceneWidth - pad - side, pad, side, h, summary, input.app.icon)
}

export function loadIcon(src: string | undefined) {
  if (!src) return null
  const img = new Image()
  img.decoding = "async"
  img.src = src
  return img
}
