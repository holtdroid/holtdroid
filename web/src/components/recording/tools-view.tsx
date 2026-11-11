import { ChevronDownIcon } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

type Tab = ToolTab
type TabItem = { id: Tab; label: string; count?: number; alert?: number }

const tabGap = 18
const tabPadding = 16

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
  const tabs: TabItem[] = [
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
      <ToolTabs tabs={tabs} active={tab} onPick={pick} />
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

function TabCount({ tab }: { tab: TabItem }) {
  if (!tab.count) return null
  return (
    <span
      className={cn(
        "inline-grid h-[18px] min-w-[18px] place-items-center rounded-full border px-[5px] text-[11px] font-normal tabular-nums",
        tab.alert ? "border-transparent bg-danger-soft text-danger" : "text-muted-foreground",
      )}
      title={
        tab.alert
          ? `${tab.alert} ${tab.id === "network" ? "failed" : tab.id === "cache" ? "errors and warnings" : "errors"}`
          : undefined
      }
    >
      {tab.alert || tab.count}
    </span>
  )
}

const tabClass = "inline-flex h-full shrink-0 items-center gap-1.5 text-sm font-medium whitespace-nowrap"

/** The tabs that fit in one row, the active one always among them, and the rest under More. */
function ToolTabs({ tabs, active, onPick }: { tabs: TabItem[]; active: Tab; onPick: (t: Tab) => void }) {
  const [size, setSize] = useState<{ room: number; widths: number[]; more: number } | null>(null)
  const fit = useCallback((nav: HTMLElement | null) => {
    const ruler = nav?.querySelector<HTMLElement>("[data-ruler]")
    const observer = new ResizeObserver(() => {
      if (!nav || !ruler) return
      const items = [...ruler.children].map((c) => c.getBoundingClientRect().width)
      setSize({ room: nav.clientWidth - 2 * tabPadding, widths: items.slice(0, -1), more: items.at(-1) ?? 0 })
    })
    if (nav && ruler) {
      observer.observe(nav)
      observer.observe(ruler)
    }
    return () => observer.disconnect()
  }, [])

  let shown = tabs
  if (size && size.widths.length === tabs.length) {
    const total = size.widths.reduce((a, w) => a + w, 0) + tabGap * (tabs.length - 1)
    if (total > size.room) {
      const activeAt = Math.max(
        0,
        tabs.findIndex((t) => t.id === active),
      )
      const room = size.room - size.more - tabGap
      const keep = new Set([activeAt])
      let used = size.widths[activeAt]!
      tabs.forEach((_, i) => {
        if (i === activeAt) return
        const w = size.widths[i]! + tabGap
        if (used + w > room) return
        keep.add(i)
        used += w
      })
      shown = tabs.filter((_, i) => keep.has(i))
    }
  }
  const rest = tabs.filter((t) => !shown.includes(t))

  return (
    <nav
      ref={fit}
      className="relative flex h-[42px] shrink-0 overflow-hidden border-b"
      style={{ gap: tabGap, paddingInline: tabPadding }}
      aria-label="Recording tools"
    >
      <div
        data-ruler
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 flex h-full w-max"
        style={{ gap: tabGap }}
      >
        {tabs.map((t) => (
          <span key={t.id} className={tabClass}>
            {t.label}
            <TabCount tab={t} />
          </span>
        ))}
        <span className={tabClass}>
          More
          {tabs.some((t) => t.alert) && <span className="size-1.5" />}
          <ChevronDownIcon className="size-3.5" />
        </span>
      </div>
      {shown.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={active === t.id}
          onClick={() => onPick(t.id)}
          className={cn(
            tabClass,
            "transition-colors",
            active === t.id
              ? "text-foreground shadow-[inset_0_-2px_0_var(--foreground)]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
          <TabCount tab={t} />
        </button>
      ))}
      {rest.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(tabClass, "text-muted-foreground transition-colors hover:text-foreground")}
            >
              More
              {rest.some((t) => t.alert) && <span className="size-1.5 rounded-full bg-danger" />}
              <ChevronDownIcon className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {rest.map((t) => (
              <DropdownMenuItem key={t.id} onSelect={() => onPick(t.id)} className="justify-between gap-3">
                {t.label}
                <TabCount tab={t} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  )
}
