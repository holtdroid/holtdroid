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

// Must match how the agent starts the server (internal/agent/scrcpy.go).
const options = new ScrcpyOptions3_3_3({ audio: false, control: true, clipboardAutosync: false, videoCodec: "h264" })

export type ScreenConnection = {
  control: ScreenControl
  done: Promise<void>
  close: () => void
}

export function screenSupported() {
  return WebCodecsVideoDecoder.isSupported
}

function socketStream(ws: WebSocket) {
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

function opened(ws: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true })
    ws.addEventListener("close", () => reject(new Error("the screen connection closed")), { once: true })
  })
}

export async function openScreen(url: string, canvas: HTMLCanvasElement): Promise<ScreenConnection> {
  const ws = new WebSocket(url)
  ws.binaryType = "arraybuffer"
  await opened(ws)
  const { stream, metadata } = await options.parseVideoStreamMetadata(socketStream(ws))
  const renderer = WebGLVideoFrameRenderer.isSupported
    ? new WebGLVideoFrameRenderer(canvas)
    : new BitmapVideoFrameRenderer(canvas)
  const decoder = new WebCodecsVideoDecoder({ codec: metadata.codec, renderer })
  const control = new ScreenControl(ws, canvas)
  const done = stream
    .pipeThrough(options.createMediaStreamTransformer())
    .pipeTo(decoder.writable)
    .catch(() => undefined)
    .finally(() => decoder.dispose())
  return { control, done, close: () => ws.close() }
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
  readonly #serializer = new ScrcpyControlMessageSerializer(options)
  readonly #scroll = options.createScrollController()

  constructor(ws: WebSocket, canvas: HTMLCanvasElement) {
    this.#ws = ws
    this.#canvas = canvas
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

  // Printable characters go in as text so any keyboard layout works; other
  // keys as Android key codes, which share their names with KeyboardEvent.code.
  key(e: KeyboardEvent, down: boolean): boolean {
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

  backOrScreenOn() {
    this.#send(this.#serializer.backOrScreenOn(AndroidKeyEventAction.Down))
    this.#send(this.#serializer.backOrScreenOn(AndroidKeyEventAction.Up))
  }

  paste(text: string) {
    const message = this.#serializer.setClipboard({ sequence: 0n, paste: true, content: text })
    this.#send(Array.isArray(message) ? message[0] : message)
  }
}
