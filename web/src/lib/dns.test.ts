import { describe, expect, test } from "bun:test"
import type { DNSQuery, DNSRewrite } from "@/api/client"
import {
  answerOf,
  describeSVCB,
  formatTTL,
  groupLookups,
  lookupAnswer,
  lookupBadges,
  lookupTTL,
  importSettings,
  matches,
  mergeRewrites,
  patternChoices,
  ruleFor,
  validIPv4,
  validPattern,
} from "@/lib/dns"

const rw = (pattern: string, extra: Partial<DNSRewrite> = {}): DNSRewrite => ({
  pattern,
  kind: "nxdomain",
  ttl: 0,
  enabled: true,
  ...extra,
})

describe("patterns", () => {
  test("validity", () => {
    expect(validPattern("api.example.com")).toBe(true)
    expect(validPattern("*.example.com")).toBe(true)
    expect(validPattern("_dmarc.example.com")).toBe(true)
    expect(validPattern("a.*.example.com")).toBe(false)
    expect(validPattern("*")).toBe(false)
    expect(validPattern("bad..name")).toBe(false)
    expect(validPattern("-bad.example.com")).toBe(false)
  })

  test("wildcards match what is under the name, not the name", () => {
    expect(matches("*.example.com", "a.b.example.com")).toBe(true)
    expect(matches("*.example.com", "example.com")).toBe(false)
    expect(matches("*.example.com", "badexample.com")).toBe(false)
    expect(matches("example.com", "example.com")).toBe(true)
  })

  test("precedence follows the agent", () => {
    const rules = [
      rw("*.example.com"),
      rw("*.api.example.com"),
      rw("v1.api.example.com"),
      rw("off.example.com", { enabled: false }),
    ]
    expect(ruleFor(rules, "v1.api.example.com")?.pattern).toBe("v1.api.example.com")
    expect(ruleFor(rules, "v2.api.example.com")?.pattern).toBe("*.api.example.com")
    expect(ruleFor(rules, "off.example.com")?.pattern).toBe("*.example.com")
    expect(ruleFor(rules, "example.org")).toBeUndefined()
  })

  test("choices for a name from the log", () => {
    expect(patternChoices("api.example.com")).toEqual(["api.example.com", "*.example.com", "*.api.example.com"])
    expect(patternChoices("example.com")).toEqual(["example.com", "*.example.com"])
  })
})

test("IPv4", () => {
  expect(validIPv4("10.0.0.1")).toBe(true)
  expect(validIPv4("0.0.0.0")).toBe(true)
  expect(validIPv4("256.0.0.1")).toBe(false)
  expect(validIPv4("01.2.3.4")).toBe(false)
  expect(validIPv4("::1")).toBe(false)
})

test("answerOf tells a block from an address", () => {
  expect(answerOf(rw("a.example.com", { kind: "address", addresses: ["0.0.0.0"] }))).toBe("block")
  expect(answerOf(rw("a.example.com", { kind: "address", addresses: ["0.0.0.0", "1.2.3.4"] }))).toBe("address")
})

test("merge keeps order and lets incoming win", () => {
  const merged = mergeRewrites(
    [rw("a.example.com"), rw("b.example.com")],
    [rw("b.example.com", { ttl: 9 }), rw("c.example.com")],
  )
  expect(merged.map((r) => `${r.pattern}:${r.ttl}`)).toEqual(["a.example.com:0", "b.example.com:9", "c.example.com:0"])
})

describe("import", () => {
  test("an export", () => {
    const got = importSettings(
      JSON.stringify({
        format: "holtdroid-dns/1",
        name: "staging",
        settings: {
          ttlMode: "limit",
          maxTtl: 5,
          rewrites: [{ pattern: "API.Example.com.", kind: "address", addresses: ["10.0.0.1"] }],
        },
      }),
    )
    expect(got.name).toBe("staging")
    expect(got.settings.ttlMode).toBe("limit")
    expect(got.settings.maxTtl).toBe(5)
    expect(got.settings.allowEncrypted).toBe(false)
    expect(got.settings.rewrites[0]).toMatchObject({ pattern: "api.example.com", enabled: true, ttl: 0 })
  })

  test("a bare list", () => {
    expect(
      importSettings(JSON.stringify([{ pattern: "a.example.com", kind: "nxdomain" }])).settings.rewrites,
    ).toHaveLength(1)
  })

  test("garbage", () => {
    expect(() => importSettings("{}")).toThrow()
    expect(() => importSettings(JSON.stringify([{ pattern: "a", kind: "drop" }]))).toThrow()
  })
})

