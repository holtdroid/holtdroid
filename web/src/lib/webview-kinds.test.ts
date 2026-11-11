import { describe, expect, test } from "bun:test"
import { defaultWebView, kindBlurb, kindLabel, newestStable, visibleBuilds, webviewKinds } from "@/lib/webview-kinds"

const chrome = "com.google.android.webview"
const chromium = "com.android.webview"
const build = (id: string, pkg: string, channels: string[] = []) => ({ id, package: pkg, channels })

const builds = [
  build("chromium-158", chromium, ["stable"]),
  build("chrome-158", chrome),
  build("chrome-157", chrome, ["stable"]),
  build("chromium-157", chromium),
]

describe("webviewKinds", () => {
  test("puts the preferred kind first and groups its builds", () => {
    const kinds = webviewKinds(builds, chrome)
    expect(kinds.map((k) => k.label)).toEqual(["Chrome WebView", "Chromium WebView"])
    expect(kinds[0]?.builds.map((b) => b.id)).toEqual(["chrome-158", "chrome-157"])
  })

  test("names an unknown package after itself", () => {
    expect(kindLabel("org.example.webview")).toBe("org.example.webview")
  })
})

describe("defaultWebView", () => {
  test("takes the newest stable build of the preferred kind", () => {
    expect(defaultWebView(builds, chrome)?.id).toBe("chrome-157")
    expect(defaultWebView(builds, chromium)?.id).toBe("chromium-158")
  })

  test("falls back to the other kinds when the preferred one has no builds", () => {
    expect(defaultWebView(builds.slice(0, 1), chrome)?.id).toBe("chromium-158")
  })

  test("is empty without builds", () => {
    expect(defaultWebView([], chrome)).toBeUndefined()
  })
})

describe("newestStable", () => {
  test("falls back to the newest build when none is on Stable", () => {
    expect(newestStable([build("a", chrome), build("b", chrome)])?.id).toBe("a")
  })
})

describe("visibleBuilds", () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `v${i}` }))
  test("shows everything when only one would be hidden", () => {
    expect(visibleBuilds(many.slice(0, 5), "v0", 4).length).toBe(5)
  })
  test("shows the newest ones", () => {
    expect(visibleBuilds(many, "v1", 4).map((b) => b.id)).toEqual(["v0", "v1", "v2", "v3"])
  })
  test("keeps an older selected build visible", () => {
    expect(visibleBuilds(many, "v6", 4).map((b) => b.id)).toEqual(["v0", "v1", "v2", "v6"])
  })
  test("describes the kinds", () => {
    expect(kindBlurb(chrome)).toBe("With H.264 and AAC")
    expect(kindBlurb("x")).toBe("")
  })
})
