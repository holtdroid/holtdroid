import { VibrateIcon } from "lucide-react"
import { toast } from "sonner"
import { sessionBase, type Vibration } from "@/api/client"
import { useEventSource } from "@/hooks/use-event-source"
import { useUserActivation } from "@/hooks/use-user-activation"
import { getScreenPrefs, setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"
import { buzz } from "@/lib/vibration"

export function useVibrationAlerts(provider: string, id: string) {
  const { audio } = useScreenPrefs()
  const activated = useUserActivation()
  const audible = audio && activated
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
