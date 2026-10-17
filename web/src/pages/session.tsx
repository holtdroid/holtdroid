import { Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeftIcon, ClockIcon, SquareIcon, TimerResetIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { sessionBase, type StatusEvent } from "@/api/client"
import { canManage, useExtendSession, useMe, useProviders, useSession, useStopSession } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { DeviceRail } from "@/components/session/device-rail"
import { DeviceScreen } from "@/components/session/device-screen"
import { useLiveScreen } from "@/components/session/live-screen"
import { DevToolsPanel } from "@/components/session/devtools-panel"
import { SessionToolbar } from "@/components/session/session-toolbar"
import { StartProgress } from "@/components/session/start-progress"
import { VersionSwitcher } from "@/components/session/version-switcher"
import { SessionStateBadge } from "@/components/session-state-badge"
import { Button } from "@/components/ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
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
  const navigate = useNavigate()
  const now = useNow()
  const registerFrame = useActivityHeartbeat(provider, id)
  const [status, setStatus] = useState<StatusEvent | null>(null)
  const live = useLiveScreen()

  const agentUp = session !== undefined && session.state !== "provisioning"
  useEventSource<{ state: StatusEvent }>(agentUp ? `${sessionBase(provider, id)}/v1/status` : null, {
    state: setStatus,
  })

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
  const state = session.state === "failed" ? "failed" : (status?.state ?? session.state)
  const left = Math.min(new Date(session.idleDeadline).getTime(), new Date(session.ttlDeadline).getTime()) - now
  const manage = canManage(me.data, session)

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/" aria-label="Back">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <AppIcon src={session.iconUrl} className="size-8" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{session.label || session.package}</span>
            <SessionStateBadge state={state} />
          </div>
          <div className="text-muted-foreground truncate font-mono text-xs">
            {session.package}
            {session.versionName ? ` · ${session.versionName}` : ""} · {session.slot}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {state === "ready" && caps && (
            <SessionToolbar
              provider={provider}
              id={id}
              locations={caps.locations}
              clipboard={caps.clipboard}
              appRunning={status?.appRunning ?? true}
            />
          )}
          <VersionSwitcher session={session} disabled={state !== "ready" || !manage} />
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
            <SquareIcon />
            Stop
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {state !== "ready" ? (
          <StartProgress
            state={state}
            detail={status?.detail || session.detail}
            reason={session.reason || status?.reason}
          />
        ) : (
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize="42" minSize="20">
              <div className="flex size-full">
                <div className="min-w-0 flex-1">
                  <DeviceScreen provider={provider} id={id} live={live} />
                </div>
                <DeviceRail provider={provider} id={id} name={session.package} live={live} />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="58" minSize="20">
              {caps?.devtools ? (
                <DevToolsPanel provider={provider} id={id} frameRef={registerFrame} />
              ) : (
                <div className="text-muted-foreground grid h-full place-items-center text-sm">
                  This device does not support DevTools.
                </div>
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
    </div>
  )
}
