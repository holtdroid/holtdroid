import { describe, expect, test } from "bun:test"
import type { DeviceState, NetworkProfileInfo } from "@/api/client"
import { bandwidth, devicePoll, hold, loop, position, quality, speed, stepName } from "./network-conditions"

const lte: NetworkProfileInfo = {
  id: "lte",
  name: "Typical 4G",
  description: "",
  scenario: false,
  rtt: 70,
  down: 10_000,
  up: 3_000,
  loss: 0.5,
}
const gprs: NetworkProfileInfo = {
  id: "gprs",
  name: "GPRS",
  description: "",
  scenario: false,
  rtt: 800,
  down: 50,
  up: 25,
  loss: 3,
}
const subway: NetworkProfileInfo = {
  id: "subway",
  name: "Subway",
  description: "",
  scenario: true,
  steps: [
    { profile: "lte", min: 20_000, max: 40_000 },
    { profile: "", min: 5_000, max: 20_000 },
  ],
}
const profiles = [{ id: "full", name: "No limits", description: "", scenario: false }, lte, gprs, subway]

describe("network conditions", () => {
  test("bandwidth", () => {
    expect(bandwidth(692_587)).toBe("693 Mbit/s")
    expect(bandwidth(1_250)).toBe("1.3 Mbit/s")
    expect(bandwidth(512.4)).toBe("512 kbit/s")
    expect(bandwidth()).toBe("∞")
  })
  test("hold and loop", () => {
    expect(hold({ profile: "lte", min: 20_000, max: 40_000 })).toBe("20–40 s")
    expect(hold({ profile: "", min: 3_000, max: 3_000 })).toBe("3 s")
    expect(hold({ profile: "", min: 500, max: 1_500 })).toBe("0.5–1.5 s")
    expect(loop(subway.steps ?? [])).toEqual({ min: 25_000, max: 60_000, mean: 42_500, text: "25–60 s" })
  })

  test("step names", () => {
    expect(stepName(profiles, { profile: "lte", min: 1, max: 1 })).toBe("Typical 4G")
    expect(stepName(profiles, { profile: "", min: 1, max: 1 })).toBe("Outage")
  })

  test("speed orders links", () => {
    expect(speed({})).toBe(1)
    expect(speed(lte)).toBeGreaterThan(speed(gprs))
    expect(quality(speed(lte))).toBe("good")
    expect(quality(speed(gprs))).toBe("poor")
  })

  test("device poll follows the scenario", () => {
    const now = Date.parse("2026-11-11T12:00:30Z")
    const s = {
      networkProfile: "subway",
      networkProfiles: profiles,
      networkStep: 0,
      networkStepSince: "2026-11-11T12:00:20Z",
    } as DeviceState
    expect(devicePoll(undefined, now)).toBe(30_000)
    expect(devicePoll(s, now)).toBe(10_000)
    expect(devicePoll({ ...s, networkStepSince: "2026-11-11T12:00:00Z" }, now)).toBe(2_000)
    expect(devicePoll({ ...s, networkProfile: "lte" }, now)).toBe(30_000)
  })

  test("position of a running scenario", () => {
    const now = Date.parse("2026-11-11T12:00:30Z")
    const s = {
      networkProfile: "subway",
      networkProfiles: profiles,
      networkStep: 1,
      networkStepSince: "2026-11-11T12:00:20Z",
    } as DeviceState
    expect(position(s, now)).toEqual({ step: 1, count: 2, elapsed: 10_000, progress: 0.5, next: 0 })
    expect(position({ ...s, networkProfile: "lte" }, now)).toBeNull()
    expect(position({ ...s, networkStep: undefined }, now)).toBeNull()
  })
})
