import type { DevToolsRequest } from "@/api/client"
import { decodeBase64, textOf } from "@/lib/recording/body"
import { splitURL } from "@/lib/recording/devtools"
import type { Severity } from "@/lib/recording/images"

export type SvgSourceKind = "script" | "document" | "style" | "svg" | "data" | "dom"

/** A text the paths were found in: a response body, or the inline SVGs a page drew. */
export type SvgSource = {
  key: string
  url: string
  label: string
  kind: SvgSourceKind
  text: string
  requests: string[]
}

export type SvgPath = {
  d: string
  source: string
  offset: number
  viewBox?: number[]
  /** the most digits after a decimal point */
  decimals: number
  /** digits after the point worth keeping for the path's size */
  precision: number
  extent: number
  absolute: number
  relative: number
  /** the path with its numbers rounded to precision, nothing else changed */
  rounded: string
  /** what svgo's convertPathData makes of it at that precision, once known */
  optimized?: string
}

export type SvgRule = "precision" | "encoding" | "duplicate"

export type SvgFinding = {
  id: string
  rule: SvgRule
  severity: Severity
  title: string
  detail: string
  source?: string
  paths: SvgPath[]
  saving: number
}

export type SvgSourceStats = {
  source: SvgSource
  paths: SvgPath[]
  bytes: number
  precisionSaving: number
  encodingSaving: number
}

export type SvgSummary = {
  sources: number
  paths: number
  bytes: number
  saving: number
  duplicated: number
  optimized: boolean
  errors: number
  warnings: number
  infos: number
}

export type SvgReport = { sources: SvgSourceStats[]; findings: SvgFinding[]; summary: SvgSummary }

const textTypes = new Set(["Script", "Document", "Stylesheet", "XHR", "Fetch", "Other"])
const pathChars = /^\s*[Mm][\s\d.,eE+\-MmLlHhVvCcSsQqTtAaZz]*$/
const maxPath = 100_000

export const optimizeKey = (p: Pick<SvgPath, "precision" | "d">) => `${p.precision}:${p.d}`

function sourceKind(r: DevToolsRequest): SvgSourceKind | undefined {
  const mime = (r.mimeType ?? "").toLowerCase()
  if (mime === "image/svg+xml" || /\.svg(?:$|\?)/i.test(r.url)) return "svg"
  if (r.resourceType === "Image" || r.resourceType === "Media" || r.resourceType === "Font") return undefined
  if (r.resourceType === "Script" || mime.includes("javascript")) return "script"
  if (r.resourceType === "Stylesheet" || mime === "text/css") return "style"
  if (r.resourceType === "Document" || mime.includes("html")) return "document"
  if (textTypes.has(r.resourceType ?? "") && (mime.includes("json") || mime.startsWith("text/"))) return "data"
  return undefined
}

/**
 * The bodies paths can be in, one per URL (the latest that was recorded),
 * and the inline SVGs of each page as one source.
 */
