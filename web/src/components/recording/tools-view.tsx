import { CableIcon, GlobeIcon, type LucideIcon, SquareTerminalIcon, TerminalIcon } from "lucide-react"
import { useState } from "react"
import { ClocksContext, type Clocks } from "@/components/recording/json-view"
import { ConsoleView, NetworkView, SocketsView } from "@/components/recording/devtools-view"
import { LogcatView } from "@/components/recording/logcat-view"
import { type DevToolsLog, requestPhase } from "@/lib/recording/devtools"
import type { Player } from "@/lib/recording/player"
import { cn } from "@/lib/utils"

type Tab = "logcat" | "network" | "console" | "sockets"

const storageKey = "holtdroid.recording.tab"

function savedTab(): Tab {
  try {
    const v = localStorage.getItem(storageKey)
    if (v === "logcat" || v === "network" || v === "console" || v === "sockets") return v
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
  clocks,
}: {
  player: Player
  time: number
  log: DevToolsLog
  clocks: Clocks
}) {
  const [tab, setTab] = useState<Tab>(savedTab)
  const pick = (t: Tab) => {
    setTab(t)
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

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] bg-stage-surface-low">
      <nav className="flex gap-1 overflow-x-auto px-3 pt-3 pb-2" aria-label="Recording tools">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            onClick={() => pick(t.id)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition-colors [&_svg]:size-4",
              tab === t.id
                ? "bg-stage-secondary-container text-stage-on-secondary-container"
                : "text-stage-on-surface-variant hover:bg-stage-surface-container",
            )}
          >
            <t.icon />
            {t.label}
            {t.count ? (
              <span
                className={cn(
                  "min-w-5 rounded-full px-1.5 text-center text-[11px] leading-[18px] tabular-nums",
                  t.alert
                    ? "bg-stage-error text-stage-on-error"
                    : tab === t.id
                      ? "bg-stage-surface-low/70 text-stage-on-surface-variant"
                      : "bg-stage-surface-high text-stage-outline",
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
        <div className="flex min-h-0 flex-1 flex-col">
          {tab === "logcat" && <LogcatView player={player} time={time} />}
          {tab === "network" && <NetworkView log={log} time={time} onSeek={seek} />}
          {tab === "console" && <ConsoleView log={log} time={time} onSeek={seek} />}
          {tab === "sockets" && <SocketsView log={log} time={time} onSeek={seek} />}
        </div>
      </ClocksContext>
    </section>
  )
}
