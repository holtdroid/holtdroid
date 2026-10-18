import logoUrl from "@/logo.svg"
import { type RecordMode, recordFps } from "@/lib/recorder"

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
const sans = '"Geist Variable", system-ui, sans-serif'
const mono = 'ui-monospace, "SF Mono", Menlo, monospace'
const color = {
  bg: "#07090d",
  bgGlow: "rgba(61, 220, 132, 0.10)",
  card: "rgba(255, 255, 255, 0.045)",
  border: "rgba(255, 255, 255, 0.09)",
  line: "rgba(255, 255, 255, 0.06)",
  text: "#f3f5f7",
  muted: "#8a94a6",
  accent: "#3ddc84",
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

function clock(seconds: number) {
  const s = Math.floor(seconds)
  const hh = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0")
  const ss = String(s % 60).padStart(2, "0")
  return hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`
}

class PanelFrames {
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

  get live() {
    return !this.#closed && this.stream.getVideoTracks().some((t) => t.readyState === "live")
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

export class Composer {
  readonly canvas = document.createElement("canvas")
  readonly #ctx: CanvasRenderingContext2D
  readonly #mode: RecordMode
  readonly #screen: () => HTMLCanvasElement | null
  readonly #info: () => RecordInfo
  readonly #panelTitle: () => string
  readonly #logo = loadImage(logoUrl)
  #icon: { src: string; img: HTMLImageElement } | null = null
  #panel: PanelFrames | null = null
  #start = 0
  #last = 0
  #angle: number | null = null
  #panelK = 0
  #screenSize = { w: 1080, h: 2400 }
  #worker: Worker | null = null
  #interval: ReturnType<typeof setInterval> | undefined

  constructor(opts: {
    mode: RecordMode
    screen: () => HTMLCanvasElement | null
    info: () => RecordInfo
    panelTitle: () => string
  }) {
    this.#mode = opts.mode
    this.#screen = opts.screen
    this.#info = opts.info
    this.#panelTitle = opts.panelTitle
    const s = opts.screen()
    const portrait = opts.mode === "screen" && (!s || s.height >= s.width)
    this.canvas.width = portrait ? 1080 : 1920
    this.canvas.height = portrait ? 1920 : 1080
    const ctx = this.canvas.getContext("2d", { alpha: false })
    if (!ctx) throw new Error("This browser can't draw the recording")
    this.#ctx = ctx
  }

  start() {
    this.#start = performance.now()
    this.#draw()
    const period = 1000 / recordFps
    try {
      const worker = new Worker(new URL("./ticker.worker.ts", import.meta.url), { type: "module" })
      worker.addEventListener("message", () => this.#draw())
      worker.postMessage(period)
      this.#worker = worker
    } catch {
      this.#interval = setInterval(() => this.#draw(), period)
    }
  }

  stop() {
    this.#worker?.terminate()
    this.#worker = null
    clearInterval(this.#interval)
    this.#panel?.close()
    this.#panel = null
  }

  setPanel(stream: MediaStream) {
    this.#panel?.close()
    this.#panel = new PanelFrames(stream)
  }

  #draw() {
    const now = performance.now()
    const t = (now - this.#start) / 1000
    const dt = this.#last ? Math.min(0.25, (now - this.#last) / 1000) : 0
    this.#last = now
    const ease = 1 - Math.exp(-dt * 9)

    const screen = this.#screen()
    const live = screen && screen.width > 0 && screen.height > 0 ? screen : null
    if (live) this.#screenSize = { w: live.width, h: live.height }
    const info = this.#info()
    if (info.icon && this.#icon?.src !== info.icon) this.#icon = { src: info.icon, img: loadImage(info.icon) }

    const { w: sw, h: sh } = this.#screenSize
    const rot = sw > sh ? (info.rotation % 2 === 1 ? info.rotation : 1) : info.rotation % 2 === 0 ? info.rotation : 0
    let target = (-rot * Math.PI) / 2
    if (this.#angle === null) this.#angle = target
    while (target - this.#angle > Math.PI) target -= 2 * Math.PI
    while (target - this.#angle < -Math.PI) target += 2 * Math.PI
    this.#angle += (target - this.#angle) * ease
    if (Math.abs(target - this.#angle) < 1e-3) this.#angle = target

    if (this.#panel && !this.#panel.live) {
      this.#panel.close()
      this.#panel = null
    }
    this.#panelK += ((this.#panel?.frame ? 1 : 0) - this.#panelK) * ease

    this.#background()
    const phone = new Phone(Math.min(sw, sh), Math.max(sw, sh), this.#angle, rot, live)
    if (this.#mode === "full") this.#full(t, phone, info)
    else this.#screenOnly(t, phone, info)
  }

  #background() {
    const ctx = this.#ctx
    const { width: W, height: H } = this.canvas
    ctx.globalAlpha = 1
    ctx.fillStyle = color.bg
    ctx.fillRect(0, 0, W, H)
    const glow = ctx.createRadialGradient(W * 0.15, H * 0.1, 0, W * 0.15, H * 0.1, Math.max(W, H) * 0.8)
    glow.addColorStop(0, color.bgGlow)
    glow.addColorStop(1, "rgba(0, 0, 0, 0)")
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, W, H)
    const shade = ctx.createLinearGradient(0, 0, 0, H)
    shade.addColorStop(0, "rgba(255, 255, 255, 0.015)")
    shade.addColorStop(1, "rgba(0, 0, 0, 0.35)")
    ctx.fillStyle = shade
    ctx.fillRect(0, 0, W, H)
  }

  #screenOnly(t: number, phone: Phone, info: RecordInfo) {
    const ctx = this.#ctx
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
      const pad = Math.min(W, H) * 0.06
      const zoom = 0.94 + 0.06 * easeOut(phoneAlpha)
      const scale = phone.fit(W - 2 * pad, H - 2 * pad) * zoom
      phone.draw(ctx, W / 2, H / 2, scale, phoneAlpha)
    }
  }

  #intro(info: RecordInfo) {
    const ctx = this.#ctx
    const { width: W, height: H } = this.canvas
    const cx = W / 2
    const portrait = H > W
    const top = H / 2 - (portrait ? 380 : 330)

    const logo = 150
    if (loaded(this.#logo)) ctx.drawImage(this.#logo, cx - logo / 2, top, logo, logo)
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
    this.#appBlock(card, info, 76)

    const chips = info.device.map(([label, value]) => ({ label, value }))
    let y = card.y + card.h + 40
    const rows = layoutChips(ctx, chips, Math.min(W - 160, 900))
    for (const row of rows) {
      let x = cx - row.width / 2
      for (const c of row.chips) {
        drawChip(ctx, x, y, c)
        x += c.w + chipGap
      }
      y += chipH + chipGap
    }
    text(ctx, new Date().toLocaleString(), cx, y + 36, { size: 18, color: color.muted, align: "center" })
  }

  #appBlock(card: Rect, info: RecordInfo, icon: number) {
    const ctx = this.#ctx
    const pad = (card.h - icon) / 2
    const ix = card.x + pad
    const iy = card.y + pad
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(ix, iy, icon, icon, icon * 0.22)
    ctx.fillStyle = "rgba(255, 255, 255, 0.06)"
    ctx.fill()
    ctx.clip()
    const img = this.#icon?.img
    if (loaded(img)) ctx.drawImage(img, ix, iy, icon, icon)
    else if (loaded(this.#logo)) ctx.drawImage(this.#logo, ix + icon * 0.15, iy + icon * 0.15, icon * 0.7, icon * 0.7)
    ctx.restore()

    const tx = ix + icon + 24
    const max = card.x + card.w - tx - pad
    text(ctx, info.title, tx, card.y + card.h / 2 - 8, { size: icon > 80 ? 30 : 28, weight: 650, max })
    const sub = info.version ? `${info.subtitle} · ${info.version}` : info.subtitle
    text(ctx, sub, tx, card.y + card.h / 2 + 24, { size: 17, color: color.muted, font: mono, max })
  }

  #full(t: number, phone: Phone, info: RecordInfo) {
    const ctx = this.#ctx
    const { width: W, height: H } = this.canvas
    const P = 56
    const G = 36
    const side = 440

    const logo = 60
    if (loaded(this.#logo)) ctx.drawImage(this.#logo, P, P, logo, logo)
    text(ctx, "Holtdroid", P + logo + 18, P + 30, { size: 32, weight: 700 })
    text(ctx, "Android session recording", P + logo + 18, P + 56, { size: 17, color: color.muted })

    const app = { x: P, y: P + logo + 32, w: side, h: 140 }
    panel(ctx, app, 22)
    this.#appBlock(app, info, 84)

    const rec = { x: P, y: H - P - 104, w: side, h: 104 }
    const dev = { x: P, y: app.y + app.h + 20, w: side, h: 0 }
    const rowH = 46
    const maxRows = Math.max(0, Math.floor((rec.y - 20 - dev.y - 66) / rowH))
    const rows = info.device.slice(0, maxRows)
    dev.h = 66 + rows.length * rowH
    panel(ctx, dev, 22)
    text(ctx, "DEVICE", dev.x + 28, dev.y + 42, { size: 14, weight: 650, color: color.muted, spacing: 3 })
    rows.forEach(([label, value], i) => {
      const y = dev.y + 66 + i * rowH
      ctx.fillStyle = color.line
      ctx.fillRect(dev.x + 28, y, dev.w - 56, 1)
      ctx.font = `400 18px ${sans}`
      const lw = ctx.measureText(label).width
      text(ctx, label, dev.x + 28, y + 30, { size: 18, color: color.muted })
      text(ctx, value, dev.x + dev.w - 28, y + 30, { size: 18, align: "right", max: dev.w - 72 - lw })
    })

    panel(ctx, rec, 22)
    const pulse = 0.55 + 0.45 * Math.cos(t * Math.PI * 2)
    ctx.globalAlpha = pulse
    ctx.fillStyle = color.rec
    ctx.beginPath()
    ctx.arc(rec.x + 36, rec.y + 38, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    text(ctx, "REC", rec.x + 54, rec.y + 44, { size: 17, weight: 700, color: color.rec, spacing: 2 })
    text(ctx, clock(t), rec.x + rec.w - 28, rec.y + 46, { size: 30, weight: 600, font: mono, align: "right" })
    text(ctx, new Date().toLocaleString(), rec.x + 28, rec.y + 80, { size: 16, color: color.muted, max: rec.w - 56 })

    const x0 = P + side + G
    const mw = W - x0 - P
    const mh = H - 2 * P
    const k = this.#panelK
    const scale = phone.fit(mw - (mw * 0.54 + G) * k, mh)
    const phoneW = phone.bounds().w * scale
    const cx = x0 + mw / 2 + (x0 + phoneW / 2 - (x0 + mw / 2)) * k
    phone.draw(ctx, cx, P + mh / 2, scale, 1)

    const frame = this.#panel?.frame
    const px = x0 + phoneW + G
    const pw = x0 + mw - px
    if (k > 0.01 && pw > 120) {
      ctx.save()
      ctx.globalAlpha = k
      const box = { x: px, y: P, w: pw, h: mh }
      panel(ctx, box, 22)
      ctx.fillStyle = color.accent
      ctx.beginPath()
      ctx.arc(px + 30, P + 30, 6, 0, Math.PI * 2)
      ctx.fill()
      text(ctx, this.#panelTitle(), px + 46, P + 37, { size: 20, weight: 650, max: pw - 76 })
      const body = { x: px + 12, y: P + 60, w: pw - 24, h: mh - 72 }
      ctx.beginPath()
      ctx.roundRect(body.x, body.y, body.w, body.h, 14)
      ctx.fillStyle = "#0c0f14"
      ctx.fill()
      if (frame) {
        ctx.clip()
        const s = Math.min(body.w / frame.w, body.h / frame.h)
        const fw = frame.w * s
        const fh = frame.h * s
        ctx.drawImage(frame.source, body.x + (body.w - fw) / 2, body.y + (body.h - fh) / 2, fw, fh)
      }
      ctx.restore()
    }

    if (t < 0.4) {
      ctx.globalAlpha = 1 - t / 0.4
      ctx.fillStyle = color.bg
      ctx.fillRect(0, 0, W, H)
      ctx.globalAlpha = 1
    }
  }
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
    this.#b = nw * 0.045
    this.#w = nw + 2 * this.#b
    this.#h = nh + 2 * this.#b
  }

  bounds() {
    const c = Math.abs(Math.cos(this.angle))
    const s = Math.abs(Math.sin(this.angle))
    const grow = 1.04
    return { w: (this.#w * c + this.#h * s) * grow, h: (this.#w * s + this.#h * c) * grow }
  }

  fit(w: number, h: number) {
    const b = this.bounds()
    return Math.max(0, Math.min(w / b.w, h / b.h))
  }

  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, alpha: number) {
    const { nw, nh } = this
    const b = this.#b
    const W = this.#w
    const H = this.#h
    const R = nw * 0.14
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(cx, cy)
    ctx.rotate(this.angle)
    ctx.scale(scale, scale)

    const bw = b * 0.32
    ctx.fillStyle = "#2c3038"
    ctx.beginPath()
    ctx.roundRect(W / 2 - bw * 0.4, -H / 2 + H * 0.17, bw, H * 0.075, bw / 2)
    ctx.roundRect(W / 2 - bw * 0.4, -H / 2 + H * 0.28, bw, H * 0.14, bw / 2)
    ctx.fill()

    ctx.save()
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)"
    ctx.shadowBlur = 70
    ctx.shadowOffsetY = 28
    const body = ctx.createLinearGradient(-W / 2, -H / 2, W / 2, H / 2)
    body.addColorStop(0, "#41464f")
    body.addColorStop(0.5, "#1c1f24")
    body.addColorStop(1, "#30343b")
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.roundRect(-W / 2, -H / 2, W, H, R)
    ctx.fill()
    ctx.restore()

    const hair = 1.5 / Math.max(scale, 1e-3)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)"
    ctx.lineWidth = hair
    ctx.beginPath()
    ctx.roundRect(-W / 2 + hair, -H / 2 + hair, W - 2 * hair, H - 2 * hair, R - hair)
    ctx.stroke()

    const inset = b * 0.3
    ctx.fillStyle = "#040506"
    ctx.beginPath()
    ctx.roundRect(-W / 2 + inset, -H / 2 + inset, W - 2 * inset, H - 2 * inset, R - inset)
    ctx.fill()

    const r = R - b * 0.85
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(-nw / 2, -nh / 2, nw, nh, r)
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

    const glare = ctx.createLinearGradient(-nw / 2, -nh / 2, nw / 2, nh * 0.1)
    glare.addColorStop(0, "rgba(255, 255, 255, 0.05)")
    glare.addColorStop(0.5, "rgba(255, 255, 255, 0)")
    ctx.fillStyle = glare
    ctx.beginPath()
    ctx.roundRect(-nw / 2, -nh / 2, nw, nh, r)
    ctx.fill()

    const cr = nw * 0.021
    const camY = -nh / 2 + cr * 2.4
    ctx.fillStyle = "#08090b"
    ctx.beginPath()
    ctx.arc(0, camY, cr, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)"
    ctx.lineWidth = cr * 0.18
    ctx.stroke()
    const lens = ctx.createRadialGradient(-cr * 0.3, camY - cr * 0.3, 0, 0, camY, cr * 0.6)
    lens.addColorStop(0, "rgba(120, 140, 200, 0.55)")
    lens.addColorStop(1, "rgba(20, 24, 40, 0)")
    ctx.fillStyle = lens
    ctx.beginPath()
    ctx.arc(0, camY, cr * 0.6, 0, Math.PI * 2)
    ctx.fill()
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
