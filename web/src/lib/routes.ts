import type { Connection, DNSQuery, IPInfo } from "@/api/client"
import { cdnSites } from "@/lib/cdn-sites"

export type RouteFlagId = "far" | "churn" | "bypass" | "plain"

export type RouteFlag = { id: RouteFlagId; label: string; title: string }

/** The connections to one name (or one address without a name). */
export type HostRoute = {
  key: string
  host?: string
  addresses: string[]
  ports: number[]
  outbounds: string[]
  /** the CDN site that answered, an IATA code */
  edge?: string
  conns: Connection[]
  open: number
  upload: number
  download: number
  first: number
  last: number
  flags: RouteFlag[]
}

export type Exit = { location?: string; info?: IPInfo }

export const churnWindow = 60_000
export const churnCount = 6

const continents: Record<string, string> = {
  AF: "Africa",
  AN: "Antarctica",
  AS: "Asia",
  EU: "Europe",
  NA: "North America",
  OC: "Oceania",
  SA: "South America",
}

export function continentName(code: string | undefined) {
  return code ? (continents[code] ?? code) : ""
}

/** The latest line of each connection, oldest first. */
export function latest(lines: Connection[]): Connection[] {
  const byID = new Map<string, Connection>()
  for (const c of lines) byID.set(c.id, c)
  return [...byID.values()].toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start))
}

/** Whether the server is on another continent than the session's exit; a CDN's anycast addresses never are. */
export function isFar(info: IPInfo | undefined, exit: IPInfo | undefined) {
  return !!info?.continent && !!exit?.continent && !info.cdn && !info.private && info.continent !== exit.continent
}

/** Whether many TCP connections to one port started within a minute, as when keep-alive isn't used. */
export function churned(conns: Connection[]) {
  const byPort = new Map<number, number[]>()
  for (const c of conns) {
    if (c.network !== "tcp") continue
    const starts = byPort.get(c.port) ?? []
    starts.push(Date.parse(c.start))
    byPort.set(c.port, starts)
  }
  for (const starts of byPort.values()) {
    starts.sort((a, b) => a - b)
    for (let i = churnCount - 1; i < starts.length; i++) {
      if (starts[i]! - starts[i - churnCount + 1]! <= churnWindow) return true
    }
  }
  return false
}

function where(info: IPInfo | undefined) {
  if (!info?.country) return "another continent"
  return `${info.country} (${continentName(info.continent)})`
}

export function routeFlags(conns: Connection[], info: Map<string, IPInfo>, exit: Exit): RouteFlag[] {
  const flags: RouteFlag[] = []
  const farAt = conns.map((c) => (c.address ? info.get(c.address) : undefined)).find((i) => isFar(i, exit.info))
  if (farAt) {
    flags.push({
      id: "far",
      label: "far",
      title: `Served from ${where(farAt)} while the session leaves from ${where(exit.info)}: every round trip crosses continents.`,
    })
  }
  if (churned(conns)) {
    flags.push({
      id: "churn",
      label: "no reuse",
      title: `${churnCount} or more connections to one port within a minute: each pays a TCP and TLS handshake. Keep-alive or HTTP/2 would reuse one.`,
    })
  }
  const loc = exit.location
  if (loc && loc !== "direct" && conns.some((c) => c.outbound && c.outbound !== loc)) {
    flags.push({ id: "bypass", label: "bypass", title: `Some of it left past the VPN location ${loc}.` })
  }
  if (conns.some((c) => c.network === "tcp" && c.port === 80)) {
    flags.push({ id: "plain", label: "HTTP", title: "Unencrypted HTTP on port 80." })
  }
  return flags
}

