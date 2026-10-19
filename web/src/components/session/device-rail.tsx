import { useQuery } from "@tanstack/react-query"
import { AndroidKeyCode } from "@yume-chan/scrcpy"
import {
  BellIcon,
  CameraIcon,
  ChevronLeftIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  CircleIcon,
  HeadphoneOffIcon,
  HeadphonesIcon,
  LockIcon,
  LockOpenIcon,
  PowerIcon,
  RotateCcwSquareIcon,
  RotateCwSquareIcon,
  SquareIcon,
  ToggleRightIcon,
  Volume1Icon,
  Volume2Icon,
  VibrateIcon,
  VolumeXIcon,
  CheckIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { toast } from "sonner"
import { type DeviceAction, type Location, type SessionView, sessionBase, type Vibration } from "@/api/client"
import type { AdbSession } from "@/components/session/adb-session"
import { ClipboardButton } from "@/components/session/clipboard-button"
import { DeviceControls } from "@/components/session/device-controls"
import { displayURL, type LiveScreen, useScreenLive } from "@/components/session/live-screen"
import { RecordButton } from "@/components/session/record-button"
import { ScreenSettings } from "@/components/session/screen-settings"
import { useDeviceAction } from "@/components/session/use-device"
import { Button } from "@/components/ui/button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { RailButton, RailItem, RailSection } from "@/components/session/rail-item"
import { useEventSource } from "@/hooks/use-event-source"
import { useUserActivation } from "@/hooks/use-user-activation"
import { download, stamp } from "@/lib/adb"
import { type AudioConnection, AudioUnavailableError, audioSupported, openAudio } from "@/lib/audio"
import type { ScreenControl } from "@/lib/scrcpy"
import { getScreenPrefs, type LockMode, setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"
import { cn } from "@/lib/utils"
import { buzz } from "@/lib/vibration"

const groups: { title: string; buttons: { action: DeviceAction; label: string; icon: ReactNode }[] }[] = [
  { title: "Screen", buttons: [{ action: "unlock", label: "Wake and unlock", icon: <LockOpenIcon /> }] },
  {
    title: "Volume",
    buttons: [
      { action: "volume-up", label: "Volume up", icon: <Volume2Icon /> },
      { action: "volume-down", label: "Volume down", icon: <Volume1Icon /> },
      { action: "mute", label: "Mute", icon: <VolumeXIcon /> },
    ],
  },
  {
    title: "Rotation",
    buttons: [
      { action: "rotate-left", label: "Rotate left", icon: <RotateCcwSquareIcon /> },
      { action: "rotate-right", label: "Rotate right", icon: <RotateCwSquareIcon /> },
    ],
  },
  {
    title: "Navigation",
    buttons: [
      { action: "back", label: "Back", icon: <ChevronLeftIcon /> },
      { action: "home", label: "Home", icon: <CircleIcon /> },
      { action: "recents", label: "Recent apps", icon: <SquareIcon /> },
      { action: "notifications", label: "Notifications", icon: <BellIcon /> },
      { action: "quick-settings", label: "Quick settings", icon: <ToggleRightIcon /> },
    ],
  },
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
  session,
  live,
  adb,
  clipboard,
  locations,
}: {
  provider: string
  id: string
  session: SessionView
  live: LiveScreen
  adb: AdbSession | null
  clipboard: boolean
  locations: Location[]
}) {
  const action = useDeviceAction(provider, id)
  const [shooting, setShooting] = useState(false)
  const { audio, railLabels } = useScreenPrefs()
  const activated = useUserActivation()
  useVibrationAlerts(provider, id, audio && activated)

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
      download(blob, `${session.package}-${stamp()}.png`)
    } catch (e) {
      toast.error("Could not take a screenshot", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setShooting(false)
    }
  }

  return (
    <div
      className={cn(
        "bg-background flex shrink-0 flex-col gap-1 overflow-y-auto border-l p-1",
        railLabels ? "w-48 items-stretch" : "items-center",
      )}
    >
      <RailButton
        label={railLabels ? "Icons only" : "Show labels"}
        className="text-muted-foreground"
        onClick={() => setScreenPrefs({ railLabels: !railLabels })}
      >
        {railLabels ? <ChevronsRightIcon /> : <ChevronsLeftIcon />}
      </RailButton>
      {groups.map((group, i) => (
        <div key={group.title} className="contents">
          <RailSection title={group.title} />
          {i === 0 && <LockButton run={run} />}
          {group.buttons.map((b) => (
            <RailButton key={b.action} label={b.label} onClick={() => run(b.action)}>
              {b.icon}
            </RailButton>
          ))}
        </div>
      ))}
      <RailSection title="Capture" />
      <RailButton label="Screenshot" disabled={shooting} onClick={() => void screenshot()}>
        <CameraIcon />
      </RailButton>
      <RecordButton provider={provider} id={id} session={session} live={live} adb={adb} />
      <RailSection title="Stream" separator={false} />
      <AudioButton provider={provider} id={id} live={live} />
      {clipboard && <ClipboardButton provider={provider} id={id} />}
      <ScreenSettings live={live} />
      <RailSection title="Device" />
      <DeviceControls provider={provider} id={id} locations={locations} />
    </div>
  )
}

