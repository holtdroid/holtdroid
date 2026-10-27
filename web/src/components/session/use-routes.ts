import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { agentClient, api, type Connection, type IPInfo, sessionBase, unwrap } from "@/api/client"
import { useEventSource } from "@/hooks/use-event-source"

const maxConnections = 3000

export function useConnectionsState(provider: string, id: string) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  return useQuery({
    queryKey: ["connections", provider, id],
    queryFn: () => unwrap(client.GET("/v1/connections")),
    staleTime: Infinity,
  })
}

/** The device's connections, the latest line of each; the agent resends what it keeps on every reconnect. */
export function useConnectionsLog(provider: string, id: string, enabled: boolean) {
  const [conns, setConns] = useState<Map<string, Connection>>(() => new Map())
  useEventSource<{ connection: Connection }>(enabled ? `${sessionBase(provider, id)}/v1/connections/events` : null, {
    connection: (c) =>
      setConns((prev) => {
        const next = new Map(prev)
        next.delete(c.id)
        next.set(c.id, c)
        if (next.size > maxConnections) {
          const oldest = [...next.values()].find((x) => x.end)
          if (oldest) next.delete(oldest.id)
        }
        return next
      }),
  })
  return useMemo(() => [...conns.values()], [conns])
}

type Looked = { info: IPInfo; database?: string }

type Batch = { scope: string; waiters: Map<string, ((l: Looked) => void)[]>; timer: ReturnType<typeof setTimeout> }

const batches = new Map<string, Batch>()

async function flush(b: Batch) {
  batches.delete(b.scope)
  const addresses = [...b.waiters.keys()]
  const body = { addresses }
  let list: { database?: string; addresses: IPInfo[] | null } = { addresses: [] }
  try {
    list = b.scope
      ? await unwrap(api.POST("/api/v1/shared/{token}/ip-info", { params: { path: { token: b.scope } }, body }))
      : await unwrap(api.POST("/api/v1/ip-info", { body }))
  } catch {
    list = { addresses: [] }
  }
  const byAddress = new Map((list.addresses ?? []).map((i) => [i.address, i]))
  for (const [a, waiters] of b.waiters) {
    const info = byAddress.get(a) ?? { address: a }
    for (const w of waiters) w({ info, database: list.database })
  }
}

function lookup(scope: string, address: string) {
  return new Promise<Looked>((resolve) => {
    let b = batches.get(scope)
    if (!b) {
      const created: Batch = { scope, waiters: new Map(), timer: setTimeout(() => void flush(created), 50) }
      batches.set(scope, created)
      b = created
    }
    b.waiters.set(address, [...(b.waiters.get(address) ?? []), resolve])
    if (b.waiters.size >= 1000) {
      clearTimeout(b.timer)
      void flush(b)
    }
  })
}

export type Geo = { info: Map<string, IPInfo>; database?: string }

/** Where addresses are, looked up in batches and kept for the page's life; share is a recording's share token. */
export function useIPInfo(addresses: string[], share?: string): Geo {
  const scope = share ?? ""
  return useQueries({
    queries: addresses.map((a) => ({
      queryKey: ["ip-info", scope, a],
      queryFn: () => lookup(scope, a),
      staleTime: Infinity,
      gcTime: Infinity,
    })),
    combine: (results) => {
      const info = new Map<string, IPInfo>()
      let database: string | undefined
      for (const r of results) {
        if (!r.data) continue
        info.set(r.data.info.address, r.data.info)
        database ??= r.data.database
      }
      return { info, database }
    },
  })
}
