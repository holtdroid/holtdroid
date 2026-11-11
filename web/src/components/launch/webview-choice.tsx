import { ChevronDownIcon, ChevronUpIcon, GlobeIcon, PackageIcon } from "lucide-react"
import { useState } from "react"
import type { WebViewView } from "@/api/client"
import { ChoiceCard, ChoiceGroup, Section } from "@/components/launch/choice-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatBytes } from "@/lib/format"
import { cn } from "@/lib/utils"
import { kindBlurb, newestStable, visibleBuilds, webviewKinds } from "@/lib/webview-kinds"

const COLLAPSED = 4

const channelVariant: Record<string, "success" | "info" | "violet" | "warning"> = {
  stable: "success",
  beta: "info",
  dev: "violet",
  canary: "warning",
}

const day = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" })

function releasedOn(released: string) {
  const at = new Date(released)
  return Number.isNaN(at.getTime()) ? "" : day.format(at)
}

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
  const kinds = webviewKinds(all, preferred)
  const kind = kinds.find((k) => k.package === all.find((w) => w.id === selected)?.package)
  const builds = kind?.builds ?? []
  const shown = expanded ? builds : visibleBuilds(builds, selected, COLLAPSED)
  const hidden = builds.length - shown.length
  const pickKind = (pkg: string) => {
    setExpanded(false)
    if (pkg === kind?.package) return
    const build = newestStable(all.filter((w) => w.package === pkg))
    if (build) onSelect(build.id)
  }

  return (
    <Section title="WebView" hint="Installed over the system one before the app starts">
      <ChoiceGroup label="Kind of WebView" className="grid-cols-2 sm:grid-cols-3">
        <ChoiceCard selected={selected === ""} onSelect={() => onSelect("")}>
          <span className="flex items-center gap-2">
            <span className="bg-muted text-muted-foreground grid size-[26px] shrink-0 place-items-center rounded-lg border">
              <PackageIcon className="size-3.5" />
            </span>
            <span className="font-medium">Built-in</span>
          </span>
          <span className="text-muted-foreground text-xs">
            {android ? `As shipped with Android ${android}` : "As shipped with the device"}
          </span>
        </ChoiceCard>
        {kinds.map((k) => (
          <ChoiceCard key={k.package} selected={k.package === kind?.package} onSelect={() => pickKind(k.package)}>
            <span className="flex min-w-0 items-center gap-2 pr-5">
              <span
                className={cn(
                  "grid size-[26px] shrink-0 place-items-center rounded-lg",
                  k.package === "com.google.android.webview"
                    ? "bg-success-soft text-success"
                    : "bg-info-soft text-info",
                )}
              >
                <GlobeIcon className="size-3.5" />
              </span>
              <span className="truncate font-medium">{k.label}</span>
            </span>
            <span className="text-muted-foreground text-xs">
              {[kindBlurb(k.package), `${k.builds.length} ${k.builds.length === 1 ? "version" : "versions"}`]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </ChoiceCard>
        ))}
      </ChoiceGroup>
      {kind && (
        <div className="bg-muted flex flex-col rounded-xl border p-1">
          <div role="radiogroup" aria-label={`${kind.label} version`} className="flex flex-col">
            {shown.map((w) => {
              const on = w.id === selected
              return (
                <button
                  key={w.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onSelect(w.id)}
                  className={cn(
                    "focus-visible:ring-ring/50 flex h-10 items-center gap-3 rounded-[9px] px-3 text-left outline-none focus-visible:ring-3",
                    on ? "bg-card" : "hover:bg-card/60",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0 rounded-full border-[1.5px]",
                      on ? "border-foreground border-[5px]" : "border-muted-foreground",
                    )}
                  />
                  <span className="w-32 min-w-16 truncate font-mono text-[13px]" title={w.version}>
                    {w.version}
                  </span>
                  <span className="flex min-w-0 flex-1 gap-1 overflow-hidden">
                    {w.channels.map((c) => (
                      <Badge key={c} variant={channelVariant[c] ?? "secondary"} className="capitalize">
                        {c}
                      </Badge>
                    ))}
                  </span>
                  <span className="text-muted-foreground min-w-24 shrink-0 text-right text-xs whitespace-nowrap tabular-nums">
                    {releasedOn(w.released)}
                  </span>
                  {w.size > 0 && (
                    <span className="text-muted-foreground hidden w-16 shrink-0 text-right font-mono text-xs sm:inline">
                      {formatBytes(w.size)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {(hidden > 0 || expanded) && builds.length > COLLAPSED + 1 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground mx-2 my-1 w-fit"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
              {expanded ? "Fewer versions" : `${hidden} older ${hidden === 1 ? "version" : "versions"}`}
            </Button>
          )}
        </div>
      )}
    </Section>
  )
}
