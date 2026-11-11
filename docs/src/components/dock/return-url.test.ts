import { describe, expect, test } from "bun:test"
import { maxLength, resolveReturnUrl, splitHash, storageKey, validReturnUrl } from "./return-url"

const docs = "https://holtdroid.github.io"

describe("validReturnUrl", () => {
  test.each([
    ["https://holtdroid.example.com/", "https://holtdroid.example.com/"],
    [
      "https://holtdroid.example.com/session/emulator/7f3a?tab=logcat#x",
      "https://holtdroid.example.com/session/emulator/7f3a?tab=logcat#x",
    ],
    ["http://localhost:8080/apps", "http://localhost:8080/apps"],
    ["HTTPS://Holtdroid.Example.com", "https://holtdroid.example.com/"],
  ])("accepts %s", (input, want) => {
    expect(validReturnUrl(input, docs)).toBe(want)
  })

  test.each([
    ["javascript", "javascript:alert(1)"],
    ["javascript with spaces", " javascript:alert(document.cookie)"],
    ["javascript with tab", "java\tscript:alert(1)"],
    ["data", "data:text/html,<script>alert(1)</script>"],
    ["vbscript", "vbscript:msgbox(1)"],
    ["file", "file:///etc/passwd"],
    ["blob", "blob:https://holtdroid.example.com/0b1c"],
    ["protocol-relative", "//evil.example.com/"],
    ["relative", "/session/1"],
    ["bare host", "holtdroid.example.com"],
    ["username", "https://user@holtdroid.example.com/"],
    ["credentials", "https://user:pass@holtdroid.example.com/"],
    ["password only", "https://:pass@holtdroid.example.com/"],
    ["same origin", "https://holtdroid.github.io/start/introduction/"],
    ["same origin with port", "https://holtdroid.github.io:443/"],
    ["still encoded javascript", "javascript%3Aalert(1)"],
    ["oversize", `https://holtdroid.example.com/${"a".repeat(maxLength)}`],
    ["empty", ""],
  ])("rejects %s", (_, input) => {
    expect(validReturnUrl(input, docs)).toBeNull()
  })

  test.each([null, undefined, 42, {}])("rejects non-string %p", (input) => {
    expect(validReturnUrl(input, docs)).toBeNull()
  })
})

describe("splitHash", () => {
  test.each([
    ["", null],
    ["#install", null],
    ["#returnUrl=https%3A%2F%2Fa.example.com%2F", { returnUrl: "https://a.example.com/", rest: "" }],
    [
      "#returnUrl=https%3A%2F%2Fa.example.com%2F%3Fx%3D1%26y%3D2",
      { returnUrl: "https://a.example.com/?x=1&y=2", rest: "" },
    ],
    ["#install&returnUrl=https%3A%2F%2Fa.example.com%2F", { returnUrl: "https://a.example.com/", rest: "install" }],
    ["#returnUrl=%E0%A4%A", { returnUrl: null, rest: "" }],
    ["#returnUrl=%256A%2561vascript%253Aalert(1)", { returnUrl: "%6A%61vascript%3Aalert(1)", rest: "" }],
  ])("%s", (hash, want) => {
    expect(splitHash(hash)).toEqual(want)
  })

  test("decodes once, so a double-encoded payload stays invalid", () => {
    const once = splitHash(`#returnUrl=${encodeURIComponent(encodeURIComponent("javascript:alert(1)"))}`)
    expect(validReturnUrl(once?.returnUrl, docs)).toBeNull()
  })

  test("an encoded javascript url is rejected after decoding", () => {
    const parsed = splitHash(`#returnUrl=${encodeURIComponent("javascript:alert(1)")}`)
    expect(parsed?.returnUrl).toBe("javascript:alert(1)")
    expect(validReturnUrl(parsed?.returnUrl, docs)).toBeNull()
  })

  test("a huge fragment is not decoded", () => {
    expect(splitHash(`#returnUrl=${"a".repeat(maxLength * 4)}`)?.returnUrl).toBeNull()
  })
})

function env(hash: string, stored: string | null = null, opts: { throws?: boolean } = {}) {
  const store = new Map<string, string>()
  if (stored !== null) store.set(storageKey, stored)
  const replaced: string[] = []
  const guard = () => {
    if (opts.throws) throw new Error("SecurityError")
  }
  return {
    store,
    replaced,
    env: {
      location: { hash, origin: docs, pathname: "/start/introduction/", search: "" },
      history: {
        state: null,
        replaceState: (_: unknown, __: string, url?: string | URL | null) => void replaced.push(String(url)),
      },
      sessionStorage: {
        getItem: (k: string) => (guard(), store.get(k) ?? null),
        setItem: (k: string, v: string) => (guard(), void store.set(k, v)),
        removeItem: (k: string) => (guard(), void store.delete(k)),
      },
    },
  }
}

describe("resolveReturnUrl", () => {
  test("stores a valid url from the fragment and strips it", () => {
    const e = env(`#returnUrl=${encodeURIComponent("https://holtdroid.example.com/apps")}`)
    expect(resolveReturnUrl(e.env)).toBe("https://holtdroid.example.com/apps")
    expect(e.store.get(storageKey)).toBe("https://holtdroid.example.com/apps")
    expect(e.replaced).toEqual(["/start/introduction/"])
  })

  test("keeps the rest of the fragment", () => {
    const e = env(`#install&returnUrl=${encodeURIComponent("https://holtdroid.example.com/")}`)
    resolveReturnUrl(e.env)
    expect(e.replaced).toEqual(["/start/introduction/#install"])
  })

  test("strips an invalid url without storing it and falls back to the stored one", () => {
    const e = env(`#returnUrl=${encodeURIComponent("javascript:alert(1)")}`, "https://holtdroid.example.com/")
    expect(resolveReturnUrl(e.env)).toBe("https://holtdroid.example.com/")
    expect(e.replaced).toEqual(["/start/introduction/"])
  })

  test("reads the stored url when there is no fragment", () => {
    const e = env("#install", "https://holtdroid.example.com/")
    expect(resolveReturnUrl(e.env)).toBe("https://holtdroid.example.com/")
    expect(e.replaced).toEqual([])
  })

  test("validates the stored url again and drops a bad one", () => {
    const e = env("", "javascript:alert(1)")
    expect(resolveReturnUrl(e.env)).toBeNull()
    expect(e.store.has(storageKey)).toBe(false)
  })

  test("works without storage", () => {
    const e = env(`#returnUrl=${encodeURIComponent("https://holtdroid.example.com/")}`, null, { throws: true })
    expect(resolveReturnUrl(e.env)).toBe("https://holtdroid.example.com/")
    expect(resolveReturnUrl(env("", null, { throws: true }).env)).toBeNull()
  })
})
