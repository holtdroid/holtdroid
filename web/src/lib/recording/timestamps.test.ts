import { describe, expect, test } from "bun:test"
import { detectStamp, formatSpan, relative } from "@/lib/recording/timestamps"

const ref = Date.UTC(2026, 9, 26, 12, 0, 0)

describe("detectStamp", () => {
  test.each([
    [1793016000, "expiresAt", "s", 1793016000_000],
    [1793016000.25, undefined, "s", 1793016000_250],
    [1793016000123, undefined, "ms", 1793016000123],
    [1793016000123456, undefined, "µs", 1793016000123.456],
    ["1793016000123456789", undefined, "ns", 1793016000123.4568],
    ["2026-10-26T12:00:00.123456Z", undefined, "iso", Date.UTC(2026, 9, 26, 12, 0, 0, 123)],
    ["2026-10-26T15:00:00+03:00", undefined, "iso", Date.UTC(2026, 9, 26, 12)],
    ["2026-10-26", undefined, "date", Date.UTC(2026, 9, 26)],
    ["Mon, 26 Oct 2026 12:00:00 GMT", undefined, "http", Date.UTC(2026, 9, 26, 12)],
  ] as const)("%p is %s", (value, key, unit, ms) => {
    const s = detectStamp(value, key, ref)
    expect(s?.unit).toBe(unit)
    expect(s!.ms).toBeCloseTo(ms, 1)
  })

  test("seconds far from the moment need a key that names a time", () => {
    expect(detectStamp(1234567890, "id", ref)).toBeNull()
    expect(detectStamp(1234567890, "created_at", ref)?.unit).toBe("s")
    expect(detectStamp(1234567890, "lastSeenTime", ref)?.unit).toBe("s")
  })

  test("other numbers and strings are no times", () => {
    for (const v of [42, 3.14, -1793016000, 1e20, "hello world", "1234", "2026-13-45x", true, null]) {
      expect(detectStamp(v, "value", ref)).toBeNull()
    }
  })

  test("a time without a zone says so", () => {
    expect(detectStamp("2026-10-26 12:00:00", undefined, ref)?.zoneless).toBe(true)
  })
})

test("spans and relative times", () => {
  expect(formatSpan(180)).toBe("180 ms")
  expect(formatSpan(-4200)).toBe("4.2 s")
  expect(formatSpan(3 * 3_600_000 + 12 * 60_000 + 5000)).toBe("3 h 12 min")
  expect(formatSpan(86_400_000 + 5000)).toBe("1 d")
  expect(relative(ref - 3200, ref)).toBe("3.2 s ago")
  expect(relative(ref + 3_600_000, ref)).toBe("in 1 h")
  expect(relative(ref + 400, ref)).toBe("now")
})
