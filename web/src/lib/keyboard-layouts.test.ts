import { describe, expect, test } from "bun:test"
import { desiredLocales, guessLayout, sameLocales } from "./keyboard-layouts"

const layout = (keys: Record<string, string>) => ({ get: (code: string) => keys[code] })

describe("guessLayout", () => {
  test.each([
    [{ KeyQ: "q", KeyY: "y", BracketLeft: "[" }, null],
    [{ KeyQ: "й", KeyS: "ы" }, "ru-RU"],
    [{ KeyQ: "й", KeyS: "і" }, "uk-UA"],
    [{ KeyQ: "й", KeyS: "ы", Digit2: "ә" }, "kk-KZ"],
    [{ KeyQ: "a", KeyW: "z" }, "fr-FR"],
    [{ KeyQ: "q", KeyY: "z", BracketLeft: "ü" }, "de-DE"],
    [{ KeyQ: "q", Semicolon: "ł" }, "pl-PL"],
  ])("%o → %p", (keys, want) => {
    expect(guessLayout(layout(keys))).toBe(want)
  })
})

test("desiredLocales puts the language first without repeating it", () => {
  expect(desiredLocales("ru-RU", ["en-US", "ru-RU"])).toEqual(["ru-RU", "en-US"])
})

test("sameLocales ignores the order after the first", () => {
  expect(sameLocales(["en-US", "ru-RU", "de-DE"], ["en-US", "de-DE", "ru-RU"])).toBe(true)
  expect(sameLocales(["ru-RU", "en-US"], ["en-US", "ru-RU"])).toBe(false)
  expect(sameLocales(["en-US"], ["en-US", "ru-RU"])).toBe(false)
})
