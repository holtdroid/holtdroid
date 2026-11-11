import { describe, expect, test } from "bun:test"
import type { Display } from "@/api/client"
import { cutoutName, screenFacts, screenMatches, screenName, shortlist } from "@/lib/screens"

const pixel: Display = {
  id: "pixel",
  brand: "Google",
  label: "Pixel 7a",
  like: "Pixel 8",
  width: 1080,
  height: 2400,
  dpi: 420,
  shape: { kind: "circle", top: 11, width: 24 },
}
const galaxy: Display = {
  id: "a05",
  brand: "Samsung",
  label: "Galaxy A05",
  width: 720,
  height: 1600,
  dpi: 320,
  shape: { kind: "drop", top: 0, width: 48, height: 24 },
}
const compact: Display = { id: "compact", label: "Compact 5″", width: 720, height: 1280, dpi: 320 }
const all = [pixel, galaxy, compact]
const ids = (ds: Display[]) => ds.map((d) => d.id)

describe("screens", () => {
  test("names and facts", () => {
    expect(screenName(pixel)).toBe("Google Pixel 7a")
    expect(screenName({ brand: "Google", label: "Google Pixel 7a" })).toBe("Google Pixel 7a")
    expect(screenName({ brand: "Samsung", label: "A05" })).toBe("Samsung A05")
    expect(screenFacts(pixel)).toBe("1080×2400 · 420 dpi · 411×914 dp")
    expect(cutoutName(galaxy)).toBe("Waterdrop")
    expect(cutoutName(compact)).toBe("No cutout")
    expect(cutoutName({ cutout: "hole" })).toBe("Punch hole")
  })

  test.each([
    ["notch", ["a05"]],
    ["hole", ["pixel"]],
    ["plain", ["compact"]],
    ["narrow", ["a05", "compact"]],
  ] as const)("filter %s", (filter, want) => {
    expect(ids(all.filter((d) => screenMatches(d, "", filter)))).toEqual([...want])
  })

  test("searches every word", () => {
    expect(ids(all.filter((d) => screenMatches(d, "720x1600")))).toEqual(["a05"])
    expect(ids(all.filter((d) => screenMatches(d, "google punch")))).toEqual(["pixel"])
  })

  test("shortlist puts favourites first and keeps the chosen screen", () => {
    expect(ids(shortlist(all, ["compact"], undefined, 2))).toEqual(["compact", "pixel"])
    expect(ids(shortlist(all, [], "compact", 2))).toEqual(["pixel", "compact"])
    expect(ids(shortlist(all, ["gone"], "pixel", 3))).toEqual(["pixel", "a05", "compact"])
  })
})
