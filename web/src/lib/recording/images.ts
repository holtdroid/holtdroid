import type { DevToolsImageUse, DevToolsImages, DevToolsRequest } from "@/api/client"
import { header } from "@/lib/recording/cache"
import { splitURL } from "@/lib/recording/devtools"

export type Severity = "error" | "warning" | "info"

/** A request on the analysis clock: `at` is when it finished, in recording time or the device clock. */
export type ImageRequest = DevToolsRequest & { key: string; target: string; at: number }
export type ImageShot = DevToolsImages & { target: string; at: number }
export type ImageUseAt = DevToolsImageUse & { at: number; dpr: number; target: string; frame: string }

/** What the browser made of the image: its size, and how big it gets as WebP at quality 85, whole and at the size drawn. */
export type ImageMeasure = {
  width: number
  height: number
  webp?: number
  resized?: { width: number; height: number; webp: number }
}

export type ImageFormat = "png" | "jpeg" | "gif" | "webp" | "avif" | "svg" | "bmp" | "ico" | "other"
export type ImageRule = "unused" | "offscreen" | "late" | "oversized" | "format" | "uncompressed"

export type ImageEntry = {
  url: string
  format: ImageFormat
  requests: ImageRequest[]
  /** the file's own size: the recorded body, else bytes on the wire */
  bytes: number
  /** bytes it took over the network, every request together */
  downloaded: number
  natural?: { width: number; height: number }
  /** the most device pixels any use draws it at */
  needed?: { width: number; height: number }
  uses: ImageUseAt[]
  loadedAt: number
  shownAt?: number
  body?: { data: string; base64: boolean; mime: string }
  measure?: ImageMeasure
  /** the smallest it could be: as WebP, at the size drawn, or not at all */
  best: number
}

export type ImageFinding = {
  id: string
  rule: ImageRule
  severity: Severity
  title: string
  detail: string
  url: string
  requests: string[]
  saving?: number
  estimated?: boolean
}

export type ImageSummary = {
  images: number
  downloaded: number
  unshown: number
  saving: number
  shots: boolean
  errors: number
  warnings: number
  infos: number
}

export type ImageReport = { entries: ImageEntry[]; findings: ImageFinding[]; summary: ImageSummary }

/** How long after an image loads it may take to show up on screen. */
export const showWindow = 10_000
export const webpQuality = 0.85
const scanSlack = 1500

const rasterRatio: Partial<Record<ImageFormat, number>> = { png: 0.55, jpeg: 0.7, gif: 0.6, bmp: 0.15 }
const formatName: Record<ImageFormat, string> = {
  png: "PNG",
  jpeg: "JPEG",
  gif: "GIF",
  webp: "WebP",
  avif: "AVIF",
  svg: "SVG",
  bmp: "BMP",
  ico: "ICO",
  other: "image",
}
const workers = new Set(["worker", "shared_worker", "service_worker"])

export function imageFormat(mime: string | undefined, url: string): ImageFormat {
  const m = (mime ?? "").toLowerCase().split(";")[0]!.trim()
  const byMime: Record<string, ImageFormat> = {
    "image/png": "png",
    "image/apng": "png",
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
    "image/pjpeg": "jpeg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/x-icon": "ico",
    "image/vnd.microsoft.icon": "ico",
  }
  if (byMime[m]) return byMime[m]
  const ext = /\.([a-z0-9]+)$/i.exec(splitURL(url).path.split("?")[0]!)?.[1]?.toLowerCase()
  const byExt: Record<string, ImageFormat> = {
    png: "png",
    jpg: "jpeg",
    jpeg: "jpeg",
    gif: "gif",
    webp: "webp",
    avif: "avif",
    svg: "svg",
    bmp: "bmp",
    ico: "ico",
  }
  return (ext && byExt[ext]) || "other"
}

export function isImageRequest(r: DevToolsRequest) {
  if (r.url.startsWith("data:") || r.url.startsWith("blob:") || r.redirect || !r.end) return false
  if (r.error && !r.status) return false
  if ((r.status ?? 0) >= 400) return false
  return r.resourceType === "Image" || (r.mimeType ?? "").startsWith("image/")
}

const bareURL = (u: string) => u.split("#")[0]!

export function bodyBytes(body: string, base64: boolean) {
  if (!base64) return new TextEncoder().encode(body).length
  return Math.floor((body.length * 3) / 4) - (body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0)
}

