import type {
  DevToolsConsole,
  DevToolsEntry,
  DevToolsFrame,
  DevToolsPage,
  DevToolsRequest,
  DevToolsSocket,
} from "@/api/client"

export type NetRequest = DevToolsRequest & { key: string; target: string }
export type ConsoleLine = DevToolsConsole & { key: string; target: string; t: number }
export type SocketFrame = DevToolsFrame & { key: string; t: number }
export type SocketTrack = {
  key: string
  id: string
  target: string
  url: string
  /** recording time of its first line */
  t: number
  states: { t: number; v: DevToolsSocket }[]
  frames: SocketFrame[]
}

/** How many items start at or before t, for a list sorted by time. */
function countUntil<T>(items: T[], t: number, time: (v: T) => number) {
  let lo = 0
  let hi = items.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (time(items[mid]!) <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** A recording's DevTools lines, indexed to look up what had happened by any time. */
export class DevToolsLog {
  readonly requests: NetRequest[] = []
  readonly console: ConsoleLine[] = []
  readonly sockets: SocketTrack[] = []
  readonly pages: { t: number; target: string; v: DevToolsPage }[] = []
  readonly dropped: { t: number; n: number }[] = []

  constructor(entries: DevToolsEntry[]) {
    const sockets = new Map<string, SocketTrack>()
    const seen = new Set<string>()
    const socket = (target: string, id: string, t: number) => {
      const key = `${target}/${id}`
      let s = sockets.get(key)
      if (!s) {
        s = { key, id, target, url: "", t, states: [], frames: [] }
        sockets.set(key, s)
      }
      return s
    }
    for (const [i, e] of entries.entries()) {
      const target = e.target ?? ""
      if (e.request) {
        const key = `${target}/${e.request.id}`
        if (seen.has(key)) continue
        seen.add(key)
        this.requests.push({ ...e.request, key, target })
      } else if (e.console) {
        this.console.push({ ...e.console, key: `c${i}`, target, t: e.t })
      } else if (e.socket) {
        const s = socket(target, e.socket.id, e.t)
        if (e.socket.url) s.url = e.socket.url
        s.states.push({ t: e.t, v: e.socket })
      } else if (e.frame) {
        socket(target, e.frame.socket, e.t).frames.push({ ...e.frame, key: `f${i}`, t: e.t })
      } else if (e.page) {
        this.pages.push({ t: e.t, target, v: e.page })
      } else if (e.dropped) {
        this.dropped.push({ t: e.t, n: e.dropped })
      }
    }
    this.requests.sort((a, b) => a.start - b.start)
    this.console.sort((a, b) => a.t - b.t)
    for (const s of sockets.values()) {
      s.states.sort((a, b) => a.t - b.t)
      s.frames.sort((a, b) => a.t - b.t)
      this.sockets.push(s)
    }
    this.sockets.sort((a, b) => a.t - b.t)
    this.pages.sort((a, b) => a.t - b.t)
  }

  get empty() {
    return this.requests.length === 0 && this.console.length === 0 && this.sockets.length === 0
  }

  requestsUntil(t: number) {
    return this.requests.slice(
      0,
      countUntil(this.requests, t, (r) => r.start),
    )
  }

  consoleUntil(t: number) {
    return this.console.slice(
      0,
      countUntil(this.console, t, (c) => c.t),
    )
  }

  socketsUntil(t: number) {
    return this.sockets.slice(
      0,
      countUntil(this.sockets, t, (s) => s.t),
    )
  }

  #contexts: Map<string, Context> | undefined

  /** The tabs, iframes and workers lines came from, in the order they appeared. */
  contexts(): Context[] {
    if (!this.#contexts) {
      this.#contexts = new Map()
      for (const p of this.pages) {
        const page: DevToolsPage = { ...this.#contexts.get(p.target)?.page }
        for (const [k, v] of Object.entries(p.v)) if (v !== undefined && v !== "") Object.assign(page, { [k]: v })
        this.#contexts.set(p.target, { target: p.target, page, label: contextLabel(page, p.target) })
      }
    }
    return [...this.#contexts.values()]
  }

  context(target: string) {
    if (!this.#contexts) this.contexts()
    return this.#contexts!.get(target)
  }

  /** The page a target showed at t. */
  pageAt(target: string, t: number) {
    let found: DevToolsPage | undefined
    for (const p of this.pages) {
      if (p.t > t) break
      if (p.target === target && !p.v.closed) found = p.v
    }
    return found
  }
}

export type Context = { target: string; page: DevToolsPage; label: string }

const kindNames: Record<string, string> = {
  page: "Tab",
  iframe: "iframe",
  worker: "Worker",
  shared_worker: "Shared worker",
  service_worker: "Service worker",
}

export function contextLabel(p: DevToolsPage, target: string) {
  const where = p.url ? splitURL(p.url).host || p.url : p.title || target.slice(0, 8)
  const name =
    p.type === "worker" || p.type === "service_worker" || p.type === "shared_worker"
      ? splitURL(p.url ?? "").name
      : where
  return `${kindNames[p.type ?? "page"] ?? p.type}: ${name || where}`
}

export function framesUntil(s: SocketTrack, t: number) {
  return s.frames.slice(
    0,
    countUntil(s.frames, t, (f) => f.t),
  )
}

export function socketAt(s: SocketTrack, t: number): DevToolsSocket | undefined {
  const n = countUntil(s.states, t, (x) => x.t)
  return s.states[n - 1]?.v ?? s.states[0]?.v
}

export type RequestPhase = "pending" | "failed" | "redirect" | "ok" | "client-error" | "server-error"

/** Where a request stood at recording time t. */
export function requestPhase(r: DevToolsRequest, t: number): RequestPhase {
  const status = r.status ?? 0
  if (!r.end || r.end > t) return "pending"
  if (r.error && (!status || r.canceled)) return "failed"
  if (r.redirect || (status >= 300 && status < 400)) return "redirect"
  if (status >= 500) return "server-error"
  if (status >= 400) return "client-error"
  return "ok"
}

export type ResourceGroup = "fetch" | "doc" | "js" | "css" | "img" | "media" | "font" | "other"

export function resourceGroup(type: string | undefined): ResourceGroup {
  switch (type) {
    case "XHR":
    case "Fetch":
    case "EventSource":
      return "fetch"
    case "Document":
      return "doc"
    case "Script":
      return "js"
    case "Stylesheet":
      return "css"
    case "Image":
      return "img"
    case "Media":
      return "media"
    case "Font":
      return "font"
    default:
      return "other"
  }
}

export function splitURL(url: string) {
  try {
    const u = new URL(url)
    const name = u.pathname.split("/").findLast(Boolean) ?? ""
    return { host: u.host, path: `${u.pathname}${u.search}`, name: name ? `${name}${u.search}` : u.host }
  } catch {
    return { host: "", path: url, name: url }
  }
}

const headerList = (h: Record<string, string> | undefined) =>
  Object.entries(h ?? {}).flatMap(([name, value]) => value.split("\n").map((v) => ({ name, value: v })))

function query(url: string) {
  try {
    return [...new URL(url).searchParams].map(([name, value]) => ({ name, value }))
  } catch {
    return []
  }
}

const header = (h: Record<string, string> | undefined, name: string) =>
  Object.entries(h ?? {}).find(([k]) => k.toLowerCase() === name)?.[1]

const httpVersion = (p: string | undefined) =>
  p === "h2" ? "HTTP/2.0" : p === "h3" ? "HTTP/3.0" : p?.startsWith("http/") ? p.toUpperCase() : "HTTP/1.1"

/** The recording's requests and WebSockets as a HAR 1.2 file, as Chrome DevTools exports one. */
export function toHar(log: DevToolsLog, startedAt: number, creator: { name: string; version: string }) {
  const iso = (t: number) => new Date(startedAt + t).toISOString()
  const pages = log.pages
    .filter((p) => !p.v.closed)
    .map((p, i) => ({
      startedDateTime: iso(p.t),
      id: `page_${i + 1}`,
      title: p.v.title || p.v.url || p.target,
      pageTimings: {},
    }))
  const entries: Record<string, unknown>[] = log.requests.map((r) => {
    const t = r.timing
    const timings = t
      ? {
          blocked: t.blocked,
          dns: t.dns,
          connect: t.connect,
          ssl: t.ssl,
          send: t.send,
          wait: t.wait,
          receive: t.receive,
        }
      : {
          blocked: -1,
          dns: -1,
          connect: -1,
          ssl: -1,
          send: 0,
          wait: Math.max(0, (r.end || r.start) - r.start),
          receive: 0,
        }
    const time = [timings.blocked, timings.dns, timings.connect, timings.send, timings.wait, timings.receive]
      .filter((v) => v > 0)
      .reduce((a, b) => a + b, 0)
    return {
      startedDateTime: iso(r.start),
      time,
      request: {
        method: r.method,
        url: r.url,
        httpVersion: httpVersion(r.protocol),
        cookies: [],
        headers: headerList(r.requestHeaders),
        queryString: query(r.url),
        ...(r.postData
          ? { postData: { mimeType: header(r.requestHeaders, "content-type") ?? "", text: r.postData } }
          : {}),
        headersSize: -1,
        bodySize: r.postData?.length ?? 0,
      },
      response: {
        status: r.status ?? 0,
        statusText: r.statusText ?? "",
        httpVersion: httpVersion(r.protocol),
        cookies: [],
        headers: headerList(r.responseHeaders),
        content: {
          size: r.body ? (r.bodyBase64 ? Math.floor((r.body.length * 3) / 4) : r.body.length) : 0,
          mimeType: r.mimeType ?? "",
          ...(r.body ? { text: r.body, ...(r.bodyBase64 ? { encoding: "base64" } : {}) } : {}),
        },
        redirectURL: r.redirect ?? "",
        headersSize: -1,
        bodySize: r.size ?? -1,
        ...(r.error ? { _error: r.error } : {}),
      },
      cache: {},
      timings,
      ...(r.remoteAddress ? { serverIPAddress: r.remoteAddress.replace(/:\d+$/, "").replace(/^\[|\]$/g, "") } : {}),
      _resourceType: (r.resourceType ?? "other").toLowerCase(),
    }
  })
  for (const s of log.sockets) {
    if (!s.url.startsWith("ws")) continue
    const last = s.states.at(-1)?.v
    entries.push({
      startedDateTime: iso(s.t),
      time: 0,
      request: {
        method: "GET",
        url: s.url,
        httpVersion: "HTTP/1.1",
        cookies: [],
        headers: [],
        queryString: query(s.url),
        headersSize: -1,
        bodySize: 0,
      },
      response: {
        status: last?.status ?? 101,
        statusText: "Switching Protocols",
        httpVersion: "HTTP/1.1",
        cookies: [],
        headers: [],
        content: { size: 0, mimeType: "x-unknown" },
        redirectURL: "",
        headersSize: -1,
        bodySize: 0,
      },
      cache: {},
      timings: { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0, wait: 0, receive: 0 },
      _resourceType: "websocket",
      _webSocketMessages: s.frames.map((f) => ({
        type: f.sent ? "send" : "receive",
        time: (startedAt + f.t) / 1000,
        opcode: f.opcode,
        data: f.data ?? "",
      })),
    })
  }
  entries.sort((a, b) => String(a.startedDateTime).localeCompare(String(b.startedDateTime)))
  return { log: { version: "1.2", creator, pages, entries } }
}

/** A URL scheme that isn't HTTP, for requests that have no status: blob, data, file… */
export function localScheme(url: string) {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url)
  const scheme = m?.[1]?.toLowerCase()
  return scheme && scheme !== "http" && scheme !== "https" ? scheme : undefined
}

const fetchSkip = new Set([
  "host",
  "content-length",
  "connection",
  "user-agent",
  "referer",
  "cookie",
  "accept-encoding",
])

/** The request as a fetch() call, as Chrome DevTools copies it. */
export function fetchOf(r: DevToolsRequest) {
  const headers: Record<string, string> = {}
  let referrer: string | undefined
  let cookies = false
  for (const [k, v] of Object.entries(r.requestHeaders ?? {})) {
    const name = k.toLowerCase()
    if (name.startsWith(":")) continue
    if (name === "referer") referrer = v
    if (name === "cookie") cookies = true
    if (!fetchSkip.has(name)) headers[k] = v
  }
  const init: Record<string, unknown> = { headers }
  if (referrer) init.referrer = referrer
  if (r.postData) init.body = r.postData
  init.method = r.method
  init.mode = "cors"
  init.credentials = cookies ? "include" : "omit"
  return `fetch(${JSON.stringify(r.url)}, ${JSON.stringify(init, null, 2)});`
}

const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

export function curlOf(r: DevToolsRequest) {
  const parts = [`curl ${shellQuote(r.url)}`]
  if (r.method !== "GET") parts.push(`-X ${r.method}`)
  for (const [k, v] of Object.entries(r.requestHeaders ?? {})) {
    if (k.startsWith(":")) continue
    parts.push(`-H ${shellQuote(`${k}: ${v}`)}`)
  }
  if (r.postData) parts.push(`--data-raw ${shellQuote(r.postData)}`)
  return parts.join(" \\\n  ")
}
