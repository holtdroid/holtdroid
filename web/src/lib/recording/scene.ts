import type { VideoSample } from "mediabunny"
import type { RecordingManifest, RecordingMarker } from "@/api/client"
import { md, mono, sans, series } from "@/lib/recording/android"
import { historySize } from "@/components/session/metrics"
import { drawIcon, type SceneIconName } from "@/lib/recording/scene-icons"
import { type Block, type Row, summarize, type Summary, type Tone } from "@/lib/recording/summary"
import type { Dims, Rotation, Snapshot } from "@/lib/recording/timeline"
import { drawOverlay, type Overlay } from "@/lib/recording/touches"
import logoUrl from "@/logo.svg"

const pad = 32
const gap = 12
const side = 360
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
 * a phone in portrait keeps it at 1560, a landscape phone or a tablet widens
 * the phone's column so the picture isn't tiny.
 */
export function sceneLayout(manifest: Pick<RecordingManifest, "epochs">): SceneLayout {
  const panelH = logicalH - headerH - pad
  const bezel = 10
  const aspect = manifest.epochs.reduce((a, e) => (e.height > 0 ? Math.max(a, e.width / e.height) : a), 0.45)
  const areaW = Math.min(maxArea, Math.max(minArea, Math.ceil((panelH - bezel * 2) * aspect + bezel * 2)))
  const logicalW = pad * 2 + side + gap + areaW
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
  overlay?: Overlay
  rotation?: Rotation | null
  markers?: RecordingMarker[]
  /** how much of the opening card covers the scene, 0 to 1 */
  intro?: number
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

const blockGlyph: Record<Block["icon"], SceneIconName> = {
  cpu: "cpu",
  memory: "memory",
  app: "mobile",
  frames: "resources",
  container: "container",
  temperature: "temperature",
}

function spark(ctx: Ctx, x: number, y: number, w: number, h: number, values: number[], max: number, color: string) {
  if (values.length < 2) return
  const top = Math.max(max, ...values) || 1
  const step = w / (historySize - 1)
  const x0 = x + w - (values.length - 1) * step
  const pts = values.map((v, i): [number, number] => [x0 + i * step, y + h - 2 - (v / top) * (h - 4)])
  ctx.beginPath()
  ctx.moveTo(x0, y + h)
  pts.forEach(([px, py]) => ctx.lineTo(px, py))
  ctx.lineTo(x + w, y + h)
  ctx.closePath()
  ctx.fillStyle = `${color}26`
  ctx.fill()
  ctx.beginPath()
  pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)))
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.lineJoin = "round"
  ctx.stroke()
}

function metricTile(ctx: Ctx, x: number, y: number, w: number, h: number, b: Block) {
  const color = b.tone === "bad" ? series.error : series[b.series]
  box(ctx, x, y, w, h, 24, md.container)
  drawIcon(ctx, blockGlyph[b.icon], md.onSurfaceVariant, x + 16, y + 13, 15)
  text(ctx, b.label, x + 37, y + 25, 13, md.onSurfaceVariant)
  font(ctx, 22, 500)
  text(ctx, ellipsize(ctx, b.value, w - 32), x + 16, y + 54, 22, b.tone ? toneColor[b.tone] : md.onSurface, 500)
  if (b.detail) {
    font(ctx, 12)
    text(ctx, ellipsize(ctx, b.detail, w - 32), x + 16, y + 72, 12, md.onSurfaceVariant)
  }
  if (b.chart === "bar") {
    const by = y + h - 20
    box(ctx, x + 16, by, w - 32, 6, 3, md.containerHighest)
    const filled = Math.min(1, Math.max(0, b.fraction)) * (w - 32)
    if (filled > 0) box(ctx, x + 16, by, Math.max(6, filled), 6, 3, color)
  } else if (b.chart === "spark") {
    spark(ctx, x + 16, y + h - 36, w - 32, 24, b.values, b.max, color)
  }
}