export function svgSources(
  requests: (DevToolsRequest & { key: string })[],
  inline: { target: string; frame?: string; url: string; svgs: string[] }[] = [],
): SvgSource[] {
  const byURL = new Map<string, SvgSource>()
  for (const r of requests) {
    const kind = sourceKind(r)
    if (!kind || !r.body) continue
    const text = r.bodyBase64 ? textOf(decodeBase64(r.body)) : r.body
    if (!text || !/\bd\s*[=:]|["']d["']/.test(text)) continue
    const url = r.url.split("#")[0]!
    const prev = byURL.get(url)
    byURL.set(url, {
      key: url,
      url,
      label: splitURL(url).name || url,
      kind,
      text,
      requests: [...(prev?.requests ?? []), r.key],
    })
  }
  const sources = [...byURL.values()]
  const dom = new Map<string, { url: string; parts: Set<string> }>()
  for (const s of inline) {
    const key = s.frame ? `${s.target}/${s.frame}` : s.target
    const page = dom.get(key) ?? { url: s.url, parts: new Set<string>() }
    for (const svg of s.svgs) page.parts.add(svg)
    if (s.url) page.url = s.url
    dom.set(key, page)
  }
  for (const [target, page] of dom) {
    sources.push({
      key: `dom:${target}`,
      url: page.url,
      label: `Inline SVG · ${splitURL(page.url).host || target}`,
      kind: "dom",
      text: [...page.parts].join("\n"),
      requests: [],
    })
  }
  return sources
}

const patterns = [
  /\bd\s*=\s*\\?(["'])([^"'\\]*?)\\?\1/g,
  /(?:^|[{,\s(])["']?d["']?\s*:\s*(["'`])([^"'`]*?)\1/g,
  /setAttribute(?:NS)?\(\s*(?:null\s*,\s*)?["']d["']\s*,\s*(["'`])([^"'`]*?)\1/g,
]
const dataURI = /data:image\/svg\+xml(;base64)?(?:;[^,"'()\s]*)?,([A-Za-z0-9+/=]+|[^"'`)]+)/g
const viewBoxRE =
  /viewBox\\?["']?\s*[=:]\s*\\?["'`]\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*\\?["'`]/g

export const isPathData = (s: string) => s.length >= 8 && s.length <= maxPath && pathChars.test(s) && /\d/.test(s)

function viewBoxBefore(text: string, at: number) {
  const window = text.slice(Math.max(0, at - 1500), at)
  let last: number[] | undefined
  for (const m of window.matchAll(viewBoxRE)) last = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  return last
}

/** Every path's d in a text: markup, compiled JSX, JSON, setAttribute and SVG data URIs. */
export function extractPaths(text: string, source: string): SvgPath[] {
  const found = new Map<number, SvgPath>()
  const scan = (t: string, base: number, viewBoxOf: (at: number) => number[] | undefined) => {
    for (const re of patterns) {
      for (const m of t.matchAll(re)) {
        const d = m[2]!.replace(/\\[nrt]/g, " ")
        if (!isPathData(d)) continue
        const at = base + m.index
        if (!found.has(at)) found.set(at, { ...pathStats(d, viewBoxOf(m.index)), source, offset: at })
      }
    }
  }
  scan(text, 0, (at) => viewBoxBefore(text, at))
  for (const m of text.matchAll(dataURI)) {
    let svg: string
    try {
      svg = m[1] ? atob(m[2]!) : decodeURIComponent(m[2]!)
    } catch {
      continue
    }
    scan(svg, m.index, (at) => viewBoxBefore(svg, at))
  }
  return [...found.values()].toSorted((a, b) => a.offset - b.offset)
}

const argCount: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }
const token = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g

/** Digits after the point worth keeping: three for a path a unit across, none for one a thousand across. */
export const precisionFor = (extent: number) =>
  extent > 0 ? Math.min(3, Math.max(0, 3 - Math.floor(Math.log10(extent)))) : 2

const roundTo = (n: number, digits: number) => {
  const s = n.toFixed(digits)
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s
}

export function roundPath(d: string, digits: number) {
  return d.replace(/[-+]?(?:\d+\.\d+|\.\d+)(?:[eE][-+]?\d+)?/g, (n) => {
    const r = roundTo(Number(n), digits)
    if (r === "-0") return "0"
    return /^[-+]?\./.test(n) ? r.replace(/^(-?)0\./, "$1.") : r
  })
}

export function pathStats(d: string, viewBox?: number[]) {
  let cmd = ""
  let args: number[] = []
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let absolute = 0
  let relative = 0
  let decimals = 0
  let first = true
  const point = (px: number, py: number) => {
    minX = Math.min(minX, px)
    maxX = Math.max(maxX, px)
    minY = Math.min(minY, py)
    maxY = Math.max(maxY, py)
  }
  const run = () => {
    const lower = cmd.toLowerCase()
    const rel = cmd === lower
    const n = argCount[lower] ?? 0
    if (lower !== "m" || !first) {
      if (rel) relative++
      else absolute++
    }
    first = false
    const groups = n > 0 ? Math.floor(args.length / n) : 0
    for (let g = 0; g < groups; g++) {
      const i = g * n
      const a = args.slice(i, i + n)
      const ox = rel ? x : 0
      const oy = rel ? y : 0
      if (lower === "h") x = ox + a[0]!
      else if (lower === "v") y = oy + a[0]!
      else {
        const controls = lower === "a" ? 0 : n - 2
        for (let j = 0; j < controls; j += 2) point(ox + a[j]!, oy + a[j + 1]!)
        x = ox + a[n - 2]!
        y = oy + a[n - 1]!
      }
      point(x, y)
      if (lower === "m" && g === 0) {
        startX = x
        startY = y
      }
    }
    if (lower === "z") {
      x = startX
      y = startY
    }
  }
  for (const m of d.matchAll(token)) {
    if (m[1]) {
      if (cmd) run()
      cmd = m[1]
      args = []
    } else {
      const dot = m[2]!.indexOf(".")
      if (dot >= 0) decimals = Math.max(decimals, m[2]!.replace(/[eE].*$/, "").length - dot - 1)
      args.push(Number(m[2]))
    }
  }
  if (cmd) run()
  const extent =
    viewBox && viewBox[2]! > 0
      ? Math.max(viewBox[2]!, viewBox[3]!)
      : Number.isFinite(minX)
        ? Math.max(maxX - minX, maxY - minY)
        : 0
  const precision = precisionFor(extent)
  return { d, viewBox, decimals, precision, extent, absolute, relative, rounded: roundPath(d, precision) }
}

/** The paths optimized by svgo's convertPathData, keyed by optimizeKey. */
export async function optimizePaths(paths: SvgPath[]): Promise<Map<string, string>> {
  const { optimize } = await import("svgo/browser")
  const out = new Map<string, string>()
  const byPrecision = new Map<number, string[]>()
  for (const p of paths) {
    if (out.has(optimizeKey(p))) continue
    out.set(optimizeKey(p), p.d)
    byPrecision.set(p.precision, [...(byPrecision.get(p.precision) ?? []), p.d])
  }
  for (const [precision, ds] of byPrecision) {
    for (let i = 0; i < ds.length; i += 500) {
      const batch = ds.slice(i, i + 500)
      const svg = `<svg xmlns="http://www.w3.org/2000/svg">${batch.map((d, j) => `<path id="p${j}" d="${d}"/>`).join("")}</svg>`
      let result: string
      try {
        result = optimize(svg, { plugins: [{ name: "convertPathData", params: { floatPrecision: precision } }] }).data
      } catch {
        continue
      }
      for (const m of result.matchAll(/<path id="p(\d+)"(?: d="([^"]*)")?/g)) {
        const d = batch[Number(m[1])]
        if (d !== undefined) out.set(`${precision}:${d}`, m[2] ?? "")
      }
    }
  }
  return out
}

const kb = (n: number) => (n >= 1024 ? `${Math.round((n / 1024) * 10) / 10} KB` : `${n} B`)

/**
 * The SVG paths the WebViews loaded: more digits than their size needs,
 * longer commands than svgo would write, and the same path shipped more
 * than once. Savings are bytes before gzip or Brotli.
 */
export function analyzeSvg(sources: SvgSource[], optimized?: Map<string, string>): SvgReport {
  const stats: SvgSourceStats[] = []
  const findings: SvgFinding[] = []
  const network = new Map<string, SvgPath[]>()
  const dom: SvgPath[] = []
  for (const source of sources) {
    const paths = extractPaths(source.text, source.key)
    if (!paths.length) continue
    for (const p of paths) {
      const o = optimized?.get(optimizeKey(p))
      if (o !== undefined) p.optimized = o
      if (source.kind === "dom") dom.push(p)
      else network.set(p.d, [...(network.get(p.d) ?? []), p])
    }
    const bytes = paths.reduce((n, p) => n + p.d.length, 0)
    const precisionSaving = paths.reduce((n, p) => n + p.d.length - p.rounded.length, 0)
    const encodingSaving = paths.reduce(
      (n, p) => n + (p.optimized !== undefined ? Math.max(0, p.rounded.length - p.optimized.length) : 0),
      0,
    )
    stats.push({ source, paths, bytes, precisionSaving, encodingSaving })
  }
  const inNetwork = new Set(network.keys())
  for (const s of stats) {
    if (s.source.kind !== "dom") continue
    const own = s.paths.filter((p) => !inNetwork.has(p.d))
    s.paths = own
    s.bytes = own.reduce((n, p) => n + p.d.length, 0)
    s.precisionSaving = own.reduce((n, p) => n + p.d.length - p.rounded.length, 0)
    s.encodingSaving = own.reduce(
      (n, p) => n + (p.optimized !== undefined ? Math.max(0, p.rounded.length - p.optimized.length) : 0),
      0,
    )
  }
  const live = stats.filter((s) => s.paths.length > 0)

  for (const s of live) {
    const name = `\`${s.source.label}\``
    const over = s.paths.filter((p) => p.decimals > p.precision)
    if (s.precisionSaving >= 256 && over.length) {
      const most = Math.max(...over.map((p) => p.decimals))
      const digits = [...new Set(over.map((p) => p.precision))].toSorted((a, b) => a - b).join(" or ")
      findings.push({
        id: `precision:${s.source.key}`,
        rule: "precision",
        severity: s.precisionSaving >= 10 * 1024 || s.precisionSaving >= s.bytes * 0.2 ? "warning" : "info",
        title: `${name}: ${over.length} of ${s.paths.length} paths keep up to ${most} decimals, rounding saves ${kb(s.precisionSaving)}`,
        detail: `Rounded to ${digits} digit${digits === "1" ? "" : "s"} after the point for their size (from the viewBox, or the path's own extent) they look the same; ${kb(s.precisionSaving)} of ${kb(s.bytes)} path data, before compression.`,
        source: s.source.key,
        paths: over,
        saving: s.precisionSaving,
      })
    }
    if (s.encodingSaving >= 256) {
      const absolute = s.paths.reduce((n, p) => n + p.absolute, 0)
      const total = absolute + s.paths.reduce((n, p) => n + p.relative, 0)
      const better = s.paths.filter((p) => p.optimized !== undefined && p.optimized.length < p.rounded.length)
      findings.push({
        id: `encoding:${s.source.key}`,
        rule: "encoding",
        severity: s.encodingSaving >= 10 * 1024 || s.encodingSaving >= s.bytes * 0.2 ? "warning" : "info",
        title: `${name}: shorter path commands save another ${kb(s.encodingSaving)}`,
        detail: `${total ? `${Math.round((absolute / total) * 100)}% of the commands are absolute. ` : ""}svgo's convertPathData picks relative or absolute per segment, whichever is shorter, drops separators and repeated commands, and turns lines into H and V and curves into shorthand or arcs where it can. ${better.length} paths get shorter.`,
        source: s.source.key,
        paths: better,
        saving: s.encodingSaving,
      })
    }
  }

  const dupes = [...network.values()].filter((ps) => ps.length > 1)
  const duplicated = dupes.reduce((n, ps) => n + ps[0]!.d.length * (ps.length - 1), 0)
  if (duplicated >= 256) {
    const files = new Set(dupes.flatMap((ps) => ps.map((p) => p.source)))
    findings.push({
      id: "duplicate",
      rule: "duplicate",
      severity: duplicated >= 10 * 1024 ? "warning" : "info",
      title: `${dupes.length} path${dupes.length === 1 ? " is" : "s are"} shipped more than once: ${kb(duplicated)}`,
      detail: `The same path data appears ${dupes.reduce((n, ps) => n + ps.length, 0)} times in ${files.size} file${files.size === 1 ? "" : "s"}. One icon component, a sprite with <symbol> and <use>, or an SVG file the browser caches ships it once.`,
      paths: dupes.toSorted((a, b) => b[0]!.d.length * b.length - a[0]!.d.length * a.length).map((ps) => ps[0]!),
      saving: duplicated,
    })
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
  findings.sort((a, b) => order[a.severity] - order[b.severity] || b.saving - a.saving)
  live.sort(
    (a, b) => b.precisionSaving + b.encodingSaving - (a.precisionSaving + a.encodingSaving) || b.bytes - a.bytes,
  )
  const count = (s: Severity) => findings.filter((f) => f.severity === s).length
  return {
    sources: live,
    findings,
    summary: {
      sources: live.length,
      paths: live.reduce((n, s) => n + s.paths.length, 0),
      bytes: live.reduce((n, s) => n + s.bytes, 0),
      saving: live.reduce((n, s) => n + s.precisionSaving + s.encodingSaving, 0) + duplicated,
      duplicated,
      optimized: optimized !== undefined,
      errors: count("error"),
      warnings: count("warning"),
      infos: count("info"),
    },
  }
}

/** How often a path occurs among the report's network sources. */
export function occurrences(report: SvgReport, d: string) {
  return report.sources.flatMap((s) => s.paths.filter((p) => p.d === d).map((p) => ({ source: s.source, path: p })))
}
