import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { api, unwrap } from "./client"

export const usageRanges = {
  "7d": { label: "7 days", days: 7 },
  "30d": { label: "30 days", days: 30 },
  "90d": { label: "90 days", days: 90 },
  "365d": { label: "Year", days: 365 },
} as const

export type UsageRange = keyof typeof usageRanges

export function rangeStart(range: UsageRange, now = Date.now()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - usageRanges[range].days + 1)
  return d.getTime()
}

export function useSessionStats(range: UsageRange, enabled: boolean) {
  return useQuery({
    queryKey: ["stats", "sessions", range],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/admin/stats/sessions", {
          params: { query: { since: new Date(rangeStart(range)).toISOString() } },
        }),
      ),
    enabled,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  })
}
