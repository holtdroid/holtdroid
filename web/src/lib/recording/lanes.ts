import type { DeviceState, Network, RecordingChunk, StatusEvent } from "@/api/client"
import { crashOwner } from "@/lib/logcat"
import { type DevToolsLog, requestPhase, splitURL } from "@/lib/recording/devtools"
import type { RecordingFiles } from "@/lib/recording/files"
import {
  type At,
  clock,
  lastAt,
  type LogLine,
  parseLogcat,
  type ScreenState,
  type Segment,
} from "@/lib/recording/timeline"

export type ScreenKind = "portrait" | "landscape" | "off" | "locked" | "novideo"
export type AppKind = "running" | "closed" | "starting"
export type NetworkKind = "normal" | "throttled" | "offline"

export type Span<K extends string = string> = { start: number; end: number; kind: K; label: string }
export type Tick = { t: number; title: string }

const videoGap = 1500

/** Cuts [0, duration] at every edge of the layers and keeps, for each piece, the first layer that covers it. */
export function flatten<K extends string>(duration: number, layers: Span<K>[][]): Span<K>[] {
  const edges = new Set([0, duration])
  for (const l of layers) {
    for (const s of l) {
      edges.add(Math.min(duration, Math.max(0, s.start)))
      edges.add(Math.min(duration, Math.max(0, s.end)))
    }
  }
  const cuts = [...edges].toSorted((a, b) => a - b)
  const out: Span<K>[] = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i]!
    const b = cuts[i + 1]!
    if (b <= a) continue
    const mid = (a + b) / 2
    let hit: Span<K> | undefined
    for (const l of layers) {
      hit = l.find((s) => s.start <= mid && mid < s.end)
      if (hit) break
    }
    if (!hit) continue
    const last = out.at(-1)
    if (last && last.end === a && last.kind === hit.kind && last.label === hit.label) last.end = b
    else out.push({ start: a, end: b, kind: hit.kind, label: hit.label })
  }
  return out
}

/** When the display was off or locked: from the recorded screen state, or from the portal's buttons in older recordings. */
export function screenStates(screens: At<ScreenState>[], keys: { t: number; key: string }[], duration: number) {
  const marks = screens.length
    ? screens.map((s) => ({ t: s.t, kind: !s.v.on ? "off" : s.v.locked ? "locked" : "on" }))
    : keys.flatMap((k) =>
        k.key === "screen-off"
          ? [{ t: k.t, kind: "off" }]
          : k.key === "lock"
            ? [{ t: k.t, kind: "locked" }]
            : k.key === "unlock"
              ? [{ t: k.t, kind: "on" }]
              : [],
      )
  const out: Span<ScreenKind>[] = []
  marks.forEach((m, i) => {
    if (m.kind === "on") return
    const end = marks[i + 1]?.t ?? duration
    const last = out.at(-1)
    if (last && last.kind === m.kind && last.end === m.t) last.end = end
    else if (end > m.t)
      out.push({ start: m.t, end, kind: m.kind as ScreenKind, label: m.kind === "off" ? "Off" : "Locked" })
  })
  return out
}

/** Portrait and landscape where there is video, off and locked over them, and the gaps without video. */
export function screenLane(
  segments: Segment[],
  screens: At<ScreenState>[],
  keys: { t: number; key: string }[],
  duration: number,
): Span<ScreenKind>[] {
  const video: Span<ScreenKind>[] = []
  for (const s of segments) {
    const kind: ScreenKind = s.width > s.height ? "landscape" : "portrait"
    const end = s.start + s.duration
    const last = video.at(-1)
    if (last && last.kind === kind && s.start - last.end <= videoGap) last.end = Math.max(last.end, end)
    else video.push({ start: s.start, end, kind, label: kind === "landscape" ? "Landscape" : "Portrait" })
  }
  return flatten(duration, [
    screenStates(screens, keys, duration),
    video,
    [{ start: 0, end: duration, kind: "novideo", label: "" }],
  ])
}

