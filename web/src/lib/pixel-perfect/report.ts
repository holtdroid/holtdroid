import { differencePixels, maskCanvas, toCanvas } from "@/lib/pixel-perfect/capture"
import { type Analysis, describe, type Pixels } from "@/lib/pixel-perfect/diff"
import type { Box } from "@/lib/pixel-perfect/geometry"
import { mono, sans } from "@/lib/recording/android"
import { logoImage } from "@/lib/recording/scene"

export type ReportInput = {
  analysis: Analysis
  screen: Pixels
  reference: Pixels
  ignored: Box[]
  motion: Uint8Array | null
  toDevice: number
  title: string
  subtitle: string
  source: string
  /** The page element of each region, when a WebView was found. */
  elements: ({ label: string } | null)[]
  media: Box[]
}

const pad = 40
const gap = 28
const headerH = 112
const labelH = 40
const rowH = 26
const maxRows = 14
const red = "#ef4444"

function boxes(ctx: OffscreenCanvasRenderingContext2D, regions: Box[], x: number, y: number, k: number) {
  ctx.lineWidth = 2
  ctx.font = `600 13px ${sans}`
  regions.forEach((r, i) => {
    const bx = x + r.x * k
    const by = y + r.y * k
    ctx.strokeStyle = red
    ctx.fillStyle = "rgb(239 68 68 / 0.08)"
    ctx.fillRect(bx, by, r.w * k, r.h * k)
    ctx.strokeRect(bx + 1, by + 1, Math.max(2, r.w * k - 2), Math.max(2, r.h * k - 2))
    const label = String(i + 1)
    const w = ctx.measureText(label).width + 8
    ctx.fillStyle = red
    ctx.fillRect(bx, Math.max(y, by - 17), w, 17)
    ctx.fillStyle = "#fff"
    ctx.fillText(label, bx + 4, Math.max(y, by - 17) + 13)
  })
}

function hatch(ctx: OffscreenCanvasRenderingContext2D, areas: Box[], x: number, y: number, k: number) {
  ctx.save()
  ctx.strokeStyle = "rgb(56 189 248 / 0.7)"
  ctx.setLineDash([6, 4])
  ctx.lineWidth = 1.5
  for (const a of areas) ctx.strokeRect(x + a.x * k, y + a.y * k, a.w * k, a.h * k)
  ctx.restore()
}

function checker(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save()
  ctx.fillStyle = "#1c1f26"
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = "#252933"
  for (let yy = 0; yy < h; yy += 12) {
    for (let xx = (yy / 12) % 2 ? 12 : 0; xx < w; xx += 24)
      ctx.fillRect(x + xx, y + yy, Math.min(12, w - xx), Math.min(12, h - yy))
  }
  ctx.restore()
}