const cssLength = (s: string, of: number) =>
  s.endsWith("%") ? (Number.parseFloat(s) / 100) * of : s.endsWith("px") ? Number.parseFloat(s) : undefined

/** background-size of the first layer, as the CSS pixels the image is drawn at. */
export function backgroundSize(fit: string, box: { width: number; height: number }, nw?: number, nh?: number) {
  const v = (fit.split(",")[0] ?? "").trim()
  if (v === "cover" || v === "contain") {
    if (!nw || !nh) return undefined
    const scale = v === "cover" ? Math.max(box.width / nw, box.height / nh) : Math.min(box.width / nw, box.height / nh)
    return { width: nw * scale, height: nh * scale }
  }
  const [a = "auto", b = "auto"] = v ? v.split(/\s+/) : []
  let w = cssLength(a, box.width)
  let h = cssLength(b, box.height)
  if (w === undefined && h === undefined) return nw && nh ? { width: nw, height: nh } : undefined
  if (w === undefined) w = nw && nh && h !== undefined ? (h * nw) / nh : undefined
  if (h === undefined) h = nw && nh && w !== undefined ? (w * nh) / nw : undefined
  return w !== undefined && h !== undefined && Number.isFinite(w) && Number.isFinite(h)
    ? { width: w, height: h }
    : undefined
}

/** The device pixels a use draws the image at, if that can be told. */
export function neededFor(u: ImageUseAt, natural?: { width: number; height: number }) {
  if (u.hidden || u.width <= 0 || u.height <= 0) return undefined
  const nw = u.naturalWidth || natural?.width
  const nh = u.naturalHeight || natural?.height
  const fit = (u.fit ?? "").trim()
  let size: { width: number; height: number } | undefined = { width: u.width, height: u.height }
  if (u.kind === "css") size = backgroundSize(fit, u, nw, nh)
  else if (fit === "none") size = nw && nh ? { width: nw, height: nh } : undefined
  else if ((fit === "contain" || fit === "cover" || fit === "scale-down") && nw && nh) {
    let scale = fit === "cover" ? Math.max(u.width / nw, u.height / nh) : Math.min(u.width / nw, u.height / nh)
    if (fit === "scale-down") scale = Math.min(1, scale)
    size = { width: nw * scale, height: nh * scale }
  }
  if (!size) return undefined
  return { width: Math.ceil(size.width * u.dpr), height: Math.ceil(size.height * u.dpr) }
}

const px = (s: { width: number; height: number }) => `${Math.round(s.width)}×${Math.round(s.height)}`
const kb = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
const secs = (ms: number) => `${Math.round(ms / 100) / 10} s`

/**
 * Checks the images a page loaded against how it draws them: loaded but
 * not on screen within showWindow, bigger than any place draws them, in a
 * format WebP beats, or barely compressed. Images that loaded before the
 * pages were first scanned aren't judged by when they showed up; without
 * image lines at all only the files themselves are checked.
 */