function drawResources(ctx: Ctx, x: number, y: number, w: number, h: number, list: Block[]) {
  const space = 8
  const tw = (w - space) / 2
  const rowsN = list.reduce((n, b, i) => (b.wide || i % 2 === 0 ? n + 1 : n), 0)
  const th = Math.min(112, (h - space * (rowsN - 1)) / Math.max(1, rowsN))
  if (th < 84) return
  let row = -1
  let col = 0
  list.forEach((b) => {
    if (b.wide || col === 1 || row < 0) {
      row++
      col = 0
    }
    metricTile(ctx, x + col * (tw + space), y + row * (th + space), b.wide ? w : tw, th, b)
    col = b.wide ? 1 : col + 1
  })
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

/** The state that changes during a recording, in a narrow column of small cards beside the phone. */
function drawWidgets(ctx: Ctx, x: number, y: number, w: number, h: number, s: Summary) {
  const inner = w - 40
  let cy = y

  const clockH = 132
  card(ctx, x, cy, w, clockH)
  text(ctx, s.clock.time, x + 18, cy + 56, 46, md.onSurface, 300)
  font(ctx, 14)
  text(
    ctx,
    ellipsize(ctx, `${s.clock.date}${s.clock.zone ? ` · ${s.clock.zone}` : ""}`, inner),
    x + 20,
    cy + 82,
    14,
    md.onSurfaceVariant,
  )
  if (s.clock.offset) {
    text(
      ctx,
      `Clock ${s.clock.offset}`,
      x + 20,
      cy + 102,
      13,
      s.clock.offsetTone ? toneColor[s.clock.offsetTone] : md.onSurface,
    )
  }
  drawIcon(ctx, "clock", md.outline, x + 20, cy + clockH - 28, 14)
  text(ctx, `${s.elapsed.now} / ${s.elapsed.total}`, x + 40, cy + clockH - 16, 13, md.onSurfaceVariant, 400, mono)
  cy += clockH + gap

  const stateH = 56
  card(ctx, x, cy, w, stateH)
  if (s.app.state) {
    font(ctx, 13, 500)
    const sw = ctx.measureText(s.app.state).width + 24
    box(ctx, x + 18, cy + 14, sw, 28, 14, s.app.running ? md.primaryContainer : md.containerHighest)
    ctx.textAlign = "center"
    text(
      ctx,
      s.app.state,
      x + 18 + sw / 2,
      cy + 33,
      13,
      s.app.running ? md.onPrimaryContainer : md.onSurfaceVariant,
      500,
    )
    ctx.textAlign = "left"
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
    font(ctx, 14, 500)
    const lw = ctx.measureText(label).width
    ctx.textAlign = "right"
    text(ctx, label, x + w - 18, cy + 33, 14, fg, 500)
    ctx.textAlign = "left"
    drawIcon(ctx, name, fg, x + w - 18 - lw - 24, cy + 19, 18)
  }
  cy += stateH + gap

  if (s.tiles.length > 0) {
    drawTiles(ctx, x, cy, w, s.tiles)
    cy += 64 + gap
  }

  const networkH = rowsHeight(s.network.length)
  card(ctx, x, cy, w, networkH, "Network", "network")
  rows(ctx, x + 20, cy + 64, inner, s.network)
  cy += networkH + gap

  drawResources(ctx, x, cy, w, y + h - cy, s.resources)
}

/** The opening card: what was recorded and on what, before the recording starts. */
function drawIntro(ctx: Ctx, layout: SceneLayout, s: Summary, app: SceneApp, startedAt: number, alpha: number) {
  if (alpha <= 0) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = md.surface
  ctx.fillRect(0, headerH, layout.logicalW, layout.logicalH - headerH)
  const w = Math.min(720, layout.logicalW - pad * 2)
  const x = (layout.logicalW - w) / 2
  const list = [
    ...s.device,
    {
      label: "Recorded",
      value: new Date(startedAt).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }),
    },
    { label: "Length", value: s.elapsed.total },
  ]
  const h = 200 + rowsHeight(list.length)
  const y = headerH + (layout.logicalH - headerH - pad - h) / 2
  card(ctx, x, y, w, h)
  ctx.save()
  box(ctx, x + 32, y + 36, 112, 112, 30, md.containerHigh)
  ctx.beginPath()
  ctx.roundRect(x + 32, y + 36, 112, 112, 30)
  ctx.clip()
  if (app.icon && app.icon.complete && app.icon.naturalWidth > 0) ctx.drawImage(app.icon, x + 32, y + 36, 112, 112)
  ctx.restore()
  const tx = x + 172
  const room = w - 172 - 32
  font(ctx, 34, 500)
  text(ctx, ellipsize(ctx, app.recordingTitle || s.app.title, room), tx, y + 80, 34, md.onSurface, 500)
  font(ctx, 17)
  text(
    ctx,
    ellipsize(ctx, app.recordingTitle ? s.app.title : s.app.subtitle, room),
    tx,
    y + 112,
    17,
    md.onSurfaceVariant,
  )
  font(ctx, 15, 400, mono)
  text(
    ctx,
    ellipsize(ctx, `${s.app.version ? `${s.app.version} · ` : ""}${s.app.subtitle}`, room),
    tx,
    y + 140,
    15,
    md.outline,
    400,
    mono,
  )
  ctx.fillStyle = `${md.outlineVariant}99`
  ctx.fillRect(x + 32, y + 180, w - 64, 1)
  rows(ctx, x + 32, y + 226, w - 64, list)
  ctx.restore()
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
  drawWidgets(ctx, pad, headerH, side, h, summary)
  drawPhone(ctx, phoneX, headerH, layout.areaW, h, input.frame, input.overlay, input.rotation)
  if (input.markers?.length) drawMarkers(ctx, phoneX, headerH, layout.areaW, input.markers, input.t)
  drawIntro(ctx, layout, summary, input.app, input.startedAt, input.intro ?? 0)
}

export function loadIcon(src: string | undefined) {
  if (!src) return null
  const img = new Image()
  img.decoding = "async"
  img.src = src
  return img
}

export const logoImage = typeof Image === "undefined" ? null : loadIcon(logoUrl)
