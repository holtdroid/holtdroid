import { useContext, useMemo } from "react"
import type { Connection, DNSEvent, DNSQuery, Network } from "@/api/client"
import { ClocksContext } from "@/components/recording/json-view"
import { RoutesTable } from "@/components/session/routes-table"
import { useIPInfo } from "@/components/session/use-routes"
import type { DevToolsLog } from "@/lib/recording/devtools"
import { type At, clock, lastAt } from "@/lib/recording/timeline"
import { answerAddresses, edgeFromHeaders, groupRoutes } from "@/lib/routes"

/** The connections as they stood at t: the latest line of each written by then. */
function connectionsAt(lines: At<Connection>[], t: number) {
  const byID = new Map<string, Connection>()
  for (const l of lines) {
    if (l.t > t) break
    byID.set(l.v.id, l.v)
  }
  return [...byID.values()]
}

/** The CDN site each name's WebView responses came from, by their headers, the latest winning. */
function edgesByHost(log: DevToolsLog, time: number) {
  const out = new Map<string, string>()
  for (const r of log.requestsUntil(time)) {
    const edge = edgeFromHeaders(r.responseHeaders)
    if (!edge) continue
    try {
      out.set(new URL(r.url).hostname, edge)
    } catch {
      continue
    }
  }
  return out
}

/** The Routes tab of a recording: the connections up to the playhead, where their servers are, and the WebView's timings for each name. */
export function RoutesView({
  conns,
  dns,
  network,
  log,
  time,
  share,
  picked,
  onPick,
}: {
  conns: At<Connection>[]
  dns: At<DNSEvent>[]
  network: At<Network>[]
  log: DevToolsLog
  time: number
  share?: string
  picked?: string
  onPick: (route: string | undefined) => void
}) {
  const clocks = useContext(ClocksContext)
  const all = useMemo(() => {
    const queries = dns.flatMap((e) => (e.v.query ? [e.v.query] : []))
    const exits = network.flatMap((e) => (e.v.externalIp ? [e.v.externalIp] : []))
    return [
      ...new Set([...conns.flatMap((c) => (c.v.address ? [c.v.address] : [])), ...answerAddresses(queries), ...exits]),
    ]
  }, [conns, dns, network])
  const geo = useIPInfo(all, share)
  const net = lastAt(network, time)?.v ?? network[0]?.v
  const exitIP = net?.externalIp
  const exit = { location: net?.location, address: exitIP, info: exitIP ? geo.info.get(exitIP) : undefined }
  const now = connectionsAt(conns, time)
  const answered = edgesByHost(log, time)
  const routes = groupRoutes(now, geo.info, exit)
  for (const r of routes) r.edge ??= answered.get(r.key)
  const queries: DNSQuery[] = dns.flatMap((e) => (e.v.query && e.t <= time ? [e.v.query] : []))

  return (
    <RoutesTable
      routes={routes}
      geo={geo}
      exit={exit}
      picked={picked ?? null}
      onPick={(key) => onPick(key ?? undefined)}
      time={(iso) => clock(Date.parse(iso) - clocks.startedAt)}
      lookups={(host) => queries.filter((q) => q.name === host)}
      webview={{ log, time }}
      empty="No connection yet at this point of the recording."
    />
  )
}
