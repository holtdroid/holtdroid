import { CheckIcon, CircleAlertIcon, CopyIcon, Loader2Icon } from "lucide-react"
import { useState, type ReactNode } from "react"
import { toast } from "sonner"
import type { SessionState, SessionView } from "@/api/client"
import { AppIcon } from "@/components/app-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useNow } from "@/hooks/use-now"
import { cn } from "@/lib/utils"

export type StartState = SessionState | "queued"

export type StartInfo = {
  id?: string
  label?: string
  iconUrl?: string
  versionName?: string
  badges?: string[]
  rows?: [string, ReactNode][]
  since?: string | number
}

export function startSteps(queued: boolean, appData: SessionView["appData"], webview?: string) {
  const steps: { state: StartState; label: string }[] = [
    { state: "provisioning", label: "Reserving a device" },
    { state: "booting", label: "Booting Android" },
    { state: "installing", label: webview ? `Installing WebView ${webview} and the APK` : "Installing the APK" },
    { state: "instrumenting", label: "Enabling WebView debugging" },
    { state: "ready", label: "Ready" },
  ]
  if (appData) {
    steps.splice(3, 0, {
      state: "restoring",
      label: appData === "cache" ? "Restoring app data and cache" : "Restoring app data",
    })
  }
  if (queued) steps.unshift({ state: "queued", label: "Waiting for a free device" })
  return steps
}

export function sessionStartInfo(s: SessionView): StartInfo {
  const appData = s.appData === "cache" ? "Restored with cache" : s.appData ? "Restored" : "Fresh install"
  return {
    id: s.id,
    label: s.label || s.package,
    iconUrl: s.iconUrl,
    versionName: s.versionName,
    badges: [
      s.capabilities?.model || s.capabilities?.screen?.label,
      s.capabilities?.android && `Android ${s.capabilities.android}`,
      s.webview && `WebView ${s.webview}`,
      s.location,
    ].filter((b): b is string => !!b),
    rows: [
      [
        "Package",
        <span key="package" className="font-mono">
          {s.package}
        </span>,
      ],
      [
        "Device",
        <span key="device" className="font-mono">
          {s.slotLabel || s.slot}
        </span>,
      ],
      ["App data", appData],
    ],
    since: s.createdAt,
  }
}

function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

function Elapsed({ since }: { since: string | number }) {
  const now = useNow(1000)
  return (
    <span className="text-muted-foreground ml-2 font-mono text-xs tabular-nums">
      {clock(now - new Date(since).getTime())}
    </span>
  )
}

export function StartProgress({
  state,
  detail,
  reason,
  appData,
  webview,
  queued = false,
  session,
  info: given,
  children,
}: {
  state: StartState
  detail?: string
  reason?: string
  appData?: SessionView["appData"]
  webview?: string
  queued?: boolean
  session?: SessionView
  info?: StartInfo
  children?: ReactNode
}) {
  const [mounted] = useState(Date.now)
  const info = given ?? (session ? sessionStartInfo(session) : {})
  const steps = startSteps(queued, appData, webview)
  const current = steps.findIndex((s) => s.state === state)
  const failed = state === "failed"
  const since = info.since ?? mounted

  return (
    <div className="grid h-full place-items-center overflow-y-auto p-6">
      <section
        aria-label={failed ? "The device failed to start" : "Starting your device"}
        className="bg-card flex w-full max-w-[440px] flex-col rounded-2xl border"
      >
        <div className="grid gap-2.5 px-5 pt-[18px] pb-3.5">
          {info.id && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground font-mono text-xs">{info.id}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Copy session id"
                onClick={() =>
                  void navigator.clipboard.writeText(info.id ?? "").then(
                    () => toast.success("Session id copied"),
                    () => toast.error("Couldn't copy the session id"),
                  )
                }
              >
                <CopyIcon />
              </Button>
            </div>
          )}
          <div className="flex min-w-0 items-center gap-2.5">
            {info.label && <AppIcon src={info.iconUrl} className="size-7 rounded-lg" />}
            <h2 className="min-w-0 truncate text-[17px] font-semibold">
              {info.label ?? (failed ? "The device failed to start" : "Starting your device")}
            </h2>
            {info.versionName && (
              <span className="text-muted-foreground shrink-0 font-mono text-sm">{info.versionName}</span>
            )}
            {failed ? (
              <Badge variant="destructive">Failed</Badge>
            ) : state === "queued" ? (
              <Badge variant="warning">Queued</Badge>
            ) : state === "ready" ? (
              <Badge variant="success" dot>
                Ready
              </Badge>
            ) : (
              <Badge variant="info">
                <Loader2Icon className="animate-spin" />
                Starting
              </Badge>
            )}
          </div>
          {(info.badges?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {info.badges?.map((b) => (
                <Badge key={b} variant="secondary">
                  {b}
                </Badge>
              ))}
            </div>
          )}
          <div className="mt-1 flex items-center gap-1" aria-hidden>
            {steps.map((step, i) => (
              <span
                key={step.state}
                className={cn(
                  "h-1.5 flex-1 rounded-full",
                  failed
                    ? i === 0
                      ? "bg-danger"
                      : "bg-border"
                    : i < current || state === "ready"
                      ? "bg-success"
                      : i === current
                        ? "bg-info animate-pulse"
                        : "bg-border",
                )}
              />
            ))}
            {!failed && state !== "ready" && <Elapsed since={since} />}
          </div>
          <p className={cn("text-sm", failed ? "text-danger" : "text-muted-foreground")}>
            {failed ? reason || "See the provider logs for details." : detail || "This usually takes about a minute."}
          </p>
        </div>

        <ol className="mx-4 overflow-hidden rounded-xl border">
          {steps.map((step, i) => {
            const done = !failed && (i < current || state === "ready")
            const active = !failed && i === current && state !== "ready"
            const broken = failed && i === 0
            return (
              <li
                key={step.state}
                className={cn(
                  "flex min-h-10 items-center gap-2.5 px-3.5 py-2 text-[13px]",
                  i < steps.length - 1 && "border-b border-dashed",
                  active && "bg-muted font-medium",
                  !done && !active && !broken && "text-muted-foreground",
                )}
              >
                {done ? (
                  <CheckIcon className="text-success size-4 shrink-0" />
                ) : active ? (
                  <Loader2Icon className="text-info size-4 shrink-0 animate-spin" />
                ) : broken ? (
                  <CircleAlertIcon className="text-danger size-4 shrink-0" />
                ) : (
                  <span
                    aria-hidden
                    className="border-muted-foreground mx-px size-3.5 shrink-0 rounded-full border-[1.5px] border-dashed"
                  />
                )}
                <span className="flex-1">{step.label}</span>
              </li>
            )
          })}
        </ol>

        <div className="mt-auto grid gap-2.5 px-5 pt-4 pb-[18px]">
          {(info.rows?.length ?? 0) > 0 && (
            <>
              <div className="text-muted-foreground text-xs font-semibold tracking-[.06em] uppercase">Session</div>
              <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-2 text-[13px]">
                {info.rows?.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="min-w-0 truncate">{v}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {children && <div className="mt-1.5 flex gap-2 *:flex-1">{children}</div>}
        </div>
      </section>
    </div>
  )
}
