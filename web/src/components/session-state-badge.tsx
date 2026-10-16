import type { SessionState } from "@/api/client"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const labels: Record<SessionState, string> = {
  provisioning: "Provisioning",
  booting: "Booting",
  installing: "Installing",
  instrumenting: "Instrumenting",
  ready: "Ready",
  stopping: "Stopping",
  failed: "Failed",
}

export function SessionStateBadge({ state }: { state: SessionState }) {
  return (
    <Badge
      variant={state === "failed" ? "destructive" : state === "ready" ? "default" : "secondary"}
      className={cn(state === "ready" && "bg-emerald-600 text-white dark:bg-emerald-500")}
    >
      {state !== "ready" && state !== "failed" && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {labels[state]}
    </Badge>
  )
}
