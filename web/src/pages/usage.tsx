import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { InfoIcon, ShieldAlertIcon } from "lucide-react"
import { useState } from "react"
import { useMe } from "@/api/queries"
import { rangeStart, type UsageRange, usageRanges, useSessionStats } from "@/api/stats"
import { EmptyPanel, Meter, PageHeader, Panel, SectionLabel } from "@/components/page"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { UserAvatar } from "@/components/user-avatar"
import { type Bucket, type Ended, formatHours, type Ranked, summarize, type Usage } from "@/lib/usage"
import { cn } from "@/lib/utils"

type Metric = "launches" | "people" | "seconds"

const metrics: Record<Metric, { label: string; format: (n: number) => string }> = {
  launches: { label: "Sessions", format: (n) => n.toLocaleString() },
  people: { label: "People", format: (n) => n.toLocaleString() },
  seconds: { label: "Device time", format: formatHours },
}

const endedLabels: Record<Ended, string> = {
  stopped: "Stopped by a person",
  idle: "Reaped after the idle timeout",
  ttl: "Reaped at the maximum lifetime",
  reaped: "Reaped",
  open: "Running, or ended without a record",
}

const hours = Array.from({ length: 24 }, (_, h) => h)
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
const fullDay = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" })

export function validateUsageSearch(search: Record<string, unknown>): { range?: UsageRange } {
  const range = search.range
  return typeof range === "string" && range in usageRanges ? { range: range as UsageRange } : {}
}

