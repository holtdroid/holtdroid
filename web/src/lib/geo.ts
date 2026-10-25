export type Point = { latitude: number; longitude: number }

export type TravelMode = "walk" | "run" | "drive"

export const travelModes: Record<TravelMode, { label: string; speed: number }> = {
  walk: { label: "Walk", speed: 1.4 },
  run: { label: "Run", speed: 2.8 },
  drive: { label: "Drive", speed: 13.9 },
}

export function travelMode(speed: number): TravelMode {
  const modes = Object.entries(travelModes) as [TravelMode, { speed: number }][]
  return modes.reduce((best, m) => (Math.abs(m[1].speed - speed) < Math.abs(best[1].speed - speed) ? m : best))[0]
}

const earthRadius = 6371008.8

export function distance(a: Point, b: Point) {
  const rad = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * rad
  const dLng = (b.longitude - a.longitude) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function pathLength(points: Point[]) {
  return points.reduce((sum, p, i) => (i === 0 ? 0 : sum + distance(points[i - 1]!, p)), 0)
}

export function formatDistance(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`
}
