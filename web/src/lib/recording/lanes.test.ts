import { describe, expect, test } from "bun:test"
import type { DeviceState, StatusEvent } from "@/api/client"
import {
  appLane,
  flatten,
  issuesOf,
  networkLane,
  nextAfter,
  scanCrashes,
  screenLane,
  screenStates,
  thin,
} from "@/lib/recording/lanes"
import { DevToolsLog } from "@/lib/recording/devtools"
import { parseLogcat, type Segment } from "@/lib/recording/timeline"

const seg = (start: number, duration: number, width: number, height: number): Segment => ({
  start,
  duration,
  width,
  height,
  file: `s${start}`,
  init: "i",
  key: true,
  size: 1,
})

const status = (appRunning: boolean, state: StatusEvent["state"] = "ready") => ({ appRunning, state }) as StatusEvent

describe("flatten", () => {
  test("the first layer wins and equal neighbours merge", () => {
    const out = flatten(10, [
      [{ start: 2, end: 4, kind: "off", label: "Off" }],
      [
        { start: 0, end: 5, kind: "portrait", label: "Portrait" },
        { start: 5, end: 10, kind: "portrait", label: "Portrait" },
      ],
    ])
    expect(out).toEqual([
      { start: 0, end: 2, kind: "portrait", label: "Portrait" },
      { start: 2, end: 4, kind: "off", label: "Off" },
      { start: 4, end: 10, kind: "portrait", label: "Portrait" },
    ])
  })
})

describe("screenLane", () => {
  test("orientation from the video, gaps without video, and the recorded screen state", () => {
    const lane = screenLane(
      [seg(0, 2000, 720, 1600), seg(2000, 2000, 720, 1600), seg(4000, 2000, 1600, 720), seg(9000, 1000, 720, 1600)],
      [
        { t: 0, v: { on: true, locked: false } },
        { t: 1000, v: { on: false, locked: false } },
        { t: 1500, v: { on: true, locked: true } },
        { t: 1800, v: { on: true, locked: false } },
      ],
      [{ t: 3000, key: "screen-off" }],
      10_000,
    )
    expect(lane.map((s) => [s.kind, s.start, s.end])).toEqual([
      ["portrait", 0, 1000],
      ["off", 1000, 1500],
      ["locked", 1500, 1800],
      ["portrait", 1800, 4000],
      ["landscape", 4000, 6000],
      ["novideo", 6000, 9000],
      ["portrait", 9000, 10_000],
    ])
  })

  test("older recordings fall back to the portal's buttons", () => {
    expect(
      screenStates(
        [],
        [
          { t: 100, key: "screen-off" },
          { t: 300, key: "home" },
          { t: 500, key: "lock" },
          { t: 700, key: "unlock" },
        ],
        1000,
      ).map((s) => [s.kind, s.start, s.end]),
    ).toEqual([
      ["off", 100, 500],
      ["locked", 500, 700],
    ])
  })
})

describe("appLane", () => {
  test("starting, running, closed and reopened", () => {
    const lane = appLane(
      [
        { t: 0, v: status(false, "instrumenting") },
        { t: 100, v: status(true) },
        { t: 400, v: status(false) },
        { t: 600, v: status(true) },
      ],
      1000,
      "Shop",
    )
    expect(lane.map((s) => [s.label, s.start, s.end])).toEqual([
      ["Instrumenting", 0, 100],
      ["Shop", 100, 400],
      ["Closed", 400, 600],
      ["Shop · reopened", 600, 1000],
    ])
  })
})

const d = (over: Partial<DeviceState>) =>
  ({
    wifi: true,
    mobileData: true,
    airplaneMode: false,
    networkProfile: "full",
    networkProfiles: [
      { id: "full", name: "Full speed" },
      { id: "3g", name: "3G" },
    ],
    ...over,
  }) as DeviceState

