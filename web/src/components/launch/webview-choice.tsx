import { GlobeIcon, PackageIcon } from "lucide-react"
import type { WebViewView } from "@/api/client"
import { ChoiceCard, ChoiceGroup, Section } from "@/components/launch/choice-card"
import { Badge } from "@/components/ui/badge"

export function WebViewChoice({
  webviews,
  selected,
  android,
  onSelect,
}: {
  webviews: WebViewView[]
  selected: string
  android?: string
  onSelect: (id: string) => void
}) {
  return (
    <Section
      title="WebView"
      hint="Chromium builds installed over the device's own WebView before the app starts. Each adds a few seconds to the launch."
    >
      <ChoiceGroup label="WebView" className="grid-cols-2 sm:grid-cols-4">
        <ChoiceCard selected={selected === ""} onSelect={() => onSelect("")} className="gap-1.5 p-2.5">
          <div className="flex items-center gap-2">
            <span className="bg-muted text-muted-foreground grid size-7 shrink-0 place-items-center rounded-md">
              <PackageIcon className="size-3.5" />
            </span>
            <span className="text-sm font-medium">Built-in</span>
          </div>
          <div className="text-muted-foreground text-xs">
            {android ? `As shipped with Android ${android}` : "As shipped"}
          </div>
        </ChoiceCard>
        {webviews.map((w) => (
          <ChoiceCard key={w.id} selected={w.id === selected} onSelect={() => onSelect(w.id)} className="gap-1.5 p-2.5">
            <div className="flex items-center gap-2 pr-5">
              <span className="bg-primary/10 text-primary grid size-7 shrink-0 place-items-center rounded-md">
                <GlobeIcon className="size-3.5" />
              </span>
              <span className="truncate text-sm font-medium">{w.title}</span>
            </div>
            <div className="text-muted-foreground truncate font-mono text-xs">{w.version}</div>
            {w.channels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {w.channels.map((c) => (
                  <Badge key={c} variant="secondary" className="px-1.5 py-0 text-[10px] capitalize">
                    {c}
                  </Badge>
                ))}
              </div>
            )}
          </ChoiceCard>
        ))}
      </ChoiceGroup>
    </Section>
  )
}