export function analyzeImages({
  requests,
  shots,
  measures = new Map(),
  kinds = new Map(),
  now,
}: {
  requests: ImageRequest[]
  shots: ImageShot[]
  measures?: Map<string, ImageMeasure>
  /** the kind of each target (page, iframe, worker …): workers' images are never drawn */
  kinds?: Map<string, string>
  /** the latest time on the analysis clock lines are known for */
  now: number
}): ImageReport {
  const uses = new Map<string, ImageUseAt[]>()
  for (const s of shots.toSorted((a, b) => a.at - b.at)) {
    for (const u of s.uses ?? []) {
      const url = bareURL(u.src)
      const list = uses.get(url) ?? []
      list.push({ ...u, at: s.at, dpr: s.dpr || 1, target: s.target, frame: s.frame ?? "" })
      uses.set(url, list)
    }
  }
  const watchedFrom = Math.min(...shots.map((s) => s.at)) - scanSlack
  const groups = new Map<string, ImageRequest[]>()
  for (const r of requests) {
    if (!isImageRequest(r)) continue
    const url = bareURL(r.url)
    groups.set(url, [...(groups.get(url) ?? []), r])
  }

  const entries: ImageEntry[] = []
  const findings: ImageFinding[] = []
  const add = (e: ImageEntry, f: Omit<ImageFinding, "id" | "url" | "requests">) =>
    findings.push({ ...f, id: `${f.rule}:${e.url}`, url: e.url, requests: e.requests.map((r) => r.key) })

  for (const [url, rs] of groups) {
    rs.sort((a, b) => a.at - b.at)
    const withBody = rs.findLast((r) => r.body && !r.bodyTruncated)
    const format = imageFormat(
      withBody?.mimeType ?? rs.at(-1)?.mimeType ?? header(rs.at(-1)?.responseHeaders, "content-type"),
      url,
    )
    const downloaded = rs.reduce((n, r) => n + (r.cached ? 0 : (r.size ?? 0)), 0)
    const bytes = withBody
      ? bodyBytes(withBody.body!, !!withBody.bodyBase64)
      : Math.max(0, ...rs.map((r) => r.size ?? 0))
    const measure = withBody ? measures.get(withBody.key) : undefined
    const all = uses.get(url) ?? []
    const sized = all.find((u) => u.naturalWidth && u.naturalHeight)
    const natural = measure
      ? { width: measure.width, height: measure.height }
      : sized
        ? { width: sized.naturalWidth!, height: sized.naturalHeight! }
        : undefined
    let needed: { width: number; height: number } | undefined
    for (const u of all) {
      const n = neededFor(u, natural)
      if (n) needed = { width: Math.max(needed?.width ?? 0, n.width), height: Math.max(needed?.height ?? 0, n.height) }
    }
    const e: ImageEntry = {
      url,
      format,
      requests: rs,
      bytes,
      downloaded,
      natural,
      needed,
      uses: firstUses(all),
      loadedAt: rs[0]!.at,
      shownAt: all.find((u) => u.shown)?.at,
      body: withBody
        ? { data: withBody.body!, base64: !!withBody.bodyBase64, mime: withBody.mimeType ?? "" }
        : undefined,
      measure,
      best: bytes,
    }
    entries.push(e)
    const name = `\`${splitURL(url).name || url}\``
    const fromWorker = rs.every((r) => workers.has(kinds.get(r.target) ?? ""))

    if (shots.length > 0 && e.loadedAt >= watchedFrom && !fromWorker && !url.endsWith("/favicon.ico")) {
      const drawn = all.filter((u) => !u.hidden)
      if (e.shownAt !== undefined && e.shownAt - e.loadedAt > showWindow) {
        add(e, {
          rule: "late",
          severity: "info",
          title: `${name} loaded ${secs(e.shownAt - e.loadedAt)} before it was shown`,
          detail: `It came while nothing on screen used it. \`loading="lazy"\` or loading it when it is about to scroll into view keeps the first screen's bandwidth for what it shows.`,
        })
      } else if (e.shownAt === undefined && now - e.loadedAt >= showWindow) {
        e.best = 0
        if (all.length > 0) {
          add(e, {
            rule: "offscreen",
            severity: "warning",
            title: `${name} wasn't on screen in the ${showWindow / 1000} s after it loaded`,
            detail:
              drawn.length > 0
                ? `The page has it below the fold or outside the viewport. Loading it with \`loading="lazy"\`, or once it is about to show, saves ${kb(downloaded || bytes)} at start.`
                : `Every element that uses it is hidden (display: none, invisible or no size), so it was downloaded for nothing.`,
            saving: downloaded || bytes,
          })
        } else {
          add(e, {
            rule: "unused",
            severity: "warning",
            title: `${name} loaded but the page draws it nowhere`,
            detail: `No <img>, CSS background, SVG <image> or poster used it while the page was watched. It may be preloaded for a later screen, or not needed at all.`,
            saving: downloaded || bytes,
          })
        }
      }
    }

    if (format === "svg" || format === "ico" || format === "other") continue

    if (natural && needed && natural.width >= needed.width * 1.5 && natural.height >= needed.height * 1.5) {
      const area = natural.width * natural.height
      const used = Math.min(natural.width, needed.width) * Math.min(natural.height, needed.height)
      if (area - used >= 10_000) {
        const ratio = area / used
        const saving = Math.round(bytes * (1 - 1 / ratio))
        const resized = measure?.resized?.webp
        e.best = Math.min(e.best, resized ?? bytes - saving)
        add(e, {
          rule: "oversized",
          severity: ratio >= 4 ? "warning" : "info",
          title: `${name} is ${px(natural)} but drawn at ${px(needed)} device pixels at most`,
          detail:
            `It has ${Math.round(ratio * 10) / 10}× the pixels its ${all.length > 1 ? `${firstUses(all).length} uses need` : "use needs"}, counting the screen's density. ` +
            (resized !== undefined
              ? `At ${px(measure!.resized!)} as WebP it would be ${kb(resized)} instead of ${kb(bytes)}.`
              : `A ${px(needed)} version would be about ${kb(bytes - saving)} instead of ${kb(bytes)}.`),
          saving,
          estimated: true,
        })
      }
    }

    const ratio = rasterRatio[format]
    if (ratio !== undefined) {
      const webp = format !== "gif" && measure?.webp !== undefined ? measure.webp : Math.round(bytes * ratio)
      const estimated = format === "gif" || measure?.webp === undefined
      const saving = bytes - webp
      if (saving >= 1024 && saving >= bytes * 0.1) {
        e.best = Math.min(e.best, webp)
        add(e, {
          rule: "format",
          severity: saving >= 20 * 1024 || saving >= bytes * 0.5 ? "warning" : "info",
          title: `${name} is ${formatName[format]}: as WebP it would be ${estimated ? "about " : ""}${kb(webp)} instead of ${kb(bytes)}`,
          detail:
            format === "gif"
              ? `An animated GIF is usually several times bigger than the same animation as animated WebP or a muted looping video; a still one than a WebP.`
              : estimated
                ? `A guess from what WebP usually saves on ${formatName[format]}; the file itself wasn't recorded to measure it.`
                : `Measured by re-encoding it as WebP at quality ${webpQuality * 100}. AVIF usually saves more still.`,
          saving,
          estimated,
        })
      }
    }

    if ((format === "webp" || format === "avif") && natural) {
      const bpp = (bytes * 8) / (natural.width * natural.height)
      const webp = measure?.webp
      if (webp !== undefined && bytes - webp >= Math.max(2048, bytes * 0.3)) {
        e.best = Math.min(e.best, webp)
        add(e, {
          rule: "uncompressed",
          severity: "warning",
          title: `${name} looks barely compressed: re-encoded it is ${kb(webp)} instead of ${kb(bytes)}`,
          detail: `${formatName[format]} at ${Math.round(bpp * 100) / 100} bits per pixel; WebP at quality ${webpQuality * 100} is ${Math.round((1 - webp / bytes) * 100)}% smaller. It was probably saved lossless or at a quality close to 100.`,
          saving: bytes - webp,
        })
      } else if (webp === undefined && bpp > (format === "avif" ? 1.5 : 2.5) && bytes >= 8 * 1024) {
        add(e, {
          rule: "uncompressed",
          severity: "info",
          title: `${name} is heavy for its size: ${Math.round(bpp * 100) / 100} bits per pixel`,
          detail: `Lossy ${formatName[format]} photos usually take under ${format === "avif" ? 1 : 1.5} bits per pixel; this one may have been saved lossless or at a very high quality.`,
          estimated: true,
        })
      }
    }
  }

  entries.sort((a, b) => b.bytes - b.best - (a.bytes - a.best) || a.loadedAt - b.loadedAt)
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
  findings.sort((a, b) => order[a.severity] - order[b.severity] || (b.saving ?? 0) - (a.saving ?? 0))
  const count = (s: Severity) => findings.filter((f) => f.severity === s).length
  return {
    entries,
    findings,
    summary: {
      images: entries.length,
      downloaded: entries.reduce((n, e) => n + e.downloaded, 0),
      unshown: findings
        .filter((f) => f.rule === "offscreen" || f.rule === "unused")
        .reduce((n, f) => n + (f.saving ?? 0), 0),
      saving: entries.reduce((n, e) => n + Math.max(0, e.bytes - e.best), 0),
      shots: shots.length > 0,
      errors: count("error"),
      warnings: count("warning"),
      infos: count("info"),
    },
  }
}

/** Each element's first use and the biggest it was drawn. */
function firstUses(all: ImageUseAt[]) {
  const byElement = new Map<string, ImageUseAt>()
  for (const u of all) {
    const k = `${u.target}/${u.frame}/${u.element}/${u.kind}`
    const prev = byElement.get(k)
    if (!prev) byElement.set(k, u)
    else
      byElement.set(k, {
        ...prev,
        width: Math.max(prev.width, u.width),
        height: Math.max(prev.height, u.height),
        shown: prev.shown || u.shown,
        hidden: prev.hidden && u.hidden,
      })
  }
  return [...byElement.values()]
}
