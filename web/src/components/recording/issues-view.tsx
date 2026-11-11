import { InfoIcon, TriangleAlertIcon } from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/recording/devtools-view"
import { copy } from "@/components/recording/json-view"
import { curlOf, type DevToolsLog, splitURL } from "@/lib/recording/devtools"
import type { Issue } from "@/lib/recording/lanes"
import type { PlayerView } from "@/lib/recording/link"
import { clock } from "@/lib/recording/timeline"
import { cn } from "@/lib/utils"

/** What went wrong in the recording up to the playhead: failed requests, errors, crashes and closes. */
export function IssuesView({
  issues,
  log,
  time,
  onSeek,
  onView,
}: {
  issues: Issue[]
  log: DevToolsLog
  time: number
  onSeek: (t: number) => void
  onView: (patch: PlayerView) => void
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const shown = issues.filter((i) => i.t <= time)
  const current = shown.at(-1)?.id
  const issue = shown.find((i) => i.id === picked)
  const request = issue?.request ? log.requests.find((r) => r.key === issue.request) : undefined

  if (shown.length === 0) {
    return (
      <Empty>
        {issues.length > 0
          ? "Nothing has gone wrong yet at this moment."
          : "No failed requests, errors, crashes or closes in this recording."}
      </Empty>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2.5">
      {shown.toReversed().map((i) => (
        <button
          key={i.id}
          type="button"
          aria-pressed={picked === i.id}
          onClick={() => {
            setPicked(i.id)
            onSeek(i.t)
          }}
          className={cn(
            "flex items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-muted",
            i.id === current && (i.level === "error" ? "bg-danger-soft" : "bg-warning-soft"),
            picked === i.id && "ring-1 ring-border",
          )}
        >
          {i.kind === "closed" ? (
            <InfoIcon className="mt-0.5 size-4 shrink-0 text-warning" />
          ) : (
            <TriangleAlertIcon
              className={cn("mt-0.5 size-4 shrink-0", i.level === "error" ? "text-danger" : "text-warning")}
            />
          )}
          <span className="grid min-w-0 flex-1">
            <span className="truncate font-medium">{i.title}</span>
            {i.detail && <span className="truncate text-xs text-muted-foreground">{i.detail}</span>}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{clock(i.t)}</span>
        </button>
      ))}
      {issue && (issue.request || issue.message) && (
        <div className="mt-2 grid gap-2 rounded-xl border bg-muted p-3">
          {request ? (
            <>
              <div className="flex min-w-0 items-center gap-2">
                <Badge variant="destructive" className="font-mono">
                  {request.status || "failed"}
                </Badge>
                <span className="truncate font-mono text-[12.5px]">
                  {request.method} {splitURL(request.url).path}
                </span>
              </div>
              {request.error && <span className="font-mono text-xs text-muted-foreground">{request.error}</span>}
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" onClick={() => onView({ tab: "network", request: request.key })}>
                  Open in Network
                </Button>
                <Button size="sm" variant="outline" onClick={() => copy(curlOf(request), "cURL copied")}>
                  Copy as cURL
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={() => onView({ tab: "console", message: issue.message })}>
                Open in Console
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
