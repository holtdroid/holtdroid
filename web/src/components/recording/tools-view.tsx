import { useMemo } from "react"
import type { Connection, DNSEvent, Network } from "@/api/client"
import { CacheView } from "@/components/recording/cache-view"
import { DNSView } from "@/components/recording/dns-view"
import { RoutesView } from "@/components/recording/routes-view"
import { ClocksContext, type Clocks, PlayheadContext } from "@/components/recording/json-view"
import { ConsoleView, NetworkView, SocketsView } from "@/components/recording/devtools-view"
import { IssuesView } from "@/components/recording/issues-view"
import { LogcatView } from "@/components/recording/logcat-view"
import { analyzeCache } from "@/lib/recording/cache"
import { type DevToolsLog, requestPhase } from "@/lib/recording/devtools"
import type { Issue } from "@/lib/recording/lanes"
import { type PlayerView, type ToolTab, toolTabs } from "@/lib/recording/link"
import type { At } from "@/lib/recording/timeline"
import type { Player } from "@/lib/recording/player"
import { PixelPerfectPanel } from "@/components/session/pixel-perfect/panel"
import type { PixelTarget } from "@/components/session/pixel-perfect/source"
import type { PixelPerfect } from "@/components/session/pixel-perfect/state"
import { cn } from "@/lib/utils"

type Tab = ToolTab

const storageKey = "holtdroid.recording.tab"

/** The tab this browser last had open. */
export function savedTab(): ToolTab {
  try {
    const v = localStorage.getItem(storageKey)
    if (v && (toolTabs as string[]).includes(v)) return v as ToolTab
  } catch {
    return "findings"
  }
  return "findings"
}

/** The right column of the player: findings, logcat and the WebViews' network, console, WebSockets and caching. */
export function RecordingTools({
  player,
  time,
  log,
  dns,
  conns,
  network,
  share,
  clocks,
  view,
  onView,
  pixel,
  issues,
}: {
  player: Player
  time: number
  log: DevToolsLog
  dns: At<DNSEvent>[]
  conns: At<Connection>[]
  network: At<Network>[]
  share?: string
  clocks: Clocks
  view: PlayerView
  onView: (patch: PlayerView) => void
  /** Pixel perfect over the recording, when the viewer has references. */
  pixel?: { pp: PixelPerfect; target: PixelTarget }
  issues: Issue[]
}) {
  const tab = view.tab === "pixel-perfect" && !pixel ? "findings" : (view.tab ?? "findings")
  const pick = (t: Tab) => {
    onView({ tab: t })
    try {
      localStorage.setItem(storageKey, t)
    } catch {
      return
    }
  }
  const seek = (t: number) => void player.seek(t)
  const requests = log.requestsUntil(time)
  const failed = requests.filter((r) =>
    ["failed", "server-error", "client-error"].includes(requestPhase(r, time)),
  ).length
  const messages = log.consoleUntil(time)
  const errors = messages.filter((c) => c.level === "error").length
  const count = requests.length
  const cache = useMemo(() => analyzeCache(log.requests.slice(0, count)), [log, count])
  const found = issues.filter((i) => i.t <= time)
  const tabs: { id: Tab; label: string; count?: number; alert?: number }[] = [
    {
      id: "findings",
      label: "Findings",
      count: found.length,
      alert: found.filter((i) => i.level === "error").length,
    },
    { id: "logcat", label: "Logcat" },
    { id: "network", label: "Network", count: requests.length, alert: failed },
    { id: "console", label: "Console", count: messages.length, alert: errors },
    { id: "sockets", label: "WebSockets", count: log.socketsUntil(time).length },
  ]
  if (log.requests.length > 0) {
    tabs.push({
      id: "cache",
      label: "Cache",
      count: cache.findings.length,
      alert: cache.summary.errors + cache.summary.warnings,
    })
  }
  if (dns.length > 0) {
    const queries = dns.filter((e) => e.v.query && e.t <= time)
    tabs.push({
      id: "dns",
      label: "DNS",
      count: queries.length,
      alert: queries.filter((e) => e.v.query?.result === "failed").length,
    })
  }
  if (pixel) tabs.push({ id: "pixel-perfect", label: "Pixel perfect" })
  if (conns.length > 0) {
    tabs.push({
      id: "routes",
      label: "Routes",
      count: new Set(conns.filter((c) => c.t <= time).map((c) => c.v.host || c.v.address || c.v.id)).size,
    })
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card text-foreground">
      <nav
        className="flex h-[42px] shrink-0 gap-[18px] overflow-x-auto overflow-y-hidden border-b px-4 [scrollbar-width:none]"
        aria-label="Recording tools"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            onClick={() => pick(t.id)}
            className={cn(
              "inline-flex h-full shrink-0 items-center gap-1.5 text-sm font-medium transition-colors",
              tab === t.id
                ? "text-foreground shadow-[inset_0_-2px_0_var(--foreground)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.count ? (
              <span
                className={cn(
                  "inline-grid h-[18px] min-w-[18px] place-items-center rounded-full border px-[5px] text-[11px] font-normal tabular-nums",
                  t.alert ? "border-transparent bg-danger-soft text-danger" : "text-muted-foreground",
                )}
                title={
                  t.alert
                    ? `${t.alert} ${t.id === "network" ? "failed" : t.id === "cache" ? "errors and warnings" : "errors"}`
                    : undefined
                }
              >
                {t.alert || t.count}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      <ClocksContext value={clocks}>
        <PlayheadContext value={time}>
          <div className="flex min-h-0 flex-1 flex-col">
            {tab === "findings" && <IssuesView issues={issues} log={log} time={time} onSeek={seek} onView={onView} />}
            {tab === "logcat" && <LogcatView player={player} time={time} />}
            {pixel && tab === "pixel-perfect" && <PixelPerfectPanel pp={pixel.pp} target={pixel.target} active />}
            {tab === "network" && (
              <NetworkView
                log={log}
                time={time}
                onSeek={seek}
                picked={view.request}
                onPick={(request) => onView({ request })}
              />
            )}
            {tab === "console" && (
              <ConsoleView
                log={log}
                time={time}
                onSeek={seek}
                picked={view.message}
                onPick={(message) => onView({ message })}
              />
            )}
            {tab === "dns" && <DNSView events={dns} network={network} share={share} time={time} onSeek={seek} />}
            {tab === "routes" && (
              <RoutesView
                conns={conns}
                dns={dns}
                network={network}
                log={log}
                time={time}
                share={share}
                picked={view.route}
                onPick={(route) => onView({ route })}
              />
            )}
            {tab === "cache" && (
              <CacheView
                report={cache}
                onSeek={seek}
                picked={view.finding}
                onPick={(finding) => onView({ finding })}
                onReveal={(request) => onView({ tab: "network", request })}
                empty="No requests yet"
              />
            )}
            {tab === "sockets" && (
              <SocketsView
                log={log}
                time={time}
                onSeek={seek}
                socket={view.socket}
                frame={view.frame}
                onPick={(socket, frame) => onView({ socket, frame })}
              />
            )}
          </div>
        </PlayheadContext>
      </ClocksContext>
    </section>
  )
}
