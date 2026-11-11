import { Link } from "@tanstack/react-router"
import { ArrowUpRightIcon, ClockIcon, EllipsisIcon, Loader2Icon, SquareIcon, TimerResetIcon } from "lucide-react"
import { toast } from "sonner"
import type { ProviderView, SessionView } from "@/api/client"
import { canManage, useExtendSession, useMe, useProviders, useSessions, useStopSession } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { deviceLine } from "@/components/dock/running-devices"
import { startSteps } from "@/components/session/start-progress"
import { SessionStateBadge } from "@/components/session-state-badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { UserAvatar } from "@/components/user-avatar"
import { useNow } from "@/hooks/use-now"
import { capacityTicks, countTones, slotTones, type Tick } from "@/lib/capacity"
import { formatDuration } from "@/lib/format"
import { sessionTone, stopsIn } from "@/lib/session-tone"
import { cn } from "@/lib/utils"

const toneClass = Object.fromEntries(slotTones.map((t) => [t.tone, t.className]))

function Ticks({ ticks }: { ticks: Tick[] }) {
  return (
    <div className="flex min-w-0 gap-[3px]">
      {ticks.map((t) => (
        <Tooltip key={t.id}>
          <TooltipTrigger asChild>
            <span className={cn("h-5 max-w-10 min-w-0.5 flex-1 rounded-[2px]", toneClass[t.tone])} />
          </TooltipTrigger>
          <TooltipContent>
            {t.label}: {slotTones.find((s) => s.tone === t.tone)?.label.toLowerCase()}
            {t.session ? ` · ${t.session.label || t.session.package}` : ""}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

function Capacity({ providers, sessions, now }: { providers: ProviderView[]; sessions: SessionView[]; now: number }) {
  const rows = providers.map((p) => ({ provider: p, ticks: p.error ? [] : capacityTicks(p, sessions, now) }))
  const legend = countTones(rows.flatMap((r) => r.ticks))
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {rows.map(({ provider: p, ticks }) => (
        <div key={p.name} className="flex min-w-0 flex-col gap-1.5">
          {providers.length > 1 && (
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate font-medium">{p.name}</span>
              {!p.error && (
                <span className="text-muted-foreground shrink-0 whitespace-nowrap tabular-nums">
                  {ticks.filter((t) => t.tone === "free").length}/{ticks.length} free
                </span>
              )}
            </div>
          )}
          {p.error ? <p className="text-danger text-xs break-words">{p.error}</p> : <Ticks ticks={ticks} />}
        </div>
      ))}
      {legend.length > 0 && (
        <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px]">
          {legend.map((t) => (
            <span key={t.tone} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className={cn("h-3 w-1 shrink-0 rounded-[2px]", t.className)} />
              {t.count} {t.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function SessionsPanel({ className }: { className?: string }) {
  const sessions = useSessions()
  const providers = useProviders()
  const me = useMe()
  const now = useNow()
  const items = sessions.data?.items ?? []
  const user = me.data?.user
  const mine = items.filter((s) => s.owner === user).length
  const ordered = items.toSorted(
    (a, b) => Number(b.owner === user) - Number(a.owner === user) || b.createdAt.localeCompare(a.createdAt),
  )

  return (
    <section className={cn("bg-card flex min-h-0 min-w-0 flex-col gap-4 rounded-2xl border p-5", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Devices</h2>
        {items.length > 0 && (
          <Badge variant="secondary">
            {mine === items.length ? `${items.length} running` : `${mine} of ${items.length} yours`}
          </Badge>
        )}
        <span className="flex-1" />
        {me.data?.admin && (
          <Button variant="outline" size="sm" asChild>
            <Link to="/inventory">Inventory</Link>
          </Button>
        )}
      </div>

      {providers.data && <Capacity providers={providers.data} sessions={items} now={now} />}

      {sessions.data?.errors.map((e) => (
        <Alert key={e.source} variant="destructive">
          <AlertDescription>
            Provider “{e.source}”: {e.message}
          </AlertDescription>
        </Alert>
      ))}

      <div className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        {sessions.isPending ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : items.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-8 text-center text-sm text-balance break-words">
            No devices running. Launch an app to start one.
          </p>
        ) : (
          <ul className="flex min-w-0 flex-col">
            {ordered.map((s) => (
              <SessionRow key={`${s.provider}/${s.id}`} session={s} now={now} mine={s.owner === user} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function SessionBadge({ session: s, now }: { session: SessionView; now: number }) {
  const tone = sessionTone(s, now)
  if (tone === "idle")
    return (
      <Badge variant="warning">
        <ClockIcon />
        Stops in {formatDuration(stopsIn(s, now))}
      </Badge>
    )
  if (tone === "ready") return <Badge variant="success">Running</Badge>
  return <SessionStateBadge state={s.state} />
}

function SessionRow({ session: s, now, mine }: { session: SessionView; now: number; mine: boolean }) {
  const me = useMe()
  const stop = useStopSession()
  const extend = useExtendSession()
  const manage = canManage(me.data, s)
  const tone = sessionTone(s, now)
  const steps = startSteps(false, s.appData, s.webview)
  const step = steps.findIndex((x) => x.state === s.state)
  const starting = tone === "starting" && s.state !== "stopping" && step >= 0
  const uptime = formatDuration(now - new Date(s.createdAt).getTime())
  const limits = `Stops when idle in ${formatDuration(new Date(s.idleDeadline).getTime() - now)}, max lifetime ends in ${formatDuration(new Date(s.ttlDeadline).getTime() - now)}`
  const label = s.label || s.package
  const extendNow = () =>
    extend.mutate(s, { onError: (e) => toast.error("Could not extend", { description: e.message }) })

  return (
    <li className="flex min-w-0 flex-col gap-2 border-b border-dashed py-3 last:border-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2.5">
        <AppIcon src={s.iconUrl} className="size-7 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 font-medium">
            <span className="min-w-0 truncate">{label}</span>
            <SessionBadge session={s} now={now} />
          </div>
          <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            {!mine && (
              <UserAvatar
                user={s.owner}
                picture={me.data?.user === s.owner ? me.data.picture : undefined}
                className="size-4 shrink-0"
              />
            )}
            <span className="truncate" title={limits}>
              {[!mine && (s.ownerName || s.owner), deviceLine(s), `up ${uptime}`].filter(Boolean).join(" · ")}
            </span>
          </div>
          {s.reason && <p className="text-danger mt-0.5 text-xs break-all">{s.reason}</p>}
        </div>
        {starting && (
          <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
            {step + 1}/{steps.length}
          </span>
        )}
        {tone === "idle" && manage && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={extendNow} disabled={extend.isPending}>
            <TimerResetIcon />
            Extend
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label={`More for ${label}`}
              disabled={!manage}
            >
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={extendNow} disabled={extend.isPending}>
              <TimerResetIcon />
              Extend
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={stop.isPending}
              onSelect={() =>
                stop.mutate(s, { onError: (e) => toast.error("Could not stop", { description: e.message }) })
              }
            >
              {stop.isPending ? <Loader2Icon className="animate-spin" /> : <SquareIcon />}
              Stop
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="icon" className="shrink-0" asChild>
          <Link to="/session/$provider/$id" params={{ provider: s.provider, id: s.id }} aria-label={`Open ${label}`}>
            <ArrowUpRightIcon />
          </Link>
        </Button>
      </div>
      {starting && (
        <div className="bg-border h-1 overflow-hidden rounded-full">
          <div
            className="bg-info h-full transition-[width]"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>
      )}
    </li>
  )
}
