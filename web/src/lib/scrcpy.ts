import { HidKeyboard, HidKeyCode } from "@yume-chan/aoa"
import {
  AndroidKeyCode,
  AndroidKeyEventAction,
  AndroidKeyEventMeta,
  AndroidMotionEventAction,
  ScrcpyControlMessageSerializer,
  ScrcpyControlMessageType,
  ScrcpyOptions3_3_3,
  ScrcpyPointerId,
} from "@yume-chan/scrcpy"
import {
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
  WebGLVideoFrameRenderer,
} from "@yume-chan/scrcpy-decoder-webcodecs"
import { ReadableStream } from "@yume-chan/stream-extra"
import type { KeyboardMode, ScreenPrefs, VideoCodec } from "@/lib/screen-prefs"

// Must match how the agent starts the server (internal/agent/scrcpy.go).
const serverOptions = { audio: false, control: true, clipboardAutosync: false } as const

// contract.DisplayUnsupportedCodec
const unsupportedCodec = 4001

const openHardKeyboardSettings = 15
const keyboardId = 1

export class UnsupportedCodecError extends Error {}

export type StreamStats = { frames: number; skipped: number; bytes: number }

export type ScreenConnection = {
  canvas: HTMLCanvasElement
  control: ScreenControl
  done: Promise<void>
  snapshot: () => Promise<Blob | undefined>
  stats: () => StreamStats
  close: () => void
}

export function screenSupported() {
  return WebCodecsVideoDecoder.isSupported
}

const codecProbes: Record<VideoCodec, string> = {
  h264: "avc1.640028",
  h265: "hvc1.1.6.L120.90",
  av1: "av01.0.08M.08",
}

export async function decodableCodecs(): Promise<VideoCodec[]> {
  if (!screenSupported()) return []
  const codecs = Object.keys(codecProbes) as VideoCodec[]
  const supported = await Promise.all(
    codecs.map((codec) =>
      VideoDecoder.isConfigSupported({ codec: codecProbes[codec] }).then(
        (r) => r.supported === true,
        () => false,
      ),
    ),
  )
  return codecs.filter((_, i) => supported[i])
}

export function socketStream(ws: WebSocket) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      ws.addEventListener("message", (e) => controller.enqueue(new Uint8Array(e.data as ArrayBuffer)))
      ws.addEventListener("close", () => {
        try {
          controller.close()
        } catch {
          return
        }
      })
    },
    cancel() {
      ws.close()
    },
  })
}

export function openSocket(url: string) {
  const ws = new WebSocket(url)
  ws.binaryType = "arraybuffer"
  const closed = new Promise<CloseEvent>((resolve) => ws.addEventListener("close", resolve, { once: true }))
  const opened = new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true })
    ws.addEventListener("close", () => reject(new Error("the connection closed")), { once: true })
  })
  return { ws, opened, closed }
}

type StreamOptions = Omit<ScreenPrefs, "keyboard">

function screenQuery(prefs: StreamOptions) {
  return new URLSearchParams({
    codec: prefs.codec,
    maxSize: String(prefs.maxSize),
    maxFps: String(prefs.maxFps),
    bitRate: String(prefs.bitRate),
  }).toString()
}

export async function openScreen(
  url: string,
  canvas: HTMLCanvasElement,
  prefs: StreamOptions,
): Promise<ScreenConnection> {
  const { ws, opened, closed } = openSocket(`${url}?${screenQuery(prefs)}`)
  const options = new ScrcpyOptions3_3_3({ ...serverOptions, videoCodec: prefs.codec })
  let parsed
  try {
    await opened
    parsed = await options.parseVideoStreamMetadata(socketStream(ws))
  } catch (e) {
    const event = await Promise.race([closed, new Promise<undefined>((r) => setTimeout(r, 100))])
    if (event?.code === unsupportedCodec) throw new UnsupportedCodecError(event.reason)
    throw e
  }
  const { stream, metadata } = parsed
  const renderer = WebGLVideoFrameRenderer.isSupported
    ? new WebGLVideoFrameRenderer(canvas)
    : new BitmapVideoFrameRenderer(canvas)
  const decoder = new WebCodecsVideoDecoder({ codec: metadata.codec, renderer })
  let bytes = 0
  ws.addEventListener("message", (e: MessageEvent<ArrayBuffer>) => {
    bytes += e.data.byteLength
  })
  const control = new ScreenControl(ws, canvas, options)
  const done = stream
    .pipeThrough(options.createMediaStreamTransformer())
    .pipeTo(decoder.writable)
    .catch(() => undefined)
    .finally(() => decoder.dispose())
  return {
    canvas,
    control,
    done,
    snapshot: () => decoder.snapshot(),
    stats: () => ({ frames: decoder.framesRendered, skipped: decoder.framesSkipped, bytes }),
    close: () => ws.close(),
  }
}

function clamp(v: number, max: number) {
  return Math.min(Math.max(v, 0), max)
}

const metaKeys: ["shiftKey" | "altKey" | "ctrlKey" | "metaKey", number][] = [
  ["shiftKey", AndroidKeyEventMeta.Shift],
  ["altKey", AndroidKeyEventMeta.Alt],
  ["ctrlKey", AndroidKeyEventMeta.Ctrl],
  ["metaKey", AndroidKeyEventMeta.Meta],
]

export class ScreenControl {
  readonly #ws: WebSocket
  readonly #canvas: HTMLCanvasElement
  readonly #serializer: ScrcpyControlMessageSerializer
  readonly #scroll
  readonly #hid = new HidKeyboard()
  readonly #report = new Uint8Array(HidKeyboard.REPORT_SIZE)
  #hidCreated = false

