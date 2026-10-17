const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]

export type RecordMode = "screen" | "page"

export function recordingSupported(mode: RecordMode) {
  if (typeof MediaRecorder === "undefined") return false
  return mode === "page"
    ? typeof navigator.mediaDevices?.getDisplayMedia === "function"
    : "captureStream" in HTMLCanvasElement.prototype
}

export type Recording = { stop: () => void; done: Promise<Blob>; extension: string }

function record(stream: MediaStream): Recording {
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? ""
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  recorder.addEventListener("dataavailable", (e) => chunks.push(e.data))
  const done = new Promise<Blob>((resolve) => {
    recorder.addEventListener(
      "stop",
      () => {
        for (const t of stream.getTracks()) t.stop()
        resolve(new Blob(chunks, { type: recorder.mimeType }))
      },
      { once: true },
    )
  })
  for (const t of stream.getVideoTracks()) {
    t.addEventListener("ended", () => recorder.state !== "inactive" && recorder.stop(), { once: true })
  }
  recorder.start(1000)
  return {
    extension: mimeType.startsWith("video/mp4") ? "mp4" : "webm",
    done,
    stop: () => {
      if (recorder.state !== "inactive") recorder.stop()
    },
  }
}

export function recordCanvas(canvas: HTMLCanvasElement) {
  return record(canvas.captureStream(30))
}

export async function recordPage() {
  const options: DisplayMediaStreamOptions & {
    preferCurrentTab: boolean
    selfBrowserSurface: "include" | "exclude"
    surfaceSwitching: "include" | "exclude"
  } = {
    video: { displaySurface: "browser", frameRate: 30 },
    audio: true,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
  }
  return record(await navigator.mediaDevices.getDisplayMedia(options))
}
