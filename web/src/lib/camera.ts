import { sessionBase } from "@/api/client"

const fps = 15
const maxWidth = 960

export function cameraURL(provider: string, id: string) {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws"
  return `${scheme}://${window.location.host}${sessionBase(provider, id)}/camera/browser`
}

export type BrowserCamera = { stop: () => void }

// openBrowserCamera sends this browser's camera to the device as JPEG frames
// until stop is called or the agent closes the socket (another source took
// over).
export async function openBrowserCamera(url: string, onEnd: (reason: string) => void): Promise<BrowserCamera> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: fps } },
  })
  const video = document.createElement("video")
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  let ws: WebSocket | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  let ended = false
  const stop = (reason = "") => {
    if (ended) return
    ended = true
    clearInterval(timer)
    for (const t of stream.getTracks()) t.stop()
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000)
    onEnd(reason)
  }
  try {
    await video.play()
    const socket = new WebSocket(url)
    ws = socket
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true })
      socket.addEventListener("close", (e) => reject(new Error(e.reason || "The device did not take the camera")), {
        once: true,
      })
    })
    socket.addEventListener("close", (e) => stop(e.code === 1000 ? "" : e.reason))
    const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round((video.videoWidth || 640) * scale)
    canvas.height = Math.round((video.videoHeight || 480) * scale)
    const ctx = canvas.getContext("2d")
    let busy = false
    timer = setInterval(() => {
      if (busy || !ctx || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 1 << 20) return
      busy = true
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => {
          busy = false
          if (blob && socket.readyState === WebSocket.OPEN) socket.send(blob)
        },
        "image/jpeg",
        0.75,
      )
    }, 1000 / fps)
  } catch (e) {
    ended = true
    clearInterval(timer)
    for (const t of stream.getTracks()) t.stop()
    ws?.close()
    throw e
  }
  return { stop: () => stop() }
}
