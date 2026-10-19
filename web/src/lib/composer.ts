import logoUrl from "@/logo.svg"
import { recordFps } from "@/lib/recorder"

export type RecordInfo = {
  title: string
  subtitle: string
  version?: string
  icon?: string
  device: [string, string][]
  rotation: number
}

const introSeconds = 1.5
const fadeSeconds = 0.6
const longSide = 1920
const bannerH = 56
const sans = '"Geist Variable", system-ui, sans-serif'
const mono = 'ui-monospace, "SF Mono", Menlo, monospace'
const color = {
  bg: "#07090d",
  bgGlow: "rgba(61, 220, 132, 0.10)",
  banner: "#0c0f14",
  card: "rgba(255, 255, 255, 0.045)",
  border: "rgba(255, 255, 255, 0.09)",
  text: "#f3f5f7",
  muted: "#8a94a6",
  rec: "#ef4444",
}

type Rect = { x: number; y: number; w: number; h: number }
type Frame = { source: CanvasImageSource; w: number; h: number }
type TrackProcessor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> }

function loadImage(src: string) {
  const img = new Image()
  img.decoding = "async"
  img.src = src
  return img
}

function loaded(img: HTMLImageElement | undefined): img is HTMLImageElement {
  return img !== undefined && img.complete && img.naturalWidth > 0
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v))
}

function easeOut(v: number) {
  return 1 - (1 - v) ** 3
}

function even(v: number) {
  return Math.max(2, Math.round(v / 2) * 2)
}

