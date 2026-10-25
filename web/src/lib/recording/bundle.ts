import type { RecordingManifest, RecordingMarker, RecordingView, RecordingEvent } from "@/api/client"
import { gunzipText, type RecordingFiles } from "@/lib/recording/files"

export const bundleFormat = "holtdroid-recording"
export const bundleExtension = ".holtdroid"

type Entry = { name: string; method: number; compressed: number; size: number; offset: number }

const eocd = 0x06054b50
const eocd64 = 0x06064b50
const locator64 = 0x07064b50
const central = 0x02014b50
const local = 0x04034b50
const max32 = 0xffffffff

export class BundleError extends Error {}

async function read(file: Blob, start: number, end: number) {
  return new DataView(await file.slice(start, end).arrayBuffer())
}

/**
 * Reads a ZIP's index, the central directory at its end, without loading
 * the rest: a file of many gigabytes costs a few hundred kilobytes.
 */
export async function readZipIndex(file: Blob): Promise<Map<string, Entry>> {
  const tail = await read(file, Math.max(0, file.size - 70_000), file.size)
  let at = -1
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === eocd) {
      at = i
      break
    }
  }
  if (at < 0) throw new BundleError("This isn't a recording file: it has no ZIP index")
  const tailStart = file.size - tail.byteLength
  let count = tail.getUint16(at + 10, true)
  let cdSize = tail.getUint32(at + 12, true)
  let cdOffset = tail.getUint32(at + 16, true)
  if (count === 0xffff || cdSize === max32 || cdOffset === max32) {
    const loc = tailStart + at - 20
    const locator = await read(file, loc, loc + 20)
    if (loc < 0 || locator.getUint32(0, true) !== locator64) throw new BundleError("The ZIP64 index is damaged")
    const start = Number(locator.getBigUint64(8, true))
    const rec = await read(file, start, start + 56)
    if (rec.getUint32(0, true) !== eocd64) throw new BundleError("The ZIP64 index is damaged")
    count = Number(rec.getBigUint64(32, true))
    cdSize = Number(rec.getBigUint64(40, true))
    cdOffset = Number(rec.getBigUint64(48, true))
  }
  const cd = await read(file, cdOffset, cdOffset + cdSize)
  const names = new TextDecoder()
  const entries = new Map<string, Entry>()
  let p = 0
  for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
    if (cd.getUint32(p, true) !== central) throw new BundleError("The ZIP index is damaged")
    const method = cd.getUint16(p + 10, true)
    let compressed = cd.getUint32(p + 20, true)
    let size = cd.getUint32(p + 24, true)
    const nameLen = cd.getUint16(p + 28, true)
    const extraLen = cd.getUint16(p + 30, true)
    const commentLen = cd.getUint16(p + 32, true)
    let offset = cd.getUint32(p + 42, true)
    const name = names.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen))
    let x = p + 46 + nameLen
    const extraEnd = x + extraLen
    while (x + 4 <= extraEnd) {
      const id = cd.getUint16(x, true)
      const len = cd.getUint16(x + 2, true)
      if (id === 0x0001) {
        let v = x + 4
        const next = () => {
          const n = Number(cd.getBigUint64(v, true))
          v += 8
          return n
        }
        if (size === max32) size = next()
        if (compressed === max32) compressed = next()
        if (offset === max32) offset = next()
      }
      x += 4 + len
    }
    entries.set(name, { name, method, compressed, size, offset })
    p = extraEnd + commentLen
  }
  return entries
}

class ZipFiles implements RecordingFiles {
  readonly #starts = new Map<string, number>()

  constructor(
    readonly file: Blob,
    readonly entries: Map<string, Entry>,
  ) {}

  has(name: string) {
    return this.entries.has(name)
  }

  async #data(name: string): Promise<{ blob: Blob; method: number }> {
    const e = this.entries.get(name)
    if (!e) throw new BundleError(`${name} isn't in the file`)
    let start = this.#starts.get(name)
    if (start === undefined) {
      const head = await read(this.file, e.offset, e.offset + 30)
      if (head.getUint32(0, true) !== local) throw new BundleError(`${name} is damaged`)
      start = e.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true)
      this.#starts.set(name, start)
    }
    return { blob: this.file.slice(start, start + e.compressed), method: e.method }
  }

  /** The entry as a blob, unpacked when the ZIP deflated it; nothing is read until it is used. */
  async blob(name: string): Promise<Blob> {
    const { blob, method } = await this.#data(name)
    if (method === 0) return blob
    if (method !== 8) throw new BundleError(`${name} uses an unsupported ZIP method`)
    return new Response(blob.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob()
  }

  async bytes(name: string) {
    return (await this.blob(name)).arrayBuffer()
  }

  async text(name: string) {
    const blob = await this.blob(name)
    return name.endsWith(".gz") ? gunzipText(blob) : blob.text()
  }
}

export type Bundle = {
  files: RecordingFiles
  recording: RecordingView
  manifest: RecordingManifest
  markers: RecordingMarker[]
  exportedAt: string
  /** a URL for the app's icon, which the page owns and should revoke */
  iconUrl?: string
  size: number
}

type Meta = {
  format?: string
  version?: number
  exportedAt?: string
  recording?: Partial<RecordingView>
  markers?: RecordingMarker[]
}

/** Opens a .holtdroid file: only its index, the small description and the manifest are read. */
export async function openBundle(file: Blob): Promise<Bundle> {
  const zip = new ZipFiles(file, await readZipIndex(file))
  if (!zip.has("holtdroid.json") || !zip.has("manifest.json")) {
    throw new BundleError("This ZIP isn't a Holtdroid recording")
  }
  const meta = JSON.parse(await zip.text("holtdroid.json")) as Meta
  if (meta.format !== bundleFormat) throw new BundleError("This isn't a Holtdroid recording")
  if (typeof meta.version !== "number" || meta.version > 1) {
    throw new BundleError("This recording was made by a newer Holtdroid; update the portal to open it")
  }
  const manifest = JSON.parse(await zip.text("manifest.json")) as RecordingManifest
  const iconUrl = zip.has("icon.png") ? URL.createObjectURL(await zip.blob("icon.png")) : undefined
  const r = meta.recording ?? {}
  const recording: RecordingView = {
    id: "",
    package: "",
    source: "",
    artifactId: "",
    state: "done",
    createdAt: manifest.startedAt,
    duration: manifest.duration,
    size: manifest.size,
    keep: false,
    filesUrl: "",
    logcatUrl: "",
    logcatLogUrl: "",
    exportUrl: "",
    ...r,
    iconUrl,
  }
  return {
    files: zip,
    recording,
    manifest,
    markers: meta.markers ?? [],
    exportedAt: meta.exportedAt ?? "",
    iconUrl,
    size: file.size,
  }
}

/** Every event of a recording, in order, from its event files. */
export async function readEvents(files: RecordingFiles, manifest: RecordingManifest): Promise<RecordingEvent[]> {
  const out: RecordingEvent[] = []
  for (const chunk of manifest.events) {
    let text = ""
    try {
      text = await files.text(chunk.file)
    } catch {
      continue
    }
    for (const line of text.split("\n")) {
      if (!line) continue
      try {
        out.push(JSON.parse(line) as RecordingEvent)
      } catch {
        continue
      }
    }
  }
  return out
}
