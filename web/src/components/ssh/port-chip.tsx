import { toast } from "sonner"
import type { ReverseTunnel } from "@/api/client"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatRelative } from "@/lib/format"
import { localURL } from "@/lib/ssh-ports"
import { cn } from "@/lib/utils"

const portStyle: Record<ReverseTunnel["state"], string> = {
  up: "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  down: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300",
  unknown: "border-muted-foreground/30",
}

const portDot: Record<ReverseTunnel["state"], string> = {
  up: "bg-emerald-500",
  down: "bg-red-500",
  unknown: "bg-muted-foreground/40",
}

const portState: Record<ReverseTunnel["state"], string> = {
  up: "A server answers on your machine.",
  down: "Nothing answers on your machine.",
  unknown: "Not checked yet.",
}

function copyURL(port: number) {
  const url = localURL(port)
  navigator.clipboard.writeText(url).then(
    () => toast.success(`Copied ${url}`),
    () => toast.error("Could not copy to the clipboard"),
  )
}

export function PortChip({ tunnel: r, now }: { tunnel: ReverseTunnel; now: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge asChild variant="outline" className={cn("cursor-pointer gap-1.5 font-mono", portStyle[r.state])}>
          <button type="button" onClick={() => copyURL(r.port)}>
            <span className={cn("size-1.5 rounded-full", portDot[r.state])} />
            localhost:{r.port}
            {r.connections > 0 && <span className="opacity-70">·{r.connections}</span>}
          </button>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {portState[r.state]} Published by {r.user} {formatRelative(r.since, now)}
        {r.connections > 0 && `, ${r.connections} open ${r.connections === 1 ? "connection" : "connections"}`}. Click to
        copy {localURL(r.port)}
      </TooltipContent>
    </Tooltip>
  )
}
