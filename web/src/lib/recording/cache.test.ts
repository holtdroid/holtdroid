import { describe, expect, test } from "bun:test"
import {
  analyzeCache,
  type CacheRequest,
  cdnOf,
  findBusters,
  freshAsked,
  isHashed,
  parseCacheControl,
} from "@/lib/recording/cache"

const wall = Date.UTC(2026, 9, 27, 12, 0, 0)
let n = 0

function req(url: string, patch: Partial<CacheRequest> = {}): CacheRequest {
  n++
  return {
    key: `P1/r${n}`,
    id: `r${n}`,
    start: n * 100,
    end: n * 100 + 50,
    wall,
    method: "GET",
    url,
    resourceType: "Script",
    status: 200,
    size: 1000,
    ...patch,
    responseHeaders: { date: new Date(wall).toUTCString(), ...patch.responseHeaders },
  }
}

const rules = (rs: CacheRequest[]) => analyzeCache(rs).findings.map((f) => `${f.severity} ${f.rule}`)

describe("parseCacheControl", () => {
  test.each([
    [
      "public, max-age=600",
      [
        ["public", true],
        ["max-age", "600"],
      ],
    ],
    [
      'private="set-cookie", no-cache',
      [
        ["private", "set-cookie"],
        ["no-cache", true],
      ],
    ],
    [
      "MAX-AGE = 0 , must-revalidate",
      [
        ["max-age", "0"],
        ["must-revalidate", true],
      ],
    ],
    ["", []],
  ])("%s", (v, want) => expect([...parseCacheControl(v)]).toEqual(want as [string, string | true][]))
})

describe("cdnOf", () => {
  test.each([
    [{ "CF-Cache-Status": "HIT" }, { name: "Cloudflare", status: "HIT", kind: "hit" }],
    [{ "cf-cache-status": "expired" }, { name: "Cloudflare", status: "EXPIRED", kind: "miss" }],
    [{ "cf-cache-status": "DYNAMIC" }, { name: "Cloudflare", status: "DYNAMIC", kind: "uncached" }],
    [
      { "x-cache": "Hit from cloudfront", "x-amz-cf-id": "abc" },
      { name: "CloudFront", status: "Hit from cloudfront", kind: "hit" },
    ],
    [
      { "x-cache": "MISS, MISS", "x-served-by": "cache-ams-1" },
      { name: "Fastly", status: "MISS", kind: "miss" },
    ],
    [{ server: "nginx" }, undefined],
  ])("%o", (h, want) => expect(cdnOf(h)).toEqual(want as ReturnType<typeof cdnOf>))
})

describe("findBusters", () => {
  test.each([
    [`https://a.example/x?_=${wall - 40}`, [["_", "ms"]]],
    [`https://a.example/x?ts=${Math.floor(wall / 1000) + 5}`, [["ts", "s"]]],
    ["https://a.example/x?at=2026-10-27T11:58:00Z", [["at", "iso"]]],
    ["https://a.example/x?day=2026-10-27", [["day", "date"]]],
    [`https://a.example/feed/${wall}/items`, [["segment 2", "ms"]]],
    [`https://a.example/x?_=${wall - 3 * 86_400_000}`, []],
    ["https://a.example/x?v=20261027&id=1730000000", []],
    ["https://a.example/x?lang=en", []],
  ])("%s", (url, want) => expect(findBusters(url, wall).map((b) => [b.name, b.unit])).toEqual(want))

  test("needs the request's time", () => expect(findBusters(`https://a.example/?_=${wall}`, undefined)).toEqual([]))
})

test.each([
  ["https://a.example/assets/app.3f9a8c1d.js", true],
  ["https://a.example/assets/chunk-BX2KQ7aZ.css", true],
  ["https://a.example/app.js?v=9f8e7d6c5b", true],
  ["https://a.example/logo.png", false],
  ["https://a.example/fonts/inter.woff2", false],
  ["https://a.example/bundle-20241001.js", false],
])("isHashed %s", (url, want) => expect(isHashed(url)).toBe(want))

test.each([
  [{ "Cache-Control": "no-cache", Pragma: "no-cache" }, "Script", true],
  [{ pragma: "no-cache" }, "Fetch", true],
  [{ "cache-control": "max-age=0" }, "Document", false],
  [{ "cache-control": "max-age=0" }, "Fetch", true],
  [{ accept: "*/*" }, "Fetch", false],
])("freshAsked %o %s", (h, type, want) =>
  expect(freshAsked(req("https://a.example/", { requestHeaders: h, resourceType: type }))).toBe(want),
)