let nextID = 0
const q = (name: string, type: string, at: number, extra: Partial<DNSQuery> = {}): DNSQuery => ({
  id: ++nextID,
  at: new Date(Date.UTC(2026, 9, 26, 12, 0, 0) + at).toISOString(),
  name,
  type,
  protocol: "udp",
  result: "answered",
  rcode: "NOERROR",
  answers: [],
  duration: 20,
  ...extra,
})
const a = (name: string, type: string, data: string, ttl: number, originalTtl = ttl) => ({
  name,
  type,
  data,
  ttl,
  originalTtl,
})

describe("lookups", () => {
  test("A, AAAA and HTTPS of a name at once are one lookup", () => {
    const got = groupLookups([
      q("www.example.com", "A", 0),
      q("api.example.com", "A", 10),
      q("www.example.com", "HTTPS", 15),
      q("www.example.com", "AAAA", 30, { result: "ipv4-only" }),
      q("www.example.com", "A", 5000),
      q("api.example.com", "A", 20),
    ])
    expect(got.map((l) => `${l.name}:${l.queries.map((x) => x.type).join("+")}`)).toEqual([
      "www.example.com:A+HTTPS+AAAA",
      "api.example.com:A",
      "www.example.com:A",
      "api.example.com:A",
    ])
  })

  test("answer, TTL and badges", () => {
    const [l] = groupLookups([
      q("www.example.com", "A", 0, {
        answers: [
          a("www.example.com", "CNAME", "edge.example.net", 3600),
          a("edge.example.net", "A", "10.0.0.1", 0, 300),
          a("edge.example.net", "A", "10.0.0.2", 0, 300),
        ],
      }),
      q("www.example.com", "HTTPS", 1, { answers: [a("www.example.com", "HTTPS", "1 . alpn=h3,h2", 0, 21600)] }),
    ])
    expect(lookupAnswer(l!)).toEqual({ text: "10.0.0.1", more: 1 })
    expect(lookupTTL(l!)).toEqual({ served: 0, original: 300 })
    expect(lookupBadges(l!)).toEqual([])
  })

  test("what stands out", () => {
    const [nx] = groupLookups([q("gone.example.com", "A", 0, { rcode: "NXDOMAIN" })])
    expect(lookupBadges(nx!).map((b) => b.label)).toEqual(["NXDOMAIN"])
    const [rw] = groupLookups([
      q("api.example.com", "A", 0, {
        result: "rewritten",
        rule: "*.example.com",
        answers: [a("api.example.com", "A", "10.0.0.7", 0)],
      }),
    ])
    expect(lookupBadges(rw!).map((b) => b.label)).toEqual(["rewrite"])
    const [empty] = groupLookups([q("accounts.example.com", "HTTPS", 0)])
    expect(lookupBadges(empty!).map((b) => b.label)).toEqual(["no records"])
    const [doh] = groupLookups([
      q("chrome.cloudflare-dns.com", "A", 0, { result: "blocked", rcode: "NXDOMAIN", rule: "encrypted DNS" }),
      q("chrome.cloudflare-dns.com", "HTTPS", 1, { result: "blocked", rcode: "NXDOMAIN", rule: "encrypted DNS" }),
    ])
    expect(lookupBadges(doh!).map((b) => b.label)).toEqual(["DoH blocked"])
    const [fail] = groupLookups([q("x.example.com", "A", 0, { result: "failed", rcode: "SERVFAIL", error: "timeout" })])
    expect(lookupBadges(fail!).map((b) => b.label)).toEqual(["SERVFAIL"])
  })

  test("HTTPS records and TTLs read as words", () => {
    expect(describeSVCB("1 . alpn=h3,h2 ipv4hint=1.2.3.4")).toBe("alpn h3, h2")
    expect(describeSVCB("2 fallback.example.com alpn=h2")).toBe("alpn h2 · via fallback.example.com")
    expect(describeSVCB("0 svc.example.com")).toBe("alias → svc.example.com")
    expect([42, 300, 3536, 21552, 172800].map(formatTTL)).toEqual(["42s", "5m", "59m", "6h", "2d"])
  })
})
