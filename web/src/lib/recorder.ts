const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]

export function recordingSupported() {
  return typeof MediaRecorder !== "undefined" && "captureStream" in HTMLCanvasElement.prototype
}

export type Recording = { stop: () => Promise<Blob>; extension: string }

export function startRecording(canvas: HTMLCanvasElement): Recording {
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? ""
  const stream = canvas.captureStream(30)
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  recorder.addEventListener("dataavailable", (e) => chunks.push(e.data))
  recorder.start(1000)
  return {
    extension: mimeType.startsWith("video/mp4") ? "mp4" : "webm",
    stop: () =>
      new Promise((resolve) => {
        recorder.addEventListener(
          "stop",
          () => {
            for (const t of stream.getTracks()) t.stop()
            resolve(new Blob(chunks, { type: recorder.mimeType }))
          },
          { once: true },
        )
        recorder.stop()
      }),
  }
}