describe("analyzeCache", () => {
  test("a timestamp in the URL of a cacheable response is an error, with the bytes it cost", () => {
    const rs = [0, 1, 2].map((i) =>
      req(`https://api.example/v1/catalog?lang=en&_=${wall + i * 2000}`, {
        wall: wall + i * 2000,
        resourceType: "Fetch",
        size: 5000,
        responseHeaders: { "cache-control": "public, max-age=300", "cf-cache-status": "MISS" },
      }),
    )
    const { findings, summary } = analyzeCache(rs)
    const f = findings[0]!
    expect(f.rule).toBe("buster")
    expect(f.severity).toBe("error")
    expect(f.requests).toHaveLength(3)
    expect(f.wasted).toBe(10000)
    expect(f.detail).toContain("Cloudflare")
    expect(summary.wasted).toBe(10000)
    expect(summary.cdn.miss).toBe(3)
  })

  test("a value that differs on every request", () => {
    const rs = ["a1b2c3d4", "z9y8x7w6", "q1w2e3r4"].map((v) =>
      req(`https://api.example/v1/prices?nonce=${v}`, {
        resourceType: "Fetch",
        responseHeaders: { "cache-control": "max-age=60" },
      }),
    )
    expect(rules(rs)).toContain("warning changing-param")
    const pages = ["1", "2", "3"].map((p) => req(`https://api.example/v1/list?page=${p}`, { resourceType: "Fetch" }))
    expect(rules(pages)).not.toContain("warning changing-param")
  })

  test("the same file downloaded again, and why", () => {
    const none = [0, 1].map(() => req("https://a.example/logo.png", { resourceType: "Image" }))
    const r = analyzeCache(none).findings
    expect(r.map((f) => f.rule)).toEqual(["repeat", "no-policy"])
    expect(r[0]!.detail).toContain("nothing to revalidate it with")
    expect(r[0]!.wasted).toBe(1000)

    const fresh = [0, 1].map((i) =>
      req("https://a.example/app.js", {
        wall: wall + i * 1000,
        requestHeaders: i ? { "cache-control": "no-cache" } : {},
        responseHeaders: { "cache-control": "max-age=600", etag: '"1"' },
      }),
    )
    const f = analyzeCache(fresh).findings.find((x) => x.rule === "repeat")!
    expect(f.detail).toContain("asked for a fresh copy")
  })

  test("a reused file is no repeat", () => {
    const rs = [
      req("https://a.example/app.3f9a8c1d.js", {
        responseHeaders: { "cache-control": "public, max-age=31536000, immutable" },
      }),
      req("https://a.example/app.3f9a8c1d.js", { cached: "memory", size: 0 }),
      req("https://a.example/app.3f9a8c1d.js", { status: 304, size: 120 }),
    ]
    const { findings, summary } = analyzeCache(rs)
    expect(findings).toEqual([])
    expect(summary).toMatchObject({ requests: 3, browser: 1, revalidated: 1, network: 1, bytes: 1000 })
  })

  test.each([
    [
      "cdn hit on a private response",
      { "cache-control": "private", "cf-cache-status": "HIT" },
      "Fetch",
      "error cdn-private",
    ],
    [
      "cdn hit that sets a cookie",
      { "set-cookie": "sid=1", "cf-cache-status": "HIT", "cache-control": "public, max-age=60" },
      "Fetch",
      "error cdn-private",
    ],
    [
      "bypass on a static file",
      { "cache-control": "no-cache", etag: '"1"', "set-cookie": "a=1", "cf-cache-status": "BYPASS" },
      "Stylesheet",
      "warning cdn-bypass",
    ],
    ["dynamic image", { "cf-cache-status": "DYNAMIC", "cache-control": "max-age=60" }, "Image", "warning cdn-dynamic"],
    [
      "dynamic JSON that could be cached",
      { "cf-cache-status": "DYNAMIC", "cache-control": "public, max-age=60" },
      "Fetch",
      "warning cdn-dynamic",
    ],
    ["stale hit", { "cf-cache-status": "HIT", "cache-control": "max-age=60", age: "600" }, "Script", "info cdn-stale"],
    ["no-store script", { "cache-control": "no-store" }, "Script", "warning no-store"],
    ["no-cache without validator", { "cache-control": "no-cache" }, "Stylesheet", "warning no-validator"],
    ["public cookie", { "cache-control": "public, max-age=60", "set-cookie": "a=1" }, "Fetch", "warning set-cookie"],
    [
      "vary user-agent",
      { "cache-control": "max-age=60", vary: "Accept-Encoding, User-Agent" },
      "Script",
      "warning vary",
    ],
    ["vary star", { "cache-control": "max-age=60", vary: "*" }, "Script", "error vary"],
    ["pragma only", { pragma: "no-cache", etag: '"1"' }, "Fetch", "info legacy"],
    ["no headers on a document", {}, "Document", "info no-policy"],
  ])("%s", (_, h, type, want) =>
    expect(rules([req("https://a.example/f.css", { resourceType: type, responseHeaders: h })])).toContain(want),
  )

  test("a hashed file with a short lifetime", () =>
    expect(
      rules([req("https://a.example/app.3f9a8c1d.js", { responseHeaders: { "cache-control": "max-age=3600" } })]),
    ).toEqual(["info short-hashed"]))

  test("no-cache API calls without cdn are fine", () =>
    expect(
      rules([
        req("https://a.example/api", { resourceType: "Fetch", responseHeaders: { "cache-control": "no-store" } }),
      ]),
    ).toEqual([]))

  test("Disable cache shows on every request", () => {
    const rs = Array.from({ length: 6 }, (_, i) =>
      req(`https://a.example/${i}.js`, {
        requestHeaders: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        responseHeaders: { "cache-control": "max-age=600" },
      }),
    )
    const f = analyzeCache(rs).findings.find((x) => x.rule === "fresh-asked")!
    expect(f.severity).toBe("warning")
    expect(f.detail).toContain("Disable cache")
  })

  test("only what a cache could keep", () => {
    const rs = [
      req("https://a.example/x", { method: "POST", resourceType: "Fetch" }),
      req("https://a.example/y", { error: "net::ERR_FAILED", status: 0 }),
      req("data:image/png;base64,AAAA", { resourceType: "Image" }),
      req("https://a.example/z", { resourceType: "Preflight", method: "OPTIONS" }),
      req("https://a.example/e", { status: 500 }),
    ]
    expect(analyzeCache(rs).summary.requests).toBe(0)
  })
})
