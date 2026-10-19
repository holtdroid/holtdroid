import {
  type AudioCodec,
  BufferTarget,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  MediaStreamAudioTrackSource,
  MediaStreamVideoTrackSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  type Target,
} from "mediabunny"

export type RecordMode = "screen" | "tab"

export const recordFps = 30

export function recordingSupported() {
  return typeof VideoEncoder !== "undefined" && "captureStream" in HTMLCanvasElement.prototype
}

export function tabCaptureSupported() {
  return typeof navigator.mediaDevices?.getDisplayMedia === "function"
}

export function captureTab() {
  const options: DisplayMediaStreamOptions & {
    preferCurrentTab: boolean
    selfBrowserSurface: "include" | "exclude"
    surfaceSwitching: "include" | "exclude"
  } = {
    video: { displaySurface: "browser", frameRate: recordFps },
    audio: true,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
  }
  return navigator.mediaDevices.getDisplayMedia(options)
}

const folder = "recordings"
const lockPrefix = "holtdroid-recording:"

async function recordingsDir() {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(folder, { create: true })
}

async function unusedRecordings(dir: FileSystemDirectoryHandle) {
  const held = new Set(((await navigator.locks?.query())?.held ?? []).map((l) => l.name))
  const names: string[] = []
  for await (const name of dir.keys()) if (!held.has(lockPrefix + name)) names.push(name)
  return names
}

function holdLock(name: string) {
  const lock = new AbortController()
  void navigator.locks
    ?.request(lockPrefix + name, () => new Promise((resolve) => lock.signal.addEventListener("abort", resolve)))
    .catch(() => undefined)
  return () => lock.abort()
}

async function openFileTarget(name: string) {
  try {
    const dir = await recordingsDir()
    const release = holdLock(name)
    const handle = await dir.getFileHandle(name, { create: true })
    const target = new StreamTarget(await handle.createWritable(), { chunked: true, chunkSize: 1 << 20 })
    const file = async (): Promise<Blob> => {
      const blob = await handle.getFile()
      setTimeout(() => void dir.removeEntry(name).catch(() => undefined), 120_000)
      return blob
    }
    return { target, release, file }
  } catch {
    return null
  }
}

export async function leftoverRecordings() {
  try {
    const dir = await recordingsDir()
    const names = await unusedRecordings(dir)
    const files = await Promise.all(names.map(async (name) => (await dir.getFileHandle(name)).getFile()))
    return files.filter((f) => f.size > 0)
  } catch {
    return []
  }
}

export async function discardRecordings(names: string[]) {
  try {
    const dir = await recordingsDir()
    await Promise.all(names.map((name) => dir.removeEntry(name).catch(() => undefined)))
  } catch {
    return
  }
}

export type Recording = { stop: () => void; done: Promise<Blob>; extension: string; started: number }

async function continuousAudio(track: MediaStreamTrack) {
  try {
    const ctx = new AudioContext()
    const resumed = ctx.resume().then(() => true)
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500))
    if (!(await Promise.race([resumed, timeout])) || ctx.state !== "running") {
      void ctx.close()
      return null
    }
    const dest = ctx.createMediaStreamDestination()
    ctx.createMediaStreamSource(new MediaStream([track])).connect(dest)
    const out = dest.stream.getAudioTracks()[0]
    if (!out) {
      void ctx.close()
      return null
    }
    return { track: out, close: () => void ctx.close() }
  } catch {
    return null
  }
}

export async function startRecording(canvas: HTMLCanvasElement, name: string, tabAudio?: MediaStreamTrack) {
  const videoCodec = await getFirstEncodableVideoCodec(["avc", "vp9", "av1", "hevc"], {
    width: canvas.width,
    height: canvas.height,
    frameRate: recordFps,
  })
  if (!videoCodec) throw new Error("This browser can't encode video")
  const audioCodec: AudioCodec | null = tabAudio ? await getFirstEncodableAudioCodec(["aac", "opus"]) : null
  const audio = tabAudio && audioCodec ? await continuousAudio(tabAudio) : null

  const opened = await openFileTarget(`${name}.mp4`)
  const memory = new BufferTarget()
  const target: Target = opened?.target ?? memory
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "fragmented" }), target })

  const stream = canvas.captureStream(recordFps)
  const videoTrack = stream.getVideoTracks()[0]
  const cleanup = () => {
    videoTrack?.stop()
    tabAudio?.stop()
    audio?.close()
    opened?.release()
  }
  if (!videoTrack) {
    cleanup()
    throw new Error("The canvas has no video track")
  }
  const video = new MediaStreamVideoTrackSource(
    videoTrack,
    { codec: videoCodec, quality: QUALITY_HIGH, sizeChangeBehavior: "contain" },
    { frameRate: recordFps },
  )
  output.addVideoTrack(video, { frameRate: recordFps })
  if (audio && audioCodec) {
    output.addAudioTrack(
      new MediaStreamAudioTrackSource(audio.track, {
        codec: audioCodec,
        quality: QUALITY_HIGH,
      }),
    )
  }
  try {
    await output.start()
  } catch (e) {
    cleanup()
    throw e
  }

  let stopping = false
  let stop: (() => void) | undefined
  const done = new Promise<Blob>((resolve, reject) => {
    stop = () => {
      if (stopping) return
      stopping = true
      void (async () => {
        try {
          await output.finalize()
        } finally {
          cleanup()
        }
        return opened ? opened.file() : new Blob([memory.buffer ?? new ArrayBuffer(0)], { type: "video/mp4" })
      })().then(resolve, reject)
    }
    void video.errorPromise.catch((e: unknown) => {
      stopping = true
      reject(e)
      cleanup()
      void output.cancel()
    })
  })
  return { stop: () => stop?.(), done, extension: "mp4", started: Date.now() } satisfies Recording
}
