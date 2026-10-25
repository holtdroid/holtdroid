import { expect, test } from "bun:test"
import { distance, formatDistance, pathLength, travelMode } from "./geo"

test("distance and path length", () => {
  const a = { latitude: 0, longitude: 0 }
  const b = { latitude: 0, longitude: 0.01 }
  expect(distance(a, b)).toBeCloseTo(1111.95, 1)
  expect(pathLength([a, b, a])).toBeCloseTo(2223.9, 1)
  expect(pathLength([a])).toBe(0)
})

test("formatDistance", () => {
  expect(formatDistance(420.4)).toBe("420 m")
  expect(formatDistance(1234)).toBe("1.23 km")
  expect(formatDistance(23_456)).toBe("23.5 km")
})

test("travelMode picks the nearest preset", () => {
  expect(travelMode(1.4)).toBe("walk")
  expect(travelMode(3)).toBe("run")
  expect(travelMode(20)).toBe("drive")
})