const stateNames: Record<string, string> = {
  provisioning: "Starting",
  booting: "Booting",
  installing: "Installing",
  restoring: "Restoring data",
  instrumenting: "Instrumenting",
  stopping: "Stopping",
  failed: "Failed",
}

/** Whether the app was running, from the agent's status; a run after a close is marked reopened. */
export function appLane(status: At<StatusEvent>[], duration: number, title: string): Span<AppKind>[] {
  const spans: Span<AppKind>[] = []
  let closed = false
  status.forEach((s, i) => {
    const end = status[i + 1]?.t ?? duration
    const kind: AppKind = s.v.appRunning ? "running" : s.v.state === "ready" ? "closed" : "starting"
    const label =
      kind === "running"
        ? closed
          ? `${title} · reopened`
          : title
        : kind === "closed"
          ? "Closed"
          : (stateNames[s.v.state] ?? s.v.state)
    if (kind === "closed") closed = true
    const last = spans.at(-1)
    if (last && last.kind === kind && last.label === label) last.end = end
    else if (end > s.t) spans.push({ start: s.t, end, kind, label })
  })
  return spans
}

/** The emulated network, the region and the VPN exit as they changed. */
export function networkLane(device: At<DeviceState>[], network: At<Network>[], duration: number): Span<NetworkKind>[] {
  const times = [...new Set([...device.map((d) => d.t), ...network.map((n) => n.t)])].toSorted((a, b) => a - b)
  const spans: Span<NetworkKind>[] = []
  times.forEach((t, i) => {
    const d = lastAt(device, t)?.v
    const n = lastAt(network, t)?.v
    const end = times[i + 1] ?? duration
    let kind: NetworkKind = "normal"
    const parts: string[] = []
    if (d?.airplaneMode) {
      kind = "offline"
      parts.push("Airplane mode")
    } else if (d && !d.wifi && !d.mobileData) {
      kind = "offline"
      parts.push("No network")
    } else {
      const profile = d?.networkProfile ? d.networkProfiles?.find((p) => p.id === d.networkProfile) : undefined
      if (profile && profile.id !== "full") {
        kind = "throttled"
        parts.push(profile.name)
      }
      const region = d?.networkRegion
      if (region) {
        kind = "throttled"
        parts.push(d.networkRegions?.find((r) => r.id === region.region)?.name ?? region.region)
      }
      if (parts.length === 0 && d?.networkProfile) parts.push("No emulation")
    }
    if (n) parts.push(n.country ? n.country.toUpperCase() : n.location || "direct")
    const label = parts.join(" · ")
    const last = spans.at(-1)
    if (last && last.kind === kind && last.label === label) last.end = end
    else if (end > t) spans.push({ start: t, end, kind, label })
  })
  return spans
}

export type CrashKind = "crash" | "anr"
export type Crash = { t: number; kind: CrashKind; title: string; detail: string }

/** The app's crashes and ANRs in logcat lines: Java crashes, tombstones and "ANR in". */
export function scanCrashes(lines: LogLine[], pkg: string): Crash[] {
  const out: Crash[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (l.tag === "ActivityManager" && l.message.startsWith(`ANR in ${pkg}`)) {
      const reason = lines.slice(i + 1, i + 6).find((x) => x.message.startsWith("Reason:"))
      out.push({ t: l.t, kind: "anr", title: "App not responding", detail: reason?.message.slice(8).trim() ?? "" })
      continue
    }
    const java = l.tag === "AndroidRuntime" && l.message.startsWith("FATAL EXCEPTION")
    const native = l.tag === "DEBUG" && l.message.startsWith("*** *** ***")
    if (!java && !native) continue
    const window = lines.slice(i + 1, i + 8).filter((x) => x.tag === l.tag)
    const owner = window.findIndex((x) => crashOwner(x, pkg, undefined) !== undefined)
    if (owner < 0 || !crashOwner(window[owner]!, pkg, undefined)) continue
    const cause = java
      ? window[owner + 1]?.message.trim()
      : window.find((x) => x.message.startsWith("signal "))?.message.trim()
    out.push({ t: l.t, kind: "crash", title: java ? "App crashed" : "Native crash", detail: cause ?? "" })
  }
  return out
}

