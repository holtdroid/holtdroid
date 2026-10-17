type Reply = { id?: number; result?: Record<string, unknown>; error?: { message: string } }

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
