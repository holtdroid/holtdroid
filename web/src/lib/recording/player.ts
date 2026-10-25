import type { RecordingManifest } from "@/api/client"
import { Cursor, Frames } from "@/lib/recording/frames"
import { drawScene, type SceneApp, sceneHeight, sceneWidth } from "@/lib/recording/scene"
import { LogcatChunks, segmentsOf, type Telemetry } from "@/lib/recording/timeline"

export type PlayerState = { time: number; playing: boolean; rate: number; duration: number }

const logcatLines = 60

/** Plays a recording onto a canvas through the same scene the baked video uses. */
export class Player {
  readonly frames: Frames
  readonly logcat: LogcatChunks
  #cursor: Cursor
  #telemetry: Telemetry
  #manifest: RecordingManifest
  #app: SceneApp
  #ctx: CanvasRenderingContext2D | null = null
  #t = 0
  #playing = false
  #rate = 1
  #wall = 0
  #from = 0
  #raf = 0
  #state: PlayerState
  #published = -1
  #listeners = new Set<() => void>()

  constructor(filesUrl: string, manifest: RecordingManifest, telemetry: Telemetry, app: SceneApp) {
    this.#manifest = manifest
    this.#telemetry = telemetry
    this.#app = app
    this.frames = new Frames(filesUrl, segmentsOf(manifest))
    this.logcat = new LogcatChunks(filesUrl, manifest.logcat)
    this.#cursor = new Cursor(this.frames)
    this.#state = { time: 0, playing: false, rate: 1, duration: manifest.duration }
    this.logcat.subscribe(() => this.#draw())
    if (app.icon && !app.icon.complete) app.icon.addEventListener("load", () => this.#draw(), { once: true })
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
    this.#state = { time: this.#t, playing: this.#playing, rate: this.#rate, duration: this.#manifest.duration }
    for (const fn of this.#listeners) fn()
  }

  /** Takes a newer manifest of a recording still in progress. */
  update(manifest: RecordingManifest, telemetry: Telemetry) {
    const grew = manifest.duration > this.#manifest.duration
    this.#manifest = manifest
    this.#telemetry = telemetry
    this.frames.segments = segmentsOf(manifest)
    this.logcat.update(manifest.logcat)
    if (grew && this.#cursor.ended) this.#cursor.seek(this.#t)
    this.#publish(true)
    this.#draw()
  }

  attach(canvas: HTMLCanvasElement | null) {
    this.#ctx = null
    if (canvas) {
      canvas.width = sceneWidth
      canvas.height = sceneHeight
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
    this.#publish(true)
    this.#loop()
  }

  pause() {
    this.#playing = false
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
    this.#publish(true)
  }

  async seek(t: number) {
    this.#t = Math.min(Math.max(0, t), this.#manifest.duration)
    this.#from = this.#t
    this.#wall = performance.now()
    this.#cursor.seek(this.#t)
    void this.logcat.ensure(this.#t)
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
    if (!this.#ctx) return
    drawScene(this.#ctx, {
      t: this.#t,
      duration: this.#manifest.duration,
      startedAt: new Date(this.#manifest.startedAt).getTime(),
      frame: this.#cursor.frame?.sample ?? null,
      snap: this.#telemetry.at(this.#t),
      logcat: this.logcat.before(this.#t, logcatLines),
      app: this.#app,
    })
  }

  /** Stops playing and frees the decoder; a later seek or attach starts it again. */
  dispose() {
    this.pause()
    this.#cursor.close()
  }
}
