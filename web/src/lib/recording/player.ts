import type { RecordingManifest } from "@/api/client"
import { AudioPlayback } from "@/lib/recording/audio"
import type { RecordingFiles } from "@/lib/recording/files"
import { Cursor, Frames } from "@/lib/recording/frames"
import { LogcatChunks, segmentsOf } from "@/lib/recording/timeline"
import { drawOverlay, type TouchTrack } from "@/lib/recording/touches"

export type PlayerState = {
  time: number
  playing: boolean
  rate: number
  duration: number
  size: { w: number; h: number }
  /** the recording has sound */
  sound: boolean
  muted: boolean
}

/** Plays a recording's video onto a canvas; everything around it is the page's. */
export class Player {
  readonly frames: Frames
  readonly logcat: LogcatChunks
  readonly audio: AudioPlayback
  #cursor: Cursor
  #manifest: RecordingManifest
  #ctx: CanvasRenderingContext2D | null = null
  #t = 0
  #playing = false
  #rate = 1
  #wall = 0
  #from = 0
  #raf = 0
  #size: { w: number; h: number }
  #touches: TouchTrack | null = null
  #showTouches = true
  #state: PlayerState
  #published = -1
  #listeners = new Set<() => void>()

  constructor(files: RecordingFiles, manifest: RecordingManifest) {
    this.#manifest = manifest
    this.frames = new Frames(files, segmentsOf(manifest))
    this.logcat = new LogcatChunks(files, manifest.logcat)
    this.audio = new AudioPlayback(files, manifest)
    this.#cursor = new Cursor(this.frames)
    const first = manifest.epochs[0]
    this.#size = { w: first?.width || 720, h: first?.height || 1600 }
    this.#state = this.#snapshot()
  }

  subscribe = (fn: () => void) => {
    this.#listeners.add(fn)
    return () => void this.#listeners.delete(fn)
  }

  getState = () => this.#state

  #publish(force = false) {
    const time = Math.floor(this.#t / 100)
    if (!force && time === this.#published) return
    this.#published = time
    this.#state = this.#snapshot()
    for (const fn of this.#listeners) fn()
  }

  #snapshot(): PlayerState {
    return {
      time: this.#t,
      playing: this.#playing,
      rate: this.#rate,
      duration: this.#manifest.duration,
      size: this.#size,
      sound: this.audio.available,
      muted: this.audio.muted,
    }
  }

  setMuted(muted: boolean) {
    this.audio.setMuted(muted)
    this.#publish(true)
  }

  /** Takes a newer manifest of a recording still in progress. */
  update(manifest: RecordingManifest) {
    const grew = manifest.duration > this.#manifest.duration
    this.#manifest = manifest
    this.frames.segments = segmentsOf(manifest)
    this.logcat.update(manifest.logcat)
    this.audio.update(manifest)
    if (grew && this.#cursor.ended) this.#cursor.seek(this.#t)
    this.#publish(true)
    this.#draw()
  }

  setTouches(track: TouchTrack | null) {
    this.#touches = track
    this.#draw()
  }

  setShowTouches(show: boolean) {
    this.#showTouches = show
    this.#draw()
  }

  attach(canvas: HTMLCanvasElement | null) {
    if (canvas && this.#ctx?.canvas === canvas) return
    this.#ctx = null
    if (canvas) {
      canvas.width = this.#size.w
      canvas.height = this.#size.h
      this.#ctx = canvas.getContext("2d", { alpha: false })
      void this.seek(this.#t)
    }
  }

  play() {
    if (this.#playing) return
    if (this.#t >= this.#manifest.duration - 50) void this.seek(0)
    this.#playing = true
    this.#wall = performance.now()
    this.#from = this.#t
    this.audio.start(this.#t, this.#rate)
    this.#publish(true)
    this.#loop()
  }

  pause() {
    this.#playing = false
    this.audio.stop()
    cancelAnimationFrame(this.#raf)
    this.#publish(true)
  }

  toggle() {
    if (this.#playing) this.pause()
    else this.play()
  }

  setRate(rate: number) {
    this.#from = this.#t
    this.#wall = performance.now()
    this.#rate = rate
    if (this.#playing) this.audio.start(this.#t, rate)
    this.#publish(true)
  }

  async seek(t: number) {
    this.#t = Math.min(Math.max(0, t), this.#manifest.duration)
    this.#from = this.#t
    this.#wall = performance.now()
    this.#cursor.seek(this.#t)
    void this.logcat.ensure(this.#t)
    if (this.#playing) this.audio.start(this.#t, this.#rate)
    this.#publish(true)
    await this.#cursor.advance(this.#t)
    this.#draw()
  }

  #loop = () => {
    if (!this.#playing) return
    this.#t = this.#from + (performance.now() - this.#wall) * this.#rate
    if (this.#t >= this.#manifest.duration) {
      this.#t = this.#manifest.duration
      this.pause()
    }
    this.#cursor.pump(this.#t, () => undefined)
    void this.logcat.ensure(this.#t)
    this.#draw()
    this.#publish()
    this.#raf = requestAnimationFrame(this.#loop)
  }

  #draw() {
    const ctx = this.#ctx
    if (!ctx) return
    const sample = this.#cursor.frame?.sample
    if (sample && (sample.displayWidth !== this.#size.w || sample.displayHeight !== this.#size.h)) {
      this.#size = { w: sample.displayWidth, h: sample.displayHeight }
      ctx.canvas.width = this.#size.w
      ctx.canvas.height = this.#size.h
      this.#publish(true)
    }
    if (sample) sample.draw(ctx, 0, 0, this.#size.w, this.#size.h)
    else {
      ctx.fillStyle = "#000"
      ctx.fillRect(0, 0, this.#size.w, this.#size.h)
    }
    if (this.#showTouches && this.#touches)
      drawOverlay(ctx, 0, 0, this.#size.w, this.#size.h, this.#touches.at(this.#t))
  }

  /** Stops playing and frees the decoder; a later seek or attach starts it again. */
  dispose() {
    this.pause()
    this.audio.dispose()
    this.#cursor.close()
  }
}
