import { Link } from "@tanstack/react-router"
import { ChevronRightIcon, ExternalLinkIcon, FilterIcon, ShieldIcon } from "lucide-react"
import { Fragment, useState } from "react"
import type { AuditEvent, AuditFilter } from "@/api/audit"
import { CopyButton } from "@/components/copy-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { UserAvatar } from "@/components/user-avatar"
import { formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"

const categoryColor: Record<string, string> = {
  auth: "bg-sky-500",
  session: "bg-emerald-500",
  artifact: "bg-violet-500",
  ssh: "bg-amber-500",
  audit: "bg-rose-500",
}

const timeOnly = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
const dateTime = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})
const full = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "long" })

function formatTime(iso: string, now: number) {
  const d = new Date(iso)
  return new Date(now).toDateString() === d.toDateString() ? timeOnly.format(d) : dateTime.format(d)
}

function ResultBadge({ result }: { result: AuditEvent["result"] }) {
  if (result === "ok") return <Badge variant="secondary">ok</Badge>
  if (result === "denied") return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">denied</Badge>
  return <Badge variant="destructive">failed</Badge>
}

function FilterValue({
  children,
  onClick,
  title,
  className,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  className?: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn("max-w-full truncate text-left hover:underline", className)}
    >
      {children}
    </button>
  )
}

function subject(e: AuditEvent) {
  return e.artifact ?? (e.session ? `${e.provider ? `${e.provider}/` : ""}${e.session}` : e.provider)
}

function detailsText(details: AuditEvent["details"]) {
  return Object.entries(details ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ")
}

export function AuditTable({
  events,
  now,
  onFilter,
}: {
  events: AuditEvent[]
  now: number
  onFilter: (patch: AuditFilter) => void
}) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow>
          <TableHead className="w-6" />
          <TableHead className="w-32">Time</TableHead>
          <TableHead className="w-40">Who</TableHead>
          <TableHead className="w-40">Action</TableHead>
          <TableHead className="w-16">Result</TableHead>
          <TableHead>Subject</TableHead>
          <TableHead className="hidden xl:table-cell">Details</TableHead>
          <TableHead className="hidden w-32 lg:table-cell">Client</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((e) => {
          const expanded = open.has(e.id)
          const category = e.action.split(".")[0] ?? ""
          const what = subject(e)
          return (
            <Fragment key={e.id}>
              <TableRow
                className="cursor-pointer"
                data-state={expanded ? "selected" : undefined}
                onClick={() => toggle(e.id)}
              >
                <TableCell className="pr-0">
                  <ChevronRightIcon
                    className={cn("text-muted-foreground size-3.5 transition-transform", expanded && "rotate-90")}
                  />
                </TableCell>
                <TableCell className="tabular-nums">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>{formatTime(e.time, now)}</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {full.format(new Date(e.time))} · {formatRelative(e.time, now)}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  {e.actor ? (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <UserAvatar user={e.actor} className="size-5" />
                      <FilterValue title="Show only this user" onClick={() => onFilter({ actor: e.actor })}>
                        {e.actor}
                      </FilterValue>
                      {e.admin && <ShieldIcon className="text-muted-foreground size-3 shrink-0" aria-label="admin" />}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <span className={cn("size-1.5 shrink-0 rounded-full", categoryColor[category] ?? "bg-muted")} />
                    <FilterValue
                      title="Show only this action"
                      onClick={() => onFilter({ action: e.action })}
                      className="font-mono"
                    >
                      {e.action}
                    </FilterValue>
                  </span>
                </TableCell>
                <TableCell>
                  <ResultBadge result={e.result} />
                </TableCell>
                <TableCell className="max-w-0">
                  <div className="truncate font-mono">
                    {e.session ? (
                      <FilterValue title="Show this session's events" onClick={() => onFilter({ session: e.session })}>
                        {what}
                      </FilterValue>
                    ) : (
                      (what ?? <span className="text-muted-foreground font-sans">—</span>)
                    )}
                  </div>
                  {e.reason && e.result !== "ok" && <div className="text-destructive truncate">{e.reason}</div>}
                </TableCell>
                <TableCell className="text-muted-foreground hidden max-w-0 truncate xl:table-cell">
                  {detailsText(e.details)}
                </TableCell>
                <TableCell className="text-muted-foreground hidden truncate font-mono lg:table-cell">
                  {e.clientIp}
                </TableCell>
              </TableRow>
              {expanded && (
                <TableRow className="hover:bg-transparent">
                  <TableCell />
                  <TableCell colSpan={7} className="pb-3 whitespace-normal">
                    <EventDetail event={e} onFilter={onFilter} />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          )
        })}
      </TableBody>
    </Table>
  )
}

function EventDetail({ event: e, onFilter }: { event: AuditEvent; onFilter: (patch: AuditFilter) => void }) {
  const { id: _, ...raw } = e
  const fields: [string, string | undefined][] = [
    ["Time", e.time],
    ["Service", e.service],
    ["Actor", e.actor && `${e.actor}${e.admin ? " (admin)" : ""}`],
    ["Provider", e.provider],
    ["Session", e.session],
    ["Artifact", e.artifact],
    ["Reason", e.reason],
    ["Client IP", e.clientIp],
    ["X-Forwarded-For", e.forwardedFor],
    ["User agent", e.userAgent],
    ...Object.entries(e.details ?? {}).map(([k, v]): [string, string] => [k, v]),
  ]
  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
        {fields
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-mono break-all">{v}</dd>
            </Fragment>
          ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        {e.session && (
          <Button variant="outline" size="xs" onClick={() => onFilter({ session: e.session })}>
            <FilterIcon /> This session
          </Button>
        )}
        {e.session && e.provider && (
          <Button variant="outline" size="xs" asChild>
            <Link to="/session/$provider/$id" params={{ provider: e.provider, id: e.session }}>
              <ExternalLinkIcon /> Open session
            </Link>
          </Button>
        )}
        {e.clientIp && (
          <Button variant="outline" size="xs" onClick={() => onFilter({ q: e.clientIp })}>
            <FilterIcon /> This IP
          </Button>
        )}
        <span className="text-muted-foreground ml-auto flex items-center gap-1">
          JSON
          <CopyButton text={JSON.stringify(raw)} label="Copy as JSON" />
        </span>
      </div>
    </div>
  )
}
