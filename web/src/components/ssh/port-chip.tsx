import { toast } from "sonner"
import type { ReverseTunnel } from "@/api/client"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copyText } from "@/lib/clipboard"
import { formatRelative } from "@/lib/format"
import { localURL } from "@/lib/ssh-ports"
import { cn } from "@/lib/utils"

const portVariant: Record<ReverseTunnel["state"], "success" | "destructive" | "secondary"> = {
  up: "success",
  down: "destructive",
  unknown: "secondary",
}

const portState: Record<ReverseTunnel["state"], string> = {
  up: "A server answers on your machine.",
  down: "Nothing answers on your machine.",
  unknown: "Not checked yet.",
}

function copyURL(port: number) {
  const url = localURL(port)
  copyText(url).then(
    () => toast.success(`Copied ${url}`),
    () => toast.error("Could not copy to the clipboard"),
  )
}

export function PortChip({ tunnel: r, now }: { tunnel: ReverseTunnel; now: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge asChild variant={portVariant[r.state]} className="cursor-pointer gap-1.5 font-mono">
          <button type="button" onClick={() => copyURL(r.port)}>
            <span className={cn("size-1.5 rounded-full bg-current", r.state === "unknown" && "opacity-40")} />
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
