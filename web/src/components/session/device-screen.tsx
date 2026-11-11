import { type CSSProperties, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { type Display, type Screen, sessionBase } from "@/api/client"
import type { AdbSession } from "@/components/session/adb-session"
import { CutoutOverlay } from "@/components/session/cutout-overlay"
import { displayURL, type LiveScreen, useDecodableCodecs } from "@/components/session/live-screen"
import { PixelOverlay } from "@/components/session/pixel-perfect/overlay"
import type { PixelPerfect } from "@/components/session/pixel-perfect/state"
import { AppClosed, AppCrashed, Connecting, Locked, Reconnecting, ScreenOff } from "@/components/session/screen-states"
import { StageToolbar, toolSize } from "@/components/session/stage-toolbar"
import { useDevice, useRestartApp, useRunDeviceAction } from "@/components/session/use-device"
import { useVibrationAlerts } from "@/components/session/vibration-alerts"
import { useEventSource } from "@/hooks/use-event-source"
import { screenDp } from "@/lib/cutout"
import type { Crash } from "@/lib/logcat"
import { openScreen, screenSupported, UnsupportedCodecError } from "@/lib/scrcpy"
import { setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"
import { pickCodec, streamSettings } from "@/lib/stream-settings"
import { cn } from "@/lib/utils"

type Status = "connecting" | "live" | "retrying"

const gap = 12
const bezel = 10

function stageInset(across: boolean) {
  const frame = 2 * (gap + bezel)
  return across ? { x: frame, y: frame + toolSize + 8 + gap } : { x: frame + toolSize + gap, y: frame }
}

function frameStyle(ratio: number, corner: number, inset: { x: number; y: number }): CSSProperties {
  return {
    "--r": ratio,
    "--sw": `max(0px, min(calc((100cqh - ${inset.y}px) * var(--r)), calc(100cqw - ${inset.x}px)))`,
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
  pkg,
  label,
  appRunning,
  adb,
  pp,
  onTab,
}: {
  provider: string
  id: string
  live: LiveScreen
  display?: Display
  pkg: string
  label: string
  appRunning: boolean
  adb: AdbSession | null
  pp: PixelPerfect
  onTab: (tab: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const supported = screenSupported()
  const prefs = useScreenPrefs()
  const codecs = useDecodableCodecs()
  const { bitRate } = prefs
  const device = useDevice(provider, id)
  const run = useRunDeviceAction(provider, id, live)
  const restart = useRestartApp(provider, id)
  useVibrationAlerts(provider, id)
  const { maxSize, maxFps } = streamSettings(prefs, `${provider}/${id}`, device.data)
  const ready = !device.isPending
  const codec = pickCodec(prefs.codec, codecs)
  const stream = `${provider}/${id}/${codec}/${maxSize}/${maxFps}/${bitRate}`
  const [state, setState] = useState<{ stream: string; status: Status; since: number; framed: boolean }>({
    stream,
    status: "connecting",
    since: 0,
    framed: false,
  })
  const status = state.stream === stream ? state.status : "connecting"
  const [screen, setScreen] = useState<{ key: string; value: Screen; offAt?: number } | null>(null)
  const display = screen?.key === `${provider}/${id}` ? screen : null
  const [videoRatio, setVideoRatio] = useState<number | null>(null)
  const [crash, setCrash] = useState<Crash | null>(null)

  useEventSource<{ screen: Screen }>(supported ? `${sessionBase(provider, id)}/v1/screen` : null, {
    screen: (value) =>
      setScreen((prev) => ({
        key: `${provider}/${id}`,
        value,
        offAt: value.on ? undefined : prev?.value.on === false ? prev.offAt : Date.now(),
      })),
  })

  useEffect(() => adb?.logcat.onCrash(setCrash), [adb])

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
        setState({ stream, status: "live", since: 0, framed: true })
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
      setState((s) => ({
        stream,
        status: "retrying",
        since: s.stream === stream && s.status === "retrying" ? s.since : Date.now(),
        framed: s.framed,
      }))
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
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyK") return
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

  if (!supported) {
    return (
      <div className="grid size-full place-items-center bg-stage p-6 text-center text-sm text-muted-foreground">
        This browser can&apos;t decode the screen stream (WebCodecs is missing). Use a recent Chrome, Edge, Firefox or
        Safari.
      </div>
    )
  }

  const portrait = shape && shape.width > 0 && shape.height > 0 ? shape : null
  const ratio = videoRatio ?? (portrait ? portrait.width / portrait.height : 9 / 19.5)
  const corner = portrait?.radius ? portrait.radius / Math.min(screenDp(portrait).w, screenDp(portrait).h) : 0.07
  const across = ratio > 1
  const inset = stageInset(across)
  const lost = status === "retrying" && state.framed
  const reopen = () => {
    setCrash(null)
    restart.mutate()
  }

  const bottom =
    status === "connecting" ? (
      <Connecting />
    ) : status === "retrying" ? (
      <Reconnecting since={state.since} />
    ) : display && !display.value.on ? (
      <ScreenOff
        since={display.offAt}
        onWake={() => (live.connection ? live.connection.control.backOrScreenOn() : run("unlock"))}
      />
    ) : display?.value.locked ? (
      <Locked onUnlock={() => run("unlock")} />
    ) : null

  const top = crash ? (
    <AppCrashed
      label={label}
      crash={crash}
      reopening={restart.isPending}
      onLogcat={adb ? () => onTab("logcat") : undefined}
      onReopen={reopen}
      onDismiss={() => setCrash(null)}
    />
  ) : !appRunning && status === "live" ? (
    <AppClosed label={label} reopening={restart.isPending} onReopen={reopen} />
  ) : null

  return (
    <div
      className="grid size-full min-h-0 min-w-0 place-items-center overflow-hidden"
      style={{ containerType: "size" }}
      data-inset-x={inset.x}
      data-inset-y={inset.y}
    >
      <div className={cn("flex items-center", across ? "flex-col gap-2" : "flex-row gap-3")}>
        <div className="relative border bg-frame shadow-float" style={frameStyle(ratio, corner, inset)}>
          <div
            className="relative overflow-hidden bg-black"
            style={{ width: "var(--sw)", height: "calc(var(--sw) / var(--r))", borderRadius: "var(--sr)" }}
          >
            <canvas
              ref={canvasRef}
              tabIndex={0}
              aria-label="Device screen"
              className={cn(
                "size-full touch-none object-contain transition-[filter,opacity] outline-none select-none",
                lost && "pointer-events-none opacity-55 blur-[1.5px] grayscale",
              )}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={(e) => onKey(e, true)}
              onKeyUp={(e) => onKey(e, false)}
              onBlur={() => live.connection?.control.releaseKeys()}
              onContextMenu={(e) => e.preventDefault()}
            />
            <PixelOverlay pp={pp} canvasRef={canvasRef} />
            {shape?.cutout && shape.cutout !== "none" && <CutoutOverlay canvasRef={canvasRef} screen={shape} />}
            {top}
            {bottom}
          </div>
        </div>
        <StageToolbar provider={provider} id={id} live={live} pkg={pkg} across={across} />
      </div>
    </div>
  )
}
