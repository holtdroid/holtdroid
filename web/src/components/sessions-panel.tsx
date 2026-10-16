import { Link } from "@tanstack/react-router"
import { ClockIcon, GlobeIcon, MonitorSmartphoneIcon, SquareIcon, TimerResetIcon } from "lucide-react"
import { toast } from "sonner"
import type { SessionView } from "@/api/client"
import { canManage, useExtendSession, useMe, useProviders, useSessions, useStopSession } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { SessionStateBadge } from "@/components/session-state-badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { UserAvatar } from "@/components/user-avatar"
import { useNow } from "@/hooks/use-now"
import { formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"

export function SessionsPanel() {
  const sessions = useSessions()
  const providers = useProviders()
  const now = useNow()

  return (
    <section className="flex min-h-0 flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Active sessions</h2>
        <span className="text-muted-foreground text-xs">{sessions.data?.items.length ?? 0} running</span>
      </div>

      <div className="grid gap-2">
        {providers.data?.map((p) => (
          <div key={p.name} className="flex items-center gap-2 text-xs">
            <MonitorSmartphoneIcon className="text-muted-foreground size-4" />
            <span className="w-24 truncate font-medium">{p.name}</span>
            {p.error ? (
              <span className="text-destructive truncate">{p.error}</span>
            ) : (
              <div className="flex gap-1">
                {p.capacity.slots.map((slot) => (
                  <Tooltip key={slot.id}>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          "h-2.5 w-6 rounded-full",
                          slot.state === "free" && "bg-emerald-500/70",
                          slot.state === "busy" && "bg-amber-500",
                          slot.state === "offline" && "bg-muted-foreground/30",
                        )}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      {slot.label}: {slot.state}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {sessions.data?.errors.map((e) => (
        <Alert key={e.source} variant="destructive">
          <AlertDescription>
            Provider “{e.source}”: {e.message}
          </AlertDescription>
        </Alert>
      ))}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sessions.isPending ? (
          <Skeleton className="h-28 rounded-xl" />
        ) : sessions.data?.items.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
            No devices running. Pick an APK to launch one.
          </p>
        ) : (
          <ul className="grid gap-2">
            {sessions.data?.items.map((s) => (
              <SessionCard key={`${s.provider}/${s.id}`} session={s} now={now} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function SessionCard({ session: s, now }: { session: SessionView; now: number }) {
  const me = useMe()
  const stop = useStopSession()
  const extend = useExtendSession()
  const manage = canManage(me.data, s)

  const idleLeft = new Date(s.idleDeadline).getTime() - now
  const idleTotal = new Date(s.idleDeadline).getTime() - new Date(s.lastActivity).getTime()
  const ttlLeft = new Date(s.ttlDeadline).getTime() - now
  const left = Math.min(idleLeft, ttlLeft)
  const uptime = now - new Date(s.createdAt).getTime()

  return (
    <li className="bg-card grid gap-3 rounded-xl border p-3">
      <div className="flex items-start gap-3">
        <AppIcon src={s.iconUrl} className="size-10" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{s.label || s.package}</span>
            <SessionStateBadge state={s.state} />
          </div>
          <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <UserAvatar
                user={s.owner}
                picture={me.data?.user === s.owner ? me.data.picture : undefined}
                className="size-4"
              />
              {s.owner}
            </span>
            <span>{s.slot}</span>
            <span>up {formatDuration(uptime)}</span>
            {s.location && (
              <span className="inline-flex items-center gap-1">
                <GlobeIcon className="size-3" />
                {s.location}
              </span>
            )}
          </div>
          {s.reason && <p className="text-destructive mt-1 text-xs">{s.reason}</p>}
        </div>
      </div>

      <div className="grid gap-1">
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="size-3" />
            {idleLeft <= ttlLeft ? "Stops when idle in" : "Max lifetime ends in"} {formatDuration(left)}
          </span>
          <span>TTL {formatDuration(ttlLeft)}</span>
        </div>
        <Progress value={Math.max(0, Math.min(100, (idleLeft / Math.max(idleTotal, 1)) * 100))} className="h-1" />
      </div>

      <div className="flex gap-2">
        <Button size="sm" asChild className="flex-1">
          <Link to="/session/$provider/$id" params={{ provider: s.provider, id: s.id }}>
            Open
          </Link>
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!manage || extend.isPending}
          onClick={() =>
            extend.mutate(s, { onError: (e) => toast.error("Could not extend", { description: e.message }) })
          }
        >
          <TimerResetIcon />
          Extend
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!manage || stop.isPending}
          onClick={() => stop.mutate(s, { onError: (e) => toast.error("Could not stop", { description: e.message }) })}
        >
          <SquareIcon />
          Stop
        </Button>
      </div>
    </li>
  )
}
