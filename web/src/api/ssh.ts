import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ComputerList } from "./client"
import { api, unwrap } from "./client"

const sshKeys = {
  info: ["ssh"] as const,
  tunnels: ["ssh", "tunnels"] as const,
  computers: ["ssh", "computers"] as const,
}

export function useSSHInfo() {
  return useQuery({
    queryKey: sshKeys.info,
    queryFn: () => unwrap(api.GET("/api/v1/ssh")),
    staleTime: Infinity,
  })
}

export function useSSHTunnels() {
  const info = useSSHInfo()
  return useQuery({
    queryKey: sshKeys.tunnels,
    queryFn: () => unwrap(api.GET("/api/v1/ssh/tunnels")),
    enabled: !!info.data?.enabled,
    refetchInterval: 5000,
  })
}

export function useComputers() {
  const info = useSSHInfo()
  return useQuery({
    queryKey: sshKeys.computers,
    queryFn: () => unwrap(api.GET("/api/v1/ssh/computers")),
    enabled: !!info.data?.enabled,
    refetchInterval: 3000,
  })
}

export function useConnectCode() {
  return useMutation({ mutationFn: () => unwrap(api.POST("/api/v1/connect/codes")) })
}

export function connectCommand(code: string) {
  return `curl -fsSL ${window.location.origin}/tunnel.sh | sh -s -- ${code}`
}

export function useSetPublished() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ports }: { id: string; ports: number[] }) =>
      unwrap(api.PUT("/api/v1/ssh/computers/{id}/published", { params: { path: { id } }, body: { ports } })),
    onMutate: async ({ id, ports }) => {
      await qc.cancelQueries({ queryKey: sshKeys.computers })
      const previous = qc.getQueryData<ComputerList>(sshKeys.computers)
      qc.setQueryData<ComputerList>(
        sshKeys.computers,
        (list) => list && { computers: list.computers.map((c) => (c.id === id ? { ...c, published: ports } : c)) },
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => qc.setQueryData(sshKeys.computers, ctx?.previous),
    onSettled: () => void qc.invalidateQueries({ queryKey: sshKeys.computers }),
  })
}
