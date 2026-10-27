import { describe, expect, test } from "bun:test"
import {
  analyzeSvg,
  extractPaths,
  isPathData,
  optimizePaths,
  pathStats,
  precisionFor,
  roundPath,
  type SvgSource,
  svgSources,
} from "@/lib/recording/svgpaths"

const circle =
  "M12.000000 2.250000C6.615234 2.250000 2.250000 6.615234 2.250000 12.000000C2.250000 17.384766 6.615234 21.750000 12.000000 21.750000Z"
const cart = "M 3.000000 4.000000 L 5.250000 4.000000 L 7.500000 15.000000 L 18.000000 15.000000"

const source = (key: string, text: string, kind: SvgSource["kind"] = "script"): SvgSource => ({
  key,
  url: `https://shop.example.com/${key}`,
  label: key,
  kind,
  text,
  requests: [`P1/${key}`],
})

describe("extractPaths", () => {
  test("markup, escaped markup, compiled JSX, JSON and setAttribute", () => {
    const text = [
      `<svg viewBox="0 0 48 48"><path fill="red" d="${cart}"/></svg>`,
      `html='<path d=\\"${circle}\\"/>'`,
      `e("path",{d:"${cart}"})`,
      `{"d":"${circle}"}`,
      `el.setAttribute("d", "${cart}")`,
      `const id="M12"; const width = 10`,
    ].join("\n")
    const paths = extractPaths(text, "a.js")
    expect(paths.map((p) => p.d)).toEqual([cart, circle, cart, circle, cart])
    expect(paths[0]!.viewBox).toEqual([0, 0, 48, 48])
  })

  test("SVG data URIs, URL-encoded and base64", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${cart}"/></svg>`
    const css = `.a{background:url("data:image/svg+xml,${encodeURIComponent(svg)}")}.b{background:url(data:image/svg+xml;base64,${btoa(svg)})}`
    expect(extractPaths(css, "a.css").map((p) => p.d)).toEqual([cart, cart])
  })

  test("only path data counts", () => {
    expect(isPathData("M0 0h24v24H0z")).toBe(true)
    expect(isPathData("Mozilla/5.0")).toBe(false)
    expect(isPathData("MLZ")).toBe(false)
  })
})

describe("pathStats", () => {
  test("decimals, extent from the points and command kinds", () => {
    const s = pathStats(cart)
    expect(s.decimals).toBe(6)
    expect(s.extent).toBe(15)
    expect(s.precision).toBe(2)
    expect(s.absolute).toBe(3)
    expect(s.relative).toBe(0)
    expect(s.rounded).toBe("M 3 4 L 5.25 4 L 7.5 15 L 18 15")
  })

  test("relative commands move the pen", () => {
    expect(pathStats("m100 100 l500 0 v400 z").extent).toBe(500)
  })

  test("a viewBox decides the size", () => {
    expect(pathStats(cart, [0, 0, 1024, 1024]).precision).toBe(0)
  })

  test.each([
    [0.5, 3],
    [1, 3],
    [24, 2],
    [100, 1],
    [512, 1],
    [1000, 0],
    [0, 2],
  ])("precisionFor(%d) = %d", (extent, want) => expect(precisionFor(extent)).toBe(want))

  test("roundPath leaves integers and drops negative zeros", () => {
    expect(roundPath("M10 -0.0001L1.23456e2 .5", 2)).toBe("M10 0L123.46 .5")
  })
})

test("svgSources keeps the latest body per URL, decodes base64 and joins a page's inline SVGs", () => {
  const sources = svgSources(
    [
      {
        key: "P1/1",
        id: "1",
        start: 1,
        method: "GET",
        url: "https://a.example/app.js",
        resourceType: "Script",
        body: "old d:1",
      },
      {
        key: "P1/2",
        id: "2",
        start: 2,
        method: "GET",
        url: "https://a.example/app.js",
        resourceType: "Script",
        body: `x={d:"${cart}"}`,
      },
      {
        key: "P1/3",
        id: "3",
        start: 3,
        method: "GET",
        url: "https://a.example/i.svg",
        resourceType: "Image",
        mimeType: "image/svg+xml",
        body: btoa(`<svg><path d="${circle}"/></svg>`),
        bodyBase64: true,
      },
      {
        key: "P1/4",
        id: "4",
        start: 4,
        method: "GET",
        url: "https://a.example/p.png",
        resourceType: "Image",
        body: "AAAA",
        bodyBase64: true,
      },
    ],
    [{ target: "P1", url: "https://a.example/", svgs: [`<svg><path d="${cart}"/></svg>`] }],
  )
  expect(sources.map((s) => [s.label, s.kind, s.requests])).toEqual([
    ["app.js", "script", ["P1/1", "P1/2"]],
    ["i.svg", "svg", ["P1/3"]],
    ["Inline SVG · a.example", "dom", []],
  ])
})

const many = (d: string, n: number) => Array.from({ length: n }, () => `e("path",{d:"${d}"})`).join(";")

describe("analyzeSvg", () => {
  test("excess precision per file and paths shipped more than once", () => {
    const report = analyzeSvg([
      source("vendor.js", many(circle, 4)),
      source("icons.svg", `<path d="${circle}"/>`, "svg"),
    ])
    expect(report.findings.map((f) => f.id)).toEqual(["precision:vendor.js", "duplicate"])
    const dup = report.findings.find((f) => f.rule === "duplicate")!
    expect(dup.saving).toBe(circle.length * 4)
    expect(dup.title).toContain("1 path is shipped more than once")
    expect(report.summary.paths).toBe(5)
    expect(report.summary.optimized).toBe(false)
  })

  test("inline SVGs only count paths no file brought", () => {
    const report = analyzeSvg([
      source("app.js", `{d:"${cart}"}`),
      source("dom:P1", `<svg><path d="${cart}"/><path d="${circle}"/></svg>`, "dom"),
    ])
    const dom = report.sources.find((s) => s.source.kind === "dom")!
    expect(dom.paths.map((p) => p.d)).toEqual([circle])
    expect(report.findings.find((f) => f.rule === "duplicate")).toBeUndefined()
  })

  test("svgo's shorter commands come on top of rounding", async () => {
    const sources = [source("vendor.js", many(circle, 30) + many(cart, 30))]
    const first = analyzeSvg(sources)
    const optimized = await optimizePaths(first.sources.flatMap((s) => s.paths))
    expect(optimized.get(`2:${cart}`)).toBe("M3 4h2.25L7.5 15H18")
    const report = analyzeSvg(sources, optimized)
    const enc = report.findings.find((f) => f.rule === "encoding")!
    expect(enc.saving).toBe(report.sources[0]!.encodingSaving)
    expect(enc.saving).toBeGreaterThan(0)
    expect(report.summary.optimized).toBe(true)
  })
})

test("svgSources keeps each frame's inline SVGs apart", () => {
  const svg = `<svg><path d="${cart}"/></svg>`
  const sources = svgSources(
    [],
    [
      { target: "P1", url: "https://a.example/", svgs: [svg] },
      { target: "P1", frame: "CHILD", url: "https://pay.example.net/", svgs: [svg] },
    ],
  )
  expect(sources.map((s) => [s.key, s.label])).toEqual([
    ["dom:P1", "Inline SVG · a.example"],
    ["dom:P1/CHILD", "Inline SVG · pay.example.net"],
  ])
})
