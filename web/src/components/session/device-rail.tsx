import {
  BellIcon,
  CameraIcon,
  ChevronLeftIcon,
  CircleIcon,
  LockIcon,
  LockOpenIcon,
  RotateCcwSquareIcon,
  RotateCwSquareIcon,
  SquareIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"
import { type DeviceAction, sessionBase } from "@/api/client"
import { DeviceSettingsSheet } from "@/components/session/device-settings"
import { useDeviceAction } from "@/components/session/use-device"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

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
  ],
]

export function DeviceRail({ provider, id, name }: { provider: string; id: string; name: string }) {
  const action = useDeviceAction(provider, id)
  const [shooting, setShooting] = useState(false)

  const screenshot = async () => {
    setShooting(true)
    try {
      const resp = await fetch(`${sessionBase(provider, id)}/v1/device/screenshot`)
      if (!resp.ok) throw new Error(resp.statusText || `HTTP ${resp.status}`)
      const url = URL.createObjectURL(await resp.blob())
      const a = document.createElement("a")
      a.href = url
      a.download = `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`
      a.click()
      URL.revokeObjectURL(url)
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
            <RailButton key={b.action} label={b.label} onClick={() => action.mutate(b.action)}>
              {b.icon}
            </RailButton>
          ))}
        </div>
      ))}
      <Separator className="my-1 w-6!" />
      <RailButton label="Screenshot" disabled={shooting} onClick={() => void screenshot()}>
        <CameraIcon />
      </RailButton>
      <DeviceSettingsSheet provider={provider} id={id} />
    </div>
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
