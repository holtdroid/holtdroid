import { AudioBufferSink, AudioSample, type AudioSampleSource, BlobSource, Input, MP4 } from "mediabunny"
import type { RecordingAudio, RecordingManifest, RecordingSegment } from "@/api/client"
import type { RecordingFiles } from "@/lib/recording/files"

export type AudioSegment = RecordingSegment & { init: string }

/** The sound of a recording as one list of segments; recordings made before there was sound have none. */
export function audioSegmentsOf(manifest: Pick<RecordingManifest, "audio"> | undefined): AudioSegment[] {
  const runs = (manifest?.audio as RecordingAudio[] | undefined) ?? []
  return runs.flatMap((a) => a.segments.map((s) => ({ ...s, init: a.init }))).toSorted((a, b) => a.start - b.start)
}

export type AudioChunk = {
  /** milliseconds since the recording started */
  start: number
  duration: number
  buffer: AudioBuffer
}

/** Decoded sound from `from` (ms) on, in order, one segment at a time. */
export async function* audioBuffers(
  files: RecordingFiles,
  segments: AudioSegment[],
  from: number,
): AsyncGenerator<AudioChunk, void, unknown> {
  for (const seg of segments) {
    if (seg.start + seg.duration <= from) continue
    let data: ArrayBuffer[]
    try {
      data = await Promise.all([files.bytes(seg.init), files.bytes(seg.file)])
    } catch {
      continue
    }
    const input = new Input({ source: new BlobSource(new Blob(data)), formats: [MP4] })
    try {
      const track = await input.getPrimaryAudioTrack()
      if (!track) continue
      const first = await track.getFirstTimestamp()
      const startAt = first + Math.max(0, from - seg.start) / 1000
      for await (const w of new AudioBufferSink(track).buffers(startAt)) {
        yield { start: seg.start + (w.timestamp - first) * 1000, duration: w.duration * 1000, buffer: w.buffer }
      }
    } catch {
      continue
    } finally {
      input.dispose()
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Plays a recording's sound in step with its video. It is scheduled on the
 * audio clock a few seconds ahead from wherever the video is, and starts over
 * on every seek, since the two clocks only agree for a while. Sound is
 * silent at other speeds than 1×.
 */
export class AudioPlayback {
  #ctx: AudioContext | null = null
  #gain: GainNode | null = null
  #segments: AudioSegment[]
  #run = 0
  #nodes = new Set<AudioBufferSourceNode>()
  #muted = false

  constructor(
    readonly files: RecordingFiles,
    manifest: Pick<RecordingManifest, "audio">,
  ) {
    this.#segments = audioSegmentsOf(manifest)
  }

  update(manifest: Pick<RecordingManifest, "audio">) {
    this.#segments = audioSegmentsOf(manifest)
  }

  get available() {
    return this.#segments.length > 0
  }

  get muted() {
    return this.#muted
  }

  setMuted(muted: boolean) {
    this.#muted = muted
    if (this.#gain) this.#gain.gain.value = muted ? 0 : 1
  }

  /** Plays from `from` (ms) on, if the speed is 1× and there is sound there. */
  start(from: number, rate: number) {
    this.stop()
    if (rate !== 1 || this.#segments.length === 0) return
    void this.#play(from, this.#run)
  }

  stop() {
    this.#run++
    for (const n of this.#nodes) {
      try {
        n.stop()
      } catch {
        continue
      }
    }
    this.#nodes.clear()
  }

  dispose() {
    this.stop()
    void this.#ctx?.close().catch(() => undefined)
    this.#ctx = null
    this.#gain = null
  }

  #context() {
    if (!this.#ctx) {
      this.#ctx = new AudioContext({ latencyHint: "interactive" })
      this.#gain = this.#ctx.createGain()
      this.#gain.gain.value = this.#muted ? 0 : 1
      this.#gain.connect(this.#ctx.destination)
    }
    void this.#ctx.resume().catch(() => undefined)
    return { ctx: this.#ctx, gain: this.#gain! }
  }

  async #play(from: number, run: number) {
    const { ctx, gain } = this.#context()
    const base = ctx.currentTime + 0.03
    try {
      for await (const chunk of audioBuffers(this.files, this.#segments, from)) {
        if (run !== this.#run) return
        const when = base + (chunk.start - from) / 1000
        if (when + chunk.duration / 1000 <= ctx.currentTime) continue
        while (when - ctx.currentTime > 4 && run === this.#run) await sleep(250)
        if (run !== this.#run) return
        const node = ctx.createBufferSource()
        node.buffer = chunk.buffer
        node.connect(gain)
        node.addEventListener("ended", () => this.#nodes.delete(node))
        this.#nodes.add(node)
        node.start(Math.max(when, ctx.currentTime), Math.max(0, ctx.currentTime - when))
      }
    } catch {
      return
    }
  }
}

/** Feeds a recording's sound, in order, into the output of a rendered video as far as asked. */
export class AudioFeeder {
  #chunks: AsyncGenerator<AudioChunk, void, unknown>
  #pending: AudioChunk | null = null
  #lastEnd = 0
  #done = false

  constructor(
    files: RecordingFiles,
    segments: AudioSegment[],
    readonly source: AudioSampleSource,
    readonly offset = 0,
  ) {
    this.#chunks = audioBuffers(files, segments, 0)
  }

  /** Adds everything that starts before `seconds` of the output, the recording's sound shifted by offset seconds. */
  async until(seconds: number) {
    while (!this.#done) {
      let chunk = this.#pending
      if (!chunk) {
        const next = await this.#chunks.next()
        if (next.done) {
          this.#done = true
          return
        }
        chunk = next.value
      }
      if (chunk.start / 1000 + this.offset > seconds) {
        this.#pending = chunk
        return
      }
      this.#pending = null
      const start = Math.max(chunk.start / 1000 + this.offset, this.#lastEnd)
      for (const sample of AudioSample.fromAudioBuffer(chunk.buffer, start)) {
        await this.source.add(sample)
        sample.close()
      }
      this.#lastEnd = start + chunk.duration / 1000
    }
  }

  close() {
    void this.#chunks.return()
  }
}
