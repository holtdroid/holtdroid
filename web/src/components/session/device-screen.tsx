import { LockIcon, PowerIcon } from "lucide-react"
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { type Display, type Location, type Metrics, type Screen, sessionBase } from "@/api/client"
import { CutoutOverlay } from "@/components/session/cutout-overlay"
import { displayURL, type LiveScreen, useDecodableCodecs } from "@/components/session/live-screen"
import { BatteryWidget } from "@/components/session/battery-widget"
import { ClipboardWidget } from "@/components/session/clipboard-widget"
import { DisplayWidget } from "@/components/session/display-widget"
import { GpsWidget } from "@/components/session/gps-widget"
import { LanguageWidget } from "@/components/session/language-widget"
import { NetworkWidget } from "@/components/session/network-widget"
import { widgetWidth } from "@/components/session/shade"
import { SSHWidget } from "@/components/session/ssh-widget"
import { StreamWidget } from "@/components/session/stream-widget"
import { TimeWidget } from "@/components/session/time-widget"
import { PhoneButtons } from "@/components/session/phone-buttons"
import { useDevice } from "@/components/session/use-device"
import { Spinner } from "@/components/ui/spinner"
import { useEventSource } from "@/hooks/use-event-source"
import { screenDp } from "@/lib/cutout"
import { openScreen, screenSupported, UnsupportedCodecError } from "@/lib/scrcpy"
import { setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"
import { pickCodec, streamSettings } from "@/lib/stream-settings"

type Status = "connecting" | "live" | "retrying"

const gap = 12
const bezel = 8
const keyArea = 4 + 18
const widgetGap = 8

export const frameInset = {
  x: 2 * (gap + bezel) + keyArea + widgetGap + widgetWidth,
  y: 2 * (gap + bezel),
}

function frameStyle(ratio: number, corner: number): CSSProperties {
  return {
    "--r": ratio,
    "--sw": `max(0px, min(calc((100cqh - ${frameInset.y}px) * var(--r)), calc(100cqw - ${frameInset.x}px)))`,
    "--sr": `calc(min(var(--sw), var(--sw) / var(--r)) * ${corner})`,
    "--bz": `${bezel}px`,
    padding: bezel,
    borderRadius: `calc(var(--sr) + ${bezel}px)`,
  } as CSSProperties
}

export function DeviceScreen({
  provider,
  id,
  live,
  display: shape,
  locations,
  clipboard,
  metrics,
}: {
  provider: string
  id: string
  live: LiveScreen
  display?: Display
  locations: Location[]
  clipboard: boolean
  metrics: Metrics[]
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const supported = screenSupported()
  const prefs = useScreenPrefs()
  const codecs = useDecodableCodecs()
  const { bitRate } = prefs
  const device = useDevice(provider, id)
  const { maxSize, maxFps } = streamSettings(prefs, `${provider}/${id}`, device.data)
  const ready = !device.isPending
  const codec = pickCodec(prefs.codec, codecs)
  const stream = `${provider}/${id}/${codec}/${maxSize}/${maxFps}/${bitRate}`
  const [state, setState] = useState<{ stream: string; status: Status }>({ stream, status: "connecting" })
  const status = state.stream === stream ? state.status : "connecting"
  const [screen, setScreen] = useState<{ key: string; value: Screen } | null>(null)
  const display = screen?.key === `${provider}/${id}` ? screen.value : null
  const noticeRef = useRef<HTMLDivElement>(null)
  const [noticeHovered, setNoticeHovered] = useState(false)
  const [videoRatio, setVideoRatio] = useState<number | null>(null)

  useEventSource<{ screen: Screen }>(supported ? `${sessionBase(provider, id)}/v1/screen` : null, {
    screen: (value) => setScreen({ key: `${provider}/${id}`, value }),
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !supported || !ready) return undefined
    let stopped = false
    let attempt = 0
    let timer = 0
    const connect = async () => {
      let conn
      try {
        conn = await openScreen(displayURL(provider, id, "scrcpy"), canvas, { codec, maxSize, maxFps, bitRate })
        if (stopped) {
          conn.close()
          return
        }
        live.set(conn)
        attempt = 0
        setState({ stream, status: "live" })
        await conn.done
      } catch (e) {
        if (e instanceof UnsupportedCodecError && !stopped) {
          toast.warning(`${codec.toUpperCase()} isn't available on this device`, { description: "Switched to H.264." })
          setScreenPrefs({ codec: "h264" })
          return
        }
      }
      live.release(conn)
      if (stopped) return
      setState({ stream, status: "retrying" })
      timer = window.setTimeout(() => void connect(), Math.min(500 * 2 ** attempt++, 5000))
    }
    void connect()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      live.connection?.close()
      live.set(null)
    }
  }, [provider, id, supported, ready, live, codec, maxSize, maxFps, bitRate, stream])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      live.connection?.control.wheel(e)
    }
    canvas.addEventListener("wheel", onWheel, { passive: false })
    return () => canvas.removeEventListener("wheel", onWheel)
  }, [live])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const observer = new MutationObserver(() =>
      setVideoRatio(canvas.width > 0 && canvas.height > 0 ? canvas.width / canvas.height : null),
    )
    observer.observe(canvas, { attributes: true, attributeFilter: ["width", "height"] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") live.connection?.control.resetVideo()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [live])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.focus()
    const control = live.connection?.control
    if (e.pointerType === "mouse" && e.button === 2) {
      control?.backOrScreenOn()
      return
    }
    if (e.pointerType === "mouse" && e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    control?.pointer(e.nativeEvent, "down")
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) live.connection?.control.pointer(e.nativeEvent, "move")
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    live.connection?.control.pointer(e.nativeEvent, "up")
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const onKey = (e: React.KeyboardEvent<HTMLCanvasElement>, down: boolean) => {
    const c = live.connection?.control
    if (!c) return
    if (down && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
      e.preventDefault()
      navigator.clipboard.readText().then(
        (text) => text && c.paste(text),
        () => undefined,
      )
      return
    }
    if (c.key(e.nativeEvent, down, prefs.keyboard)) e.preventDefault()
  }

  const trackNotice = (e: React.PointerEvent) => {
    const r = noticeRef.current?.getBoundingClientRect()
    const inside = !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    if (inside !== noticeHovered) setNoticeHovered(inside)
  }

  const notice: { icon: ReactNode; title: string; hint?: string } | null =
    status !== "live"
      ? {
          icon: <Spinner />,
          title: status === "connecting" ? "Connecting to the screen…" : "Screen disconnected",
          hint: status === "retrying" ? "Reconnecting…" : undefined,
        }
      : display && !display.on
        ? { icon: <PowerIcon />, title: "Screen is off", hint: "Right-click to wake it" }
        : display?.locked
          ? { icon: <LockIcon />, title: "Screen is locked", hint: "Swipe up to unlock" }
          : null

  if (!supported) {
    return (
      <div className="text-muted-foreground grid size-full place-items-center bg-neutral-950 p-6 text-center text-sm">
        This browser can't decode the screen stream (WebCodecs is missing). Use a recent Chrome, Edge, Firefox or
        Safari.
      </div>
    )
  }

  const portrait = shape && shape.width > 0 && shape.height > 0 ? shape : null
  const ratio = videoRatio ?? (portrait ? portrait.width / portrait.height : 9 / 19.5)
  const corner = portrait?.radius ? portrait.radius / Math.min(screenDp(portrait).w, screenDp(portrait).h) : 0.07

  return (
    <div className="bg-muted/40 grid size-full place-items-center overflow-hidden" style={{ containerType: "size" }}>
      <div className="flex items-start" style={{ gap: keyArea + widgetGap }}>
        <div
          className="relative bg-neutral-900 shadow-lg ring-1 ring-black/50 dark:ring-white/15"
          style={frameStyle(ratio, corner)}
        >
          <div
            className="relative overflow-hidden bg-neutral-950"
            style={{ width: "var(--sw)", height: "calc(var(--sw) / var(--r))", borderRadius: "var(--sr)" }}
            onPointerMove={trackNotice}
            onPointerLeave={() => setNoticeHovered(false)}
          >
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
              onBlur={() => live.connection?.control.releaseKeys()}
              onContextMenu={(e) => e.preventDefault()}
            />
            {shape?.cutout && shape.cutout !== "none" && <CutoutOverlay canvasRef={canvasRef} screen={shape} />}
            {notice && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center p-4">
                <div
                  ref={noticeRef}
                  role="status"
                  className="flex max-w-full flex-col items-center gap-2 rounded-[2rem] border border-white/10 bg-neutral-900/60 px-6 py-5 text-center text-white shadow-lg backdrop-blur-md transition-opacity duration-200 [corner-shape:squircle] supports-[corner-shape:squircle]:rounded-[3rem] data-[hovered=true]:opacity-0 [&_svg]:size-6 [&_svg]:text-white/80"
                  data-hovered={noticeHovered}
                >
                  {notice.icon}
                  <span className="text-sm font-medium">{notice.title}</span>
                  {notice.hint && <span className="text-xs text-white/60">{notice.hint}</span>}
                </div>
              </div>
            )}
          </div>
          <PhoneButtons provider={provider} id={id} live={live} />
        </div>
        <div className="flex flex-col gap-2">
          <NetworkWidget provider={provider} id={id} locations={locations} metrics={metrics} />
          <GpsWidget provider={provider} id={id} vpn={locations.length > 0} />
          <StreamWidget provider={provider} id={id} live={live} />
          <DisplayWidget provider={provider} id={id} />
          {clipboard && <ClipboardWidget provider={provider} id={id} />}
          <BatteryWidget provider={provider} id={id} />
          <LanguageWidget provider={provider} id={id} />
          <TimeWidget provider={provider} id={id} />
          <SSHWidget provider={provider} id={id} />
        </div>
      </div>
    </div>
  )
}
