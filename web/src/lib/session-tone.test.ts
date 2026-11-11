import { describe, expect, test } from "bun:test"
import { type SessionTone, sessionTone } from "./session-tone"

const now = Date.parse("2026-11-11T12:00:00Z")
const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString()

describe("sessionTone", () => {
  test.each<[string, Parameters<typeof sessionTone>[0], SessionTone]>([
    ["ready, far from idle stop", { state: "ready", idleDeadline: at(20), ttlDeadline: at(120) }, "ready"],
    ["ready, idle stop near", { state: "ready", idleDeadline: at(4), ttlDeadline: at(120) }, "idle"],
    ["ready, lifetime ends soon", { state: "ready", idleDeadline: at(20), ttlDeadline: at(2) }, "idle"],
    ["booting", { state: "booting", idleDeadline: at(1), ttlDeadline: at(1) }, "starting"],
    ["instrumenting", { state: "instrumenting", idleDeadline: at(20), ttlDeadline: at(120) }, "starting"],
    ["stopping", { state: "stopping", idleDeadline: at(20), ttlDeadline: at(120) }, "stopping"],
    ["failed", { state: "failed", idleDeadline: at(20), ttlDeadline: at(120) }, "failed"],
  ])("%s", (_, s, want) => {
    expect(sessionTone(s, now)).toBe(want)
  })
})
