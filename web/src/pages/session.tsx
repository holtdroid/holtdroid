import { Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeftIcon, ClockIcon, Loader2Icon, SquareIcon, TimerResetIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { sessionBase, type StatusEvent } from "@/api/client"
import { canManage, useAppData, useExtendSession, useMe, useProviders, useSession, useStopSession } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { useADBInfo, useAdbSession } from "@/components/session/adb-session"
import { DeviceRail } from "@/components/session/device-rail"
import { DeviceScreen } from "@/components/session/device-screen"
import { useLiveScreen } from "@/components/session/live-screen"
import { DevToolsPanel } from "@/components/session/devtools-panel"
import { useMetricsHistory } from "@/components/session/metrics"
import { MetricsBar } from "@/components/session/metrics-bar"
import { ScreenSplit } from "@/components/session/screen-split"
import { AppActions, SessionToolbar } from "@/components/session/session-toolbar"
import { StartProgress } from "@/components/session/start-progress"
import { ToolTabs } from "@/components/session/tool-tabs"
import { VersionSwitcher } from "@/components/session/version-switcher"
import { SessionStateBadge } from "@/components/session-state-badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useActivityHeartbeat } from "@/hooks/use-activity-heartbeat"
import { useEventSource } from "@/hooks/use-event-source"
import { useNow } from "@/hooks/use-now"
import { formatDuration } from "@/lib/format"

export function SessionPage({ provider, id }: { provider: string; id: string }) {
  const { session, isPending } = useSession(provider, id)
  const providers = useProviders()
  const me = useMe()
  const stop = useStopSession()
  const extend = useExtendSession()
  const appData = useAppData()
  const navigate = useNavigate()
  const now = useNow()
  const registerFrame = useActivityHeartbeat(provider, id)
  const [status, setStatus] = useState<StatusEvent | null>(null)
  const [wasReady, setWasReady] = useState(false)
  const [tab, setTab] = useState("devtools")
  const live = useLiveScreen()
  const adbInfo = useADBInfo()

  const agentUp = session !== undefined && session.state !== "provisioning"
  useEventSource<{ state: StatusEvent }>(agentUp ? `${sessionBase(provider, id)}/v1/status` : null, {
    state: setStatus,
  })

  const state = session?.state === "failed" ? "failed" : (status?.state ?? session?.state)
  const metrics = useMetricsHistory(provider, id, state === "ready")
  if (state === "ready" && !wasReady) setWasReady(true)
  const manage = session ? canManage(me.data, session) : false
  const adbAllowed =
    adbInfo.data?.browser === true && (!adbInfo.data.ownerOnly || manage) && session?.capabilities?.adb !== false
  const adb = useAdbSession(provider, id, session?.package ?? "", adbAllowed && wasReady && state !== "failed")
  useEffect(
    () =>
      adb.logcat.onCrash((crash) =>
        toast.error("The app crashed", {
          description: <pre className="text-xs whitespace-pre-wrap">{crash.lines.slice(0, 5).join("\n")}</pre>,
          duration: 15_000,
          action: { label: "Logcat", onClick: () => setTab("logcat") },
        }),
      ),
    [adb],
  )

  if (isPending) {
    return <Skeleton className="m-6 h-[60vh] rounded-2xl" />
  }
  if (!session) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="grid gap-3">
          <p className="font-medium">This session has ended.</p>
          <p className="text-muted-foreground text-sm">It was stopped or reaped after being idle.</p>
          <Button asChild>
            <Link to="/">Back to APKs</Link>
          </Button>
        </div>
      </div>
    )
  }

  const caps = providers.data?.find((p) => p.name === provider)?.capabilities
  const left = Math.min(new Date(session.idleDeadline).getTime(), new Date(session.ttlDeadline).getTime()) - now

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/" aria-label="Back">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <div className="-ml-2 flex min-w-0 items-center gap-1">
          <VersionSwitcher session={session} disabled={state !== "ready" || !manage}>
            <AppIcon src={session.iconUrl} className="size-8" />
            <span className="grid min-w-0">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">{session.label || session.package}</span>
                <SessionStateBadge state={state ?? session.state} />
              </span>
              <span className="text-muted-foreground truncate font-mono text-xs">
                {session.package}
                {session.versionName ? ` · ${session.versionName}` : ""} · {session.slot}
                {session.webview ? ` · WebView ${session.webview}` : ""}
              </span>
            </span>
          </VersionSwitcher>
          {state === "ready" && caps && (
            <AppActions provider={provider} id={id} appRunning={status?.appRunning ?? true} />
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {state === "ready" && caps && <SessionToolbar provider={provider} id={id} />}
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs tabular-nums">
            <ClockIcon className="size-3.5" />
            {formatDuration(left)}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={!manage || extend.isPending}
            onClick={() =>
              extend.mutate(session, {
                onSuccess: () => toast("Session extended"),
                onError: (e) => toast.error("Could not extend", { description: e.message }),
              })
            }
          >
            <TimerResetIcon />
            Extend
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={!manage || stop.isPending}
            onClick={() =>
              stop.mutate(session, {
                onSuccess: () => void navigate({ to: "/" }),
                onError: (e) => toast.error("Could not stop", { description: e.message }),
              })
            }
          >
            {stop.isPending ? <Loader2Icon className="animate-spin" /> : <SquareIcon />}
            {stop.isPending && appData.data?.enabled && session.capabilities?.appData !== false && state === "ready"
              ? "Saving app data…"
              : "Stop"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {state !== "ready" ? (
          <StartProgress
            state={state ?? session.state}
            detail={status?.detail || session.detail}
            reason={session.reason || status?.reason}
            appData={session.appData}
            webview={session.webview}
          />
        ) : (
          <ScreenSplit>
            <DeviceScreen
              provider={provider}
              id={id}
              live={live}
              display={session.capabilities?.screen}
              locations={caps?.locations ?? []}
              clipboard={caps?.clipboard ?? false}
              metrics={metrics}
            />
            <DeviceRail
              provider={provider}
              id={id}
              session={session}
              live={live}
              adb={adbAllowed ? adb : null}
              locations={caps?.locations ?? []}
            />
            <ToolTabs tab={tab} onTab={setTab} adb={adbAllowed ? adb : null} session={session}>
              {caps?.devtools ? (
                <DevToolsPanel
                  provider={provider}
                  id={id}
                  frameRef={registerFrame}
                  debuggableOnly={session.capabilities?.devtools === "debuggable"}
                />
              ) : (
                <div className="text-muted-foreground grid h-full place-items-center text-sm">
                  This device does not support DevTools.
                </div>
              )}
            </ToolTabs>
          </ScreenSplit>
        )}
      </div>
      {state === "ready" && <MetricsBar history={metrics} />}
    </div>
  )
}
