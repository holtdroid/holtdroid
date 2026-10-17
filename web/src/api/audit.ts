import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { api, unwrap } from "./client"
import type { components } from "./schema"

export type AuditEvent = components["schemas"]["AuditEvent"]
export type AuditInfo = components["schemas"]["AuditInfo"]
export type AuditResult = AuditEvent["result"]

export const auditRanges = {
  "1h": { label: "Last hour", ms: 3_600_000 },
  "24h": { label: "Last 24 hours", ms: 86_400_000 },
  "7d": { label: "Last 7 days", ms: 7 * 86_400_000 },
  "30d": { label: "Last 30 days", ms: 30 * 86_400_000 },
} as const

export type AuditRange = keyof typeof auditRanges

export type AuditFilter = {
  action?: string
  result?: AuditResult
  actor?: string
  service?: string
  session?: string
  q?: string
  range?: AuditRange
}

function auditQuery(f: AuditFilter) {
  return {
    action: f.action ? [f.action] : undefined,
    result: f.result ? [f.result] : undefined,
    service: f.service ? [f.service] : undefined,
    actor: f.actor || undefined,
    session: f.session || undefined,
    q: f.q || undefined,
    since: f.range ? new Date(Date.now() - auditRanges[f.range].ms).toISOString() : undefined,
  }
}

export function auditExportURL(f: AuditFilter) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(auditQuery(f))) {
    if (value !== undefined) params.set(key, Array.isArray(value) ? value.join(",") : value)
  }
  const query = params.toString()
  return `/api/v1/admin/audit/export${query ? `?${query}` : ""}`
}

export function useAuditInfo(enabled: boolean) {
  return useQuery({
    queryKey: ["audit", "info"],
    queryFn: () => unwrap(api.GET("/api/v1/admin/audit")),
    enabled,
    refetchInterval: 30_000,
    retry: false,
  })
}

export function useAuditEvents(filter: AuditFilter, { enabled, live }: { enabled: boolean; live: boolean }) {
  return useInfiniteQuery({
    queryKey: ["audit", "events", filter],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/admin/audit/events", {
          params: { query: { ...auditQuery(filter), before: pageParam || undefined, limit: 100 } },
          querySerializer: { array: { style: "form", explode: false } },
        }),
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next,
    enabled,
    refetchInterval: live ? 5_000 : false,
    placeholderData: keepPreviousData,
    retry: false,
  })
}