/** The connections grouped by name, in the order the names first came up. */
export function groupRoutes(conns: Connection[], info: Map<string, IPInfo>, exit: Exit): HostRoute[] {
  const groups = new Map<string, Connection[]>()
  for (const c of conns) {
    const key = c.host || c.address || c.id
    const g = groups.get(key) ?? []
    g.push(c)
    groups.set(key, g)
  }
  return [...groups].map(([key, list]) => {
    const starts = list.map((c) => Date.parse(c.start))
    const ends = list.map((c) => (c.end ? Date.parse(c.end) : Date.parse(c.start)))
    return {
      key,
      host: list[0]!.host || undefined,
      addresses: unique(list.flatMap((c) => (c.address ? [c.address] : []))),
      ports: unique(list.map((c) => c.port)),
      outbounds: unique(list.flatMap((c) => (c.outbound ? [c.outbound] : []))),
      edge: list.findLast((c) => c.edge)?.edge,
      conns: list,
      open: list.filter((c) => !c.end).length,
      upload: list.reduce((n, c) => n + c.upload, 0),
      download: list.reduce((n, c) => n + c.download, 0),
      first: Math.min(...starts),
      last: Math.max(...ends),
      flags: routeFlags(list, info, exit),
    }
  })
}

export type RouteSummary = { servers: number; countries: string[]; far: number; cdn: number; flagged: number }

export function summarize(routes: HostRoute[], info: Map<string, IPInfo>): RouteSummary {
  const addresses = unique(routes.flatMap((r) => r.addresses))
  return {
    servers: routes.length,
    countries: unique(
      addresses.flatMap((a) => (info.get(a)?.country && !info.get(a)?.cdn ? [info.get(a)!.country!] : [])),
    ),
    far: routes.filter((r) => r.flags.some((f) => f.id === "far")).length,
    cdn: routes.filter((r) => r.addresses.some((a) => info.get(a)?.cdn)).length,
    flagged: routes.filter((r) => r.flags.length > 0).length,
  }
}

const addressTypes = new Set(["A", "AAAA"])

/** The addresses DNS answers carry. */
export function answerAddresses(queries: DNSQuery[]) {
  return unique(
    queries.flatMap((q) =>
      q.answers.filter((a) => addressTypes.has(a.type) && a.data !== "0.0.0.0").map((a) => a.data),
    ),
  )
}

/** An answer that sends the device to another continent than its exit, as geo-DNS asked from elsewhere does. */
export function dnsFar(queries: DNSQuery[], info: Map<string, IPInfo>, exit: IPInfo | undefined): IPInfo | undefined {
  const answers = answerAddresses(queries).map((a) => info.get(a))
  if (answers.some((i) => i && !isFar(i, exit) && i.continent)) return undefined
  return answers.find((i) => isFar(i, exit))
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}

const cdnNames: Record<string, string> = { cloudflare: "Cloudflare", fastly: "Fastly", google: "Google" }

export function cdnName(cdn: string) {
  return cdnNames[cdn] ?? cdn
}

/** The city of a CDN site's IATA code, when it is one of the known sites. */
export function siteName(code: string): string | undefined {
  return cdnSites[code.toUpperCase()]
}

/**
 * The CDN site a response came from, by the headers CDNs add: Cloudflare's
 * cf-ray ends in it, CloudFront's x-amz-cf-pop starts with it, and the
 * last cache in Fastly's x-served-by is the one near the user.
 */
export function edgeFromHeaders(headers: Record<string, string> | undefined): string | undefined {
  if (!headers) return undefined
  const h = (name: string) => Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1]
  const ray = /-([A-Za-z]{3})$/.exec(h("cf-ray")?.trim() ?? "")
  if (ray) return ray[1]!.toUpperCase()
  const pop = /^([A-Za-z]{3})\d/.exec(h("x-amz-cf-pop")?.trim() ?? "")
  if (pop) return pop[1]!.toUpperCase()
  const served = h("x-served-by")?.split(",").at(-1)?.trim() ?? ""
  const cache = /^cache-([a-z]{3})\d*-/i.exec(served) ?? /-([A-Z]{3})$/.exec(served)
  return cache ? cache[1]!.toUpperCase() : undefined
}
