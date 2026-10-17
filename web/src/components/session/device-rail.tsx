import { useQuery } from "@tanstack/react-query"
import { AndroidKeyCode } from "@yume-chan/scrcpy"
import {
  BellIcon,
  CameraIcon,
  ChevronLeftIcon,
  CircleIcon,
  CircleStopIcon,
  HeadphoneOffIcon,
  HeadphonesIcon,
  LockIcon,
  LockOpenIcon,
  RotateCcwSquareIcon,
  RotateCwSquareIcon,
  SquareIcon,
  ToggleRightIcon,
  Volume1Icon,
  Volume2Icon,
  VideoIcon,
  VolumeXIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { type DeviceAction, sessionBase } from "@/api/client"
import { DeviceSettingsSheet } from "@/components/session/device-settings"
import { displayURL, type LiveScreen, useScreenLive } from "@/components/session/live-screen"
import { ScreenSettings } from "@/components/session/screen-settings"
import { useDeviceAction } from "@/components/session/use-device"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useNow } from "@/hooks/use-now"
import { download, stamp } from "@/lib/adb"
import { type AudioConnection, audioSupported, openAudio } from "@/lib/audio"
import { formatDuration } from "@/lib/format"
import { type Recording, recordingSupported, startRecording } from "@/lib/recorder"
import type { ScreenControl } from "@/lib/scrcpy"

const groups: { action: DeviceAction; label: string; icon: ReactNode }[][] = [
  [
    { action: "lock", label: "Lock screen", icon: <LockIcon /> },
    { action: "unlock", label: "Wake and unlock", icon: <LockOpenIcon /> },
  ],
  [
    { action: "volume-up", label: "Volume up", icon: <Volume2Icon /> },
    { action: "volume-down", label: "Volume down", icon: <Volume1Icon /> },
    { action: "mute", label: "Mute", icon: <VolumeXIcon /> },
  ],
  [
    { action: "rotate-left", label: "Rotate left", icon: <RotateCcwSquareIcon /> },
    { action: "rotate-right", label: "Rotate right", icon: <RotateCwSquareIcon /> },
  ],
  [
    { action: "back", label: "Back", icon: <ChevronLeftIcon /> },
    { action: "home", label: "Home", icon: <CircleIcon /> },
    { action: "recents", label: "Recent apps", icon: <SquareIcon /> },
    { action: "notifications", label: "Notifications", icon: <BellIcon /> },
    { action: "quick-settings", label: "Quick settings", icon: <ToggleRightIcon /> },
  ],
]

const viaScreen: Partial<Record<DeviceAction, (c: ScreenControl) => void>> = {
  "volume-up": (c) => c.press(AndroidKeyCode.VolumeUp),
  "volume-down": (c) => c.press(AndroidKeyCode.VolumeDown),
  mute: (c) => c.press(AndroidKeyCode.VolumeMute),
  back: (c) => c.press(AndroidKeyCode.AndroidBack),
  home: (c) => c.press(AndroidKeyCode.AndroidHome),
  recents: (c) => c.press(AndroidKeyCode.AndroidAppSwitch),
  notifications: (c) => c.notifications(),
  "quick-settings": (c) => c.quickSettings(),
}

export function DeviceRail({
  provider,
  id,
  name,
  live,
}: {
  provider: string
  id: string
  name: string
  live: LiveScreen
}) {
  const action = useDeviceAction(provider, id)
  const [shooting, setShooting] = useState(false)

  const run = (a: DeviceAction) => {
    const control = live.connection?.control
    const send = viaScreen[a]
    if (control && send) send(control)
    else action.mutate(a)
  }

  const screenshot = async () => {
    setShooting(true)
    try {
      let blob = await live.connection?.snapshot()
      if (!blob) {
        const resp = await fetch(`${sessionBase(provider, id)}/v1/device/screenshot`)
        if (!resp.ok) throw new Error(resp.statusText || `HTTP ${resp.status}`)
        blob = await resp.blob()
      }
      download(blob, `${name}-${stamp()}.png`)
    } catch (e) {
      toast.error("Could not take a screenshot", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setShooting(false)
    }
  }

  return (
    <div className="bg-background flex flex-col items-center gap-1 overflow-y-auto border-l p-1">
      {groups.map((group, i) => (
        <div key={group.map((b) => b.action).join()} className="contents">
          {i > 0 && <Separator className="my-1 w-6!" />}
          {group.map((b) => (
            <RailButton key={b.action} label={b.label} onClick={() => run(b.action)}>
              {b.icon}
            </RailButton>
          ))}
        </div>
      ))}
      <Separator className="my-1 w-6!" />
      <RailButton label="Screenshot" disabled={shooting} onClick={() => void screenshot()}>
        <CameraIcon />
      </RailButton>
      <RecordButton name={name} live={live} />
      <AudioButton provider={provider} id={id} />
      <ScreenSettings live={live} />
      <DeviceSettingsSheet provider={provider} id={id} />
    </div>
  )
}

function RecordButton({ name, live }: { name: string; live: LiveScreen }) {
  const screenLive = useScreenLive(live)
  const [recording, setRecording] = useState<{ rec: Recording; started: number } | null>(null)
  const now = useNow()

  const toggle = async () => {
    if (recording) {
      setRecording(null)
      download(await recording.rec.stop(), `${name}-${stamp()}.${recording.rec.extension}`)
      return
    }
    const canvas = live.connection?.canvas
    if (!canvas) return
    try {
      setRecording({ rec: startRecording(canvas), started: Date.now() })
    } catch (e) {
      toast.error("Could not record the screen", { description: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <RailButton
      label={
        !recordingSupported()
          ? "This browser can't record the screen"
          : recording
            ? `Stop recording (${formatDuration(now - recording.started)})`
            : "Record the screen"
      }
      disabled={!recordingSupported() || (!recording && !screenLive)}
      onClick={() => void toggle()}
      className={recording ? "text-red-600 dark:text-red-400" : undefined}
    >
      {recording ? <CircleStopIcon className="animate-pulse" /> : <VideoIcon />}
    </RailButton>
  )
}

function AudioButton({ provider, id }: { provider: string; id: string }) {
  const [state, setState] = useState<"off" | "starting" | "on">("off")
  const conn = useRef<AudioConnection | null>(null)
  const supported = useQuery({ queryKey: ["audio-supported"], queryFn: audioSupported, staleTime: Infinity }).data

  useEffect(() => () => conn.current?.close(), [])

  const toggle = async () => {
    if (conn.current) {
      conn.current.close()
      return
    }
    setState("starting")
    try {
      const c = await openAudio(displayURL(provider, id, "audio"))
      conn.current = c
      setState("on")
      await c.done
    } catch (e) {
      toast.error("Could not play the device audio", { description: e instanceof Error ? e.message : String(e) })
    }
    conn.current = null
    setState("off")
  }

  return (
    <RailButton
      label={
        supported === false
          ? "This browser can't play the device audio"
          : state === "on"
            ? "Stop device audio"
            : "Play device audio"
      }
      disabled={state === "starting" || supported !== true}
      onClick={() => void toggle()}
    >
      {state === "on" ? <HeadphonesIcon /> : <HeadphoneOffIcon />}
    </RailButton>
  )
}

function RailButton({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & React.ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  )
}
