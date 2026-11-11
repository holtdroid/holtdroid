import { describe, expect, test } from "bun:test"
import type { ProviderView, SessionView } from "@/api/client"
import { capacityTicks, countTones } from "@/lib/capacity"

const now = Date.parse("2026-11-11T12:00:00Z")
const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString()

const provider = {
  name: "emulator",
  capabilities: { kind: "emulator", display: "scrcpy", devtools: true, clipboard: true, locations: [], abis: [] },
  capacity: {
    slots: [
      { id: "a", label: "A", state: "busy" },
      { id: "b", label: "B", state: "busy" },
      { id: "c", label: "C", state: "busy" },
      { id: "d", label: "D", state: "busy" },
      { id: "e", label: "E", state: "free" },
      { id: "f", label: "F", state: "maintenance" },
      { id: "g", label: "G", state: "offline" },
    ],
  },
} as ProviderView

const session = (slot: string, state: SessionView["state"], idleMinutes = 20) =>
  ({
    provider: "emulator",
    id: slot,
    slot,
    state,
    idleDeadline: at(idleMinutes),
    ttlDeadline: at(300),
  }) as SessionView

describe("capacityTicks", () => {
  const ticks = capacityTicks(
    provider,
    [
      session("a", "ready"),
      session("b", "booting"),
      session("c", "ready", 2),
      { ...session("x", "ready"), provider: "other" },
    ],
    now,
  )

  test("colours each slot by its session", () => {
    expect(ticks.map((t) => t.tone)).toEqual(["running", "starting", "idle", "running", "free", "held", "offline"])
    expect(ticks[0]?.session?.id).toBe("a")
    expect(ticks[3]?.session).toBeUndefined()
  })

  test("counts the tones in legend order", () => {
    expect(countTones(ticks).map((t) => [t.label, t.count])).toEqual([
      ["Running", 2],
      ["Starting", 1],
      ["Idle", 1],
      ["On hold", 1],
      ["Offline", 1],
      ["Free", 1],
    ])
  })
})
