import { CloudOffIcon, RefreshCwIcon } from "lucide-react"
import type { useSSHKeySync } from "@/api/ssh-keys"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useNow } from "@/hooks/use-now"
import { formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs", className)}>
      {children}
    </span>
  )
}

function Dot({ className }: { className: string }) {
  return <span className={cn("size-2 rounded-full", className)} />
}

export function SyncStatus({ sync }: { sync: ReturnType<typeof useSSHKeySync> }) {
  const now = useNow(30_000)

  if (sync.enabled === undefined) return null
  if (!sync.enabled) {
    return (
      <Pill className="text-muted-foreground">
        <CloudOffIcon className="size-3.5" />
        Stored in this browser only
      </Pill>
    )
  }
  if (sync.isError) {
    return (
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Pill className="border-destructive/30 text-destructive bg-destructive/5">
              <Dot className="bg-destructive" />
              Not synced
            </Pill>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{sync.error.message}</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon-sm" onClick={() => void sync.refetch()} disabled={sync.isFetching}>
          <RefreshCwIcon className={cn(sync.isFetching && "animate-spin")} />
          <span className="sr-only">Retry</span>
        </Button>
      </div>
    )
  }
  if (!sync.isSuccess) {
    return (
      <Pill className="text-muted-foreground">
        <Spinner className="size-3.5" />
        Syncing…
      </Pill>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Pill className="border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400">
          {sync.isFetching ? <Spinner className="size-3" /> : <Dot className="bg-emerald-500" />}
          Synced {formatRelative(sync.dataUpdatedAt, now)}
        </Pill>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        Accepted by {sync.data.replicas} gateway {sync.data.replicas === 1 ? "replica" : "replicas"}. Your keys are
        re-sent every 5 minutes while the portal is open.
      </TooltipContent>
    </Tooltip>
  )
}
