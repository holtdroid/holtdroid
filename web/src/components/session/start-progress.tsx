import { CheckIcon, CircleAlertIcon, Loader2Icon } from "lucide-react"
import type { ReactNode } from "react"
import type { SessionState, SessionView } from "@/api/client"
import { cn } from "@/lib/utils"

export type StartState = SessionState | "queued"

function startSteps(queued: boolean, appData: SessionView["appData"]) {
  const steps: { state: StartState; label: string }[] = [
    { state: "provisioning", label: "Reserving a device" },
    { state: "booting", label: "Booting Android" },
    { state: "installing", label: "Installing the APK" },
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

export function StartProgress({
  state,
  detail,
  reason,
  appData,
  queued = false,
  children,
}: {
  state: StartState
  detail?: string
  reason?: string
  appData?: SessionView["appData"]
  queued?: boolean
  children?: ReactNode
}) {
  const steps = startSteps(queued, appData)
  const current = steps.findIndex((s) => s.state === state)
  const failed = state === "failed"

  return (
    <div className="grid h-full place-items-center p-6">
      <div className="bg-card w-full max-w-md rounded-2xl border p-6 [corner-shape:squircle] supports-[corner-shape:squircle]:rounded-[2.5rem]">
        <h2 className="mb-1 font-semibold">{failed ? "The device failed to start" : "Starting your device"}</h2>
        <p className="text-muted-foreground mb-5 text-sm">
          {failed ? reason || "See the provider logs for details." : detail || "This usually takes about a minute."}
        </p>
        <ol className="grid gap-3">
          {steps.map((step, i) => {
            const done = !failed && i < current
            const active = !failed && i === current
            return (
              <li key={step.state} className="flex items-center gap-3 text-sm">
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-full border",
                    done && "border-emerald-500 bg-emerald-500 text-white",
                    active && "border-primary",
                  )}
                >
                  {done ? (
                    <CheckIcon className="size-3.5" />
                  ) : active ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : failed && i === 0 ? (
                    <CircleAlertIcon className="text-destructive size-3.5" />
                  ) : null}
                </span>
                <span className={cn(!done && !active && "text-muted-foreground")}>{step.label}</span>
              </li>
            )
          })}
        </ol>
        {children && <div className="mt-5 flex justify-end gap-2">{children}</div>}
      </div>
    </div>
  )
}
