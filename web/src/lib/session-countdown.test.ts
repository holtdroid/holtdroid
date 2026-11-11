import { describe, expect, test } from "bun:test"
import { countdown } from "./session-countdown"

const now = Date.parse("2026-11-11T12:00:00Z")
const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString()

describe("countdown", () => {
  test.each([
    [
      "idle stop first",
      { idleDeadline: at(12), ttlDeadline: at(120), lastActivity: at(-3), createdAt: at(-60) },
      { ms: 12 * 60_000, idle: true, segments: 4 },
    ],
    [
      "lifetime first",
      { idleDeadline: at(15), ttlDeadline: at(5), lastActivity: at(0), createdAt: at(-115) },
      { ms: 5 * 60_000, idle: false, segments: 1 },
    ],
    [
      "just touched",
      { idleDeadline: at(15), ttlDeadline: at(120), lastActivity: at(0), createdAt: at(-1) },
      { ms: 15 * 60_000, idle: true, segments: 5 },
    ],
    [
      "over",
      { idleDeadline: at(-1), ttlDeadline: at(120), lastActivity: at(-16), createdAt: at(-30) },
      { ms: 0, idle: true, segments: 0 },
    ],
  ])("%s", (_, s, want) => {
    expect(countdown(s, now)).toEqual(want)
  })
})
