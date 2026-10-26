import { describe, expect, test } from "bun:test"
import type { DNSRewrite } from "@/api/client"
import {
  answerOf,
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
