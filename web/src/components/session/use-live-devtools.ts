import { useQueries } from "@tanstack/react-query"
import { useMemo, useRef, useState } from "react"
import { agentClient, type DevToolsEntry, sessionBase } from "@/api/client"
import { useEventSource } from "@/hooks/use-event-source"
import type { ImageRequest, ImageShot } from "@/lib/recording/images"

const maxRequests = 5000
const maxShots = 3000

export type LiveDevTools = { requests: ImageRequest[]; shots: ImageShot[]; kinds: Map<string, string> }

const empty: LiveDevTools = { requests: [], shots: [], kinds: new Map() }

/**
 * The WebViews' finished requests, image lines and targets from the live
 * stream, on the device clock, batched a few times a second.
 */
export function useLiveDevTools(provider: string, id: string, paused: boolean) {
  const [state, setState] = useState<LiveDevTools>(empty)
  const pending = useRef<DevToolsEntry[]>([])
  const timer = useRef<number | undefined>(undefined)
  const lastSeq = useRef(0)

  const flush = () => {
    timer.current = undefined
    const lines = pending.current
    pending.current = []
    setState((prev) => {
      const requests = new Map(prev.requests.map((r) => [r.key, r]))
      const shots = [...prev.shots]
      const kinds = new Map(prev.kinds)
      for (const e of lines) {
        const target = e.target ?? ""
        const at = e.wall ?? Date.now()
        if (e.request) {
          const key = `${target}/${e.request.id}`
          requests.delete(key)
          requests.set(key, { ...e.request, key, target, at })
        } else if (e.images) shots.push({ ...e.images, target, at })
        else if (e.page?.type) kinds.set(target, e.page.type)
      }
      return {
        requests: [...requests.values()].slice(-maxRequests),
        shots: shots.slice(-maxShots),
        kinds,
      }
    })
  }

  useEventSource<{ line: DevToolsEntry }>(paused ? null : `${sessionBase(provider, id)}/v1/devtools/live`, {
    line: (e) => {
      if (e.seq) {
        if (e.seq <= lastSeq.current) return
        lastSeq.current = e.seq
      }
      if (!e.request && !e.images && !e.page) return
      pending.current.push(e)
      timer.current ??= window.setTimeout(flush, 300)
    },
  })

  return { ...state, clear: () => setState(empty) }
}

/**
 * The bodies of some live requests, asked from the agent while the WebView
 * keeps them, merged into the requests; a body is asked for once.
 */
export function useLiveBodies(
  provider: string,
  id: string,
  requests: ImageRequest[],
  wanted: (r: ImageRequest) => boolean,
  limit: number,
) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  const asked = requests.filter(wanted).slice(-limit)
  const bodies = useQueries({
    queries: asked.map((r) => ({
      queryKey: ["devtools-body", provider, id, r.key],
      queryFn: async () => {
        const { data } = await client.GET("/v1/devtools/body", {
          params: { query: { target: r.target, request: r.id } },
        })
        return { key: r.key, body: data ?? null }
      },
      staleTime: Infinity,
      gcTime: 30 * 60_000,
      retry: false,
    })),
    combine: (results) => {
      const out = new Map<string, NonNullable<(typeof results)[number]["data"]>["body"]>()
      for (const r of results) if (r.data?.body) out.set(r.data.key, r.data.body)
      return out
    },
  })
  const loaded = bodies.size
  return useMemo(
    () =>
      requests.map((r) => {
        const b = bodies.get(r.key)
        return b ? { ...r, body: b.body, bodyBase64: b.base64, bodyTruncated: b.truncated } : r
      }),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [requests, loaded],
  )
}
