import { describe, expect, test } from "bun:test"
import type { DevToolsImageUse } from "@/api/client"
import {
  analyzeImages,
  backgroundSize,
  bodyBytes,
  type ImageRequest,
  type ImageShot,
  imageFormat,
  neededFor,
} from "@/lib/recording/images"

const shop = "https://shop.example.com/"

const req = (name: string, at: number, extra: Partial<ImageRequest> = {}): ImageRequest => ({
  key: `P1/${name}`,
  target: "P1",
  at,
  id: name,
  start: at - 40,
  end: at + 1,
  method: "GET",
  url: shop + name,
  resourceType: "Image",
  status: 200,
  mimeType: name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg",
  size: 40_000,
  ...extra,
})

const use = (name: string, extra: Partial<DevToolsImageUse> = {}): DevToolsImageUse => ({
  element: 1,
  src: shop + name,
  kind: "img",
  width: 100,
  height: 100,
  ...extra,
})

const shot = (at: number, uses: DevToolsImageUse[]): ImageShot => ({
  target: "P1",
  at,
  url: shop,
  width: 412,
  height: 915,
  dpr: 2,
  uses,
})

const rules = (r: ReturnType<typeof analyzeImages>) =>
  r.findings.map((f) => `${f.rule}:${f.url.slice(shop.length)}`).toSorted()

describe("imageFormat", () => {
  test.each([
    ["image/png", "a", "png"],
    ["image/jpeg; charset=binary", "a", "jpeg"],
    [undefined, `${shop}a/b.WEBP?v=2`, "webp"],
    ["application/octet-stream", `${shop}x.avif`, "avif"],
    ["image/svg+xml", "a", "svg"],
    [undefined, `${shop}pixel`, "other"],
  ] as const)("%s %s", (mime, url, want) => expect(imageFormat(mime, url)).toBe(want))
})

test("bodyBytes counts base64 padding", () => {
  expect(bodyBytes(btoa("abcd"), true)).toBe(4)
  expect(bodyBytes(btoa("abcde"), true)).toBe(5)
  expect(bodyBytes("é", false)).toBe(2)
})

describe("backgroundSize", () => {
  const box = { width: 200, height: 100 }
  test.each([
    ["cover", 400, 400, { width: 200, height: 200 }],
    ["contain", 400, 400, { width: 100, height: 100 }],
    ["24px 24px", undefined, undefined, { width: 24, height: 24 }],
    ["50% auto", 400, 200, { width: 100, height: 50 }],
    ["auto", 64, 32, { width: 64, height: 32 }],
    ["", 64, 32, { width: 64, height: 32 }],
    ["cover", undefined, undefined, undefined],
  ] as const)("%s", (fit, nw, nh, want) => expect(backgroundSize(fit, box, nw, nh)).toEqual(want))
})

test("neededFor scales boxes by the screen's density and fits", () => {
  const at = { at: 0, dpr: 2.5, target: "P1", frame: "" }
  expect(neededFor({ ...use("a.png", { width: 32, height: 32 }), ...at })).toEqual({ width: 80, height: 80 })
  expect(
    neededFor({
      ...use("a.png", { width: 100, height: 50, fit: "cover", naturalWidth: 400, naturalHeight: 400 }),
      ...at,
    }),
  ).toEqual({ width: 250, height: 250 })
  expect(neededFor({ ...use("a.png", { hidden: true }), ...at })).toBeUndefined()
  expect(neededFor({ ...use("a.png", { kind: "css", fit: "cover" }), ...at })).toBeUndefined()
})

