import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api, unwrap } from "./client"
import { keys } from "./queries"

const inventoryKey = ["inventory"] as const

export function useInventory(enabled: boolean) {
  return useQuery({
    queryKey: inventoryKey,
    queryFn: () => unwrap(api.GET("/api/v1/admin/inventory")),
    enabled,
    refetchInterval: 10_000,
    retry: false,
  })
}

export type MaintenanceTarget = { provider: string; slot?: string }

export function useSetMaintenance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ provider, slot, enabled, reason }: MaintenanceTarget & { enabled: boolean; reason?: string }) => {
      const body = { enabled, reason: reason || undefined }
      return slot
        ? unwrap(
            api.PUT("/api/v1/admin/providers/{provider}/slots/{slot}/maintenance", {
              params: { path: { provider, slot } },
              body,
            }),
          )
        : unwrap(api.PUT("/api/v1/admin/providers/{provider}/maintenance", { params: { path: { provider } }, body }))
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: inventoryKey })
      void qc.invalidateQueries({ queryKey: keys.providers })
    },
  })
}

const frontendsKey = ["devtools-frontends"] as const

export function useDevToolsFrontends(enabled: boolean) {
  return useQuery({
    queryKey: frontendsKey,
    queryFn: () => unwrap(api.GET("/api/v1/admin/devtools-frontends")),
    enabled,
    refetchInterval: 5_000,
    retry: false,
  })
}

export function useDeleteDevToolsFrontend() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rev: string) =>
      unwrap(api.DELETE("/api/v1/admin/devtools-frontends/{rev}", { params: { path: { rev } } })),
    onSettled: () => void qc.invalidateQueries({ queryKey: frontendsKey }),
  })
}

export function useFetchDevToolsFrontend() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rev: string) =>
      unwrap(api.POST("/api/v1/admin/devtools-frontends/{rev}/fetch", { params: { path: { rev } } })),
    onSettled: () => void qc.invalidateQueries({ queryKey: frontendsKey }),
  })
}
