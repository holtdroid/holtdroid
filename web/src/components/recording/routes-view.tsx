import { useContext, useMemo } from "react"
import type { Connection, DNSEvent, DNSQuery, Network } from "@/api/client"
import { ClocksContext } from "@/components/recording/json-view"
import { RoutesTable } from "@/components/session/routes-table"
import { useIPInfo } from "@/components/session/use-routes"
import type { DevToolsLog } from "@/lib/recording/devtools"
import { type At, clock, lastAt } from "@/lib/recording/timeline"
import { answerAddresses, groupRoutes } from "@/lib/routes"

/** The connections as they stood at t: the latest line of each written by then. */
function connectionsAt(lines: At<Connection>[], t: number) {
  const byID = new Map<string, Connection>()
  for (const l of lines) {
    if (l.t > t) break
    byID.set(l.v.id, l.v)
  }
  return [...byID.values()]
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
    return [...new Set([...conns.map((c) => c.v.address), ...answerAddresses(queries), ...exits])]
  }, [conns, dns, network])
  const geo = useIPInfo(all, share)
  const net = lastAt(network, time)?.v ?? network[0]?.v
  const exitIP = net?.externalIp
  const exit = { location: net?.location, address: exitIP, info: exitIP ? geo.info.get(exitIP) : undefined }
  const now = connectionsAt(conns, time)
  const routes = groupRoutes(now, geo.info, exit)
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