/** A PNG with the reference, the difference and the screen side by side, the regions and the project's logo. */
export async function renderReport(input: ReportInput): Promise<Blob> {
  const { analysis: a, screen } = input
  const colW = Math.round(Math.min(540, (1180 * a.width) / a.height))
  const k = colW / a.width
  const colH = Math.round(a.height * k)
  const listed = a.regions.slice(0, maxRows)
  const listH = a.regions.length ? 48 + listed.length * rowH + (a.regions.length > maxRows ? rowH : 0) : 0
  const width = pad * 2 + colW * 3 + gap * 2
  const height = headerH + labelH + colH + listH + pad * 2
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("This browser can't draw offscreen")

  ctx.fillStyle = "#0f1115"
  ctx.fillRect(0, 0, width, height)

  const logo = logoImage
  if (logo) await logo.decode().catch(() => undefined)
  if (logo?.complete && logo.naturalWidth > 0) ctx.drawImage(logo, pad, pad - 4, 52, 52)
  ctx.fillStyle = "#f4f4f5"
  ctx.font = `600 26px ${sans}`
  ctx.fillText(input.title, pad + 68, pad + 20)
  ctx.fillStyle = "#a1a1aa"
  ctx.font = `400 15px ${sans}`
  ctx.fillText(input.subtitle, pad + 68, pad + 44)

  const pct = `${(a.match * 100).toFixed(a.match > 0.999 && a.match < 1 ? 2 : 1)}%`
  ctx.textAlign = "right"
  ctx.font = `600 30px ${sans}`
  ctx.fillStyle = a.regions.length ? "#fca5a5" : "#86efac"
  ctx.fillText(pct, width - pad, pad + 22)
  ctx.font = `400 14px ${sans}`
  ctx.fillStyle = "#a1a1aa"
  const count = a.regions.length === 1 ? "1 difference" : `${a.regions.length || "no"} differences`
  ctx.fillText(`match · ${count} · ${input.source}`, width - pad, pad + 46)
  ctx.textAlign = "left"

  const top = headerH + pad - 20
  const columns: { label: string; draw: (x: number, y: number) => void }[] = [
    {
      label: "Reference",
      draw: (x, y) => {
        checker(ctx, x, y, colW, colH)
        ctx.drawImage(toCanvas(input.reference), x, y, colW, colH)
      },
    },
    {
      label: "Difference",
      draw: (x, y) => {
        ctx.drawImage(toCanvas(differencePixels(screen, input.reference)), x, y, colW, colH)
        if (input.motion)
          ctx.drawImage(maskCanvas(input.motion, a.width, a.height, [56, 189, 248, 60]), x, y, colW, colH)
        hatch(ctx, [...input.ignored, ...input.media], x, y, k)
        boxes(ctx, a.regions, x, y, k)
      },
    },
    {
      label: "Screen",
      draw: (x, y) => {
        ctx.drawImage(toCanvas(screen), x, y, colW, colH)
        boxes(ctx, a.regions, x, y, k)
      },
    },
  ]
  columns.forEach((c, i) => {
    const x = pad + i * (colW + gap)
    ctx.fillStyle = "#d4d4d8"
    ctx.font = `500 15px ${sans}`
    ctx.fillText(c.label, x, top + 24)
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x, top + labelH, colW, colH, 10)
    ctx.clip()
    c.draw(x, top + labelH)
    ctx.restore()
    ctx.strokeStyle = "#2a2e37"
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(x + 0.5, top + labelH + 0.5, colW - 1, colH - 1, 10)
    ctx.stroke()
  })

  if (a.regions.length) {
    let y = top + labelH + colH + 40
    ctx.fillStyle = "#d4d4d8"
    ctx.font = `500 15px ${sans}`
    ctx.fillText("Differences", pad, y)
    y += 12
    listed.forEach((r, i) => {
      y += rowH
      ctx.fillStyle = red
      ctx.font = `600 13px ${mono}`
      ctx.fillText(`#${i + 1}`, pad, y)
      ctx.fillStyle = "#e4e4e7"
      ctx.font = `400 14px ${sans}`
      ctx.fillText(describe(r.kind, input.toDevice), pad + 44, y)
      ctx.fillStyle = "#71717a"
      ctx.font = `400 13px ${mono}`
      const d = input.toDevice
      ctx.fillText(
        `${Math.round(r.w * d)}×${Math.round(r.h * d)} at ${Math.round(r.x * d)}, ${Math.round(r.y * d)}`,
        pad + 44 + colW + gap,
        y,
      )
      const el = input.elements[i]
      if (el) {
        ctx.fillStyle = "#c4b5fd"
        const max = colW + gap - 8
        let label = el.label
        while (label.length > 4 && ctx.measureText(label).width > max) label = `${label.slice(0, -2)}…`
        ctx.fillText(label, pad + (colW + gap) * 2, y)
      }
    })
    if (a.regions.length > maxRows) {
      ctx.fillStyle = "#71717a"
      ctx.font = `400 14px ${sans}`
      ctx.fillText(`and ${a.regions.length - maxRows} more`, pad + 44, y + rowH)
    }
  }
  return canvas.convertToBlob({ type: "image/png" })
}
