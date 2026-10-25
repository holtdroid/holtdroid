import type {
  DeviceState,
  Metrics,
  Network,
  RecordingChunk,
  RecordingEvent,
  RecordingInfo,
  RecordingManifest,
  RecordingSegment,
  StatusEvent,
} from "@/api/client"

export type Segment = RecordingSegment & { init: string; width: number; height: number }

export function segmentsOf(m: RecordingManifest | undefined): Segment[] {
  if (!m) return []
  return m.epochs
    .flatMap((e) => e.segments.map((s) => ({ ...s, init: e.init, width: e.width, height: e.height })))
    .toSorted((a, b) => a.start - b.start)
}

/** The last segment that starts at or before t (ms), or -1. */
export function segmentAt(segments: Segment[], t: number) {
  let lo = 0
  let hi = segments.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (segments[mid]!.start <= t) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

function lastAt<T extends { t: number }>(items: T[], t: number): T | undefined {
  let lo = 0
  let hi = items.length - 1
  let found: T | undefined
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (items[mid]!.t <= t) {
      found = items[mid]
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

type At<T> = { t: number; v: T }

export type Snapshot = {
  info?: RecordingInfo
  status?: StatusEvent
  device?: DeviceState
  network?: Network
  metrics?: Metrics
  history: At<Metrics>[]
}

/** The recording's events indexed by type, to look up the state at any time. */
export class Telemetry {
  readonly info: At<RecordingInfo>[] = []
  readonly status: At<StatusEvent>[] = []
  readonly device: At<DeviceState>[] = []
  readonly network: At<Network>[] = []
  readonly metrics: At<Metrics>[] = []

  constructor(events: RecordingEvent[]) {
    for (const e of events) {
      if (e.info) this.info.push({ t: e.t, v: e.info })
      if (e.status) this.status.push({ t: e.t, v: e.status })
      if (e.device) this.device.push({ t: e.t, v: e.device })
      if (e.network) this.network.push({ t: e.t, v: e.network })
      if (e.metrics) this.metrics.push({ t: e.t, v: e.metrics })
    }
  }

  at(t: number, span = 60_000): Snapshot {
    const end = lastAt(this.metrics, t)
    const history: At<Metrics>[] = []
    if (end) {
      for (let i = this.metrics.indexOf(end); i >= 0 && this.metrics[i]!.t >= t - span; i--)
        history.unshift(this.metrics[i]!)
    }
    return {
      info: lastAt(this.info, t)?.v ?? this.info[0]?.v,
      status: lastAt(this.status, t)?.v,
      device: lastAt(this.device, t)?.v ?? this.device[0]?.v,
      network: lastAt(this.network, t)?.v ?? this.network[0]?.v,
      metrics: end?.v,
      history,
    }
  }
}

export type LogLine = { t: number; time: string; pid: string; level: string; tag: string; message: string; raw: string }

const threadtime = /^(\S+ \S+)\s+(\d+)\s+(\d+)\s+([VDIWEFA])\s+(.*?)\s*: (.*)$/

export function parseClock(s: string) {
  const m = /^(\d+):(\d\d):(\d\d)\.(\d{3})/.exec(s)
  return m ? ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]) : 0
}

export function parseLogcat(text: string): LogLine[] {
  const out: LogLine[] = []
  for (const raw of text.split("\n")) {
    if (raw.length < 14) continue
    const t = parseClock(raw)
    const rest = raw.slice(14)
    const m = threadtime.exec(rest)
    out.push(
      m
        ? { t, time: m[1]!, pid: m[2]!, level: m[4]!, tag: m[5]!, message: m[6]!, raw: rest }
        : { t, time: "", pid: "", level: "I", tag: "", message: rest, raw: rest },
    )
  }
  return out
}

/** Loads logcat chunks around the times asked for and keeps a few of them. */
export class LogcatChunks {
  #chunks: RecordingChunk[] = []
  #loaded = new Map<string, LogLine[]>()
  #pending = new Map<string, Promise<void>>()
  #listeners = new Set<() => void>()
  version = 0

  constructor(
    readonly filesUrl: string,
    chunks: RecordingChunk[],
  ) {
    this.update(chunks)
  }

  update(chunks: RecordingChunk[]) {
    this.#chunks = chunks
  }

  subscribe = (fn: () => void) => {
    this.#listeners.add(fn)
    return () => void this.#listeners.delete(fn)
  }

  #around(t: number, before: number) {
    return this.#chunks.filter((c) => c.end >= t - before && c.start <= t)
  }

  /** Loads what covers [t - before, t]; resolves once it is there. */
  ensure(t: number, before = 120_000) {
    const wanted = this.#around(t, before)
    for (const key of this.#loaded.keys()) {
      if (this.#loaded.size > 12 && !wanted.some((c) => c.file === key)) this.#loaded.delete(key)
    }
    return Promise.all(wanted.map((c) => this.#load(c.file)))
  }

  #load(file: string) {
    if (this.#loaded.has(file)) return Promise.resolve()
    let p = this.#pending.get(file)
    if (!p) {
      p = fetch(this.filesUrl + file)
        .then((r) => (r.ok ? r.text() : ""))
        .then((text) => {
          this.#loaded.set(file, parseLogcat(text))
          this.version++
          for (const fn of this.#listeners) fn()
        })
        .catch(() => undefined)
        .finally(() => this.#pending.delete(file))
      this.#pending.set(file, p)
    }
    return p
  }

  /** The last n loaded lines at or before t. */
  before(t: number, n: number, filter?: (l: LogLine) => boolean): LogLine[] {
    const out: LogLine[] = []
    const chunks = this.#chunks.filter((c) => c.start <= t)
    for (let i = chunks.length - 1; i >= 0 && out.length < n; i--) {
      const lines = this.#loaded.get(chunks[i]!.file)
      if (!lines) continue
      for (let j = lines.length - 1; j >= 0 && out.length < n; j--) {
        const l = lines[j]!
        if (l.t <= t && (!filter || filter(l))) out.push(l)
      }
    }
    return out.toReversed()
  }
}

export function clock(ms: number, millis = false) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const hh = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0")
  const ss = String(s % 60).padStart(2, "0")
  const base = hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`
  return millis ? `${base}.${String(Math.floor(ms % 1000)).padStart(3, "0")}` : base
}
