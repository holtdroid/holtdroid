import { describe, expect, test } from "bun:test"
import type { Connection, DNSQuery, IPInfo } from "@/api/client"
import { churned, dnsFar, edgeFromHeaders, groupRoutes, isFar, latest, siteName, summarize } from "@/lib/routes"

const t0 = Date.parse("2026-10-27T10:00:00Z")

function conn(id: string, over: Partial<Connection> = {}): Connection {
  return {
    id,
    start: new Date(t0).toISOString(),
    network: "tcp",
    host: "api.example.com",
    address: "81.2.69.160",
    port: 443,
    outbound: "pl",
    upload: 100,
    download: 1000,
    ...over,
  }
}

const pl: IPInfo = { address: "198.51.100.7", country: "PL", continent: "EU" }
const info = new Map<string, IPInfo>([
  ["81.2.69.160", { address: "81.2.69.160", country: "PL", continent: "EU" }],
  ["52.94.0.1", { address: "52.94.0.1", country: "US", continent: "NA", asn: 16509, org: "Amazon.com, Inc." }],
  ["104.16.1.1", { address: "104.16.1.1", country: "CA", continent: "NA", cdn: "cloudflare" }],
])

function q(...data: string[]): DNSQuery {
  return {
    id: 1,
    at: new Date(t0).toISOString(),
    name: "s3.example.com",
    type: "A",
    protocol: "udp",
    result: "answered",
    rcode: "NOERROR",
    duration: 3,
    answers: data.map((d) => ({ name: "s3.example.com", type: "A", data: d, ttl: 60, originalTtl: 60 })),
  }
}

describe("routes", () => {
  test("latest line of a connection wins", () => {
    const got = latest([conn("a"), conn("b"), conn("a", { end: new Date(t0 + 5000).toISOString(), download: 9 })])
    expect(got.map((c) => [c.id, c.download])).toEqual([
      ["a", 9],
      ["b", 1000],
    ])
  })

  test("far ignores CDN edges and unknown places", () => {
    expect(isFar(info.get("52.94.0.1"), pl)).toBe(true)
    expect(isFar(info.get("104.16.1.1"), pl)).toBe(false)
    expect(isFar(info.get("81.2.69.160"), pl)).toBe(false)
    expect(isFar({ address: "9.9.9.9" }, pl)).toBe(false)
    expect(isFar(info.get("52.94.0.1"), undefined)).toBe(false)
  })

  test("churn needs six TCP connections to one port within a minute", () => {
    const five = Array.from({ length: 5 }, (_, i) => conn(`c${i}`, { start: new Date(t0 + i * 1000).toISOString() }))
    expect(churned(five)).toBe(false)
    expect(churned([...five, conn("c5", { start: new Date(t0 + 30_000).toISOString() })])).toBe(true)
    expect(churned([...five, conn("c5", { start: new Date(t0 + 90_000).toISOString() })])).toBe(false)
    expect(churned([...five, conn("c5", { start: new Date(t0 + 30_000).toISOString(), port: 8443 })])).toBe(false)
    expect(churned([...five, conn("c5", { network: "udp" })])).toBe(false)
  })

  test("groups by name and flags the route", () => {
    const routes = groupRoutes(
      [
        conn("a"),
        conn("b", { host: "s3.example.com", address: "52.94.0.1", end: new Date(t0 + 2000).toISOString() }),
        conn("c", { host: "", address: "104.16.1.1", outbound: "bypass" }),
        conn("d", { host: "old.example.com", address: "81.2.69.160", port: 80 }),
      ],
      info,
      { location: "pl", info: pl },
    )
    expect(routes.map((r) => [r.key, r.flags.map((f) => f.id), r.open])).toEqual([
      ["api.example.com", [], 1],
      ["s3.example.com", ["far"], 0],
      ["104.16.1.1", ["bypass"], 1],
      ["old.example.com", ["plain"], 1],
    ])
    expect(routes[1]!.flags[0]!.title).toContain("US (North America)")
    expect(summarize(routes, info)).toEqual({ servers: 4, countries: ["PL", "US"], far: 1, cdn: 1, flagged: 3 })
  })

  test("direct sessions never flag a bypass", () => {
    const [r] = groupRoutes([conn("a", { outbound: "bypass" })], info, { location: "direct" })
    expect(r!.flags).toEqual([])
  })

  test("a DNS answer is far only when no answer is near", () => {
    expect(dnsFar([q("52.94.0.1")], info, pl)?.country).toBe("US")
    expect(dnsFar([q("52.94.0.1", "81.2.69.160")], info, pl)).toBeUndefined()
    expect(dnsFar([q("104.16.1.1")], info, pl)).toBeUndefined()
  })
})

test("a connection to a name without an address", () => {
  const [r] = groupRoutes([conn("n", { host: "neverssl.com", address: undefined, port: 80 })], info, { location: "pl" })
  expect(r!.key).toBe("neverssl.com")
  expect(r!.addresses).toEqual([])
  expect(r!.flags.map((f) => f.id)).toEqual(["plain"])
})

test("the CDN site from response headers", () => {
  expect(edgeFromHeaders({ "CF-RAY": "8f1c2a3b4c5d6e7f-VNO" })).toBe("VNO")
  expect(edgeFromHeaders({ "x-amz-cf-pop": "WAW51-P2" })).toBe("WAW")
  expect(edgeFromHeaders({ "x-served-by": "cache-iad-kiad7000025-IAD, cache-fra-etou8220098-FRA" })).toBe("FRA")
  expect(edgeFromHeaders({ "x-served-by": "cache-ams-1" })).toBe("AMS")
  expect(edgeFromHeaders({ server: "nginx" })).toBeUndefined()
  expect(edgeFromHeaders(undefined)).toBeUndefined()
  expect(siteName("vno")).toBe("Vilnius, Lithuania")
  expect(siteName("XXX")).toBeUndefined()
})

test("a name keeps the latest edge the agent found", () => {
  const [r] = groupRoutes([conn("a"), conn("b", { edge: "RIX" }), conn("c", { edge: "VNO" })], info, { location: "pl" })
  expect(r!.edge).toBe("VNO")
})