/** Reads a recording's logcat chunk by chunk for crashes, remembering the chunks already read. */
export class CrashScan {
  #done = new Map<string, Crash[]>()

  constructor(
    readonly files: RecordingFiles,
    readonly pkg: string,
  ) {}

  async scan(chunks: RecordingChunk[], growing: boolean) {
    for (const [i, c] of chunks.entries()) {
      if (this.#done.has(c.file)) continue
      const text = await this.files.text(c.file).catch(() => "")
      const found = scanCrashes(parseLogcat(text, c.file), this.pkg)
      if (growing && i === chunks.length - 1)
        return [...chunks.slice(0, i).flatMap((x) => this.#done.get(x.file) ?? []), ...found]
      this.#done.set(c.file, found)
    }
    return chunks.flatMap((c) => this.#done.get(c.file) ?? [])
  }
}

export type IssueLevel = "error" | "warning"
export type Issue = {
  id: string
  t: number
  level: IssueLevel
  kind: "request" | "console" | "crash" | "anr" | "closed"
  title: string
  detail: string
  request?: string
  message?: string
}

/** What went wrong in a recording, for the Findings tab and the Events lane. */
export function issuesOf(log: DevToolsLog, status: At<StatusEvent>[], crashes: Crash[], end: number): Issue[] {
  const out: Issue[] = []
  for (const r of log.requests) {
    const phase = requestPhase(r, end)
    if (phase !== "failed" && phase !== "server-error" && phase !== "client-error") continue
    const url = splitURL(r.url)
    out.push({
      id: `r:${r.key}`,
      t: r.start,
      level: phase === "client-error" ? "warning" : "error",
      kind: "request",
      title: `${r.method} ${url.path} → ${r.status || r.error || "failed"}`,
      detail: [url.host, r.end ? `${((r.end - r.start) / 1000).toFixed(1)} s` : ""].filter(Boolean).join(" · "),
      request: r.key,
    })
  }
  for (const c of log.console) {
    if (c.level !== "error") continue
    out.push({
      id: `c:${c.key}`,
      t: c.t,
      level: "error",
      kind: "console",
      title: c.text.split("\n")[0]!.slice(0, 200),
      detail: c.source === "exception" ? "Uncaught exception" : c.source === "browser" ? "WebView" : "Console",
      message: c.key,
    })
  }
  for (const c of crashes) {
    out.push({ id: `x:${c.t}`, t: c.t, level: "error", kind: c.kind, title: c.title, detail: c.detail || "logcat" })
  }
  status.forEach((s, i) => {
    if (s.v.appRunning || !status[i - 1]?.v.appRunning) return
    if (crashes.some((c) => c.kind === "crash" && c.t <= s.t + 500 && s.t - c.t < 5000)) return
    out.push({
      id: `a:${s.t}`,
      t: s.t,
      level: "warning",
      kind: "closed",
      title: "App closed",
      detail: s.v.detail || s.v.reason || `at ${clock(s.t)}`,
    })
  })
  return out.toSorted((a, b) => a.t - b.t)
}

/** At most one tick per bucket of the timeline, so a long recording doesn't draw thousands of them. */
export function thin<T extends { t: number }>(items: T[], duration: number, buckets = 600): T[] {
  if (duration <= 0) return items
  const seen = new Set<number>()
  return items.filter((x) => {
    const b = Math.floor((x.t / duration) * buckets)
    if (seen.has(b)) return false
    seen.add(b)
    return true
  })
}

/** The span covering t, or undefined. */
export function spanAt<K extends string>(spans: Span<K>[], t: number) {
  return spans.find((s) => s.start <= t && t < s.end) ?? spans.findLast((s) => s.start <= t && t <= s.end)
}

/** The next time after t in a sorted list, wrapping to the first. */
export function nextAfter(times: number[], t: number) {
  return times.find((x) => x > t + 250) ?? times[0]
}