describe("analyzeImages", () => {
  test("images that aren't on screen within the window, late ones and ones drawn nowhere", () => {
    const report = analyzeImages({
      requests: [
        req("hero.jpg", 1000),
        req("late.jpg", 1000),
        req("ghost.png", 1000),
        req("ok.jpg", 1000),
        req("fresh.jpg", 9000),
      ],
      shots: [
        shot(1500, [
          use("hero.jpg", { element: 1 }),
          use("late.jpg", { element: 2 }),
          use("ok.jpg", { element: 3, shown: true }),
          use("fresh.jpg", { element: 4 }),
        ]),
        shot(14_000, [use("late.jpg", { element: 2, shown: true })]),
      ],
      now: 15_000,
    })
    expect(rules(report).filter((r) => !r.startsWith("format"))).toEqual([
      "late:late.jpg",
      "offscreen:hero.jpg",
      "unused:ghost.png",
    ])
    const offscreen = report.findings.find((f) => f.rule === "offscreen")!
    expect(offscreen.saving).toBe(40_000)
    expect(report.summary.unshown).toBe(80_000)
  })

  test("hidden uses say so", () => {
    const report = analyzeImages({
      requests: [req("menu.jpg", 0)],
      shots: [shot(100, [use("menu.jpg", { hidden: true, width: 0, height: 0 })])],
      now: 20_000,
    })
    expect(report.findings.find((f) => f.rule === "offscreen")?.detail).toContain("hidden")
  })

  test("without image lines only the file itself is checked", () => {
    const report = analyzeImages({ requests: [req("a.png", 0)], shots: [], now: 60_000 })
    expect(rules(report)).toEqual(["format:a.png"])
    expect(report.findings[0]!.estimated).toBe(true)
    expect(report.summary.shots).toBe(false)
  })

  test("workers' images aren't expected on screen", () => {
    const r = req("a.webp", 0, { target: "W1", key: "W1/a" })
    const report = analyzeImages({
      requests: [r],
      shots: [shot(10, [])],
      kinds: new Map([["W1", "service_worker"]]),
      now: 60_000,
    })
    expect(report.findings).toEqual([])
  })

  test("an image bigger than every place draws it, counting density and several uses", () => {
    const report = analyzeImages({
      requests: [req("avatar.webp", 0, { size: 60_000 })],
      shots: [
        shot(10, [
          use("avatar.webp", { element: 1, width: 32, height: 32, naturalWidth: 512, naturalHeight: 512, shown: true }),
          use("avatar.webp", { element: 2, width: 48, height: 48, naturalWidth: 512, naturalHeight: 512 }),
        ]),
      ],
      now: 60_000,
    })
    const f = report.findings.find((x) => x.rule === "oversized")!
    expect(f.title).toContain("512×512")
    expect(f.title).toContain("96×96")
    expect(f.severity).toBe("warning")
    expect(report.entries[0]!.needed).toEqual({ width: 96, height: 96 })
    expect(f.saving).toBe(Math.round(60_000 * (1 - (96 * 96) / (512 * 512))))
  })

  test("an image drawn near its size is fine", () => {
    const report = analyzeImages({
      requests: [req("logo.webp", 0, { size: 3000 })],
      shots: [
        shot(10, [use("logo.webp", { width: 120, height: 40, naturalWidth: 300, naturalHeight: 100, shown: true })]),
      ],
      now: 60_000,
    })
    expect(report.findings).toEqual([])
  })

  test("measured WebP sizes replace the guesses", () => {
    const r = req("photo.jpg", 0, { body: btoa("x".repeat(90_000)), bodyBase64: true })
    const report = analyzeImages({
      requests: [r],
      shots: [shot(10, [use("photo.jpg", { width: 400, height: 300, shown: true })])],
      measures: new Map([[r.key, { width: 800, height: 600, webp: 30_000 }]]),
      now: 60_000,
    })
    const f = report.findings.find((x) => x.rule === "format")!
    expect(f.estimated).toBe(false)
    expect(f.saving).toBe(60_000)
    expect(f.severity).toBe("warning")
    expect(report.summary.saving).toBe(60_000)
  })

  test("a WebP that re-encodes much smaller looks uncompressed", () => {
    const r = req("big.webp", 0, { body: btoa("x".repeat(200_000)), bodyBase64: true })
    const report = analyzeImages({
      requests: [r],
      shots: [],
      measures: new Map([[r.key, { width: 1000, height: 800, webp: 70_000 }]]),
      now: 60_000,
    })
    expect(rules(report)).toEqual(["uncompressed:big.webp"])
    expect(report.findings[0]!.saving).toBe(130_000)
  })

  test("an unmeasured WebP is judged by its bits per pixel", () => {
    const report = analyzeImages({
      requests: [req("heavy.webp", 0, { size: 120_000 })],
      shots: [
        shot(10, [use("heavy.webp", { width: 200, height: 200, naturalWidth: 400, naturalHeight: 300, shown: true })]),
      ],
      now: 60_000,
    })
    const f = report.findings.find((x) => x.rule === "uncompressed")!
    expect(f.severity).toBe("info")
    expect(f.title).toContain("8 bits per pixel")
  })

  test("failed, redirected and data: requests are left out", () => {
    const report = analyzeImages({
      requests: [
        req("gone.png", 0, { status: 404 }),
        req("moved.png", 0, { redirect: `${shop}new.png` }),
        req("err.png", 0, { status: 0, error: "net::ERR_FAILED" }),
        { ...req("inline.png", 0), url: "data:image/png;base64,AAAA" },
      ],
      shots: [],
      now: 60_000,
    })
    expect(report.entries).toEqual([])
  })
})

test("an iframe in the page's process counts as drawing its images, apart from the page's own elements", () => {
  const report = analyzeImages({
    requests: [req("pay.png", 1000)],
    shots: [
      shot(1500, [use("pay.png", { element: 1, width: 40, height: 40 })]),
      {
        ...shot(1600, [use("pay.png", { element: 1, width: 80, height: 80, shown: true })]),
        frame: "CHILD",
        url: "https://pay.example.net/",
      },
    ],
    now: 30_000,
  })
  expect(report.findings.filter((f) => f.rule === "unused" || f.rule === "offscreen")).toEqual([])
  const e = report.entries[0]!
  expect(e.uses.map((u) => [u.frame, u.element, u.shown ?? false])).toEqual([
    ["", 1, false],
    ["CHILD", 1, true],
  ])
  expect(e.needed).toEqual({ width: 160, height: 160 })
})

test("images loaded before the pages were first scanned aren't judged by when they showed up", () => {
  const report = analyzeImages({
    requests: [req("early.jpg", 1000), req("later.jpg", 30_000)],
    shots: [shot(20_000, [use("early.jpg", { element: 1 })])],
    now: 60_000,
  })
  expect(report.findings.filter((f) => f.rule !== "format").map((f) => f.id)).toEqual([`unused:${shop}later.jpg`])
})
