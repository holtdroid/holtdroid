import { ArrowRightIcon, FilterIcon } from "lucide-react"
import { useState } from "react"
import type { Connection, DNSQuery } from "@/api/client"
import { Place } from "@/components/session/ip-place"
import type { Geo } from "@/components/session/use-routes"
import { Button } from "@/components/ui/button"
import type { DevToolsLog } from "@/lib/recording/devtools"
import { formatBytes } from "@/lib/format"
import {
  answerAddresses,
  continentName,
  type Exit,
  type HostRoute,
  isFar,
  type RouteFlag,
  summarize,
} from "@/lib/routes"
import { cn } from "@/lib/utils"

const cols = "grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.6fr)_72px_52px_80px_minmax(0,1fr)]"

const flagTones: Record<RouteFlag["id"], string> = {
  far: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  churn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  bypass: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  plain: "bg-stage-error/15 text-stage-error",
}

function FlagBadge({ flag }: { flag: RouteFlag }) {
  return (
    <span title={flag.title} className={cn("shrink-0 rounded-sm px-1 text-[10.5px] leading-4", flagTones[flag.id])}>
      {flag.label}
    </span>
  )
}

function ExitPath({ exit, geo }: { exit: Exit & { address?: string }; geo: Geo }) {
  const info = exit.address ? geo.info.get(exit.address) : undefined
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span>Device</span>
      <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" />
      <span className="font-medium">{exit.location ?? "?"}</span>
      {exit.address && (
        <>
          <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" />
          <span className="font-mono text-muted-foreground">{exit.address}</span>
          <Place info={info} />
        </>
      )}
      <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" />
      <span>servers</span>
    </span>
  )
}

/** The device's connections by name: where each server is, how it was reached and what looks off. */
export function RoutesTable({
  routes,
  geo,
  exit,
  picked,
  onPick,
  time,
  lookups,
  webview,
  empty,
}: {
  routes: HostRoute[]
  geo: Geo
  exit: Exit & { address?: string }
  picked: string | null
  onPick: (key: string | null) => void
  time: (iso: string) => string
  lookups?: (host: string) => DNSQuery[]
  webview?: { log: DevToolsLog; time: number }
  empty: string
}) {
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const sum = summarize(routes, geo.info)
  const shown = flaggedOnly ? routes.filter((r) => r.flags.length > 0) : routes
  const selected = routes.find((r) => r.key === picked)

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[12px]">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b px-2 py-1.5">
        <ExitPath exit={exit} geo={geo} />
        <span className="text-muted-foreground">
          {sum.servers} {sum.servers === 1 ? "name" : "names"} · {sum.countries.length}{" "}
          {sum.countries.length === 1 ? "country" : "countries"} · {sum.cdn} on a CDN edge
          {sum.far > 0 && <span className="text-amber-700 dark:text-amber-400"> · {sum.far} on another continent</span>}
        </span>
        <Button
          size="xs"
          variant={flaggedOnly ? "secondary" : "ghost"}
          className="ml-auto"
          aria-pressed={flaggedOnly}
          onClick={() => setFlaggedOnly(!flaggedOnly)}
          title="Show only names with a far server, connections that aren't reused, traffic past the VPN or plain HTTP"
        >
          <FilterIcon />
          Flagged{sum.flagged > 0 ? ` (${sum.flagged})` : ""}
        </Button>
      </div>
      <div className={cn("grid shrink-0 border-b bg-muted/40 px-2 py-1 text-muted-foreground", cols)}>
        <span>Name</span>
        <span>Address</span>
        <span>Where</span>
        <span title="The VPN location (or bypass) the traffic left through">Via</span>
        <span className="text-right" title="Connections, open ones in brackets">
          Conns
        </span>
        <span className="text-right" title="Bytes received">
          Down
        </span>
        <span className="pl-2">Flags</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {shown.length === 0 && (
          <p className="p-4 text-center text-muted-foreground">{flaggedOnly ? "Nothing flagged." : empty}</p>
        )}
        {shown.map((r) => (
          <div
            key={r.key}
            role="button"
            tabIndex={0}
            onClick={() => onPick(picked === r.key ? null : r.key)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onPick(picked === r.key ? null : r.key)
            }}
            className={cn(
              "grid cursor-default items-center border-b border-border/50 px-2 py-1 hover:bg-accent/50",
              cols,
              picked === r.key && "bg-accent",
              r.open === 0 && "text-muted-foreground",
            )}
          >
            <span className="truncate font-mono" title={r.key}>
              {r.key}
            </span>
            <span className="truncate font-mono text-muted-foreground" title={r.addresses.join(", ")}>
              {r.addresses[0]}
              {r.addresses.length > 1 && <span className="opacity-60"> +{r.addresses.length - 1}</span>}
            </span>
            <span className="min-w-0 truncate">
              <Place info={geo.info.get(r.addresses[0]!)} />
            </span>
            <span className="truncate">{r.outbounds.join(", ")}</span>
            <span className="text-right font-mono tabular-nums">
              {r.conns.length}
              {r.open > 0 && <span className="text-muted-foreground"> ({r.open})</span>}
            </span>
            <span className="text-right font-mono text-muted-foreground tabular-nums">{formatBytes(r.download)}</span>
            <span className="flex min-w-0 gap-1 overflow-hidden pl-2">
              {r.flags.map((f) => (
                <FlagBadge key={f.id} flag={f} />
              ))}
            </span>
          </div>
        ))}
      </div>
      {selected && (
        <RouteDetails
          route={selected}
          geo={geo}
          exit={exit}
          time={time}
          lookups={lookups?.(selected.key) ?? []}
          webview={webview}
        />
      )}
      {geo.database ? (
        <p className="shrink-0 border-t px-2 py-0.5 text-[11px] text-muted-foreground">
          <a href="https://db-ip.com" target="_blank" rel="noreferrer" className="hover:underline">
            IP Geolocation by DB-IP
          </a>{" "}
          ({geo.database})
        </p>
      ) : (
        <p className="shrink-0 border-t px-2 py-0.5 text-[11px] text-muted-foreground">
          The portal has no IP geolocation database, so only CDN edges are told apart.
        </p>
      )}
    </div>
  )
}

