import type { Display } from "@/api/client"
import { ChoiceCard } from "@/components/launch/choice-card"
import { PhonePreview } from "@/components/launch/phone-preview"

export const screenName = (s: Display) =>
  !s.brand || s.label.toLowerCase().startsWith(s.brand.toLowerCase()) ? s.label : `${s.brand} ${s.label}`

export function ScreenCard({
  display: s,
  selected,
  onSelect,
}: {
  display: Display
  selected: boolean
  onSelect: () => void
}) {
  const css = `${Math.round((s.width * 160) / s.dpi)}×${Math.round((s.height * 160) / s.dpi)} CSS px`
  return (
    <ChoiceCard selected={selected} onSelect={onSelect} className="flex-row items-center gap-3">
      <div className="grid w-14 shrink-0 place-items-center">
        <PhonePreview display={s} />
      </div>
      <div className="min-w-0 pr-4">
        <div className="text-sm font-medium">{screenName(s)}</div>
        <div className="text-muted-foreground text-xs tabular-nums">
          {s.width}×{s.height} · {s.dpi} dpi
        </div>
        <div className="text-muted-foreground text-xs tabular-nums">{css}</div>
        {s.like && <div className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{s.like}</div>}
      </div>
    </ChoiceCard>
  )
}
