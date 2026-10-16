import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo } from "react"
import { toast } from "sonner"
import { agentClient, type DeviceAction, type DeviceSettings, unwrap } from "@/api/client"

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