const lockModes: Record<LockMode, { label: string; hint: string; icon: ReactNode }> = {
  lock: { label: "Lock screen", hint: "Show the lock screen", icon: <LockIcon /> },
  "screen-off": { label: "Turn screen off", hint: "Press the power button", icon: <PowerIcon /> },
}

function LockButton({ run }: { run: (a: DeviceAction) => void }) {
  const { lockMode } = useScreenPrefs()
  const current = lockModes[lockMode] ?? lockModes.lock
  return (
    <HoverCard openDelay={150} closeDelay={150}>
      <HoverCardTrigger asChild>
        <RailItem label={current.label} onClick={() => run(lockModes[lockMode] ? lockMode : "lock")}>
          {current.icon}
        </RailItem>
      </HoverCardTrigger>
      <HoverCardContent side="left" align="start" className="flex w-56 flex-col gap-0.5 p-1">
        {(Object.entries(lockModes) as [LockMode, (typeof lockModes)[LockMode]][]).map(([mode, m]) => (
          <Button
            key={mode}
            variant="ghost"
            className="h-auto justify-start gap-2 px-2 py-1.5 text-left"
            onClick={() => {
              setScreenPrefs({ lockMode: mode })
              run(mode)
            }}
          >
            {m.icon}
            <span className="flex flex-1 flex-col">
              <span>{m.label}</span>
              <span className="text-muted-foreground text-xs font-normal">{m.hint}</span>
            </span>
            {mode === lockMode && <CheckIcon className="text-muted-foreground" />}
          </Button>
        ))}
      </HoverCardContent>
    </HoverCard>
  )
}

function AudioButton({ provider, id, live }: { provider: string; id: string; live: LiveScreen }) {
  const { audio: wanted } = useScreenPrefs()
  const screenLive = useScreenLive(live)
  const activated = useUserActivation()
  const supported = useQuery({ queryKey: ["audio-supported"], queryFn: audioSupported, staleTime: Infinity }).data
  const [connected, setConnected] = useState(false)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const active = wanted && supported === true && screenLive && activated && unavailable === null

  useEffect(() => {
    if (!active) return undefined
    let stopped = false
    let conn: AudioConnection | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    const connect = async () => {
      try {
        conn = await openAudio(displayURL(provider, id, "audio"))
        if (stopped) return
        setConnected(true)
        setLastError(null)
        await conn.done
      } catch (e) {
        if (e instanceof AudioUnavailableError) {
          setUnavailable(e.message)
          return
        }
        setLastError(e instanceof Error ? e.message : String(e))
      } finally {
        conn?.close()
        conn = null
        setConnected(false)
      }
      if (!stopped) retry = setTimeout(() => void connect(), 3000)
    }
    void connect()
    return () => {
      stopped = true
      clearTimeout(retry)
      conn?.close()
    }
  }, [active, provider, id])

  const toggle = () => {
    if (unavailable !== null) {
      setUnavailable(null)
      setScreenPrefs({ audio: true })
      return
    }
    setScreenPrefs({ audio: !wanted })
  }

  const label =
    supported === false
      ? "This browser can't play the device audio"
      : unavailable !== null
        ? `${unavailable}. Click to try again`
        : !wanted
          ? "Play device audio"
          : connected
            ? "Stop device audio"
            : !activated
              ? "Device audio starts after your first click on the page"
              : !screenLive
                ? "Device audio starts with the screen"
                : lastError
                  ? `Reconnecting device audio: ${lastError}`
                  : "Connecting device audio…"

  return (
    <RailButton label={label} text="Device audio" disabled={supported !== true} onClick={toggle}>
      {wanted && unavailable === null ? (
        <HeadphonesIcon className={connected ? undefined : "animate-pulse opacity-60"} />
      ) : (
        <HeadphoneOffIcon />
      )}
    </RailButton>
  )
}

function useVibrationAlerts(provider: string, id: string, audible: boolean) {
  useEventSource<{ vibration: Vibration }>(`${sessionBase(provider, id)}/v1/vibrations`, {
    vibration: (v) => {
      if (audible && getScreenPrefs().vibrationSound) buzz(v.durationMs)
      showVibration(v, audible)
    },
  })
}

function showVibration(v: Vibration, audible: boolean) {
  const muted = !getScreenPrefs().vibrationSound
  toast("Device is vibrating", {
    id: "vibration",
    icon: <VibrateIcon className="size-4" />,
    description: [v.package, v.usage.toLowerCase().replaceAll("_", " "), v.durationMs > 0 && `${v.durationMs} ms`]
      .filter(Boolean)
      .join(" · "),
    action: audible
      ? {
          label: muted ? "Unmute" : "Mute",
          onClick: (e) => {
            e.preventDefault()
            setScreenPrefs({ vibrationSound: muted })
            showVibration(v, audible)
          },
        }
      : undefined,
  })
}
