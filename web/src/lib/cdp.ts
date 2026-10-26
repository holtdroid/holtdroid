import type { DevToolsTarget } from "@/api/client"

type Reply = { id?: number; result?: Record<string, unknown>; error?: { message: string } }

export function targetSocket(base: string, t: DevToolsTarget) {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws"
  return `${scheme}://${window.location.host}${base}/devtools/${encodeURIComponent(t.socket)}/page/${encodeURIComponent(t.id)}`
}

/** One CDP connection for several calls; it closes when asked or when the page goes away. */
export class CdpSession {
  readonly #ws: WebSocket
  readonly #open: Promise<void>
  readonly #pending = new Map<number, { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }>()
  #next = 1

  constructor(url: string) {
    this.#ws = new WebSocket(url)
    this.#open = new Promise((resolve, reject) => {
      this.#ws.addEventListener("open", () => resolve())
      this.#ws.addEventListener("error", () => reject(new Error("Could not reach DevTools")))
    })
    this.#open.catch(() => undefined)
    this.#ws.addEventListener("message", (e) => {
      const reply = JSON.parse(String(e.data)) as Reply
      const call = reply.id === undefined ? undefined : this.#pending.get(reply.id)
      if (!call || reply.id === undefined) return
      this.#pending.delete(reply.id)
      if (reply.error) call.reject(new Error(reply.error.message))
      else call.resolve(reply.result ?? {})
    })
    this.#ws.addEventListener("close", () => {
      for (const call of this.#pending.values()) call.reject(new Error("DevTools closed the connection"))
      this.#pending.clear()
    })
  }

  get closed() {
    return this.#ws.readyState === WebSocket.CLOSING || this.#ws.readyState === WebSocket.CLOSED
  }

  async send(method: string, params?: object, timeout = 15_000) {
    await this.#open
    const id = this.#next++
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`${method}: DevTools did not answer`))
      }, timeout)
      this.#pending.set(id, {
        resolve: (r) => {
          window.clearTimeout(timer)
          resolve(r)
        },
        reject: (e) => {
          window.clearTimeout(timer)
          reject(e)
        },
      })
      this.#ws.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.#ws.close()
  }
}

export function cdpCall(socketURL: string, method: string, params?: object, timeout = 30_000) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const ws = new WebSocket(socketURL)
    const done = (fn: () => void) => {
      window.clearTimeout(timer)
      ws.close()
      fn()
    }
    const timer = window.setTimeout(() => done(() => reject(new Error("DevTools did not answer"))), timeout)
    ws.addEventListener("open", () => ws.send(JSON.stringify({ id: 1, method, params })))
    ws.addEventListener("message", (e) => {
      const reply = JSON.parse(String(e.data)) as Reply
      if (reply.id !== 1) return
      done(() => (reply.error ? reject(new Error(reply.error.message)) : resolve(reply.result ?? {})))
    })
    ws.addEventListener("error", () => done(() => reject(new Error("Could not reach DevTools"))))
  })
}

export function normalizeURL(input: string) {
  const url = input.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^(about|data|javascript|blob):/i.test(url)) return url
  const local = /^(localhost|127\.\d+\.\d+\.\d+|10\.0\.2\.2)(:\d+)?(\/|$)/i.test(url)
  return `${local ? "http" : "https"}://${url}`
}