  constructor(ws: WebSocket, canvas: HTMLCanvasElement, options: ScrcpyOptions3_3_3<boolean>) {
    this.#ws = ws
    this.#canvas = canvas
    this.#serializer = new ScrcpyControlMessageSerializer(options)
    this.#scroll = options.createScrollController()
  }

  #send(message: Uint8Array | undefined) {
    if (message && this.#ws.readyState === WebSocket.OPEN) this.#ws.send(message as Uint8Array<ArrayBuffer>)
  }

  // The canvas letterboxes the video (object-fit: contain); map a client
  // point into video pixels.
  #point(clientX: number, clientY: number) {
    const rect = this.#canvas.getBoundingClientRect()
    const width = this.#canvas.width
    const height = this.#canvas.height
    const scale = Math.min(rect.width / width, rect.height / height)
    const left = rect.left + (rect.width - width * scale) / 2
    const top = rect.top + (rect.height - height * scale) / 2
    return {
      pointerX: clamp((clientX - left) / scale, width),
      pointerY: clamp((clientY - top) / scale, height),
      videoWidth: width,
      videoHeight: height,
    }
  }

  get ready() {
    return this.#canvas.width > 0 && this.#canvas.height > 0
  }

  pointer(e: PointerEvent, phase: "down" | "move" | "up") {
    if (!this.ready) return
    const action = {
      down: AndroidMotionEventAction.Down,
      move: AndroidMotionEventAction.Move,
      up: AndroidMotionEventAction.Up,
    }[phase]
    this.#send(
      this.#serializer.injectTouch({
        action,
        pointerId: e.pointerType === "mouse" ? ScrcpyPointerId.Finger : BigInt(e.pointerId),
        ...this.#point(e.clientX, e.clientY),
        pressure: phase === "up" ? 0 : e.pressure || 1,
        actionButton: 0,
        buttons: 0,
      }),
    )
  }

  wheel(e: WheelEvent) {
    if (!this.ready) return
    this.#send(
      this.#scroll.serializeScrollMessage({
        type: ScrcpyControlMessageType.InjectScroll,
        ...this.#point(e.clientX, e.clientY),
        scrollX: -e.deltaX / 100,
        scrollY: -e.deltaY / 100,
        buttons: 0,
      }),
    )
  }

  key(e: KeyboardEvent, down: boolean, mode: KeyboardMode): boolean {
    return mode === "uhid" ? this.#hidKey(e, down) : this.#textKey(e, down)
  }

  // Printable characters go in as text so any keyboard layout works; other
  // keys as Android key codes, which share their names with KeyboardEvent.code.
  #textKey(e: KeyboardEvent, down: boolean): boolean {
    const shortcut = e.ctrlKey || e.metaKey || e.altKey
    if (down && e.key.length === 1 && !shortcut) {
      this.#send(this.#serializer.injectText(e.key))
      return true
    }
    if (e.key.length === 1 && !shortcut) return true
    const keyCode = AndroidKeyCode[e.code as keyof typeof AndroidKeyCode]
    if (keyCode === undefined) return false
    let metaState = 0
    for (const [k, v] of metaKeys) if (e[k]) metaState |= v
    this.#send(
      this.#serializer.injectKeyCode({
        action: down ? AndroidKeyEventAction.Down : AndroidKeyEventAction.Up,
        keyCode,
        repeat: e.repeat ? 1 : 0,
        metaState: metaState as AndroidKeyEventMeta,
      }),
    )
    return true
  }

  // A virtual USB keyboard: Android sees physical key presses and applies
  // its own keyboard layout.
  #hidKey(e: KeyboardEvent, down: boolean): boolean {
    const code = HidKeyCode[e.code as keyof typeof HidKeyCode]
    if (code === undefined) return false
    if (!this.#hidCreated) {
      this.#send(
        this.#serializer.uHidCreate({
          id: keyboardId,
          vendorId: 0,
          productId: 0,
          name: "Holtdroid keyboard",
          data: HidKeyboard.DESCRIPTOR,
        }),
      )
      this.#hidCreated = true
    }
    if (down) this.#hid.down(code)
    else this.#hid.up(code)
    this.#sendReport()
    return true
  }

  #sendReport() {
    this.#hid.updateReport(this.#report)
    this.#send(this.#serializer.uHidInput({ id: keyboardId, data: this.#report.slice() }))
  }

  releaseKeys() {
    if (!this.#hidCreated) return
    this.#hid.reset()
    this.#sendReport()
  }

  press(keyCode: AndroidKeyCode) {
    for (const action of [AndroidKeyEventAction.Down, AndroidKeyEventAction.Up]) {
      this.#send(this.#serializer.injectKeyCode({ action, keyCode, repeat: 0, metaState: AndroidKeyEventMeta.None }))
    }
  }

  backOrScreenOn() {
    this.#send(this.#serializer.backOrScreenOn(AndroidKeyEventAction.Down))
    this.#send(this.#serializer.backOrScreenOn(AndroidKeyEventAction.Up))
  }

  notifications() {
    this.#send(this.#serializer.expandNotificationPanel())
  }

  quickSettings() {
    this.#send(this.#serializer.expandSettingPanel())
  }

  keyboardSettings() {
    this.#send(new Uint8Array([openHardKeyboardSettings]))
  }

  resetVideo() {
    this.#send(this.#serializer.resetVideo())
  }

  paste(text: string) {
    const message = this.#serializer.setClipboard({ sequence: 0n, paste: true, content: text })
    this.#send(Array.isArray(message) ? message[0] : message)
  }
}
