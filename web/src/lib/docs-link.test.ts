import { describe, expect, test } from "bun:test"
import { docsUrlWithReturn } from "./docs-link"

describe("docsUrlWithReturn", () => {
  test.each([
    ["https://holtdroid.example.com/", "https://holtdroid.github.io/#returnUrl=https%3A%2F%2Fholtdroid.example.com%2F"],
    [
      "https://holtdroid.example.com/session/emulator/7f3a?tab=logcat#x",
      "https://holtdroid.github.io/#returnUrl=https%3A%2F%2Fholtdroid.example.com%2Fsession%2Femulator%2F7f3a%3Ftab%3Dlogcat%23x",
    ],
  ])("%s", (from, want) => {
    expect(docsUrlWithReturn(from)).toBe(want)
  })
})