function duration(c: Connection) {
  if (!c.end) return "open"
  const ms = Date.parse(c.end) - Date.parse(c.start)
  return ms < 1000 ? "<1 s" : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`
}

function RouteDetails({
  route,
  geo,
  exit,
  time,
  lookups,
  webview,
}: {
  route: HostRoute
  geo: Geo
  exit: Exit & { address?: string }
  time: (iso: string) => string
  lookups: DNSQuery[]
  webview?: { log: DevToolsLog; time: number }
}) {
  const exitInfo = exit.address ? geo.info.get(exit.address) : undefined
  const answers = answerAddresses(lookups)
  return (
    <div className="max-h-[50%] shrink-0 overflow-auto border-t bg-muted/20 p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[13px] font-medium break-all">{route.key}</span>
        <span className="text-muted-foreground">
          ↑ {formatBytes(route.upload)} ↓ {formatBytes(route.download)} · ports {route.ports.join(", ")}
        </span>
      </div>
      {route.flags.map((f) => (
        <p key={f.id} className="mt-1 flex items-baseline gap-1.5">
          <FlagBadge flag={f} />
          <span>{f.title}</span>
        </p>
      ))}
      <section className="mt-2">
        <h4 className="text-muted-foreground">Servers</h4>
        <ul className="mt-0.5 grid gap-0.5">
          {route.addresses.map((a) => {
            const info = geo.info.get(a)
            return (
              <li key={a} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-baseline gap-2">
                <span className="font-mono">{a}</span>
                <span className="flex min-w-0 items-baseline gap-2">
                  <Place info={info} />
                  {isFar(info, exitInfo) && (
                    <span className="shrink-0 text-amber-700 dark:text-amber-400">
                      {continentName(info?.continent)}, the exit is in {continentName(exitInfo?.continent)}
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
      {lookups.length > 0 && (
        <section className="mt-2">
          <h4 className="text-muted-foreground">
            DNS answers{" "}
            <span className="opacity-70">(asked through the VPN location, so geo-DNS answers for its country)</span>
          </h4>
          <ul className="mt-0.5 grid gap-0.5">
            {answers.map((a) => (
              <li key={a} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-baseline gap-2">
                <span className={cn("font-mono", !route.addresses.includes(a) && "text-muted-foreground")}>{a}</span>
                <Place info={geo.info.get(a)} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {webview && <WebViewTimings route={route} log={webview.log} time={webview.time} />}
      <section className="mt-2">
        <h4 className="text-muted-foreground">Connections</h4>
        <div className="mt-0.5 grid grid-cols-[72px_52px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 gap-y-0.5 font-mono">
          {route.conns.map((c) => (
            <div key={c.id} className="contents">
              <span className="text-muted-foreground tabular-nums">{time(c.start)}</span>
              <span className="text-muted-foreground">{duration(c)}</span>
              <span className="truncate">
                {c.network}/{c.port} {c.address}
              </span>
              <span className="truncate">{c.outbound}</span>
              <span className="truncate text-muted-foreground tabular-nums">
                ↑ {formatBytes(c.upload)} ↓ {formatBytes(c.download)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function median(xs: number[]) {
  const s = xs.toSorted((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

function WebViewTimings({ route, log, time }: { route: HostRoute; log: DevToolsLog; time: number }) {
  const timed = log.requestsUntil(time).filter((r) => {
    try {
      return new URL(r.url).hostname === route.key && r.timing
    } catch {
      return false
    }
  })
  if (timed.length === 0) return null
  const stage = (pick: (t: NonNullable<(typeof timed)[number]["timing"]>) => number) => {
    const xs = timed.map((r) => pick(r.timing!)).filter((x) => x >= 0)
    return xs.length ? `${Math.round(median(xs))} ms` : "—"
  }
  const fresh = timed.filter((r) => r.timing!.connect >= 0).length
  return (
    <section className="mt-2">
      <h4 className="text-muted-foreground">
        In the WebView, median of {timed.length} request{timed.length === 1 ? "" : "s"}
      </h4>
      <p className="mt-0.5 font-mono">
        connect {stage((t) => t.connect - Math.max(t.ssl, 0))} · TLS {stage((t) => t.ssl)} · waiting{" "}
        {stage((t) => t.wait)}
        <span className="font-sans text-muted-foreground">
          {" "}
          · {fresh} of {timed.length} opened a new connection
        </span>
      </p>
    </section>
  )
}
