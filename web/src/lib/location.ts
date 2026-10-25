import { flag } from "country-emoji"
import type { Location } from "@/api/client"

export function locationFlag(l: Location) {
  return flag(l.id) ?? flag(l.label)
}

export function locationLabel(l: Location) {
  const emoji = locationFlag(l)
  return emoji ? `${emoji} ${l.label}` : l.label
}
