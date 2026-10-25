import {
  BufferTarget,
  CanvasSource,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  type Target,
} from "mediabunny"
import type { RecordingManifest } from "@/api/client"
import { Cursor, Frames } from "@/lib/recording/frames"
import { drawScene, type SceneApp, sceneHeight, sceneWidth } from "@/lib/recording/scene"
import { LogcatChunks, segmentsOf, type Telemetry } from "@/lib/recording/timeline"

export const bakeFps = 30

export type BakeProgress = { t: number; duration: number; elapsed: number; canvas: HTMLCanvasElement }

export function bakingSupported() {
  return typeof VideoEncoder !== "undefined" && typeof VideoDecoder !== "undefined"
}

/** Streams the output to a file in the origin private file system, so long videos don't sit in memory. */
async function fileTarget(name: string) {
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("baked", { create: true })
    for await (const old of dir.keys()) await dir.removeEntry(old).catch(() => undefined)
    const handle = await dir.getFileHandle(name, { create: true })
    const target = new StreamTarget(await handle.createWritable(), { chunked: true, chunkSize: 1 << 20 })
    return { target, file: () => handle.getFile() }
  } catch {
    return null
  }
}

/**
 * Renders the recording's scene frame by frame, as the player shows it, into
 * an MP4 file.
 */
export async function bake(opts: {
  filesUrl: string
  manifest: RecordingManifest
  telemetry: Telemetry
  app: SceneApp
  name: string
  signal: AbortSignal
  onProgress: (p: BakeProgress) => void
}): Promise<Blob> {
  const { manifest, telemetry, app, signal } = opts
  const canvas = document.createElement("canvas")
  canvas.width = sceneWidth
  canvas.height = sceneHeight
  const ctx = canvas.getContext("2d", { alpha: false })
  if (!ctx) throw new Error("This browser can't draw the video")
  const codec = await getFirstEncodableVideoCodec(["avc", "vp9", "av1"], { width: sceneWidth, height: sceneHeight })
  if (!codec) throw new Error("This browser can't encode video")

  const opened = await fileTarget(opts.name)
  const memory = new BufferTarget()
  const target: Target = opened?.target ?? memory
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: opened ? "fragmented" : "in-memory" }), target })
  const source = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH, latencyMode: "quality" })
  output.addVideoTrack(source, { frameRate: bakeFps })
  await output.start()

  const cursor = new Cursor(new Frames(opts.filesUrl, segmentsOf(manifest)))
  const logcat = new LogcatChunks(opts.filesUrl, manifest.logcat)
  const startedAt = new Date(manifest.startedAt).getTime()
  const step = 1000 / bakeFps
  const began = performance.now()
  let lastReport = 0
  try {
    cursor.seek(0)
    for (let i = 0; ; i++) {
      const t = i * step
      if (t > manifest.duration) break
      if (signal.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError")
      await Promise.all([cursor.advance(t), logcat.ensure(t)])
      drawScene(ctx, {
        t,
        duration: manifest.duration,
        startedAt,
        frame: cursor.frame?.sample ?? null,
        snap: telemetry.at(t),
        logcat: logcat.before(t, 60),
        app,
      })
      await source.add(t / 1000, step / 1000)
      const now = performance.now()
      if (now - lastReport > 200) {
        lastReport = now
        opts.onProgress({ t, duration: manifest.duration, elapsed: now - began, canvas })
      }
    }
    await output.finalize()
  } catch (e) {
    await output.cancel()
    throw e
  } finally {
    cursor.close()
  }
  opts.onProgress({ t: manifest.duration, duration: manifest.duration, elapsed: performance.now() - began, canvas })
  return opened ? opened.file() : new Blob([memory.buffer ?? new ArrayBuffer(0)], { type: "video/mp4" })
}
