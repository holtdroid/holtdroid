import { sessionBase } from "@/api/client"

const rate = 48000
const chunk = rate / 50

// The worklet resamples the microphone to the agent's rate and sends 20 ms
// of signed 16-bit mono at a time.
const worklet = `
class HoltdroidMic extends AudioWorkletProcessor {
  constructor() {
    super()
    this.step = sampleRate / ${rate}
    this.pos = 0
    this.prev = 0
    this.out = new Int16Array(${chunk})
    this.n = 0
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    let p = this.pos
    while (p < ch.length) {
      const i = Math.floor(p)
      const a = i === 0 ? this.prev : ch[i - 1]
      const v = Math.max(-1, Math.min(1, a + (ch[i] - a) * (p - i)))
      this.out[this.n++] = v < 0 ? v * 32768 : v * 32767
      if (this.n === this.out.length) {
        this.port.postMessage(this.out.slice().buffer)
        this.n = 0
      }
      p += this.step
    }
    this.pos = p - ch.length
    this.prev = ch[ch.length - 1]
    return true
  }
}
registerProcessor("holtdroid-mic", HoltdroidMic)
`

export function microphoneURL(provider: string, id: string) {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws"
  return `${scheme}://${window.location.host}${sessionBase(provider, id)}/microphone/browser`
}

export type BrowserMicrophone = { stop: () => void }

// openBrowserMicrophone streams this browser's microphone to the device until
// stop is called or the agent closes the socket (another source took over).
export async function openBrowserMicrophone(url: string, onEnd: (reason: string) => void): Promise<BrowserMicrophone> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  })
  const ctx = new AudioContext()
  let ws: WebSocket | null = null
  let ended = false
  const stop = (reason = "") => {
    if (ended) return
    ended = true
    for (const t of stream.getTracks()) t.stop()
    void ctx.close()
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000)
    onEnd(reason)
  }
  try {
    const module = URL.createObjectURL(new Blob([worklet], { type: "text/javascript" }))
    try {
      await ctx.audioWorklet.addModule(module)
    } finally {
      URL.revokeObjectURL(module)
    }
    const socket = new WebSocket(url)
    ws = socket
    socket.binaryType = "arraybuffer"
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true })
      socket.addEventListener("close", (e) => reject(new Error(e.reason || "The device did not take the microphone")), {
        once: true,
      })
    })
    socket.addEventListener("close", (e) => stop(e.code === 1000 ? "" : e.reason))
    const node = new AudioWorkletNode(ctx, "holtdroid-mic", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
    })
    node.port.addEventListener("message", (e: MessageEvent<ArrayBuffer>) => {
      if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 1 << 20) socket.send(e.data)
    })
    node.port.start()
    ctx.createMediaStreamSource(stream).connect(node)
    await ctx.resume()
  } catch (e) {
    ended = true
    for (const t of stream.getTracks()) t.stop()
    void ctx.close()
    ws?.close()
    throw e
  }
  return { stop: () => stop() }
}
