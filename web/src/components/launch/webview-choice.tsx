import { ChevronDownIcon, ChevronLeftIcon, ChevronUpIcon, GlobeIcon, PackageIcon } from "lucide-react"
import { useState } from "react"
import type { WebViewView } from "@/api/client"
import { ChoiceCard, ChoiceGroup, Section } from "@/components/launch/choice-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { newestStable, webviewKinds } from "@/lib/webview-kinds"

const COLLAPSED = 4

export function WebViewChoice({
  webviews: all,
  selected,
  preferred,
  android,
  onSelect,
}: {
  webviews: WebViewView[]
  selected: string
  preferred?: string
  android?: string
  onSelect: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [picking, setPicking] = useState(false)
  const [chosenKind, setChosenKind] = useState<string | null>(null)
  const kinds = webviewKinds(all, preferred)
  const selectedKind = all.find((w) => w.id === selected)?.package
  const kind = kinds.find((k) => k.package === selectedKind) ?? kinds.find((k) => k.package === chosenKind) ?? kinds[0]
  const pickKind = (pkg: string) => {
    setPicking(false)
    setExpanded(false)
    setChosenKind(pkg)
    if (pkg !== selectedKind) {
      const build = newestStable(all.filter((w) => w.package === pkg))
      if (build) onSelect(build.id)
    }
  }
  const webviews = kind?.builds ?? all
  const index = webviews.findIndex((w) => w.id === selected)
  const pinned = webviews[index]
  const collapsible = webviews.length - (COLLAPSED - 1) > COLLAPSED
  const shown =
    expanded || !collapsible
      ? webviews
      : pinned && index >= COLLAPSED - 1
        ? [pinned, ...webviews.slice(0, COLLAPSED - 2)]
        : webviews.slice(0, COLLAPSED - 1)
  const hidden = webviews.length - shown.length
  const hint =
    "Chromium builds installed over the device's own WebView, or Google's WebView with proprietary codecs (H.264, AAC), before the app starts. Each adds a few seconds to the launch."
  if (picking) {
    return (
      <Section title="WebView" hint={hint}>
        <ChoiceGroup label="Kind of WebView" className="grid-cols-2">
          {kinds.map((k) => (
            <ChoiceCard
              key={k.package}
              selected={k.package === kind?.package}
              onSelect={() => pickKind(k.package)}
              className="gap-1.5 p-2.5"
            >
              <div className="flex items-center gap-2 pr-5">
                <span className="bg-primary/10 text-primary grid size-7 shrink-0 place-items-center rounded-md">
                  <GlobeIcon className="size-3.5" />
                </span>
                <span className="truncate text-sm font-medium">{k.label}</span>
              </div>
              <div className="text-muted-foreground text-xs">
                {k.builds.length} {k.builds.length === 1 ? "version" : "versions"}
              </div>
            </ChoiceCard>
          ))}
        </ChoiceGroup>
      </Section>
    )
  }
  return (
    <Section title="WebView" hint={hint}>
      {kinds.length > 1 && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground w-fit"
            onClick={() => setPicking(true)}
          >
            <ChevronLeftIcon />
            Kinds of WebView
          </Button>
          <span className="text-sm font-medium">{kind?.label}</span>
        </div>
      )}
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
        {shown.map((w) => (
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
      {collapsible && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground w-fit"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
          {expanded ? "Show fewer versions" : `Show ${hidden} older ${hidden === 1 ? "version" : "versions"}`}
        </Button>
      )}
    </Section>
  )
}
