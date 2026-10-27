import {
  CableIcon,
  DatabaseZapIcon,
  GlobeIcon,
  ImageIcon,
  type LucideIcon,
  PenToolIcon,
  RouteIcon,
  SignpostIcon,
  SquareTerminalIcon,
  TerminalIcon,
  FrameIcon,
} from "lucide-react"
import { useMemo } from "react"
import type { Connection, DNSEvent, Network } from "@/api/client"
import { CacheView } from "@/components/recording/cache-view"
import { DNSView } from "@/components/recording/dns-view"
import { ImagesView } from "@/components/recording/images-view"
import { SvgView } from "@/components/recording/svg-view"
import { useImageReport, useSvgReport } from "@/components/recording/use-audits"
import { RoutesView } from "@/components/recording/routes-view"
import { ClocksContext, type Clocks, PlayheadContext } from "@/components/recording/json-view"
import { ConsoleView, NetworkView, SocketsView } from "@/components/recording/devtools-view"
import { LogcatView } from "@/components/recording/logcat-view"
import { analyzeCache } from "@/lib/recording/cache"
import { isImageRequest } from "@/lib/recording/images"
import { svgSources } from "@/lib/recording/svgpaths"
import { type DevToolsLog, requestPhase } from "@/lib/recording/devtools"
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
    return "logcat"
  }
  return "logcat"
}

/** The left column of the player: logcat and the WebViews' network, console, WebSockets, caching, images and SVG paths. */
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
}) {
  const tab = view.tab === "pixel-perfect" && !pixel ? "logcat" : (view.tab ?? "logcat")
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
  const second = Math.floor(time / 1000) * 1000
  const hasImages = useMemo(() => log.requests.some(isImageRequest), [log])
  const imageInput = useMemo(
    () => ({
      requests: log.requests.flatMap((r) => (r.end && r.end <= second ? [{ ...r, at: r.end }] : [])),
      shots: log.images.filter((s) => s.t <= second).map((s) => ({ ...s, at: s.t })),
      kinds: new Map(log.contexts().map((c) => [c.target, c.page.type ?? "page"])),
      now: second,
    }),
    [log, second],
  )
  const images = useImageReport(imageInput, tab === "images")
  const sources = useMemo(
    () =>
      svgSources(
        log.requests,
        log.images.flatMap((s) => (s.svgs?.length ? [{ target: s.target, url: s.url ?? "", svgs: s.svgs }] : [])),
      ),
    [log],
  )
  const svg = useSvgReport(sources, tab === "svg")
  const tabs: { id: Tab; label: string; icon: LucideIcon; count?: number; alert?: number }[] = [
    { id: "logcat", label: "Logcat", icon: SquareTerminalIcon },
    { id: "network", label: "Network", icon: GlobeIcon, count: requests.length, alert: failed },
    { id: "console", label: "Console", icon: TerminalIcon, count: messages.length, alert: errors },
    { id: "sockets", label: "WebSockets", icon: CableIcon, count: log.socketsUntil(time).length },
  ]
  if (log.requests.length > 0) {
    tabs.push({
      id: "cache",
      label: "Cache",
      icon: DatabaseZapIcon,
      count: cache.findings.length,
      alert: cache.summary.errors + cache.summary.warnings,
    })
  }
  if (hasImages) {
    tabs.push({
      id: "images",
      label: "Images",
      icon: ImageIcon,
      count: images.findings.length,
      alert: images.summary.errors + images.summary.warnings,
    })
  }
  if (svg.summary.paths > 0) {
    tabs.push({
      id: "svg",
      label: "SVG",
      icon: PenToolIcon,
      count: svg.findings.length,
      alert: svg.summary.errors + svg.summary.warnings,
    })
  }
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
  if (pixel) tabs.push({ id: "pixel-perfect", label: "Pixel perfect", icon: FrameIcon })
  if (conns.length > 0) {
    tabs.push({
      id: "routes",
      label: "Routes",
      icon: RouteIcon,
      count: new Set(conns.filter((c) => c.t <= time).map((c) => c.v.host || c.v.address || c.v.id)).size,
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
                title={
                  t.alert
                    ? `${t.alert} ${t.id === "network" ? "failed" : t.id === "cache" || t.id === "images" || t.id === "svg" ? "errors and warnings" : "errors"}`
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
            {tab === "images" && (
              <ImagesView
                report={images}
                onSeek={seek}
                picked={view.finding}
                onPick={(finding) => onView({ finding })}
                onReveal={(request) => onView({ tab: "network", request })}
                empty="No images loaded yet"
              />
            )}
            {tab === "svg" && (
              <SvgView
                report={svg}
                picked={view.finding}
                onPick={(finding) => onView({ finding })}
                onReveal={(request) => onView({ tab: "network", request })}
                empty="No SVG paths in the recorded files"
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
