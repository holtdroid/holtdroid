import { describe, expect, test } from "bun:test"
import type { RecordingEvent } from "@/api/client"
import { TouchTrack } from "@/lib/recording/touches"

const touch = (t: number, action: "down" | "move" | "up", x: number, y: number, pointer = 1) =>
  ({ t, type: "touch", touch: { action, pointer, x, y } }) as RecordingEvent

describe("TouchTrack", () => {
  const track = new TouchTrack([
    touch(1000, "down", 0.5, 0.8),
    touch(1100, "move", 0.5, 0.6),
    touch(1200, "move", 0.5, 0.4),
    touch(1250, "up", 0.5, 0.3),
    touch(5000, "down", 0.2, 0.2),
    { t: 6000, type: "key", key: "back" },
  ])

  test("nothing is shown before the first touch", () => {
    expect(track.at(500).touches).toEqual([])
  })

  test("a finger moving up the screen leaves a trail", () => {
    const o = track.at(1150)
    expect(o.touches).toHaveLength(1)
    expect(o.touches[0]).toMatchObject({ x: 0.5, y: 0.6, age: 0, held: 150 })
    expect(o.touches[0]?.trail.map((p) => p.y)).toEqual([0.8, 0.6])
  })

  test("a lifted finger fades and then goes", () => {
    expect(track.at(1400).touches[0]).toMatchObject({ y: 0.3, age: 150 })
    expect(track.at(2000).touches).toEqual([])
  })

  test("a finger that never lifts stays for a second after its last sign", () => {
    expect(track.at(5600).touches[0]).toMatchObject({ x: 0.2, held: 600, age: 0 })
    expect(track.at(6500).touches).toEqual([])
  })

  test("a navigation key is shown for under a second", () => {
    expect(track.at(6300).key).toEqual({ name: "Back", age: 300 })
    expect(track.at(7000).key).toBeUndefined()
    expect(track.at(5900).key).toBeUndefined()
  })
})
