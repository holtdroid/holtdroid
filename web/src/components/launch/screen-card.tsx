import type { Display } from "@/api/client"
import { ChoiceCard } from "@/components/launch/choice-card"
import { PhonePreview } from "@/components/launch/phone-preview"
import { cn } from "@/lib/utils"

export const screenName = (s: Display) => (s.brand ? `${s.brand} ${s.label}` : s.label)

export function ScreenCard({
  display: s,
  selected,
  onSelect,
  tile,
}: {
  display: Display
  selected: boolean
  onSelect: () => void
  tile?: boolean
}) {
  const css = `${Math.round((s.width * 160) / s.dpi)}×${Math.round((s.height * 160) / s.dpi)} CSS px`
  return (
    <ChoiceCard
      selected={selected}
      onSelect={onSelect}
      className={cn(tile ? "items-center gap-2 text-center" : "flex-row items-center gap-3")}
    >
      <div className={cn("grid shrink-0 place-items-center", tile ? "h-24" : "w-14")}>
        <PhonePreview display={s} className={tile ? "h-24" : undefined} />
      </div>
      <div className={cn("min-w-0", tile ? "w-full" : "pr-4")}>
        <div className="truncate text-sm font-medium">{screenName(s)}</div>
        <div className="text-muted-foreground text-xs tabular-nums">
          {s.width}×{s.height} · {s.dpi} dpi
        </div>
        <div className="text-muted-foreground text-xs tabular-nums">{css}</div>
        {s.like && <div className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{s.like}</div>}
      </div>
    </ChoiceCard>
  )
}
