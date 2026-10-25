import { describe, expect, test } from "bun:test"
import type { RecordingEvent, RecordingManifest } from "@/api/client"
import { clock, parseLogcat, segmentAt, segmentsOf, Telemetry } from "@/lib/recording/timeline"

describe("parseLogcat", () => {
  test("recording time and threadtime fields", () => {
    const lines = parseLogcat(
      "00:01:02.345  10-25 12:00:05.000  1234  1240 E chromium: Uncaught TypeError\n" +
        "01:00:00.000  -- 3 lines dropped --\n",
    )
    expect(lines[0]).toMatchObject({
      t: 62_345,
      pid: "1234",
      level: "E",
      tag: "chromium",
      message: "Uncaught TypeError",
    })
    expect(lines[1]).toMatchObject({ t: 3_600_000, level: "I", message: "-- 3 lines dropped --" })
  })
})

describe("segments", () => {
  const manifest = {
    epochs: [
      {
        init: "init-0.mp4",
        codec: "avc1.42c01e",
        width: 360,
        height: 640,
        segments: [{ file: "seg-1.m4s", start: 0, duration: 2000, size: 1 }],
      },
      {
        init: "init-1.mp4",
        codec: "avc1.42c01e",
        width: 640,
        height: 360,
        segments: [
          { file: "seg-2.m4s", start: 3000, duration: 2000, size: 1 },
          { file: "seg-3.m4s", start: 5000, duration: 2000, size: 1 },
        ],
      },
    ],
  } as RecordingManifest

  test("flattens epochs in time order and finds the segment at a time", () => {
    const segs = segmentsOf(manifest)
    expect(segs.map((s) => [s.file, s.init])).toEqual([
      ["seg-1.m4s", "init-0.mp4"],
      ["seg-2.m4s", "init-1.mp4"],
      ["seg-3.m4s", "init-1.mp4"],
    ])
    expect(segmentAt(segs, -1)).toBe(-1)
    expect(segmentAt(segs, 2500)).toBe(0)
    expect(segmentAt(segs, 5000)).toBe(2)
    expect(segmentAt(segs, 99_000)).toBe(2)
  })
})

const metrics = (t: number, cpu: number) =>
  ({ t, type: "metrics", metrics: { device: { cpu } } }) as unknown as RecordingEvent

describe("Telemetry", () => {
  test("state at a time and the metrics before it", () => {
    const events: RecordingEvent[] = [
      { t: 0, type: "info", info: { model: "Pixel" } },
      { t: 0, type: "network", network: { location: "pl" } },
      metrics(2000, 10),
      metrics(4000, 20),
      { t: 5000, type: "network", network: { location: "ua" } },
      metrics(70_000, 30),
    ]
    const tel = new Telemetry(events)
    expect(tel.at(4500).network?.location).toBe("pl")
    expect(tel.at(5000).network?.location).toBe("ua")
    expect(tel.at(4500).metrics?.device.cpu).toBe(20)
    expect(tel.at(4500).history.map((h) => h.t)).toEqual([2000, 4000])
    expect(tel.at(70_000).history.map((h) => h.t)).toEqual([70_000])
    expect(tel.at(1000).info?.model).toBe("Pixel")
  })
})

test("clock", () => {
  expect(clock(65_432)).toBe("01:05")
  expect(clock(3_725_004, true)).toBe("1:02:05.004")
})
