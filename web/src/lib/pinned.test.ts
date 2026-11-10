import { expect, test } from "bun:test"
import { pinnedFirst } from "@/lib/pinned"

test("pinned apps come first and otherwise keep their order", () => {
  const groups = [{ pkg: "a" }, { pkg: "b" }, {}, { pkg: "c" }, { pkg: "d" }]
  const pinned = new Set(["c", "b"])
  expect(pinnedFirst(groups, (p) => pinned.has(p)).map((g) => g.pkg)).toEqual(["b", "c", "a", undefined, "d"])
})
