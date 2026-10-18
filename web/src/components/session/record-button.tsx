import { useQuery } from "@tanstack/react-query"
import { AppWindowIcon, CheckIcon, CircleStopIcon, VideoIcon } from "lucide-react"
import { type ReactNode, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import type { SessionView } from "@/api/client"
import type { AdbSession, AdbStatus } from "@/components/session/adb-session"
import { type LiveScreen, useScreenLive } from "@/components/session/live-screen"
import { RailButton, RailItem } from "@/components/session/rail-item"
import { useDevice } from "@/components/session/use-device"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useNow } from "@/hooks/use-now"
import { download, run, stamp } from "@/lib/adb"
import { parseProps } from "@/lib/android"
import { Composer, type RecordInfo } from "@/lib/composer"
import { formatDuration } from "@/lib/format"
import {
  capturePanel,
  discardRecordings,
  leftoverRecordings,
  panelCaptureSupported,
  type RecordMode,
  type Recording,
  recordingSupported,
  startRecording,
} from "@/lib/recorder"
import { setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"

export type RecordPanel = { element: HTMLElement | null; title: string }

const recordModes: Record<RecordMode, { label: string; hint: string; icon: ReactNode }> = {
  screen: { label: "Device screen", hint: "The framed screen after a short intro", icon: <VideoIcon /> },
  full: {
    label: "Screen and details",
    hint: "Device and app details with the open DevTools or Logcat tab",
    icon: <AppWindowIcon />,
  },
}

const idle: AdbStatus = { state: "idle" }
const noSubscribe = () => () => undefined

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

function useRecordInfo(provider: string, id: string, session: SessionView, adb: AdbSession | null): RecordInfo {
  const device = useDevice(provider, id).data
  const status = useSyncExternalStore(adb?.subscribe ?? noSubscribe, () => adb?.status ?? idle)
  const ready = status.state === "ready" ? status.adb : null
  const props = useQuery({
    queryKey: ["adb-device", ready?.serial, "props"],
    queryFn: async () => (ready ? parseProps(await run(ready, "getprop")) : {}),
    enabled: ready !== null,
    staleTime: Infinity,
  }).data
  const release = props?.["ro.build.version.release"]
  const sdk = props?.["ro.build.version.sdk"]
  const rows: [string, string | undefined][] = [
    ["Model", props?.["ro.product.model"]],
    ["Android", release && (sdk ? `${release} (SDK ${sdk})` : release)],
    ["Slot", session.slot],
    ["Density", device && `${device.density} dpi`],
    ["Locale", device?.locale],
    ["Time zone", device?.timeZone],
    ["Location", session.location],
    ["Theme", device && (device.darkMode ? "Dark" : "Light")],
  ]
  return {
    title: session.label || session.package,
    subtitle: session.package,
    version: session.versionName,
    icon: session.iconUrl,
    device: rows.filter((r): r is [string, string] => Boolean(r[1])),
    rotation: device?.rotation ?? 0,
  }
}

export function RecordButton({
  provider,
  id,
  session,
  live,
  adb,
  panel,
}: {
  provider: string
  id: string
  session: SessionView
  live: LiveScreen
  adb: AdbSession | null
  panel: RecordPanel
}) {
  const screenLive = useScreenLive(live)
  const { recordMode, recordAuto } = useScreenPrefs()
  const mode = recordModes[recordMode] ? recordMode : "screen"
  const [recording, setRecording] = useState<{ rec: Recording; started: number } | null>(null)
  const now = useNow()
  const info = useRecordInfo(provider, id, session, adb)
  const latest = useRef({ info, panel })
  const active = useRef<{ rec: Recording | null; composer: Composer } | null>(null)
  const autoDone = useRef(false)
  const unmounted = useRef(false)
  const supported = recordingSupported()

  useEffect(() => {
    latest.current = { info, panel }
  })

  const sharePanel = async (composer: Composer) => {
    const element = latest.current.panel.element
    if (!element) throw new Error("The tool panel isn't on the page")
    const stream = await capturePanel(element)
    if (active.current?.composer === composer) composer.setPanel(stream)
    else for (const t of stream.getTracks()) t.stop()
    return stream
  }

  const askForPanel = (composer: Composer) => {
    toast("Recording without the tool panel", {
      id: "record-panel",
      description: "The browser asks before it shares a part of this tab.",
      duration: Infinity,
      action: {
        label: "Include it",
        onClick: () =>
          void sharePanel(composer).catch((e: unknown) => {
            if (e instanceof DOMException && e.name === "NotAllowedError") return
            toast.error("Could not capture the tool panel", { description: errorText(e) })
          }),
      },
    })
  }

  const start = async (m: RecordMode, auto: boolean) => {
    if (active.current || !supported) return
    const composer = new Composer({
      mode: m,
      screen: () => live.connection?.canvas ?? null,
      info: () => latest.current.info,
      panelTitle: () => latest.current.panel.title,
    })
    active.current = { rec: null, composer }
    const wantPanel = m === "full" && panelCaptureSupported()
    let audio: MediaStreamTrack | undefined
    try {
      if (wantPanel && !auto) {
        try {
          audio = (await sharePanel(composer)).getAudioTracks()[0]
        } catch (e) {
          if (e instanceof DOMException && e.name === "NotAllowedError") {
            active.current = null
            return
          }
          toast.warning("Recording without the tool panel", { description: errorText(e) })
        }
      }
      composer.start()
      const name = `${session.package}-${stamp()}`
      const rec = await startRecording(composer.canvas, name, audio)
      active.current = { rec, composer }
      if (unmounted.current) rec.stop()
      setRecording({ rec, started: Date.now() })
      if (wantPanel && auto) askForPanel(composer)
      try {
        download(await rec.done, `${name}.${rec.extension}`)
      } finally {
        toast.dismiss("record-panel")
      }
    } catch (e) {
      toast.error("Recording failed", { description: errorText(e) })
    } finally {
      composer.stop()
      active.current = null
      setRecording(null)
    }
  }

  const autoStart = useEffectEvent(() => {
    if (autoDone.current) return
    autoDone.current = true
    void start(mode, true)
  })

  useEffect(() => {
    if (!recordAuto) autoDone.current = false
    else if (screenLive) autoStart()
  }, [recordAuto, screenLive])

  useEffect(() => {
    void leftoverRecordings().then((files) => {
      if (files.length === 0) return
      const names = files.map((f) => f.name)
      toast("Found an unfinished recording", {
        id: "record-leftover",
        description: "The page closed while it was recording. It plays up to where it stopped.",
        duration: Infinity,
        action: {
          label: "Download",
          onClick: () => {
            for (const f of files) download(f, f.name)
            setTimeout(() => void discardRecordings(names), 120_000)
          },
        },
        cancel: { label: "Discard", onClick: () => void discardRecordings(names) },
      })
    })
    return () => {
      unmounted.current = true
      active.current?.rec?.stop()
    }
  }, [])

  if (recording) {
    return (
      <RailButton
        text="Stop recording"
        label={`Stop recording (${formatDuration(now - recording.started)})`}
        onClick={() => recording.rec.stop()}
        className="text-red-600 dark:text-red-400"
      >
        <CircleStopIcon className="animate-pulse" />
      </RailButton>
    )
  }

  return (
    <HoverCard openDelay={150} closeDelay={150}>
      <HoverCardTrigger asChild>
        <RailItem
          label={`Record: ${recordModes[mode].label.toLowerCase()}`}
          text="Record"
          disabled={!supported || !screenLive}
          onClick={() => void start(mode, false)}
        >
          {recordModes[mode].icon}
        </RailItem>
      </HoverCardTrigger>
      <HoverCardContent side="left" align="start" className="flex w-72 flex-col gap-0.5 p-1">
        {(Object.entries(recordModes) as [RecordMode, (typeof recordModes)[RecordMode]][]).map(([m, item]) => (
          <Button
            key={m}
            variant="ghost"
            className="h-auto justify-start gap-2 px-2 py-1.5 text-left whitespace-normal"
            disabled={!supported || !screenLive}
            onClick={() => {
              setScreenPrefs({ recordMode: m })
              void start(m, false)
            }}
          >
            {item.icon}
            <span className="flex flex-1 flex-col">
              <span>{item.label}</span>
              <span className="text-muted-foreground text-xs font-normal">
                {!supported
                  ? "Not supported in this browser"
                  : m === "full" && !panelCaptureSupported()
                    ? "Device and app details; this browser can't capture the tool panel"
                    : item.hint}
              </span>
            </span>
            {m === mode && <CheckIcon className="text-muted-foreground" />}
          </Button>
        ))}
        <Separator className="my-1" />
        <Label className="hover:bg-accent flex items-start gap-2 rounded-md px-2 py-1.5 font-normal">
          <Checkbox
            className="mt-0.5"
            checked={recordAuto}
            disabled={!supported}
            onCheckedChange={(v) => setScreenPrefs({ recordAuto: v === true })}
          />
          <span className="flex flex-col">
            <span>Record automatically</span>
            <span className="text-muted-foreground text-xs">
              Starts when the screen connects, saves when you stop it or leave the page
            </span>
          </span>
        </Label>
      </HoverCardContent>
    </HoverCard>
  )
}
