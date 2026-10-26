import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  agentClient,
  api,
  type DNSEvent,
  type DNSPreset,
  type DNSQuery,
  type DNSSettings,
  type DNSState,
  sessionBase,
  unwrap,
} from "@/api/client"
import { useEventSource } from "@/hooks/use-event-source"

const maxQueries = 2000

export function dnsKey(provider: string, id: string) {
  return ["dns", provider, id]
}

const presetsKey = ["dns-presets"]

export function useDNS(provider: string, id: string, enabled = true) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  return useQuery({
    queryKey: dnsKey(provider, id),
    queryFn: () => unwrap(client.GET("/v1/dns")),
    staleTime: Infinity,
    enabled,
  })
}

export function useSetDNS(provider: string, id: string) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DNSSettings) => unwrap(client.PUT("/v1/dns", { body })),
    onSuccess: (state) => qc.setQueryData(dnsKey(provider, id), state),
    onError: (e) => toast.error("Could not change the DNS rewrites", { description: e.message }),
  })
}

export function useFlushDNS(provider: string, id: string) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  return useMutation({
    mutationFn: () => unwrap(client.POST("/v1/dns/flush")),
    onSuccess: () =>
      toast.success("DNS cache cleared", {
        description: "Apps' own caches stay: a WebView keeps names for up to a minute.",
      }),
    onError: (e) => toast.error("Could not clear the DNS cache", { description: e.message }),
  })
}

/** The live DNS log; the agent resends what it keeps on every reconnect. */
export function useDNSLog(provider: string, id: string, paused: boolean) {
  const [queries, setQueries] = useState<DNSQuery[]>([])
  const seen = useRef(new Set<string>())
  const qc = useQueryClient()
  useEventSource<{ dns: DNSEvent }>(paused ? null : `${sessionBase(provider, id)}/v1/dns/events`, {
    dns: (e) => {
      if (e.settings) {
        const settings = e.settings
        qc.setQueryData<DNSState>(dnsKey(provider, id), (s) => ({ available: true, ...s, settings }))
      }
      const q = e.query
      if (!q) return
      const key = `${q.id}@${q.at}`
      if (seen.current.has(key)) return
      seen.current.add(key)
      setQueries((prev) => [...prev.slice(-(maxQueries - 1)), q])
    },
  })
  return { queries, clear: () => setQueries([]) }
}

export function useDNSPresets() {
  return useQuery({
    queryKey: presetsKey,
    queryFn: () => unwrap(api.GET("/api/v1/dns-presets")),
    staleTime: 30_000,
  })
}

export function useSaveDNSPreset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name, settings }: { id?: string; name: string; settings: DNSSettings }) =>
      id
        ? unwrap(api.PUT("/api/v1/dns-presets/{id}", { params: { path: { id } }, body: { name, settings } }))
        : unwrap(api.POST("/api/v1/dns-presets", { body: { name, settings } })),
    onSuccess: (p: DNSPreset) => {
      void qc.invalidateQueries({ queryKey: presetsKey })
      toast.success(`Saved “${p.name}”`)
    },
    onError: (e) => toast.error("Could not save the set", { description: e.message }),
  })
}

export function useDeleteDNSPreset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE("/api/v1/dns-presets/{id}", { params: { path: { id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: presetsKey }),
    onError: (e) => toast.error("Could not delete the set", { description: e.message }),
  })
}
