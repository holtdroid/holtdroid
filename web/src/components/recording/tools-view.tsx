import { CableIcon, GlobeIcon, type LucideIcon, SignpostIcon, SquareTerminalIcon, TerminalIcon } from "lucide-react"
import type { DNSEvent } from "@/api/client"
import { DNSView } from "@/components/recording/dns-view"
import { ClocksContext, type Clocks, PlayheadContext } from "@/components/recording/json-view"
import { ConsoleView, NetworkView, SocketsView } from "@/components/recording/devtools-view"
import { LogcatView } from "@/components/recording/logcat-view"
import { type DevToolsLog, requestPhase } from "@/lib/recording/devtools"
import { type PlayerView, type ToolTab, toolTabs } from "@/lib/recording/link"
import type { At } from "@/lib/recording/timeline"
import type { Player } from "@/lib/recording/player"
import { cn } from "@/lib/utils"

type Tab = ToolTab

const storageKey = "holtdroid.recording.tab"

/** The tab this browser last had open. */
export function savedTab(): ToolTab {
  try {
    const v = localStorage.getItem(storageKey)
    if (v && (toolTabs as string[]).includes(v)) return v as ToolTab
  } catch {
    return "logcat"
  }
  return "logcat"
}

/** The left column of the player: logcat and the WebViews' network, console and WebSockets. */
export function RecordingTools({
  player,
  time,
  log,
  dns,
  clocks,
  view,
  onView,
}: {
  player: Player
  time: number
  log: DevToolsLog
  dns: At<DNSEvent>[]
  clocks: Clocks
  view: PlayerView
  onView: (patch: PlayerView) => void
}) {
  const tab = view.tab ?? "logcat"
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
  const tabs: { id: Tab; label: string; icon: LucideIcon; count?: number; alert?: number }[] = [
    { id: "logcat", label: "Logcat", icon: SquareTerminalIcon },
    { id: "network", label: "Network", icon: GlobeIcon, count: requests.length, alert: failed },
    { id: "console", label: "Console", icon: TerminalIcon, count: messages.length, alert: errors },
    { id: "sockets", label: "WebSockets", icon: CableIcon, count: log.socketsUntil(time).length },
  ]
  if (dns.length > 0) {
    const queries = dns.filter((e) => e.v.query && e.t <= time)
    tabs.push({
      id: "dns",
      label: "DNS",
      icon: SignpostIcon,
      count: queries.length,
      alert: queries.filter((e) => e.v.query?.result === "failed").length,
    })
  }

  return (
    <section className="devtools-skin flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background text-foreground">
      <nav
        className="mb-2 flex h-9 shrink-0 gap-1 overflow-x-auto overflow-y-hidden border-b px-2 [scrollbar-width:none]"
        aria-label="Recording tools"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            onClick={() => pick(t.id)}
            className={cn(
              "inline-flex h-full shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm transition-colors [&_svg]:size-3.5",
              tab === t.id
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon />
            {t.label}
            {t.count ? (
              <span
                className={cn(
                  "min-w-5 rounded-full px-1.5 text-center text-[11px] leading-[18px] tabular-nums",
                  t.alert ? "bg-stage-error text-stage-on-error" : "bg-muted text-muted-foreground",
                )}
                title={t.alert ? `${t.alert} ${t.id === "network" ? "failed" : "errors"}` : undefined}
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
            {tab === "logcat" && <LogcatView player={player} time={time} />}
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
            {tab === "dns" && <DNSView events={dns} time={time} onSeek={seek} />}
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
