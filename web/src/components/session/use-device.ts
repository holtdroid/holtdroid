import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AndroidKeyCode } from "@yume-chan/scrcpy"
import { useMemo } from "react"
import { toast } from "sonner"
import { agentClient, type DeviceAction, type DeviceSettings, unwrap } from "@/api/client"
import type { LiveScreen } from "@/components/session/live-screen"
import type { ScreenControl } from "@/lib/scrcpy"

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

function deviceKey(provider: string, id: string) {
  return ["device", provider, id]
}

export function useDevice(provider: string, id: string) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  return useQuery({
    queryKey: deviceKey(provider, id),
    queryFn: () => unwrap(client.GET("/v1/device")),
    refetchInterval: 30_000,
  })
}

export function useUpdateDevice(provider: string, id: string) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DeviceSettings) => unwrap(client.PATCH("/v1/device", { body })),
    onSuccess: (state) => qc.setQueryData(deviceKey(provider, id), state),
    onError: (e) => {
      toast.error("Could not change the device", { description: e.message })
      void qc.invalidateQueries({ queryKey: deviceKey(provider, id) })
    },
  })
}

export function useDeviceAction(provider: string, id: string) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (action: DeviceAction) =>
      unwrap(client.POST("/v1/device/actions/{action}", { params: { path: { action } } })),
    onSuccess: (_, action) => {
      if (action === "rotate-left" || action === "rotate-right") {
        void qc.invalidateQueries({ queryKey: deviceKey(provider, id) })
      }
    },
    onError: (e) => toast.error("Device action failed", { description: e.message }),
  })
}

export function useRunDeviceAction(provider: string, id: string, live: LiveScreen) {
  const action = useDeviceAction(provider, id)
  return (a: DeviceAction) => {
    const control = live.connection?.control
    const send = viaScreen[a]
    if (control && send) send(control)
    else action.mutate(a)
  }
}

export function networkKey(provider: string, id: string) {
  return ["network", provider, id]
}

export function useNetwork(provider: string, id: string, enabled = true) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  return useQuery({
    queryKey: networkKey(provider, id),
    queryFn: () => unwrap(client.GET("/v1/network")),
    refetchInterval: 30_000,
    enabled,
  })
}
