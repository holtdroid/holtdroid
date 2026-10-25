import type { VideoSample } from "mediabunny"
import type { RecordingManifest, RecordingMarker } from "@/api/client"
import { logLevels, md, mono, sans, series } from "@/lib/recording/android"
import { drawIcon, type SceneIconName } from "@/lib/recording/scene-icons"
import { type Block, type Row, summarize, type Summary, type Tone } from "@/lib/recording/summary"
import { clock, type Dims, type LogLine, type Rotation, type Snapshot } from "@/lib/recording/timeline"
import { drawOverlay, type Overlay } from "@/lib/recording/touches"
import logoUrl from "@/logo.svg"

const pad = 32
const gap = 12
const side = 608
const radius = 28
const headerH = 56
const logicalH = 1080
const outputScale = 1.2
const minArea = 616
const maxArea = 1360
const markerShown = 3200

export type SceneLayout = {
  /** pixels of the video */
  width: number
  height: number
  scale: number
  logicalW: number
  logicalH: number
  /** width of the middle column the phone is drawn in */
  areaW: number
}

const even = (v: number) => Math.max(2, Math.round(v / 2) * 2)

/**
 * The video is 1296 pixels tall; its width follows the widest the screen got:
 * a phone in portrait keeps it at 2304, a landscape phone or a tablet widens
 * the middle column so the picture isn't tiny.
 */
export function sceneLayout(manifest: Pick<RecordingManifest, "epochs">): SceneLayout {
  const panelH = logicalH - headerH - pad
  const bezel = 10
  const aspect = manifest.epochs.reduce((a, e) => (e.height > 0 ? Math.max(a, e.width / e.height) : a), 0.45)
  const areaW = Math.min(maxArea, Math.max(minArea, Math.ceil((panelH - bezel * 2) * aspect + bezel * 2)))
  const logicalW = pad * 2 + side * 2 + gap * 2 + areaW
  return {
    width: even(logicalW * outputScale),
    height: even(logicalH * outputScale),
    scale: outputScale,
    logicalW,
    logicalH,
    areaW,
  }
}

export type SceneApp = {
  title: string
  subtitle: string
  version?: string
  icon?: HTMLImageElement | null
  /** the name the owner gave the recording */
  recordingTitle?: string
}

export type SceneInput = {
  t: number
  duration: number
  startedAt: number
  frame: VideoSample | null
  snap: Snapshot
  logcat: LogLine[]
  overlay?: Overlay
  rotation?: Rotation | null
  markers?: RecordingMarker[]
  layout: SceneLayout
  app: SceneApp
}

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

