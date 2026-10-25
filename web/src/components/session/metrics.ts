import { useState, useSyncExternalStore } from "react"
import { type Metrics, sessionBase } from "@/api/client"
import { useEventSource } from "@/hooks/use-event-source"
import { formatBytes } from "@/lib/format"

export const historySize = 30

function useDocumentVisible() {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener("visibilitychange", onChange)
      return () => document.removeEventListener("visibilitychange", onChange)
    },
    () => document.visibilityState === "visible",
  )
}

export function useMetricsHistory(provider: string, id: string, enabled: boolean) {
  const visible = useDocumentVisible()
  const [history, setHistory] = useState<Metrics[]>([])
  useEventSource<{ metrics: Metrics }>(enabled && visible ? `${sessionBase(provider, id)}/v1/metrics` : null, {
    metrics: (m) => setHistory((h) => [...h.slice(1 - historySize), m]),
  })
  return history
}

export function byteRate(bps: number) {
  return `${formatBytes(Math.round(bps))}/s`
}
