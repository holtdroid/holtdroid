import { Link, useMatchRoute } from "@tanstack/react-router"
import { ArrowRightIcon, ClockIcon, GlobeIcon, Loader2Icon, MonitorSmartphoneIcon, SquareIcon } from "lucide-react"
import type { ReactNode } from "react"
import { toast } from "sonner"
import type { SessionView } from "@/api/client"
import { canManage, useMe, useSessions, useStopSession } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { SessionStateBadge } from "@/components/session-state-badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { useNow } from "@/hooks/use-now"
import { formatDuration } from "@/lib/format"
import { sessionTone, stopsIn, toneDot } from "@/lib/session-tone"
import { cn } from "@/lib/utils"
import { dockItem } from "./dock-item"

const maxChips = 3

const sessionKey = (s: SessionView) => `${s.provider}/${s.id}`

export function useMySessions() {
  const me = useMe()
  const sessions = useSessions()
  const user = me.data?.user
  return user ? (sessions.data?.items ?? []).filter((s) => s.owner === user) : []
}

function Dot({ s, now }: { s: SessionView; now: number }) {
  return <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", toneDot[sessionTone(s, now)])} />
}

export function deviceLine(s: SessionView) {
  return [
    s.capabilities?.model || s.slotLabel || s.slot,
    s.capabilities?.android && `Android ${s.capabilities.android}`,
    s.location,
  ]
    .filter(Boolean)
    .join(" · ")
}

function DevicePeek({ s }: { s: SessionView }) {
  const now = useNow()
  const me = useMe()
  const stop = useStopSession()
  const left = stopsIn(s, now)
  const idleFirst = new Date(s.idleDeadline).getTime() <= new Date(s.ttlDeadline).getTime()
  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-3">
        <AppIcon src={s.iconUrl} className="size-9 rounded-[10px]" />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{s.label || s.package}</span>
            <SessionStateBadge state={s.state} />
          </span>
          <span className="text-muted-foreground truncate font-mono text-xs">
            {s.package}
            {s.versionName ? ` · ${s.versionName}` : ""}
          </span>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-muted-foreground flex items-center gap-1.5">
          <MonitorSmartphoneIcon className="size-3.5" />
          Device
        </dt>
        <dd className="truncate">
          {s.capabilities?.model || s.slotLabel || s.slot}
          {s.capabilities?.android ? ` · Android ${s.capabilities.android}` : ""}
        </dd>
        {s.location && (
          <>
            <dt className="text-muted-foreground flex items-center gap-1.5">
              <GlobeIcon className="size-3.5" />
              Location
            </dt>
            <dd className="truncate">{s.location}</dd>
          </>
        )}
        {s.state === "ready" && (
          <>
            <dt className="text-muted-foreground flex items-center gap-1.5">
              <ClockIcon className="size-3.5" />
              {idleFirst ? "Idle stop" : "Lifetime"}
            </dt>
            <dd className={cn("tabular-nums", sessionTone(s, now) === "idle" && "text-warning")}>
              in {formatDuration(left)}
            </dd>
          </>
        )}
      </dl>
      {s.reason && <p className="text-danger text-xs break-all">{s.reason}</p>}
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" asChild>
          <Link to="/session/$provider/$id" params={{ provider: s.provider, id: s.id }}>
            Open
            <ArrowRightIcon />
          </Link>
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={!canManage(me.data, s) || stop.isPending}
          onClick={() => stop.mutate(s, { onError: (e) => toast.error("Could not stop", { description: e.message }) })}
        >
          {stop.isPending ? <Loader2Icon className="animate-spin" /> : <SquareIcon />}
          Stop
        </Button>
      </div>
    </div>
  )
}

function Chip({ s, now, current }: { s: SessionView; now: number; current: boolean }) {
  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Link
          to="/session/$provider/$id"
          params={{ provider: s.provider, id: s.id }}
          aria-label={`${s.label || s.package}, ${s.state}`}
          aria-current={current ? "page" : undefined}
          className={cn(
            "bg-muted text-foreground hover:bg-accent inline-flex h-10 max-w-44 shrink-0 items-center gap-2 rounded-xl border pr-2.5 pl-1.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            current && "border-foreground",
          )}
        >
          <AppIcon src={s.iconUrl} className="size-7 rounded-lg" />
          <span className="hidden min-w-0 truncate 2xl:inline">{s.label || s.package}</span>
          <Dot s={s} now={now} />
        </Link>
      </HoverCardTrigger>
      <HoverCardContent side="top" sideOffset={12} className="w-80 p-3">
        <DevicePeek s={s} />
      </HoverCardContent>
    </HoverCard>
  )
}

function DeviceMenu({
  sessions,
  now,
  label,
  className,
  children,
}: {
  sessions: SessionView[]
  now: number
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={label} className={cn(dockItem, className)}>
          {children}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" sideOffset={12} align="center" className="w-72">
        <DropdownMenuLabel className="text-muted-foreground text-xs">Your devices</DropdownMenuLabel>
        {sessions.map((s) => (
          <DropdownMenuItem key={sessionKey(s)} asChild>
            <Link to="/session/$provider/$id" params={{ provider: s.provider, id: s.id }} className="gap-2.5">
              <AppIcon src={s.iconUrl} className="size-7 rounded-lg" />
              <span className="grid min-w-0 flex-1">
                <span className="truncate font-medium">{s.label || s.package}</span>
                <span className="text-muted-foreground truncate text-xs">{deviceLine(s)}</span>
              </span>
              <Dot s={s} now={now} />
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function RunningDevices() {
  const mine = useMySessions()
  const now = useNow(5_000)
  const matchRoute = useMatchRoute()
  const open = matchRoute({ to: "/session/$provider/$id" })
  const currentKey = open ? `${open.provider}/${open.id}` : ""
  if (mine.length === 0) return null

  const shown = mine.slice(0, maxChips)
  const rest = mine.slice(maxChips)
  return (
    <>
      <div className="hidden items-center gap-1 sm:flex">
        {shown.map((s) => (
          <Chip key={sessionKey(s)} s={s} now={now} current={sessionKey(s) === currentKey} />
        ))}
        {rest.length > 0 && (
          <DeviceMenu sessions={rest} now={now} label={`${rest.length} more devices`} className="text-foreground">
            +{rest.length}
          </DeviceMenu>
        )}
      </div>
      <DeviceMenu
        sessions={mine}
        now={now}
        label={`Your devices (${mine.length})`}
        className="text-foreground sm:hidden"
      >
        <MonitorSmartphoneIcon />
        <span className="tabular-nums">{mine.length}</span>
      </DeviceMenu>
    </>
  )
}
