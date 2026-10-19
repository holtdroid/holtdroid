import { flag } from "country-emoji"
import type { Location } from "@/api/client"

export function locationLabel(l: Location) {
  const emoji = flag(l.id) ?? flag(l.label)
  return emoji ? `${emoji} ${l.label}` : l.label
}