export function UsagePage() {
  const me = useMe()
  const admin = me.data?.admin === true
  const range = useSearch({ from: "/_portal/usage" }).range ?? "30d"
  const navigate = useNavigate({ from: "/usage" })
  const [metric, setMetric] = useState<Metric>("launches")
  const stats = useSessionStats(range, admin)

  if (me.data && !admin) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Alert>
          <ShieldAlertIcon />
          <AlertTitle>Admins only</AlertTitle>
          <AlertDescription>Usage statistics are visible to members of the admin groups.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const usage = stats.data
    ? summarize(stats.data.items, Date.parse(stats.data.since), Date.parse(stats.data.until))
    : undefined

  return (
    <div className="h-full overflow-y-auto pb-(--dock-space)">
      <div className="mx-auto grid max-w-6xl content-start gap-5 p-4 lg:px-8 lg:py-7">
        <PageHeader
          title="Usage"
          meta="Admins only"
          description="Devices launched from the portal, how long they ran and how they ended, from the api's database. Times are in your time zone."
        >
          <div className="ml-auto flex items-center gap-3">
            {stats.isFetching && <Spinner className="size-3" />}
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={range}
              onValueChange={(v) => v && void navigate({ search: { range: v as UsageRange }, replace: true })}
            >
              {Object.entries(usageRanges).map(([key, r]) => (
                <ToggleGroupItem key={key} value={key}>
                  {r.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </PageHeader>

        {stats.isError && (
          <Alert variant="destructive">
            <AlertDescription>Could not load usage: {stats.error.message}</AlertDescription>
          </Alert>
        )}
        {stats.data?.truncated && (
          <Alert>
            <InfoIcon />
            <AlertDescription>
              More sessions than one page holds: the newest are left out. Pick a shorter range.
            </AlertDescription>
          </Alert>
        )}

        {!usage ? (
          <Skeleton className="h-96 rounded-2xl" />
        ) : usage.launches === 0 ? (
          <EmptyPanel>
            No devices were launched since {fullDay.format(rangeStart(range))}. With database.type memory the history
            starts at the api's last restart.
          </EmptyPanel>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Tile label="Sessions" value={usage.launches.toLocaleString()} />
              <Tile label="People" value={usage.people.toLocaleString()} />
              <Tile label="Device time" value={formatHours(usage.seconds)} hint="ended sessions" />
              <Tile label="Median session" value={formatHours(usage.median)} />
              <Tile label="90th percentile" value={formatHours(usage.p90)} />
            </div>

            <Panel className="grid gap-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionLabel>
                  {metrics[metric].label} per {usage.unit}
                </SectionLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  spacing={0}
                  value={metric}
                  onValueChange={(v) => v && setMetric(v as Metric)}
                >
                  {Object.entries(metrics).map(([key, m]) => (
                    <ToggleGroupItem key={key} value={key}>
                      {m.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <Bars buckets={usage.buckets} metric={metric} unit={usage.unit} />
            </Panel>

            <div className="grid gap-5 lg:grid-cols-2">
              <Panel className="grid content-start gap-4 p-4">
                <SectionLabel>When devices are launched</SectionLabel>
                <Heatmap cells={usage.heatmap} />
              </Panel>
              <Panel className="grid content-start gap-4 p-4">
                <SectionLabel>Session length</SectionLabel>
                <Shares rows={usage.durations.map((d) => ({ label: d.label, count: d.count }))} />
                <SectionLabel className="pt-2">How sessions ended</SectionLabel>
                <Shares
                  rows={(Object.keys(endedLabels) as Ended[])
                    .filter((k) => usage.ended[k] > 0)
                    .map((k) => ({ label: endedLabels[k], count: usage.ended[k] }))}
                />
              </Panel>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <TopList title="Most active people" rows={usage.topPeople} people />
              <TopList title="Most launched apps" rows={usage.topApps} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Panel className="grid gap-1 p-4">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {hint && <span className="text-muted-foreground text-[11px]">{hint}</span>}
    </Panel>
  )
}

function Bars({ buckets, metric, unit }: { buckets: Bucket[]; metric: Metric; unit: Usage["unit"] }) {
  const max = Math.max(1, ...buckets.map((b) => b[metric]))
  const format = metrics[metric].format
  const label = (b: Bucket) => (unit === "week" ? `Week of ${dayFormat.format(b.start)}` : fullDay.format(b.start))
  const ticks = [
    { key: "first", bucket: buckets[0] },
    { key: "middle", bucket: buckets[Math.floor(buckets.length / 2)] },
    { key: "last", bucket: buckets.at(-1) },
  ]
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
      <div className="text-muted-foreground flex h-44 flex-col justify-between text-right text-[11px] tabular-nums">
        <span>{format(max)}</span>
        <span>0</span>
      </div>
      <div className="border-border flex h-44 items-end gap-[2px] border-b">
        {buckets.map((b) => (
          <Tooltip key={b.start}>
            <TooltipTrigger asChild>
              <div className="group flex h-full min-w-0 flex-1 items-end">
                <div
                  className="bg-primary group-hover:bg-primary/80 w-full rounded-t-[4px]"
                  style={{ height: `${(b[metric] / max) * 100}%`, minHeight: b[metric] > 0 ? 2 : 0 }}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <div className="font-medium">{label(b)}</div>
              <div>
                {b.launches.toLocaleString()} sessions · {b.people.toLocaleString()} people · {formatHours(b.seconds)}
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <span />
      <div className="text-muted-foreground flex justify-between pt-1.5 text-[11px]">
        {ticks.map((t) => (
          <span key={t.key}>{t.bucket ? dayFormat.format(t.bucket.start) : ""}</span>
        ))}
      </div>
    </div>
  )
}

function Heatmap({ cells }: { cells: number[][] }) {
  const max = Math.max(1, ...cells.flat())
  return (
    <div className="grid grid-cols-[auto_repeat(24,minmax(0,1fr))] gap-[2px] text-[10px]">
      {weekdays.map((name, day) => (
        <div key={name} className="contents">
          <span className="text-muted-foreground pr-1.5 leading-4">{name}</span>
          {hours.map((hour) => {
            const n = cells[day]?.[hour] ?? 0
            return (
              <Tooltip key={hour}>
                <TooltipTrigger asChild>
                  <div
                    className={cn("aspect-square rounded-[3px]", n === 0 ? "bg-muted" : "bg-primary")}
                    style={n > 0 ? { opacity: 0.15 + 0.85 * (n / max) } : undefined}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {name} {String(hour).padStart(2, "0")}:00–{String(hour + 1).padStart(2, "0")}:00 ·{" "}
                  {n.toLocaleString()} {n === 1 ? "launch" : "launches"}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      ))}
      <span />
      {hours.map((h) => (
        <span key={h} className="text-muted-foreground text-center">
          {h % 6 === 0 ? h : ""}
        </span>
      ))}
    </div>
  )
}

function Shares({ rows }: { rows: { label: string; count: number }[] }) {
  const total = Math.max(
    1,
    rows.reduce((sum, r) => sum + r.count, 0),
  )
  return (
    <div className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <span className="truncate">{r.label}</span>
          <Meter value={r.count / total} fill="bg-primary" className="h-1.5" />
          <span className="text-muted-foreground text-right tabular-nums">{r.count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

function TopList({ title, rows, people }: { title: string; rows: Ranked[]; people?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.launches))
  return (
    <Panel className="grid content-start gap-3 p-4">
      <SectionLabel>{title}</SectionLabel>
      <table className="w-full text-sm">
        <thead className="text-muted-foreground text-left text-xs">
          <tr>
            <th className="pb-1 font-normal">{people ? "Person" : "App"}</th>
            <th className="w-1/3 pb-1 font-normal" />
            <th className="pb-1 text-right font-normal">Sessions</th>
            <th className="pb-1 pl-3 text-right font-normal">Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="max-w-0 py-1 pr-3">
                {people && r.actor ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <UserAvatar user={r.actor} className="size-5" />
                    {r.named ? (
                      <Link to="/users" search={{ user: r.actor }} className="truncate hover:underline">
                        {r.label}
                      </Link>
                    ) : (
                      <span className="truncate">{r.label}</span>
                    )}
                  </span>
                ) : (
                  <span className={cn("block truncate", !people && "font-mono text-xs")}>{r.label}</span>
                )}
              </td>
              <td className="py-1">
                <Meter value={r.launches / max} fill="bg-primary" className="h-1.5" />
              </td>
              <td className="py-1 text-right tabular-nums">{r.launches.toLocaleString()}</td>
              <td className="text-muted-foreground py-1 pl-3 text-right tabular-nums">{formatHours(r.seconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}
