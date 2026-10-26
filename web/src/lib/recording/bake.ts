import {
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  type StreamTargetChunk,
  type Target,
} from "mediabunny"
import type { RecordingManifest, RecordingMarker } from "@/api/client"
import { AudioFeeder, audioSegmentsOf } from "@/lib/recording/audio"
import type { RecordingFiles } from "@/lib/recording/files"
import { Cursor, Frames } from "@/lib/recording/frames"
import { drawScene, logoImage, type SceneApp, sceneLayout } from "@/lib/recording/scene"
import { loadSceneIcons } from "@/lib/recording/scene-icons"
import { rotationAt, segmentsOf, sizeChanges, type Telemetry } from "@/lib/recording/timeline"

/** The opening card with the app and the device, before the recording plays. */
const introMs = 3000
const introFade = 500

export const bakeFps = 30

export type BakeProgress = { t: number; duration: number; elapsed: number; canvas: HTMLCanvasElement }

export function bakingSupported() {
  return typeof VideoEncoder !== "undefined" && typeof VideoDecoder !== "undefined"
}

type PickerWindow = {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<FileSystemFileHandle>
}

/** The browser can write straight into a file the user picks. */
export function canSaveToFile() {
  return typeof (window as PickerWindow).showSaveFilePicker === "function"
}

/** Where the video goes while it is rendered. */
export type Sink = {
  target: Target
  /** it is written straight to the file the user chose, so there is nothing to download */
  saved: boolean
  /** the finished video, unless it was saved already */
  file: () => Promise<Blob | null>
  /** bytes written so far */
  size: () => number
  /** throws the half-written output away */
  discard: () => void
}

function guarded(writable: FileSystemWritableFileStream) {
  const writer = writable.getWriter()
  let discarded = false
  let end = 0
  const stream = new WritableStream<StreamTargetChunk>({
    write: (chunk) => {
      end = Math.max(end, chunk.position + chunk.data.byteLength)
      return writer.write(chunk)
    },
    close: () => (discarded ? writer.abort() : writer.close()),
    abort: (reason) => writer.abort(reason),
  })
  return { stream, size: () => end, discard: () => void (discarded = true) }
}

/**
 * Asks where to save the video when the browser can write to a file as it
 * goes (it must run from a click); otherwise the video is collected in the
 * browser's private storage and handed over at the end. Either way it never
 * sits in memory. A cancelled picker throws an AbortError.
 */
export async function openSink(name: string): Promise<Sink> {
  const picker = (window as PickerWindow).showSaveFilePicker
  if (picker) {
    try {
      const handle = await picker.call(window, {
        suggestedName: name,
        types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
      })
      const out = guarded(await handle.createWritable())
      return {
        target: new StreamTarget(out.stream, { chunked: true, chunkSize: 4 << 20 }),
        saved: true,
        file: async () => null,
        size: out.size,
        discard: () => {
          out.discard()
          void (handle as unknown as { remove?: () => Promise<void> }).remove?.().catch(() => undefined)
        },
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e
    }
  }
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("baked", { create: true })
    for await (const old of dir.keys()) await dir.removeEntry(old).catch(() => undefined)
    const handle = await dir.getFileHandle(name, { create: true })
    return {
      target: new StreamTarget(await handle.createWritable(), { chunked: true, chunkSize: 4 << 20 }),
      saved: false,
      file: () => handle.getFile(),
      size: () => 0,
      discard: () => void dir.removeEntry(name).catch(() => undefined),
    }
  } catch {
    const memory = new BufferTarget()
    return {
      target: memory,
      saved: false,
      file: async () => new Blob([memory.buffer ?? new ArrayBuffer(0)], { type: "video/mp4" }),
      size: () => 0,
      discard: () => undefined,
    }
  }
}

/**
 * Renders the recording frame by frame into the sink as an MP4, from the same
 * data and in the same style as the player.
 */
export async function bake(opts: {
  files: RecordingFiles
  manifest: RecordingManifest
  telemetry: Telemetry
  app: SceneApp
  markers: RecordingMarker[]
  sink: Sink
  signal: AbortSignal
  onProgress: (p: BakeProgress) => void
}): Promise<void> {
  const { manifest, telemetry, app, markers, sink, signal } = opts
  const layout = sceneLayout(manifest)
  const canvas = document.createElement("canvas")
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext("2d", { alpha: false })
  if (!ctx) throw new Error("This browser can't draw the video")
  const codec = await getFirstEncodableVideoCodec(["avc", "vp9", "av1"], { width: layout.width, height: layout.height })
  if (!codec) throw new Error("This browser can't encode a video this big")
  await Promise.all([logoImage?.decode().catch(() => undefined), loadSceneIcons()])

  const fragmented = !(sink.target instanceof BufferTarget)
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: fragmented ? "fragmented" : "in-memory" }),
    target: sink.target,
  })
  const source = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH, latencyMode: "quality" })
  output.addVideoTrack(source, { frameRate: bakeFps })
  const audioSegments = audioSegmentsOf(manifest)
  let sound: AudioSampleSource | null = null
  if (audioSegments.length > 0) {
    const audioCodec = await getFirstEncodableAudioCodec(["aac", "opus"], { numberOfChannels: 2, sampleRate: 48000 })
    if (audioCodec) {
      sound = new AudioSampleSource({ codec: audioCodec, bitrate: QUALITY_HIGH })
      output.addAudioTrack(sound)
    }
  }
  await output.start()

  const segments = segmentsOf(manifest)
  const cursor = new Cursor(new Frames(opts.files, segments, 4))
  const feeder = sound ? new AudioFeeder(opts.files, audioSegments, sound, introMs / 1000) : null
  const changes = sizeChanges(segments)
  const startedAt = new Date(manifest.startedAt).getTime()
  const step = 1000 / bakeFps
  const began = performance.now()
  let lastReport = 0
  try {
    cursor.seek(0)
    for (let i = 0; ; i++) {
      const out = i * step
      const t = Math.max(0, out - introMs)
      if (t > manifest.duration) break
      if (signal.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError")
      await cursor.advance(t)
      drawScene(ctx, {
        t,
        intro: out < introMs ? Math.min(1, (introMs - out) / introFade) : 0,
        duration: manifest.duration,
        startedAt,
        frame: cursor.frame?.sample ?? null,
        snap: telemetry.at(t),
        overlay: telemetry.touches.at(t),
        rotation: rotationAt(changes, t),
        markers,
        layout,
        app,
      })
      await source.add(out / 1000, step / 1000)
      await feeder?.until(out / 1000 + 1)
      const now = performance.now()
      if (now - lastReport > 200) {
        lastReport = now
        opts.onProgress({ t, duration: manifest.duration, elapsed: now - began, canvas })
      }
    }
    await feeder?.until(Number.POSITIVE_INFINITY)
    await output.finalize()
  } catch (e) {
    sink.discard()
    await output.cancel().catch(() => undefined)
    throw e
  } finally {
    cursor.close()
    feeder?.close()
  }
  opts.onProgress({ t: manifest.duration, duration: manifest.duration, elapsed: performance.now() - began, canvas })
}