function ellipsize(ctx: Ctx, s: string, width: number) {
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

function box(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fillStyle = fill
  ctx.fill()
}

/** A card with an optional title: an icon and a label, 32 px from the top edge. */
function card(ctx: Ctx, x: number, y: number, w: number, h: number, title?: string, icon?: SceneIconName) {
  box(ctx, x, y, w, h, radius, md.container)
  if (!title) return
  let tx = x + 22
  if (icon) {
    drawIcon(ctx, icon, md.onSurfaceVariant, x + 22, y + 17, 18)
    tx += 26
  }
  text(ctx, title, tx, y + 31, 14, md.onSurfaceVariant, 500)
}

const rowStep = 24
const rowsHeight = (n: number) => 62 + n * rowStep

/** Label on the left, value on the right, one baseline for both. */
function rows(ctx: Ctx, x: number, y: number, w: number, list: Row[]) {
  list.forEach((r, i) => {
    const ly = y + i * rowStep
    text(ctx, r.label, x, ly, 15, md.outline)
    ctx.textAlign = "right"
    font(ctx, 15)
    const room = w - ctx.measureText(r.label).width - 20
    text(ctx, ellipsize(ctx, r.value, room), x + w, ly, 15, r.tone ? toneColor[r.tone] : md.onSurface)
    ctx.textAlign = "left"
  })
}

function meter(ctx: Ctx, x: number, y: number, w: number, b: Block) {
  const color = b.tone === "bad" ? series.error : series[b.series]
  text(ctx, b.label, x, y + 14, 15, md.outline)
  ctx.textAlign = "right"
  font(ctx, 15)
  text(ctx, ellipsize(ctx, b.value, w - 110), x + w, y + 14, 15, b.tone ? toneColor[b.tone] : md.onSurface)
  ctx.textAlign = "left"
  box(ctx, x, y + 23, w, 6, 3, md.containerHighest)
  const filled = Math.min(1, Math.max(0, b.fraction)) * w
  if (filled > 0) box(ctx, x, y + 23, Math.max(6, filled), 6, 3, color)
}

function drawTiles(ctx: Ctx, x: number, y: number, w: number, tiles: Summary["tiles"]) {
  const n = tiles.length
  const space = 8
  const tw = (w - space * (n - 1)) / n
  tiles.forEach((t, i) => {
    const tx = x + i * (tw + space)
    const warn = t.tone === "warn"
    const fill = t.on ? (warn ? md.warnContainer : md.primaryContainer) : md.containerHigh
    const fg = t.on ? (warn ? md.warn : md.onPrimaryContainer) : md.outline
    box(ctx, tx, y, tw, 64, 22, fill)
    drawIcon(ctx, t.id, fg, tx + tw / 2 - 11, y + 11, 22)
    ctx.textAlign = "center"
    text(ctx, t.label, tx + tw / 2, y + 53, 13, fg, 500)
    ctx.textAlign = "left"
  })
}

function drawLogcat(ctx: Ctx, x: number, y: number, w: number, h: number, lines: LogLine[], t: number) {
  card(ctx, x, y, w, h, "Logcat", "logcat")
  const lh = 21
  const top = y + 58
  const room = Math.floor((h - 70) / lh)
  const shown = lines.slice(-room)
  ctx.save()
  ctx.beginPath()
  ctx.rect(x + 8, top - 6, w - 16, h - 62)
  ctx.clip()
  shown.forEach((l, i) => {
    const ly = top + i * lh
    const color = logLevels[l.level]?.color ?? "#bbbbbb"
    const loud = l.level === "W" || l.level === "E" || l.level === "F" || l.level === "A"
    const age = t - l.t
    if (age >= 0 && age < 1200) {
      ctx.globalAlpha = 0.16 * (1 - age / 1200)
      box(ctx, x + 8, ly - 3, w - 16, lh, 8, color)
      ctx.globalAlpha = 1
    }
    text(ctx, clock(l.t), x + 20, ly + 12, 13, "#6f7872", 400, mono)
    box(ctx, x + 70, ly - 1, 18, 18, 5, `${color}26`)
    ctx.textAlign = "center"
    text(ctx, l.level, x + 79, ly + 12.5, 12, color, 700, mono)
    ctx.textAlign = "left"
    const tag = l.tag ? `${l.tag} ` : ""
    font(ctx, 13, 400, mono)
    const tagW = Math.min(150, ctx.measureText(ellipsize(ctx, tag, 150)).width)
    text(ctx, ellipsize(ctx, tag, 150), x + 98, ly + 12, 13, loud ? color : "#7fb2e5", 400, mono)
    font(ctx, 13, 400, mono)
    text(
      ctx,
      ellipsize(ctx, l.message, w - 98 - tagW - 24),
      x + 98 + tagW,
      ly + 12,
      13,
      loud ? color : md.onSurface,
      400,
      mono,
    )
  })
  ctx.restore()
  if (shown.length === 0) text(ctx, "No logcat yet", x + 22, top + 14, 15, md.outline)
}

function contain(src: Dims, w: number, h: number): Dims {
  const k = Math.min(w / src.w, h / src.h)
  return { w: src.w * k, h: src.h * k }
}

function drawPhone(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  frame: VideoSample | null,
  overlay?: Overlay,
  rotation?: Rotation | null,
) {
  const bezel = 10
  const natural: Dims = frame ? { w: frame.displayWidth, h: frame.displayHeight } : { w: 9, h: 19.5 }
  const body = (d: Dims) => contain(d, w - bezel * 2, h - bezel * 2)
  let size = body(natural)
  if (rotation) {
    const from = body(rotation.from)
    const to = body(rotation.to)
    size = { w: from.w + (to.w - from.w) * rotation.k, h: from.h + (to.h - from.h) * rotation.k }
  }
  const sx = x + (w - size.w) / 2
  const sy = y + (h - size.h) / 2
  const r = Math.min(size.w, size.h) * 0.07 + bezel
  ctx.save()
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)"
  ctx.shadowBlur = 50
  ctx.shadowOffsetY = 20
  box(ctx, sx - bezel, sy - bezel, size.w + bezel * 2, size.h + bezel * 2, r, "#000")
  ctx.restore()
  ctx.beginPath()
  ctx.roundRect(sx - bezel, sy - bezel, size.w + bezel * 2, size.h + bezel * 2, r)
  ctx.strokeStyle = md.outlineVariant
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(sx, sy, size.w, size.h, r - bezel)
  ctx.clip()
  ctx.fillStyle = "#000"
  ctx.fillRect(sx, sy, size.w, size.h)
  if (frame) {
    const inner = contain(natural, size.w, size.h)
    const fx = sx + (size.w - inner.w) / 2
    const fy = sy + (size.h - inner.h) / 2
    frame.draw(ctx, fx, fy, inner.w, inner.h)
    if (overlay) drawOverlay(ctx, fx, fy, inner.w, inner.h, overlay)
  }
  ctx.restore()
}

