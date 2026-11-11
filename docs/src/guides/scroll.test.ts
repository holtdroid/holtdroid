import { describe, expect, test } from "bun:test"
import { clip, reveal } from "./scroll"

const view = { top: 100, left: 0, bottom: 600, right: 700 }
const max = { top: 900, left: 0 }

describe("reveal", () => {
  test.each([
    ["a visible target keeps the scroll", { top: 300, bottom: 360 }, 40, 40],
    ["a target below the fold scrolls it to a third of the view", { top: 900, bottom: 980 }, 0, 660],
    ["a target above the view scrolls back up", { top: 20, bottom: 80 }, 400, 173],
    ["a target touching the bottom edge scrolls", { top: 540, bottom: 596 }, 0, 292],
    ["never scrolls past the end", { top: 1500, bottom: 1560 }, 0, 900],
    ["never scrolls before the start", { top: 60, bottom: 90 }, 10, 0],
    ["a target taller than the view lines up its top", { top: 800, bottom: 1500 }, 0, 692],
  ])("%s", (_, y, scroll, want) => {
    const target = { ...y, left: 20, right: 200 }
    expect(reveal(target, view, { top: scroll, left: 0 }, max).top).toBe(want)
  })

  test("scrolls a horizontal strip to a target past its right edge", () => {
    const strip = { top: 0, left: 0, bottom: 36, right: 400 }
    const tab = { top: 0, left: 450, bottom: 36, right: 530 }
    expect(reveal(tab, strip, { top: 0, left: 0 }, { top: 0, left: 500 })).toEqual({ top: 0, left: 343 })
  })
})

describe("clip", () => {
  test("keeps the visible part of a target", () => {
    expect(clip({ top: 550, left: 10, bottom: 650, right: 90 }, view)).toEqual({
      top: 550,
      left: 10,
      bottom: 600,
      right: 90,
    })
  })

  test("drops a target scrolled out of view", () => {
    expect(clip({ top: 640, left: 10, bottom: 700, right: 90 }, view)).toBeNull()
  })
})
