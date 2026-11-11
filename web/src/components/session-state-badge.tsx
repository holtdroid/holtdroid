import type { SessionState } from "@/api/client"
import { Badge } from "@/components/ui/badge"

const labels: Record<SessionState, string> = {
  provisioning: "Provisioning",
  booting: "Booting",
  installing: "Installing",
  restoring: "Restoring",
  instrumenting: "Instrumenting",
  ready: "Ready",
  stopping: "Stopping",
  failed: "Failed",
}

export function SessionStateBadge({ state }: { state: SessionState }) {
  const starting = state !== "ready" && state !== "failed" && state !== "stopping"
  return (
    <Badge
      variant={state === "failed" ? "destructive" : state === "ready" ? "success" : starting ? "info" : "secondary"}
      dot={state === "ready"}
    >
      {starting && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {labels[state]}
    </Badge>
  )
}
