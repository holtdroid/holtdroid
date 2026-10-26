import { describe, expect, test } from "bun:test"
import type { DeviceState, Metrics, StatusEvent } from "@/api/client"
import { summarize } from "@/lib/recording/summary"
import type { Snapshot } from "@/lib/recording/timeline"

const app = { title: "Shop", subtitle: "com.example.shop", version: "4.2.1" }

function input(snap: Partial<Snapshot>, t = 65_000) {
  return {
    t,
    duration: 120_000,
    startedAt: Date.UTC(2026, 0, 10, 12, 0, 0),
    snap: { history: [], ...snap },
    app,
  }
}

const device = {
  timeZone: "Europe/Warsaw",
  timeOffset: 3_600_000,
  wifi: true,
  mobileData: false,
  airplaneMode: false,
  batterySaver: true,
  darkMode: false,
  batteryLevel: 72,
  charging: false,
  screenWidth: 1080,
  screenHeight: 2400,
  density: 420,
  locale: "pl-PL",
  networkProfile: "edge",
  networkProfiles: [
    { id: "edge", name: "EDGE", description: "", scenario: false, rtt: 500, jitter: 150, down: 240, up: 200, loss: 2 },
  ],
} as unknown as DeviceState

describe("summarize", () => {
  test("clock follows the device's zone and shows how far it is from real time", () => {
    const s = summarize(input({ device }))
    expect(s.elapsed).toEqual({ now: "01:05", total: "02:00" })
    expect(s.clock.time).toBe("14:01")
    expect(s.clock.zone).toBe("Europe/Warsaw")
    expect(s.clock.offset).toBe("1 h ahead")
    expect(s.clock.offsetTone).toBe("warn")
  })

  test("throttling shows the profile's numbers and warns", () => {
    const s = summarize(input({ device }))
    const row = s.network.find((r) => r.label === "Throttling")
    expect(row?.tone).toBe("warn")
    expect(row?.value).toContain("EDGE")
    expect(row?.value).toContain("+500±150 ms")
    expect(row?.value).toContain("↓ 240 kbit/s")
    expect(row?.value).toContain("2% loss")
    expect(s.tiles.find((t) => t.id === "saver")?.on).toBe(true)
    expect(s.battery).toEqual({ level: 72, charging: false, saver: true })
  })

  test("a region shows what each path adds", () => {
    const s = summarize(
      input({
        device: {
          ...device,
          networkRegion: {
            region: "bd",
            server: "frankfurt",
            paths: [
              { class: "edge", target: 30, baseline: 20, added: 10 },
              { class: "origin", target: 170, added: 170 },
            ],
          },
          networkServers: [{ id: "frankfurt", name: "Frankfurt" }],
        },
      }),
    )
    const row = s.network.find((r) => r.label === "Region")
    expect(row?.value).toBe("bd · CDN +10 ms · Frankfurt +170 ms")
  })

  test("resources and the app's state", () => {
    const metrics = {
      device: { cpu: 40, memoryUsed: 2 * 2 ** 30, memoryTotal: 4 * 2 ** 30, rxRate: 2048, txRate: 0 },
      app: {
        processes: [
          { pid: 1, name: "a", cpu: 10, memory: 2 ** 20 },
          { pid: 2, name: "b", cpu: 5, memory: 2 ** 20 },
        ],
        fps: 58,
        jank: 3,
      },
      thermal: [{ source: "device", type: "cpu", name: "cpu0", celsius: 72 }],
    } as unknown as Metrics
    const status = { state: "ready", appRunning: true } as StatusEvent
    const s = summarize(input({ device, metrics, status, history: [{ t: 64_000, v: metrics }] }))
    expect(s.app.state).toBe("Running")
    expect(s.resources.map((b) => b.label)).toEqual(["CPU", "Memory", "App", "Frames", "Temperature"])
    expect(s.resources[2]?.value).toBe("15%")
    expect(s.resources[2]?.detail).toBe("2.0 MB PSS")
    expect(s.resources[1]?.fraction).toBe(0.5)
    expect(s.resources[4]?.tone).toBe("bad")
    expect(s.resources[4]?.wide).toBe(true)
  })

  test("without telemetry nothing breaks", () => {
    const s = summarize(input({}, 0))
    expect(s.tiles).toEqual([])
    expect(s.battery).toBeNull()
    expect(s.network[0]?.value).toBe("—")
  })
})
