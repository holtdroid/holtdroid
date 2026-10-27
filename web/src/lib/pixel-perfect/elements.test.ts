import { expect, test } from "bun:test"
import type { FigmaLayer } from "@/api/client"
import { counterpart, matchRegion, measure, placeLayers, placeViews, viewLabel } from "./elements"

const node = (parent: number, resourceId: string, x: number, y: number, w: number, h: number) => ({
  parent,
  class: "android.widget.Button",
  resourceId,
  x,
  y,
  w,
  h,
})

test("native views are scaled to the analysed pixels, with their id path", () => {
  const views = placeViews(
    {
      rotation: 0,
      nodes: [
        node(-1, "", 0, 0, 1080, 2400),
        node(0, "com.example:id/card", 48, 600, 984, 360),
        node(1, "com.example:id/pay", 96, 780, 888, 144),
        node(0, "", 2000, 0, 100, 100),
      ],
    },
    2,
    { w: 540, h: 1200 },
  )
  expect(views.map((v) => [v.label, v.path, v.box])).toEqual([
    ["Button#card", "card", { x: 24, y: 300, w: 492, h: 180 }],
    ["Button#pay", "card › pay", { x: 48, y: 390, w: 444, h: 72 }],
  ])
  expect(viewLabel({ class: "androidx.compose.ui.platform.ComposeView", resourceId: "" })).toBe("ComposeView")
})

const layer = (name: string, parent: number, x: number, y: number, w: number, h: number): FigmaLayer => ({
  id: name,
  name,
  type: "FRAME",
  parent,
  x,
  y,
  w,
  h,
})

test("design layers follow the frame's placement and name their parents", () => {
  const placed = { x: 10, y: 20, w: 720, h: 1600 }
  const layers = placeLayers(
    {
      width: 360,
      height: 800,
      layers: [layer("Card", -1, 16, 100, 328, 120), layer("Pay", 0, 16, 160, 328, 48)],
      components: [],
      composable: false,
      scale: 1,
    },
    placed,
    { w: 740, h: 1620 },
  )
  expect(layers.map((l) => [l.path, l.box])).toEqual([
    ["Card", { x: 42, y: 220, w: 656, h: 240 }],
    ["Card › Pay", { x: 42, y: 340, w: 656, h: 96 }],
  ])
  expect(matchRegion({ x: 40, y: 338, w: 660, h: 100 }, layers)?.name).toBe("Pay")
})

test("a layer's counterpart must mostly overlap it, and measures are in design units", () => {
  const frame = { x: 0, y: 0, w: 720, h: 1600 }
  const design = { x: 32, y: 320, w: 656, h: 96 }
  const views = [{ box: { x: 0, y: 0, w: 720, h: 1600 } }, { box: { x: 40, y: 320, w: 640, h: 96 } }]
  expect(counterpart(design, views)).toBe(views[1]!)
  expect(counterpart({ x: 0, y: 1500, w: 50, h: 50 }, views)).toBeNull()
  expect(measure(design, views[1]!.box, frame, 2)).toEqual([
    { label: "left", design: 16, actual: 20 },
    { label: "width", design: 328, actual: 320 },
  ])
})