const markerColor: Record<string, string> = {
  pin: md.primary,
  bug: md.error,
  flag: series.blue,
  star: md.warn,
  alert: md.warn,
  check: md.primary,
}

/** The markers that were just set, as pills at the top of the phone's column. */
function drawMarkers(ctx: Ctx, x: number, y: number, w: number, markers: RecordingMarker[], t: number) {
  const now = markers.filter((m) => t >= m.t && t - m.t < markerShown)
  now.forEach((m, i) => {
    const age = t - m.t
    const alpha = Math.min(1, age / 220, (markerShown - age) / 420)
    const color = markerColor[m.icon] ?? md.primary
    const label = m.label || "Marker"
    font(ctx, 18, 500)
    const shown = ellipsize(ctx, label, w - 160)
    const pw = ctx.measureText(shown).width + 76
    const px = x + (w - pw) / 2
    const py = y + 14 + i * 54
    ctx.save()
    ctx.globalAlpha = alpha * 0.96
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)"
    ctx.shadowBlur = 20
    box(ctx, px, py, pw, 44, 22, md.containerHighest)
    ctx.shadowColor = "transparent"
    ctx.globalAlpha = alpha
    box(ctx, px + 6, py + 6, 32, 32, 16, color)
    drawIcon(ctx, m.icon, md.surface, px + 12, py + 12, 20)
    text(ctx, shown, px + 48, py + 28, 18, md.onSurface, 500)
    ctx.restore()
  })
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
  const inner = w - 44
  let cy = y

  const clockH = 176
  card(ctx, x, cy, w, clockH)
  text(ctx, s.clock.time, x + 20, cy + 66, 56, md.onSurface, 300)
  text(ctx, `${s.clock.date}${s.clock.zone ? ` · ${s.clock.zone}` : ""}`, x + 24, cy + 94, 16, md.onSurfaceVariant)
  if (s.clock.offset) {
    text(
      ctx,
      `Clock ${s.clock.offset}`,
      x + 24,
      cy + 116,
      15,
      s.clock.offsetTone ? toneColor[s.clock.offsetTone] : md.onSurface,
    )
  }
  if (s.battery) {
    const level = s.battery.level
    const name: SceneIconName = s.battery.charging
      ? "batteryCharging"
      : level > 70
        ? "batteryFull"
        : level > 25
          ? "batteryMedium"
          : "batteryLow"
    const fg = s.battery.saver ? md.warn : md.onSurfaceVariant
    const label = `${level}%`
    font(ctx, 16, 500)
    const bw = ctx.measureText(label).width + 62
    box(ctx, x + w - 22 - bw, cy + 22, bw, 36, 18, s.battery.saver ? md.warnContainer : md.containerHigh)
    drawIcon(ctx, name, fg, x + w - 22 - bw + 14, cy + 30, 20)
    text(ctx, label, x + w - 22 - bw + 40, cy + 46, 16, fg, 500)
  }
  ctx.fillStyle = `${md.outlineVariant}99`
  ctx.fillRect(x + 22, cy + 132, inner, 1)
  drawIcon(ctx, "clock", md.outline, x + 22, cy + 142, 16)
  text(ctx, `Recording ${s.elapsed.now} / ${s.elapsed.total}`, x + 46, cy + 155, 14, md.onSurfaceVariant, 400, mono)
  ctx.textAlign = "right"
  text(ctx, s.realTime, x + w - 22, cy + 155, 14, md.onSurfaceVariant)
  ctx.textAlign = "left"
  cy += clockH + gap

  const appH = 84
  card(ctx, x, cy, w, appH)
  ctx.save()
  box(ctx, x + 22, cy + 18, 48, 48, 14, md.containerHigh)
  ctx.beginPath()
  ctx.roundRect(x + 22, cy + 18, 48, 48, 14)
  ctx.clip()
  if (icon && icon.complete && icon.naturalWidth > 0) ctx.drawImage(icon, x + 22, cy + 18, 48, 48)
  ctx.restore()
  font(ctx, 13, 500)
  const stateW = s.app.state ? ctx.measureText(s.app.state).width + 28 : 0
  const nameRoom = inner - 60 - stateW
  font(ctx, 18, 500)
  text(ctx, ellipsize(ctx, s.app.title, nameRoom), x + 84, cy + 39, 18, md.onSurface, 500)
  font(ctx, 13, 400, mono)
  text(
    ctx,
    ellipsize(ctx, `${s.app.subtitle}${s.app.version ? ` · ${s.app.version}` : ""}`, nameRoom),
    x + 84,
    cy + 61,
    13,
    md.outline,
    400,
    mono,
  )
  if (s.app.state) {
    box(ctx, x + w - 22 - stateW, cy + 28, stateW, 28, 14, s.app.running ? md.primaryContainer : md.containerHighest)
    ctx.textAlign = "center"
    text(
      ctx,
      s.app.state,
      x + w - 22 - stateW / 2,
      cy + 47,
      13,
      s.app.running ? md.onPrimaryContainer : md.onSurfaceVariant,
      500,
    )
    ctx.textAlign = "left"
  }
  cy += appH + gap

  if (s.tiles.length > 0) {
    drawTiles(ctx, x, cy, w, s.tiles)
    cy += 64 + gap
  }

  const deviceH = rowsHeight(s.device.length)
  card(ctx, x, cy, w, deviceH, "Device", "device")
  rows(ctx, x + 22, cy + 64, inner, s.device)
  cy += deviceH + gap

  const networkH = rowsHeight(s.network.length)
  card(ctx, x, cy, w, networkH, "Network", "network")
  rows(ctx, x + 22, cy + 64, inner, s.network)
  cy += networkH + gap

  const rest = y + h - cy
  card(ctx, x, cy, w, rest, "Resources", "resources")
  const tempH = s.temperature ? 34 : 0
  const area = rest - 50 - tempH - 8
  const step = Math.min(58, area / s.resources.length)
  s.resources.forEach((b, i) => meter(ctx, x + 22, cy + 52 + i * step, inner, b))
  if (s.temperature) {
    ctx.fillStyle = `${md.outlineVariant}99`
    ctx.fillRect(x + 22, y + h - 46, inner, 1)
    rows(ctx, x + 22, y + h - 20, inner, [s.temperature])
  }
}

