import { useMemo, useState } from "react"
import { RoutesTable } from "@/components/session/routes-table"
import { useNetwork } from "@/components/session/use-device"
import { useDNS, useDNSLog } from "@/components/session/use-dns"
import { useConnectionsLog, useIPInfo } from "@/components/session/use-routes"
import { wallClock } from "@/lib/format"
import { answerAddresses, groupRoutes } from "@/lib/routes"

/** Where the device's connections go: the servers behind each name, their country and network, and what looks off. */
export function RoutesPanel({ provider, id }: { provider: string; id: string }) {
  const [picked, setPicked] = useState<string | null>(null)
  const conns = useConnectionsLog(provider, id, true)
  const net = useNetwork(provider, id).data
  const dns = useDNS(provider, id).data?.available === true
  const { queries } = useDNSLog(provider, id, !dns)
  const exitIP = net?.externalIp
  const addresses = useMemo(
    () => [...new Set([...conns.map((c) => c.address), ...answerAddresses(queries), ...(exitIP ? [exitIP] : [])])],
    [conns, queries, exitIP],
  )
  const geo = useIPInfo(addresses)
  const exit = { location: net?.location, address: exitIP, info: exitIP ? geo.info.get(exitIP) : undefined }
  const routes = groupRoutes(conns, geo.info, exit)

  return (
    <div className="devtools-skin flex h-full flex-col bg-background">
      <RoutesTable
        routes={routes}
        geo={geo}
        exit={exit}
        picked={picked}
        onPick={setPicked}
        time={(iso) => wallClock(iso, false)}
        lookups={(host) => queries.filter((q) => q.name === host)}
        empty="No connection yet. Every server the device talks to shows up here, also after a reload."
      />
    </div>
  )
}
