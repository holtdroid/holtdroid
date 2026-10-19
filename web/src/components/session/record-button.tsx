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
import { PhoneScene, type RecordInfo, type Scene, TabScene } from "@/lib/composer"
import { formatDuration } from "@/lib/format"
import {
  captureTab,
  discardRecordings,
  leftoverRecordings,
  type RecordMode,
  type Recording,
  recordingSupported,
  startRecording,
  tabCaptureSupported,
} from "@/lib/recorder"
import { setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"

const recordModes: Record<RecordMode, { label: string; hint: string; icon: ReactNode }> = {
  screen: { label: "Device screen", hint: "The screen in a phone frame after a short intro", icon: <VideoIcon /> },
  tab: {
    label: "Whole tab",
    hint: "This tab under a strip with the app and device details",
    icon: <AppWindowIcon />,
  },
}

const idle: AdbStatus = { state: "idle" }
const noSubscribe = () => () => undefined

async function waitFor(check: () => boolean, ms: number) {
  for (let i = 0; i < ms / 100 && !check(); i++) await new Promise((r) => setTimeout(r, 100))
}

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
}: {
  provider: string
  id: string
  session: SessionView
  live: LiveScreen
  adb: AdbSession | null
}) {
  const screenLive = useScreenLive(live)
  const { recordMode, recordAuto } = useScreenPrefs()
  const mode = recordModes[recordMode] ? recordMode : "screen"
  const [recording, setRecording] = useState<Recording | null>(null)
  const now = useNow()
  const info = useRecordInfo(provider, id, session, adb)
  const latest = useRef(info)
  const active = useRef<{ rec: Recording | null } | null>(null)
  const autoDone = useRef(false)
  const unmounted = useRef(false)
  const supported = recordingSupported()

  useEffect(() => {
    latest.current = info
  })

  const offerTab = () => {
    toast("Record this tab?", {
      id: "record-tab",
      description: "The browser asks before it shares a tab, so recording starts after a click.",
      duration: Infinity,
      action: { label: "Record", onClick: () => void start("tab", false) },
    })
  }

  const scene = async (m: RecordMode): Promise<{ scene: Scene; tab?: MediaStream } | null> => {
    if (m === "screen") {
      const screen = () => {
        const c = live.connection
        return c && c.stats().frames > 0 ? c.canvas : null
      }
      await waitFor(() => screen() !== null, 5000)
      return { scene: new PhoneScene(screen, () => latest.current) }
    }
    try {
      const tab = await captureTab()
      return { scene: new TabScene(tab, () => latest.current), tab }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "NotAllowedError")) {
        toast.error("Could not capture this tab", { description: errorText(e) })
      }
      return null
    }
  }

  const start = async (m: RecordMode, auto: boolean) => {
    if (active.current || !supported) return
    if (m === "tab" && auto) {
      offerTab()
      return
    }
    toast.dismiss("record-tab")
    active.current = { rec: null }
    const made = await scene(m)
    if (!made) {
      active.current = null
      return
    }
    try {
      made.scene.start()
      const name = `${session.package}-${stamp()}`
      const rec = await startRecording(made.scene.canvas, name, made.tab?.getAudioTracks()[0])
      active.current = { rec }
      if (unmounted.current) rec.stop()
      made.tab?.getVideoTracks()[0]?.addEventListener("ended", () => rec.stop(), { once: true })
      setRecording(rec)
      download(await rec.done, `${name}.${rec.extension}`)
    } catch (e) {
      toast.error("Recording failed", { description: errorText(e) })
    } finally {
      made.scene.stop()
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
        onClick={() => recording.stop()}
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
            disabled={!supported || !screenLive || (m === "tab" && !tabCaptureSupported())}
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
                  : m === "tab" && !tabCaptureSupported()
                    ? "This browser can't capture a tab"
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
