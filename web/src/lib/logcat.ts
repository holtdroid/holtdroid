import type { Adb, AdbNoneProtocolProcess } from "@yume-chan/adb"
import { type AndroidLogEntry, AndroidLogPriority, deserializeAndroidLogEntry, LogId } from "@yume-chan/android-bin"
import { BufferedTransformStream, WritableStream } from "@yume-chan/stream-extra"
import { run, shq } from "@/lib/adb"

export type LogLine = {
  id: number
  time: number
  pid: number
  tid: number
  uid: number
  buffer: number
  priority: number
  tag: string
  message: string
}

export type Crash = { time: number; lines: string[] }

const capacity = 20_000
const letters = ["?", "?", "V", "D", "I", "W", "E", "F", "S"]

export function priorityLetter(p: number) {
  return letters[p] ?? "?"
}

function pad(n: number, width = 2) {
  return String(n).padStart(width, "0")
}

export function formatTime(ms: number) {
  const d = new Date(ms)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

export function formatLine(l: LogLine) {
  return `${formatTime(l.time)} ${String(l.pid).padStart(5)} ${String(l.tid).padStart(5)} ${priorityLetter(l.priority)} ${l.tag}: ${l.message}`
}

function clean(s: string) {
  return s.replace(/\0+$/, "")
}

function isCrashStart(l: LogLine) {
  return (
    (l.tag === "AndroidRuntime" && l.message.startsWith("FATAL EXCEPTION")) ||
    (l.tag === "DEBUG" && l.message.startsWith("*** *** ***"))
  )
}

// LogcatStore follows the device's main, system and crash buffers for as
// long as the ADB connection lives and keeps the last lines in memory.
export class LogcatStore {
  #lines: LogLine[] = []
  #version = 0
  #next = 0
  #appUid: number | undefined
  #process: AdbNoneProtocolProcess | undefined
  #pending: ReturnType<typeof setTimeout> | undefined
  #crash: { time: number; lines: string[]; timer: ReturnType<typeof setTimeout> } | undefined
  readonly #listeners = new Set<() => void>()
  readonly #crashListeners = new Set<(c: Crash) => void>()

  #pkg = ""

  get pkg() {
    return this.#pkg
  }

  get lines() {
    return this.#lines
  }

  get version() {
    return this.#version
  }

  get appUid() {
    return this.#appUid
  }

  subscribe = (l: () => void) => {
    this.#listeners.add(l)
    return () => this.#listeners.delete(l)
  }

  getVersion = () => this.#version

  onCrash(l: (c: Crash) => void) {
    this.#crashListeners.add(l)
    return () => {
      this.#crashListeners.delete(l)
    }
  }

  async start(adb: Adb, pkg: string) {
    this.stop()
    this.#pkg = pkg
    const packages = await run(adb, `pm list packages -U ${shq(this.#pkg)}`).catch(() => "")
    const match = new RegExp(`package:${this.#pkg.replaceAll(".", "\\.")} uid:(\\d+)`).exec(packages)
    this.#appUid = match ? Number(match[1]) : undefined
    const since = this.#lines.at(-1)?.time
    const process = await adb.subprocess.noneProtocol.spawn([
      "logcat",
      "-B",
      "-b",
      "main,system,crash",
      ...(since ? ["-T", shq(formatTime(since + 1))] : ["-T", "2000"]),
    ])
    this.#process = process
    void process.output
      .pipeThrough(new BufferedTransformStream((stream) => deserializeAndroidLogEntry(stream)))
      .pipeTo(new WritableStream<AndroidLogEntry>({ write: (e) => this.#add(e) }))
      .catch(() => undefined)
  }

  stop() {
    void this.#process?.kill()
    this.#process = undefined
  }

  clear() {
    this.#lines = []
    this.#notify()
  }

  #add(e: AndroidLogEntry) {
    const line: LogLine = {
      id: this.#next++,
      time: e.seconds * 1000 + Math.floor(e.nanoseconds / 1e6),
      pid: e.pid,
      tid: e.tid,
      uid: e.uid,
      buffer: e.logId,
      priority: e.priority,
      tag: clean(e.tag),
      message: clean(e.message),
    }
    this.#lines.push(line)
    if (this.#lines.length > capacity) this.#lines = this.#lines.slice(-capacity)
    this.#trackCrash(line)
    if (this.#pending === undefined) {
      this.#pending = setTimeout(() => {
        this.#pending = undefined
        this.#notify()
      }, 100)
    }
  }

  #trackCrash(l: LogLine) {
    if (l.buffer !== LogId.Crash || (this.#appUid !== undefined && l.uid !== this.#appUid && l.tag !== "DEBUG")) return
    if (isCrashStart(l)) {
      if (this.#crash) this.#flushCrash()
      this.#crash = { time: l.time, lines: [], timer: setTimeout(() => this.#flushCrash(), 300) }
    }
    if (this.#crash && l.priority >= AndroidLogPriority.Error) this.#crash.lines.push(l.message)
  }

  #flushCrash() {
    const c = this.#crash
    if (!c) return
    clearTimeout(c.timer)
    this.#crash = undefined
    for (const l of this.#crashListeners) l({ time: c.time, lines: c.lines })
  }

  #notify() {
    this.#version++
    for (const l of this.#listeners) l()
  }
}
