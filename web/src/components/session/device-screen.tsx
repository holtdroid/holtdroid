import { useEffect, useRef, useState } from "react"
import { sessionBase } from "@/api/client"
import { Spinner } from "@/components/ui/spinner"
import { openScreen, type ScreenConnection, type ScreenControl, screenSupported } from "@/lib/scrcpy"

type Status = "connecting" | "live" | "retrying"

function screenURL(provider: string, id: string) {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws"
  return `${scheme}://${window.location.host}${sessionBase(provider, id)}/display/scrcpy`
}

export function DeviceScreen({ provider, id }: { provider: string; id: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const control = useRef<ScreenControl | null>(null)
  const [status, setStatus] = useState<Status>("connecting")
  const supported = screenSupported()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !supported) return undefined
    let stopped = false
    let attempt = 0
    let timer = 0
    let current: ScreenConnection | undefined
    const connect = async () => {
      try {
        const conn = await openScreen(screenURL(provider, id), canvas)
        if (stopped) {
          conn.close()
          return
        }
        current = conn
        control.current = conn.control
        attempt = 0
        setStatus("live")
        await conn.done
      } catch {
        current = undefined
      }
      control.current = null
      current = undefined
      if (stopped) return
      setStatus("retrying")
      timer = window.setTimeout(() => void connect(), Math.min(500 * 2 ** attempt++, 5000))
    }
    void connect()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      current?.close()
    }
  }, [provider, id, supported])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      control.current?.wheel(e)
    }
    canvas.addEventListener("wheel", onWheel, { passive: false })
    return () => canvas.removeEventListener("wheel", onWheel)
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.focus()
    if (e.pointerType === "mouse" && e.button === 2) {
      control.current?.backOrScreenOn()
      return
    }
    if (e.pointerType === "mouse" && e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    control.current?.pointer(e.nativeEvent, "down")
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) control.current?.pointer(e.nativeEvent, "move")
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    control.current?.pointer(e.nativeEvent, "up")
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const onKey = (e: React.KeyboardEvent<HTMLCanvasElement>, down: boolean) => {
    const c = control.current
    if (!c) return
    if (down && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
      e.preventDefault()
      navigator.clipboard.readText().then(
        (text) => text && c.paste(text),
        () => undefined,
      )
      return
    }
    if (c.key(e.nativeEvent, down)) e.preventDefault()
  }

  if (!supported) {
    return (
      <div className="text-muted-foreground grid size-full place-items-center bg-neutral-950 p-6 text-center text-sm">
        This browser can't decode the screen stream (WebCodecs is missing). Use a recent Chrome, Edge, Firefox or
        Safari.
      </div>
    )
  }

  return (
    <div className="relative size-full bg-neutral-950">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label="Device screen"
        className="size-full touch-none object-contain outline-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => onKey(e, true)}
        onKeyUp={(e) => onKey(e, false)}
        onContextMenu={(e) => e.preventDefault()}
      />
      {status !== "live" && (
        <div className="text-muted-foreground absolute inset-0 grid place-items-center text-sm">
          <span className="flex items-center gap-2">
            <Spinner />
            {status === "connecting" ? "Connecting to the screen…" : "Screen disconnected, reconnecting…"}
          </span>
        </div>
      )}
    </div>
  )
}
