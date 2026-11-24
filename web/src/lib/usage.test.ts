import { describe, expect, test } from "bun:test"
import { summarize, type UsageSession } from "@/lib/usage"

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString()

const items: UsageSession[] = [
  {
    provider: "fake",
    id: "a",
    start: at(2, 10),
    end: at(2, 10, 4),
    ended: "stopped",
    actor: "u1",
    actorName: "Ada",
    package: "com.example.one",
  },
  {
    provider: "fake",
    id: "b",
    start: at(2, 11),
    end: at(2, 12),
    ended: "idle",
    actor: "u2",
    artifact: "slack/two.apk@0123abcd",
  },
  { provider: "fake", id: "c", start: at(4, 9), end: at(4, 12), ended: "ttl", actor: "u1", actorName: "Ada" },
  { provider: "fake", id: "d", start: at(4, 9, 30), actor: "u1", actorName: "Ada", package: "com.example.one" },
]

describe("summarize", () => {
  const since = new Date(2026, 10, 1).getTime()
  const until = new Date(2026, 10, 7, 23).getTime()
  const u = summarize(items, since, until)

  test("totals and quantiles cover ended sessions only", () => {
    expect(u.launches).toBe(4)
    expect(u.people).toBe(2)
    expect(u.seconds).toBe(240 + 3600 + 3 * 3600)
    expect(u.median).toBe(3600)
    expect(u.p90).toBe(3 * 3600)
    expect(u.ended).toEqual({ stopped: 1, idle: 1, ttl: 1, reaped: 0, open: 1 })
    expect(u.durations.map((d) => d.count)).toEqual([1, 0, 0, 0, 1, 1])
  })

  test("daily buckets span the range in local time", () => {
    expect(u.unit).toBe("day")
    expect(u.buckets).toHaveLength(7)
    expect(u.buckets.map((b) => b.launches)).toEqual([0, 2, 0, 2, 0, 0, 0])
    expect(u.buckets[1]?.people).toBe(2)
    expect(u.buckets[3]?.people).toBe(1)
  })

  test("heatmap rows start on Monday", () => {
    expect(u.heatmap[0]?.[10]).toBe(1)
    expect(u.heatmap[2]?.[9]).toBe(2)
  })

  test("rankings use names, packages and artifacts without revisions", () => {
    expect(u.topPeople.map((p) => [p.label, p.launches, p.named])).toEqual([
      ["Ada", 3, true],
      ["u2", 1, false],
    ])
    expect(u.topApps.map((a) => [a.label, a.launches])).toEqual([
      ["com.example.one", 2],
      ["unknown", 1],
      ["slack/two.apk", 1],
    ])
  })

  test("long ranges group by week", () => {
    expect(summarize([], since - 90 * 86_400_000, until).unit).toBe("week")
  })
})
