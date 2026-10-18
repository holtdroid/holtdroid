import { expect, test } from "bun:test"
import { groupPorts, isDevServer } from "@/lib/dev-ports"

test.each([
  ["node", true],
  ["python3.13", true],
  ["Python", true],
  ["rapportd", false],
  ["ControlCenter", false],
  ["OrbStack Helper", false],
  [undefined, false],
])("isDevServer(%p)", (name, want) => {
  expect(isDevServer(name)).toBe(want)
})

test("groupPorts keeps published and dev servers up front", () => {
  const listening = [
    { port: 3006, process: "node" },
    { port: 5000, process: "ControlCenter" },
    { port: 7000, process: "ControlCenter" },
    { port: 24282, process: "python3.13" },
  ]
  expect(groupPorts(listening, [7000, 8080])).toEqual({ main: [3006, 7000, 8080, 24282], other: [5000] })
})
