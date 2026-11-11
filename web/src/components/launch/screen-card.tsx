import { StarIcon } from "lucide-react"
import type { Display } from "@/api/client"
import { ChoiceCard } from "@/components/launch/choice-card"
import { PhonePreview } from "@/components/launch/phone-preview"
import { screenFacts, screenName } from "@/lib/screens"

export function ScreenCard({
  display: s,
  selected,
  favorite,
  onSelect,
}: {
  display: Display
  selected: boolean
  favorite?: boolean
  onSelect: () => void
}) {
  return (
    <ChoiceCard
      selected={selected}
      onSelect={onSelect}
      title={`${screenName(s)}: ${screenFacts(s)}${s.like ? `, like ${s.like}` : ""}`}
      className="items-center gap-2 px-2 pt-3.5 pb-3"
    >
      {favorite && (
        <StarIcon aria-label="Favorite" className="fill-warning text-warning absolute top-2.5 left-2.5 size-3.5" />
      )}
      <PhonePreview display={s} className="text-muted-foreground h-16" />
      <span className="w-full truncate text-center text-[13px] font-medium">{screenName(s)}</span>
      <span className="text-muted-foreground font-mono text-[11px]">
        {s.width}×{s.height}
      </span>
    </ChoiceCard>
  )
}
