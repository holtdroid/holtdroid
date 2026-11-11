import type { Display } from "@/api/client"
import { screenDp } from "@/lib/cutout"

export const screenName = (s: Pick<Display, "brand" | "label">) =>
  !s.brand || s.label.toLowerCase().startsWith(s.brand.toLowerCase()) ? s.label : `${s.brand} ${s.label}`

const cutoutNames: Record<string, string> = {
  circle: "Punch hole",
  pill: "Pill cutout",
  drop: "Waterdrop",
  notch: "Notch",
}

export function cutoutName(s: Pick<Display, "shape" | "cutout">) {
  if (s.shape) return cutoutNames[s.shape.kind] ?? "Cutout"
  if (!s.cutout || s.cutout === "none") return "No cutout"
  return s.cutout === "hole" ? "Punch hole" : "Cutout"
}

export function screenFacts(s: Pick<Display, "width" | "height" | "dpi">) {
  const { w, h } = screenDp(s)
  return `${s.width}×${s.height} · ${s.dpi} dpi · ${Math.round(w)}×${Math.round(h)} dp`
}

export type ScreenFilter = "notch" | "hole" | "plain" | "narrow"

export const screenFilters: { id: ScreenFilter; label: string }[] = [
  { id: "notch", label: "Notch" },
  { id: "hole", label: "Punch hole" },
  { id: "plain", label: "No cutout" },
  { id: "narrow", label: "≤ 360 dp wide" },
]

function passes(d: Display, filter: ScreenFilter | "") {
  const kind = d.shape?.kind
  switch (filter) {
    case "notch":
      return kind === "notch" || kind === "drop"
    case "hole":
      return kind === "circle" || kind === "pill" || (!kind && d.cutout === "hole")
    case "plain":
      return cutoutName(d) === "No cutout"
    case "narrow":
      return Math.round(screenDp(d).w) <= 360
    default:
      return true
  }
}

export function screenMatches(d: Display, q: string, filter: ScreenFilter | "" = "") {
  if (!passes(d, filter)) return false
  if (!q) return true
  const text = [
    d.brand,
    d.label,
    d.like,
    `${d.width}x${d.height}`,
    `${d.width}×${d.height}`,
    `${d.dpi}dpi`,
    cutoutName(d),
  ]
    .join(" ")
    .toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word))
}

export function shortlist(screens: Display[], favorites: string[], chosen: string | undefined, size: number) {
  const starred = favorites.map((id) => screens.find((s) => s.id === id)).filter((s): s is Display => !!s)
  const list = [...starred, ...screens.filter((s) => !starred.includes(s))].slice(0, size)
  const picked = screens.find((s) => s.id === chosen)
  return picked && !list.includes(picked) ? [...list.slice(0, size - 1), picked] : list
}
