import { describe, expect, test } from "bun:test"
import { sceneLayout } from "@/lib/recording/scene"

const epochs = (...sizes: [number, number][]) => ({
  epochs: sizes.map(([width, height]) => ({ init: "i", codec: "", width, height, segments: [] })),
})

describe("sceneLayout", () => {
  test("a phone held upright renders at 1560×1296, 20% above 1080p in height", () => {
    const l = sceneLayout(epochs([720, 1600]))
    expect([l.width, l.height]).toEqual([1560, 1296])
    expect(l.areaW).toBe(616)
  })

  test("a phone that turned sideways gets a wide middle column", () => {
    const l = sceneLayout(epochs([720, 1600], [1600, 720]))
    expect(l.areaW).toBe(1360)
    expect([l.width, l.height]).toEqual([2452, 1296])
  })

  test("a tablet in portrait widens it a little", () => {
    const l = sceneLayout(epochs([1200, 1600]))
    expect(l.areaW).toBe(749)
    expect(l.width).toBe(1720)
  })

  test("sizes stay even so every encoder takes them", () => {
    for (const sizes of [
      [500, 1111],
      [999, 777],
      [1600, 720],
    ] as [number, number][]) {
      const l = sceneLayout(epochs(sizes))
      expect(l.width % 2).toBe(0)
      expect(l.height % 2).toBe(0)
    }
  })

  test("an empty recording still has a layout", () => {
    expect(sceneLayout(epochs()).width).toBe(1560)
  })
})
