import type { RecordingView } from "@/api/client"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const labels: Record<RecordingView["state"], string> = {
  pending: "Waiting",
  recording: "Recording",
  done: "Done",
  failed: "Stopped",
  interrupted: "Cut off",
}

export function RecordingState({ state, className }: { state: RecordingView["state"]; className?: string }) {
  if (state === "done") return null
  return (
    <Badge
      variant={
        state === "recording" || state === "failed" ? "destructive" : state === "interrupted" ? "warning" : "secondary"
      }
      className={cn("gap-1.5", className)}
    >
      {state === "recording" && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {labels[state]}
    </Badge>
  )
}
