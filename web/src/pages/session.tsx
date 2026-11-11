import { Link } from "@tanstack/react-router"
import { ChevronLeftIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { sessionBase, type StatusEvent } from "@/api/client"
import { canManage, useMe, useProviders, useSession } from "@/api/queries"
import { useADBInfo, useAdbSession } from "@/components/session/adb-session"
import { DevicePanel } from "@/components/session/device-panel"
import { DeviceScreen } from "@/components/session/device-screen"
import { DevToolsPanel } from "@/components/session/devtools-panel"
import { useLiveScreen } from "@/components/session/live-screen"
import { useMetricsHistory } from "@/components/session/metrics"
import { NetworkPicker, type NetworkTab } from "@/components/session/network-picker"
import { usePixelPerfect } from "@/components/session/pixel-perfect/state"
import { useNetwork } from "@/components/session/use-device"
import { ScreenSplit } from "@/components/session/screen-split"
import { SessionHeader } from "@/components/session/session-header"
import { ShadeBounds } from "@/components/session/shade"
import { StartProgress, sessionStartInfo } from "@/components/session/start-progress"
import { ToolTabs } from "@/components/session/tool-tabs"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useActivityHeartbeat } from "@/hooks/use-activity-heartbeat"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { useEventSource } from "@/hooks/use-event-source"
import { useNow } from "@/hooks/use-now"

export function SessionPage({ provider, id }: { provider: string; id: string }) {
  const { session, isPending } = useSession(provider, id)
  const providers = useProviders()
  const me = useMe()
  const now = useNow()
  const registerFrame = useActivityHeartbeat(provider, id)
  useDocumentTitle(session ? session.label || session.package : undefined)
  const [status, setStatus] = useState<StatusEvent | null>(null)
  const [wasReady, setWasReady] = useState(false)
  const [tab, setTab] = useState("devtools")
  const [network, setNetwork] = useState<{ open: boolean; tab: NetworkTab }>({ open: false, tab: "networks" })
  const live = useLiveScreen()
  const pp = usePixelPerfect(live, provider, id, session?.capabilities?.screen)
  const adbInfo = useADBInfo()

  const agentUp = session !== undefined && session.state !== "provisioning"
  useEventSource<{ state: StatusEvent }>(agentUp ? `${sessionBase(provider, id)}/v1/status` : null, {
    state: setStatus,
  })

  const state = session?.state === "failed" ? "failed" : (status?.state ?? session?.state)
  const metrics = useMetricsHistory(provider, id, state === "ready")
  const [shadeBounds, setShadeBounds] = useState<HTMLDivElement | null>(null)
  if (state === "ready" && !wasReady) setWasReady(true)
  const manage = session ? canManage(me.data, session) : false
  const adbAllowed =
    adbInfo.data?.browser === true && (!adbInfo.data.ownerOnly || manage) && session?.capabilities?.adb !== false
  const adb = useAdbSession(provider, id, session?.package ?? "", adbAllowed && wasReady && state !== "failed")
  const caps = providers.data?.find((p) => p.name === provider)?.capabilities
  const locations = caps?.locations ?? []
  const net = useNetwork(provider, id, locations.length > 0 && state === "ready")
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
      <div className="relative grid h-full place-items-center p-6 text-center">
        <Button variant="outline" size="icon" className="absolute top-5 left-6" asChild>
          <Link to="/" aria-label="Back to apps">
            <ChevronLeftIcon />
          </Link>
        </Button>
        <div className="grid gap-3">
          <p className="font-medium">This session has ended.</p>
          <p className="text-sm text-muted-foreground">It was stopped or reaped after being idle.</p>
          <Button asChild>
            <Link to="/">Back to apps</Link>
          </Button>
        </div>
      </div>
    )
  }

  const location = net.data?.location ?? session.location
  const appRunning = status?.appRunning ?? true

  return (
    <div className="flex h-full flex-col gap-4 px-4 pt-5 sm:px-6">
      <SessionHeader
        session={session}
        state={state ?? session.state}
        manage={manage}
        now={now}
        locations={locations}
        location={location}
        recording={status?.recording}
        recordedAt={status?.recordedAt}
      />

      <div ref={setShadeBounds} className="flex min-h-0 flex-1 flex-col">
        <ShadeBounds value={shadeBounds}>
          {state !== "ready" ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <StartProgress
                state={state ?? session.state}
                detail={status?.detail || session.detail}
                reason={session.reason || status?.reason}
                appData={session.appData}
                webview={session.webview}
                info={sessionStartInfo(session, locations)}
              />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
              <div className="flex min-h-0 shrink-0 max-lg:max-h-80 lg:w-[300px] xl:w-[320px]">
                <DevicePanel
                  provider={provider}
                  id={id}
                  session={session}
                  live={live}
                  locations={locations}
                  clipboard={caps?.clipboard ?? false}
                  metrics={metrics}
                  recording={status?.recording}
                  recordedAt={status?.recordedAt}
                  manage={manage}
                  appRunning={appRunning}
                  adb={adbAllowed ? adb : null}
                  onConditions={() => setNetwork((n) => ({ ...n, open: true }))}
                />
              </div>
              <div className="min-h-[480px] min-w-0 flex-1">
                <ScreenSplit>
                  <DeviceScreen
                    provider={provider}
                    id={id}
                    live={live}
                    display={session.capabilities?.screen}
                    pkg={session.package}
                    label={session.label || session.package}
                    appRunning={appRunning}
                    adb={adbAllowed ? adb : null}
                    pp={pp}
                    onTab={setTab}
                  />
                  <ToolTabs
                    tab={tab}
                    onTab={setTab}
                    adb={adbAllowed ? adb : null}
                    session={session}
                    pp={pp}
                    devtools={!!caps?.devtools}
                  >
                    {caps?.devtools ? (
                      <DevToolsPanel
                        provider={provider}
                        id={id}
                        frameRef={registerFrame}
                        debuggableOnly={session.capabilities?.devtools === "debuggable"}
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-sm text-muted-foreground">
                        This device does not support DevTools.
                      </div>
                    )}
                  </ToolTabs>
                </ScreenSplit>
              </div>
            </div>
          )}
        </ShadeBounds>
      </div>

      <NetworkPicker
        provider={provider}
        id={id}
        pkg={session.package}
        location={locations.find((l) => l.id === location)?.label}
        open={network.open}
        onOpenChange={(open) => setNetwork((n) => ({ ...n, open }))}
        tab={network.tab}
        onTab={(t) => setNetwork((n) => ({ ...n, tab: t }))}
      />
    </div>
  )
}