function drawHeader(ctx: Ctx, layout: SceneLayout, title?: string) {
  const size = 34
  const base = headerH / 2 + 8
  if (logoImage && logoImage.complete && logoImage.naturalWidth > 0) {
    ctx.drawImage(logoImage, pad, (headerH - size) / 2 + 2, size, size)
  }
  text(ctx, "Holtdroid", pad + size + 12, base, 24, md.onSurface, 600)
  font(ctx, 24, 600)
  const word = ctx.measureText("Holtdroid").width
  ctx.beginPath()
  ctx.arc(pad + size + 12 + word + 18, base - 6, 3, 0, Math.PI * 2)
  ctx.fillStyle = md.primary
  ctx.fill()
  const room = layout.logicalW - pad * 2 - size - word - 330
  font(ctx, 15)
  text(
    ctx,
    ellipsize(ctx, title || "Android test session", room),
    pad + size + 12 + word + 30,
    base - 1,
    15,
    title ? md.onSurface : md.outline,
  )
  ctx.textAlign = "right"
  text(ctx, "github.com/holtdroid/holtdroid", layout.logicalW - pad, base - 1, 14, md.outlineVariant)
  ctx.textAlign = "left"
}

export function drawScene(ctx: Ctx, input: SceneInput) {
  const layout = input.layout
  ctx.setTransform(layout.scale, 0, 0, layout.scale, 0, 0)
  ctx.textBaseline = "alphabetic"
  ctx.textAlign = "left"
  ctx.fillStyle = md.surface
  ctx.fillRect(0, 0, layout.logicalW + 4, layout.logicalH + 4)
  drawHeader(ctx, layout, input.app.recordingTitle)
  const h = layout.logicalH - headerH - pad
  const summary = summarize({
    t: input.t,
    duration: input.duration,
    startedAt: input.startedAt,
    snap: input.snap,
    app: input.app,
  })
  const phoneX = pad + side + gap
  drawLogcat(ctx, pad, headerH, side, h, input.logcat, input.t)
  drawPhone(ctx, phoneX, headerH, layout.areaW, h, input.frame, input.overlay, input.rotation)
  if (input.markers?.length) drawMarkers(ctx, phoneX, headerH, layout.areaW, input.markers, input.t)
  drawInfo(ctx, layout.logicalW - pad - side, headerH, side, h, summary, input.app.icon)
}

export function loadIcon(src: string | undefined) {
  if (!src) return null
  const img = new Image()
  img.decoding = "async"
  img.src = src
  return img
}

export const logoImage = typeof Image === "undefined" ? null : loadIcon(logoUrl)
