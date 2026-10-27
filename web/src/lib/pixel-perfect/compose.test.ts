import { expect, test } from "bun:test"
import type { FigmaLayers } from "@/api/client"
import { componentFraction, hiddenFractions, needsComposite } from "./compose"

const layers: FigmaLayers = {
  width: 360,
  height: 800,
  layers: [],
  scale: 4,
  composable: true,
  background: "#ffffff",
  components: [
    { id: "1", name: "Status bar", type: "FRAME", layer: 0, x: 0, y: 0, w: 360, h: 24, url: "/1" },
    { id: "2", name: "Stream", type: "RECTANGLE", layer: 1, x: 0, y: 24, w: 360, h: 200, url: "/2", live: true },
    { id: "3", name: "Tab bar", type: "FRAME", layer: 2, x: -10, y: 728, w: 380, h: 80, url: "/3" },
  ],
}

test("only a composable frame with something hidden is redrawn", () => {
  expect(needsComposite(layers, [])).toBe(false)
  expect(needsComposite(layers, ["gone"])).toBe(false)
  expect(needsComposite(layers, ["2"])).toBe(true)
  expect(needsComposite({ ...layers, composable: false }, ["2"])).toBe(false)
  expect(needsComposite(null, ["2"])).toBe(false)
})

test("hidden components become fractions of the frame, clipped to it", () => {
  expect(hiddenFractions(layers, ["2"])).toEqual([{ x: 0, y: 0.03, w: 1, h: 0.25 }])
  const tab = componentFraction(layers, layers.components[2]!)
  expect([tab.x, tab.y, tab.w]).toEqual([0, 0.91, 1])
  expect(tab.h).toBeCloseTo(0.09)
})