function clock(seconds: number) {
  const s = Math.floor(seconds)
  const hh = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0")
  const ss = String(s % 60).padStart(2, "0")
  return hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`
}

class TrackFrames {
  #frame: VideoFrame | null = null
  #video: HTMLVideoElement | null = null
  #closed = false

  constructor(readonly stream: MediaStream) {
    const track = stream.getVideoTracks()[0]
    const Processor = (globalThis as { MediaStreamTrackProcessor?: TrackProcessor }).MediaStreamTrackProcessor
    if (track && Processor) {
      this.#pump(new Processor({ track }).readable.getReader())
      return
    }
    const video = document.createElement("video")
    video.muted = true
    video.playsInline = true
    video.srcObject = new MediaStream(stream.getVideoTracks())
    void video.play().catch(() => undefined)
    this.#video = video
  }

  #pump(reader: ReadableStreamDefaultReader<VideoFrame>) {
    reader.read().then(
      ({ value, done }) => {
        if (done) return
        if (this.#closed) {
          value.close()
          void reader.cancel()
          return
        }
        this.#frame?.close()
        this.#frame = value
        this.#pump(reader)
      },
      () => undefined,
    )
  }

  get frame(): Frame | null {
    if (this.#frame) return { source: this.#frame, w: this.#frame.displayWidth, h: this.#frame.displayHeight }
    const v = this.#video
    if (v && v.videoWidth > 0) return { source: v, w: v.videoWidth, h: v.videoHeight }
    return null
  }

  close() {
    this.#closed = true
    this.#frame?.close()
    this.#frame = null
    if (this.#video) this.#video.srcObject = null
    for (const t of this.stream.getTracks()) t.stop()
  }
}

export abstract class Scene {
  readonly canvas = document.createElement("canvas")
  protected readonly ctx: CanvasRenderingContext2D
  protected readonly logo = loadImage(logoUrl)
  readonly #info: () => RecordInfo
  #icon: { src: string; img: HTMLImageElement } | null = null
  #start = 0
  #last = 0
  #worker: Worker | null = null
  #interval: ReturnType<typeof setInterval> | undefined

  constructor(size: { w: number; h: number }, info: () => RecordInfo) {
    this.canvas.width = size.w
    this.canvas.height = size.h
    const ctx = this.canvas.getContext("2d", { alpha: false })
    if (!ctx) throw new Error("This browser can't draw the recording")
    this.ctx = ctx
    this.#info = info
  }

  start() {
    this.#start = performance.now()
    this.#tick()
    const period = 1000 / recordFps
    try {
      const worker = new Worker(new URL("./ticker.worker.ts", import.meta.url), { type: "module" })
      worker.addEventListener("message", () => this.#tick())
      worker.postMessage(period)
      this.#worker = worker
    } catch {
      this.#interval = setInterval(() => this.#tick(), period)
    }
  }

  stop() {
    this.#worker?.terminate()
    this.#worker = null
    clearInterval(this.#interval)
  }

  #tick() {
    const now = performance.now()
    const dt = this.#last ? Math.min(0.25, (now - this.#last) / 1000) : 0
    this.#last = now
    const info = this.#info()
    if (info.icon && this.#icon?.src !== info.icon) this.#icon = { src: info.icon, img: loadImage(info.icon) }
    this.draw((now - this.#start) / 1000, dt, info)
  }

  protected abstract draw(t: number, dt: number, info: RecordInfo): void

  protected appIcon(x: number, y: number, size: number) {
    const ctx = this.ctx
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x, y, size, size, size * 0.22)
    ctx.fillStyle = "rgba(255, 255, 255, 0.06)"
    ctx.fill()
    ctx.clip()
    const img = this.#icon?.img
    if (loaded(img)) ctx.drawImage(img, x, y, size, size)
    else if (loaded(this.logo)) ctx.drawImage(this.logo, x + size * 0.15, y + size * 0.15, size * 0.7, size * 0.7)
    ctx.restore()
  }

  protected background() {
    const ctx = this.ctx
    const { width: W, height: H } = this.canvas
    ctx.globalAlpha = 1
    ctx.fillStyle = color.bg
    ctx.fillRect(0, 0, W, H)
    const glow = ctx.createRadialGradient(W * 0.15, H * 0.1, 0, W * 0.15, H * 0.1, Math.max(W, H) * 0.8)
    glow.addColorStop(0, color.bgGlow)
    glow.addColorStop(1, "rgba(0, 0, 0, 0)")
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, W, H)
  }
}

function screenRotation(sw: number, sh: number, rotation: number) {
  if (sw > sh) return rotation % 2 === 1 ? rotation : 1
  return rotation % 2 === 0 ? rotation : 0
}

export class PhoneScene extends Scene {
  readonly #screen: () => HTMLCanvasElement | null
  #screenSize: { w: number; h: number }
  #angle: number | null = null

  constructor(screen: () => HTMLCanvasElement | null, info: () => RecordInfo) {
    const s = screen()
    const size = s && s.width > 0 && s.height > 0 ? { w: s.width, h: s.height } : { w: 1080, h: 2400 }
    super(PhoneScene.#canvasSize(size), info)
    this.#screen = screen
    this.#screenSize = size
  }

  static #canvasSize({ w, h }: { w: number; h: number }) {
    const b = new Phone(Math.min(w, h), Math.max(w, h), w > h ? Math.PI / 2 : 0, 0, null).bounds()
    const pad = Math.min(b.w, b.h) * 0.16
    const aspect = (b.w + pad) / (b.h + pad)
    return aspect >= 1 ? { w: longSide, h: even(longSide / aspect) } : { w: even(longSide * aspect), h: longSide }
  }

  protected draw(t: number, dt: number, info: RecordInfo) {
    const screen = this.#screen()
    const live = screen && screen.width > 0 && screen.height > 0 ? screen : null
    if (live) this.#screenSize = { w: live.width, h: live.height }
    const { w: sw, h: sh } = this.#screenSize
    const rot = screenRotation(sw, sh, info.rotation)
    let target = (-rot * Math.PI) / 2
    if (this.#angle === null) this.#angle = target
    while (target - this.#angle > Math.PI) target -= 2 * Math.PI
    while (target - this.#angle < -Math.PI) target += 2 * Math.PI
    this.#angle += (target - this.#angle) * (1 - Math.exp(-dt * 9))
    if (Math.abs(target - this.#angle) < 1e-3) this.#angle = target

    this.background()
    const ctx = this.ctx
    const { width: W, height: H } = this.canvas
    const introAlpha = t < introSeconds ? clamp01(t / 0.3) : clamp01(1 - (t - introSeconds) / fadeSeconds)
    const phoneAlpha = clamp01((t - introSeconds) / fadeSeconds)
    if (introAlpha > 0) {
      const drift = t < introSeconds ? (1 - introAlpha) * 16 : -(t - introSeconds) * 40
      ctx.save()
      ctx.globalAlpha = introAlpha
      ctx.translate(0, drift)
      this.#intro(info)
      ctx.restore()
    }
    if (phoneAlpha > 0) {
      const phone = new Phone(Math.min(sw, sh), Math.max(sw, sh), this.#angle, rot, live)
      const pad = Math.min(W, H) * 0.07
      const zoom = 0.94 + 0.06 * easeOut(phoneAlpha)
      phone.draw(ctx, W / 2, H / 2, phone.fit(W - 2 * pad, H - 2 * pad) * zoom, phoneAlpha)
    }
  }

  #intro(info: RecordInfo) {
    const ctx = this.ctx
    const { width: W, height: H } = this.canvas
    const cx = W / 2
    const top = H / 2 - (H > W ? 380 : 330)

    const logo = 150
    if (loaded(this.logo)) ctx.drawImage(this.logo, cx - logo / 2, top, logo, logo)
    text(ctx, "Holtdroid", cx, top + logo + 78, { size: 72, weight: 700, align: "center" })
    text(ctx, "ANDROID SESSION RECORDING", cx, top + logo + 120, {
      size: 18,
      weight: 600,
      color: color.muted,
      align: "center",
      spacing: 6,
    })

    const cardW = Math.min(W - 160, 760)
    const card = { x: cx - cardW / 2, y: top + logo + 168, w: cardW, h: 132 }
    panel(ctx, card, 24)
    const icon = 76
    const pad = (card.h - icon) / 2
    this.appIcon(card.x + pad, card.y + pad, icon)
    const tx = card.x + pad + icon + 24
    const max = card.x + card.w - tx - pad
    text(ctx, info.title, tx, card.y + card.h / 2 - 8, { size: 28, weight: 650, max })
    text(ctx, appLine(info), tx, card.y + card.h / 2 + 24, { size: 17, color: color.muted, font: mono, max })

    const chips = info.device.map(([label, value]) => ({ label, value }))
    let y = card.y + card.h + 40
    for (const row of layoutChips(ctx, chips, Math.min(W - 160, 900))) {
      let x = cx - row.width / 2
      for (const c of row.chips) {
        drawChip(ctx, x, y, c)
        x += c.w + chipGap
      }
      y += chipH + chipGap
    }
    text(ctx, new Date().toLocaleString(), cx, y + 36, { size: 18, color: color.muted, align: "center" })
  }
}

export class TabScene extends Scene {
  readonly #frames: TrackFrames

  constructor(stream: MediaStream, info: () => RecordInfo) {
    super(TabScene.#canvasSize(stream), info)
    this.#frames = new TrackFrames(stream)
  }

  static #canvasSize(stream: MediaStream) {
    const s = stream.getVideoTracks()[0]?.getSettings()
    const tw = s?.width ?? Math.round(window.innerWidth * window.devicePixelRatio)
    const th = s?.height ?? Math.round(window.innerHeight * window.devicePixelRatio)
    const w = even(Math.min(2560, Math.max(1280, tw)))
    return { w, h: even((w * th) / tw + (bannerH * w) / longSide) }
  }

  override stop() {
    super.stop()
    this.#frames.close()
  }

  protected draw(t: number, _dt: number, info: RecordInfo) {
    const ctx = this.ctx
    const { width: W, height: H } = this.canvas
    const u = W / longSide
    const bar = Math.round(bannerH * u)
    ctx.globalAlpha = 1
    ctx.fillStyle = color.bg
    ctx.fillRect(0, 0, W, H)

    const area = { x: 0, y: bar, w: W, h: H - bar }
    const frame = this.#frames.frame
    if (frame) {
      const k = Math.min(area.w / frame.w, area.h / frame.h)
      const fw = frame.w * k
      const fh = frame.h * k
      ctx.drawImage(frame.source, area.x + (area.w - fw) / 2, area.y + (area.h - fh) / 2, fw, fh)
    } else {
      text(ctx, "Waiting for the tab…", W / 2, area.y + area.h / 2, {
        size: 28 * u,
        color: color.muted,
        align: "center",
      })
    }

    ctx.save()
    ctx.scale(u, u)
    this.#banner(t, info, W / u)
    ctx.restore()
  }

  #banner(t: number, info: RecordInfo, BW: number) {
    const ctx = this.ctx
    const H = bannerH
    const mid = H / 2
    ctx.fillStyle = color.banner
    ctx.fillRect(0, 0, BW, H)
    ctx.fillStyle = color.border
    ctx.fillRect(0, H - 1, BW, 1)

    const logo = 30
    if (loaded(this.logo)) ctx.drawImage(this.logo, 18, mid - logo / 2, logo, logo)
    text(ctx, "Holtdroid", 58, mid + 7, { size: 19, weight: 700 })
    let x = 168
    divider(ctx, x, H)

    const right = BW - 20
    const time = clock(t)
    ctx.font = `600 20px ${mono}`
    const timeW = ctx.measureText(time).width
    text(ctx, time, right, mid + 7, { size: 20, weight: 600, font: mono, align: "right" })
    const recX = right - timeW - 62
    ctx.globalAlpha = 0.55 + 0.45 * Math.cos(t * Math.PI * 2)
    ctx.fillStyle = color.rec
    ctx.beginPath()
    ctx.arc(recX + 6, mid, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    text(ctx, "REC", recX + 18, mid + 5, { size: 14, weight: 700, color: color.rec, spacing: 1.5 })
    const date = new Date().toLocaleString()
    ctx.font = `400 14px ${sans}`
    const dateX = recX - 22 - ctx.measureText(date).width
    text(ctx, date, dateX, mid + 5, { size: 14, color: color.muted })
    const limit = dateX - 20
    divider(ctx, limit, H)

    x += 16
    const icon = 32
    this.appIcon(x, mid - icon / 2, icon)
    const tx = x + icon + 12
    const sub = appLine(info)
    ctx.font = `650 16px ${sans}`
    const titleW = ctx.measureText(info.title).width
    ctx.font = `400 12px ${mono}`
    const appW = Math.min(360, Math.max(titleW, ctx.measureText(sub).width), limit - tx - 20)
    text(ctx, info.title, tx, mid - 3, { size: 16, weight: 650, max: appW })
    text(ctx, sub, tx, mid + 15, { size: 12, color: color.muted, font: mono, max: appW })
    x = tx + appW + 16
    if (x < limit) divider(ctx, x, H)

    x += 18
    for (const [label, value] of info.device) {
      ctx.font = `500 13px ${sans}`
      const lw = ctx.measureText(label).width
      ctx.font = `600 14px ${sans}`
      const w = lw + 7 + ctx.measureText(value).width
      if (x + w > limit - 18) break
      text(ctx, label, x, mid + 5, { size: 13, weight: 500, color: color.muted })
      text(ctx, value, x + lw + 7, mid + 5, { size: 14, weight: 600 })
      x += w + 22
    }
  }
}

function appLine(info: RecordInfo) {
  return info.version ? `${info.subtitle} · ${info.version}` : info.subtitle
}

function divider(ctx: CanvasRenderingContext2D, x: number, h: number) {
  ctx.fillStyle = color.border
  ctx.fillRect(Math.round(x), h * 0.25, 1, h * 0.5)
}

class Phone {
  readonly #b: number
  readonly #w: number
  readonly #h: number

  constructor(
    readonly nw: number,
    readonly nh: number,
    readonly angle: number,
    readonly rot: number,
    readonly screen: HTMLCanvasElement | null,
  ) {
    this.#b = nw * 0.04
    this.#w = nw + 2 * this.#b
    this.#h = nh + 2 * this.#b
  }

  bounds() {
    const c = Math.abs(Math.cos(this.angle))
    const s = Math.abs(Math.sin(this.angle))
    return { w: this.#w * c + this.#h * s, h: this.#w * s + this.#h * c }
  }

  fit(w: number, h: number) {
    const b = this.bounds()
    return Math.max(0, Math.min(w / b.w, h / b.h))
  }

  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, alpha: number) {
    const { nw, nh } = this
    const W = this.#w
    const H = this.#h
    const R = nw * 0.06
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(cx, cy)
    ctx.rotate(this.angle)
    ctx.scale(scale, scale)

    ctx.save()
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)"
    ctx.shadowBlur = 60
    ctx.shadowOffsetY = 20
    ctx.fillStyle = "#16191e"
    ctx.beginPath()
    ctx.roundRect(-W / 2, -H / 2, W, H, R)
    ctx.fill()
    ctx.restore()

    const hair = 1.5 / Math.max(scale, 1e-3)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.16)"
    ctx.lineWidth = hair
    ctx.beginPath()
    ctx.roundRect(-W / 2 + hair / 2, -H / 2 + hair / 2, W - hair, H - hair, R)
    ctx.stroke()

    ctx.beginPath()
    ctx.roundRect(-nw / 2, -nh / 2, nw, nh, nw * 0.02)
    ctx.clip()
    ctx.fillStyle = "#000"
    ctx.fillRect(-nw / 2, -nh / 2, nw, nh)
    ctx.rotate((this.rot * Math.PI) / 2)
    const aw = this.rot % 2 ? nh : nw
    const ah = this.rot % 2 ? nw : nh
    if (this.screen) {
      const k = Math.min(aw / this.screen.width, ah / this.screen.height)
      const dw = this.screen.width * k
      const dh = this.screen.height * k
      ctx.drawImage(this.screen, -dw / 2, -dh / 2, dw, dh)
    } else {
      text(ctx, "Waiting for the screen…", 0, 0, { size: nw * 0.045, color: color.muted, align: "center" })
    }
    ctx.restore()
  }
}

function panel(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  ctx.beginPath()
  ctx.roundRect(r.x, r.y, r.w, r.h, radius)
  ctx.fillStyle = color.card
  ctx.fill()
  ctx.strokeStyle = color.border
  ctx.lineWidth = 1
  ctx.stroke()
}

type TextStyle = {
  size: number
  weight?: number
  color?: string
  font?: string
  align?: CanvasTextAlign
  max?: number
  spacing?: number
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, style: TextStyle) {
  ctx.font = `${style.weight ?? 400} ${style.size}px ${style.font ?? sans}`
  ctx.fillStyle = style.color ?? color.text
  ctx.textAlign = style.align ?? "left"
  ctx.textBaseline = "alphabetic"
  ctx.letterSpacing = `${style.spacing ?? 0}px`
  ctx.fillText(style.max === undefined ? value : ellipsize(ctx, value, style.max), x, y)
  ctx.letterSpacing = "0px"
}

function ellipsize(ctx: CanvasRenderingContext2D, value: string, max: number) {
  if (max <= 0) return ""
  if (ctx.measureText(value).width <= max) return value
  let lo = 0
  let hi = value.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(`${value.slice(0, mid)}…`).width <= max) lo = mid
    else hi = mid - 1
  }
  return `${value.slice(0, lo)}…`
}

const chipH = 44
const chipGap = 12
type Chip = { label: string; value: string; w: number }

function layoutChips(ctx: CanvasRenderingContext2D, chips: { label: string; value: string }[], max: number) {
  const rows: { chips: Chip[]; width: number }[] = []
  for (const c of chips) {
    ctx.font = `500 17px ${sans}`
    const lw = ctx.measureText(c.label).width
    ctx.font = `600 17px ${sans}`
    const w = Math.min(max, 20 + lw + 10 + ctx.measureText(c.value).width + 20)
    const row = rows.at(-1)
    if (row && row.width + chipGap + w <= max) {
      row.chips.push({ ...c, w })
      row.width += chipGap + w
    } else {
      rows.push({ chips: [{ ...c, w }], width: w })
    }
  }
  return rows
}

function drawChip(ctx: CanvasRenderingContext2D, x: number, y: number, c: Chip) {
  ctx.beginPath()
  ctx.roundRect(x, y, c.w, chipH, chipH / 2)
  ctx.fillStyle = color.card
  ctx.fill()
  ctx.strokeStyle = color.border
  ctx.lineWidth = 1
  ctx.stroke()
  text(ctx, c.label, x + 20, y + 28, { size: 17, weight: 500, color: color.muted })
  ctx.font = `500 17px ${sans}`
  const lw = ctx.measureText(c.label).width
  text(ctx, c.value, x + 20 + lw + 10, y + 28, { size: 17, weight: 600, max: c.w - lw - 50 })
}
