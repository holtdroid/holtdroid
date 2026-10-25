import { BlobSource, Input, MP4, type VideoSample, VideoSampleSink } from "mediabunny"
import { type Segment, segmentAt } from "@/lib/recording/timeline"

export type Frame = { t: number; sample: VideoSample }

/**
 * Decodes a recording's segments. Each segment starts with a key frame and is
 * read as its epoch's init file followed by the segment, so seeking only ever
 * fetches the segment that holds the time.
 */
export class Frames {
  #files = new Map<string, Promise<ArrayBuffer>>()
  segments: Segment[]

  constructor(
    readonly filesUrl: string,
    segments: Segment[],
  ) {
    this.segments = segments
  }

  #fetch(file: string) {
    let p = this.#files.get(file)
    if (!p) {
      p = fetch(this.filesUrl + file).then((r) => {
        if (!r.ok) throw new Error(`${file}: ${r.status}`)
        return r.arrayBuffer()
      })
      p.catch(() => this.#files.delete(file))
      this.#files.set(file, p)
      if (this.#files.size > 16) {
        const oldest = [...this.#files.keys()].find((k) => k.startsWith("seg-"))
        if (oldest && oldest !== file) this.#files.delete(oldest)
      }
    }
    return p
  }

  /** Frames from the one showing at t (ms) on, in recording time. */
  async *from(t: number): AsyncGenerator<Frame, void, unknown> {
    let i = Math.max(0, segmentAt(this.segments, t))
    for (; i < this.segments.length; i++) {
      const seg = this.segments[i]!
      const next = this.segments[i + 1]
      if (next) void this.#fetch(next.file).catch(() => undefined)
      let data: ArrayBuffer[]
      try {
        data = await Promise.all([this.#fetch(seg.init), this.#fetch(seg.file)])
      } catch {
        continue
      }
      const input = new Input({ source: new BlobSource(new Blob(data)), formats: [MP4] })
      try {
        const track = await input.getPrimaryVideoTrack()
        if (!track) continue
        const first = await track.getFirstTimestamp()
        const startAt = Math.max(first, first + (t - seg.start) / 1000)
        for await (const sample of new VideoSampleSink(track).samples(startAt)) {
          yield { t: seg.start + (sample.timestamp - first) * 1000, sample }
        }
      } catch {
        continue
      } finally {
        input.dispose()
      }
    }
  }
}

/**
 * Follows a Frames stream as a clock moves: frame is the one showing at the
 * last time advanced to.
 */
export class Cursor {
  #gen: AsyncGenerator<Frame, void, unknown> | null = null
  #current: Frame | null = null
  #next: Frame | null = null
  #fresh = false
  #done = false
  #busy: Promise<void> | null = null

  constructor(readonly frames: Frames) {}

  get frame() {
    return this.#current
  }

  get ended() {
    return this.#done
  }

  seek(t: number) {
    void this.#gen?.return()
    this.#next?.sample.close()
    this.#next = null
    this.#gen = this.frames.from(t)
    this.#fresh = true
    this.#done = false
    this.#busy = null
  }

  /** Moves to t, waiting for the frames it needs; t only grows between seeks. */
  async advance(t: number) {
    if (!this.#gen) this.seek(t)
    while (!this.#done) {
      if (!this.#next) {
        const gen = this.#gen!
        const r = await gen.next()
        if (gen !== this.#gen) {
          if (!r.done) r.value.sample.close()
          return
        }
        if (r.done) {
          this.#done = true
          break
        }
        this.#next = r.value
      }
      if (!this.#fresh && this.#next.t > t) break
      this.#fresh = false
      this.#current?.sample.close()
      this.#current = this.#next
      this.#next = null
    }
  }

  /** advance without waiting: one decode at a time in the background. */
  pump(t: number, onFrame: () => void) {
    if (this.#busy) return
    const before = this.#current
    this.#busy = this.advance(t).then(() => {
      this.#busy = null
      if (this.#current !== before) onFrame()
    })
  }

  close() {
    void this.#gen?.return()
    this.#gen = null
    this.#current?.sample.close()
    this.#next?.sample.close()
    this.#current = this.#next = null
  }
}
