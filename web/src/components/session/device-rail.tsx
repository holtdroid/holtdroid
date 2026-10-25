import { CameraIcon, ChevronsLeftIcon, ChevronsRightIcon, VibrateIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { type Location, type SessionView, sessionBase, type Vibration } from "@/api/client"
import type { AdbSession } from "@/components/session/adb-session"
import { DeviceControls } from "@/components/session/device-controls"
import type { LiveScreen } from "@/components/session/live-screen"
import { RecordButton } from "@/components/session/record-button"
import { RailButton, RailSection } from "@/components/session/rail-item"
import { useEventSource } from "@/hooks/use-event-source"
import { useUserActivation } from "@/hooks/use-user-activation"
import { download, stamp } from "@/lib/adb"
import { getScreenPrefs, setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"
import { cn } from "@/lib/utils"
import { buzz } from "@/lib/vibration"

export function DeviceRail({
  provider,
  id,
  session,
  live,
  adb,
  locations,
}: {
  provider: string
  id: string
  session: SessionView
  live: LiveScreen
  adb: AdbSession | null
  locations: Location[]
}) {
  const [shooting, setShooting] = useState(false)
  const { audio, railLabels } = useScreenPrefs()
  const activated = useUserActivation()
  useVibrationAlerts(provider, id, audio && activated)

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
      <RailSection title="Capture" />
      <RailButton label="Screenshot" disabled={shooting} onClick={() => void screenshot()}>
        <CameraIcon />
      </RailButton>
      <RecordButton provider={provider} id={id} session={session} live={live} adb={adb} />
      <RailSection title="Device" />
      <DeviceControls provider={provider} id={id} locations={locations} />
    </div>
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