describe("networkLane", () => {
  test("profiles, regions and the VPN exit", () => {
    const lane = networkLane(
      [
        { t: 0, v: d({}) },
        { t: 200, v: d({ networkProfile: "3g" }) },
        { t: 500, v: d({ airplaneMode: true }) },
        { t: 700, v: d({}) },
      ],
      [{ t: 0, v: { location: "kz", country: "kz" } }],
      1000,
    )
    expect(lane.map((s) => [s.kind, s.label, s.start, s.end])).toEqual([
      ["normal", "No emulation · KZ", 0, 200],
      ["throttled", "3G · KZ", 200, 500],
      ["offline", "Airplane mode · KZ", 500, 700],
      ["normal", "No emulation · KZ", 700, 1000],
    ])
  })
})

describe("scanCrashes", () => {
  test("the app's Java crashes and ANRs, not other apps'", () => {
    const lines = parseLogcat(
      [
        "00:00:01.000  11-10 10:00:01.000  100  100 E AndroidRuntime: FATAL EXCEPTION: main",
        "00:00:01.001  11-10 10:00:01.001  100  100 E AndroidRuntime: Process: com.other, PID: 100",
        "00:00:01.002  11-10 10:00:01.002  100  100 E AndroidRuntime: java.lang.IllegalStateException: no",
        "00:00:02.000  11-10 10:00:02.000  200  200 E AndroidRuntime: FATAL EXCEPTION: main",
        "00:00:02.001  11-10 10:00:02.001  200  200 E AndroidRuntime: Process: com.shop, PID: 200",
        "00:00:02.002  11-10 10:00:02.002  200  200 E AndroidRuntime: java.lang.NullPointerException: cart",
        "00:00:05.000  11-10 10:00:05.000  300  310 E ActivityManager: ANR in com.shop (com.shop/.Main)",
        "00:00:05.001  11-10 10:00:05.001  300  310 E ActivityManager: Reason: Input dispatching timed out",
      ].join("\n"),
    )
    expect(scanCrashes(lines, "com.shop")).toEqual([
      { t: 2000, kind: "crash", title: "App crashed", detail: "java.lang.NullPointerException: cart" },
      { t: 5000, kind: "anr", title: "App not responding", detail: "Input dispatching timed out" },
    ])
  })
})

describe("issuesOf", () => {
  test("failed requests, console errors, crashes and closes in time order", () => {
    const log = new DevToolsLog([
      {
        t: 500,
        type: "request",
        target: "p",
        request: { id: "1", method: "POST", url: "https://api.example.com/pay?x=1", start: 500, end: 900, status: 500 },
      },
      {
        t: 100,
        type: "request",
        target: "p",
        request: { id: "2", method: "GET", url: "https://api.example.com/ok", start: 100, end: 200, status: 200 },
      },
      { t: 300, type: "console", target: "p", console: { level: "error", source: "console", text: "boom\nstack" } },
    ] as ConstructorParameters<typeof DevToolsLog>[0])
    const issues = issuesOf(
      log,
      [
        { t: 0, v: status(true) },
        { t: 2000, v: status(false) },
        { t: 3000, v: status(true) },
        { t: 7000, v: status(false) },
      ],
      [{ t: 6990, kind: "crash", title: "App crashed", detail: "NPE" }],
      10_000,
    )
    expect(issues.map((i) => [i.kind, i.t, i.level, i.title])).toEqual([
      ["console", 300, "error", "boom"],
      ["request", 500, "error", "POST /pay?x=1 → 500"],
      ["closed", 2000, "warning", "App closed"],
      ["crash", 6990, "error", "App crashed"],
    ])
  })
})

test("thin keeps one tick per bucket", () => {
  expect(thin([{ t: 0 }, { t: 1 }, { t: 500 }], 1000, 10).map((x) => x.t)).toEqual([0, 500])
})

test("nextAfter wraps around", () => {
  expect(nextAfter([1000, 5000], 1000)).toBe(5000)
  expect(nextAfter([1000, 5000], 6000)).toBe(1000)
})
