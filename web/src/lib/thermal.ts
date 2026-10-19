import type { Temperature } from "@/api/client"

export type Level = "ok" | "warn" | "crit"

const levels: Level[] = ["ok", "warn", "crit"]

export const levelText: Record<Level, string> = {
  ok: "text-muted-foreground",
  warn: "text-amber-500",
  crit: "text-destructive",
}

export const levelFill: Record<Level, string> = {
  ok: "bg-muted-foreground/60",
  warn: "bg-amber-500",
  crit: "bg-destructive",
}

export function level(value: number, warn: number, crit: number): Level {
  if (value >= crit) return "crit"
  return value >= warn ? "warn" : "ok"
}

export function worst(...ls: Level[]): Level {
  return levels[Math.max(...ls.map((l) => levels.indexOf(l)))] ?? "ok"
}

export function hottest(ts: Temperature[]) {
  return ts.reduce<Temperature | undefined>((a, t) => (a && a.celsius >= t.celsius ? a : t), undefined)
}

export function temperatureLevel(t: Temperature): Level {
  if (t.source === "device" && (t.type === "battery" || t.type === "skin")) return level(t.celsius, 40, 45)
  if (t.source === "host" && t.type === "nvme") return level(t.celsius, 60, 70)
  return level(t.celsius, 75, 90)
}

export function sensorLabel(t: Temperature) {
  return t.name === t.type ? t.name : `${t.name} (${t.type})`
}

export function celsius(v: number) {
  return `${Math.round(v)} °C`
}
