import { ChoiceCard } from "@/components/launch/choice-card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const releases: Record<string, { name: string; color: string }> = {
  "16": { name: "Baklava", color: "#2FBF9B" },
  "15": { name: "Vanilla Ice Cream", color: "#5B8DF6" },
  "14": { name: "Upside Down Cake", color: "#F08A4B" },
  "13": { name: "Tiramisu", color: "#B07CF0" },
  "12": { name: "Snow Cone", color: "#4FA3F7" },
  "11": { name: "Red Velvet Cake", color: "#E25D6A" },
}

export const androidName = (version: string) => releases[version]?.name ?? ""

export function AndroidVersionCard({
  version,
  selected,
  blockedBy,
  alternative,
  onSelect,
}: {
  version: string
  selected: boolean
  blockedBy?: string
  alternative?: string
  onSelect: () => void
}) {
  const r = releases[version]
  const card = (
    <ChoiceCard
      selected={selected}
      tick={false}
      onSelect={onSelect}
      disabled={!!blockedBy && !alternative}
      className={cn("items-start px-3 py-2.5", blockedBy && alternative && "opacity-70")}
    >
      <span className="flex w-full items-center gap-2">
        <span
          aria-hidden
          className="bg-muted-foreground size-2.5 shrink-0 rounded-[3px]"
          style={r ? { background: r.color } : undefined}
        />
        <span className="text-lg leading-none font-semibold">{version}</span>
      </span>
      <span className="text-muted-foreground max-w-full truncate text-xs">
        {blockedBy ? (alternative ? `Use ${alternative}` : "Not supported") : r?.name || `Android ${version}`}
      </span>
    </ChoiceCard>
  )
  if (!blockedBy) return card
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="grid min-w-0">
          {card}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {blockedBy}
        {alternative && `. Switches to ${alternative}, the newest build that runs on it.`}
      </TooltipContent>
    </Tooltip>
  )
}
