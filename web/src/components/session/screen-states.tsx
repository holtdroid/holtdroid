import { LockIcon, MoonIcon, PowerIcon, RotateCwIcon, TriangleAlertIcon, XIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useNow } from "@/hooks/use-now"
import type { Crash } from "@/lib/logcat"
import { cn } from "@/lib/utils"

function StateCard({
  icon,
  title,
  detail,
  place = "bottom",
  tone,
  children,
}: {
  icon: ReactNode
  title: string
  detail?: ReactNode
  place?: "bottom" | "top" | "center"
  tone?: "danger"
  children?: ReactNode
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-xl border bg-card py-2 pr-2.5 pl-3 text-[13px] text-card-foreground shadow-float [&_button]:pointer-events-auto [&>svg]:size-4 [&>svg]:shrink-0",
        place === "bottom" && "bottom-3 left-1/2 -translate-x-1/2",
        place === "center" && "top-1/2 left-1/2 -translate-1/2",
        place === "top" && "inset-x-3 top-3",
        tone === "danger" && "border-danger",
      )}
    >
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span role="status" className="truncate font-medium">
          {title}
        </span>
        {detail && <span className="truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
      {children}
    </div>
  )
}

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

const timeOfDay = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" })

function Since({ at, prefix }: { at: number; prefix: string }) {
  const now = useNow()
  return `${prefix} ${timeOfDay.format(at)} · ${clock(now - at)}`
}

function Ago({ at }: { at: number }) {
  const now = useNow()
  return `The last frame is from ${Math.max(0, Math.round((now - at) / 1000))} s ago`
}

export function Connecting() {
  return <StateCard place="center" icon={<Spinner />} title="Connecting to the screen…" />
}

export function Reconnecting({ since }: { since: number }) {
  return (
    <StateCard
      icon={<Spinner className="text-muted-foreground" />}
      title="Reconnecting to the device"
      detail={<Ago at={since} />}
    />
  )
}

export function ScreenOff({ since, onWake }: { since?: number; onWake: () => void }) {
  return (
    <StateCard
      icon={<MoonIcon className="text-muted-foreground" />}
      title="Screen is off"
      detail={since ? <Since at={since} prefix="Since" /> : "Right-click the screen to wake it"}
    >
      <Button size="sm" onClick={onWake}>
        <PowerIcon />
        Wake
      </Button>
    </StateCard>
  )
}

export function Locked({ onUnlock }: { onUnlock: () => void }) {
  return (
    <StateCard
      place="center"
      icon={<LockIcon className="text-violet" />}
      title="Locked"
      detail="Swipe up on the screen, or unlock here"
    >
      <Button size="sm" onClick={onUnlock}>
        Unlock
      </Button>
    </StateCard>
  )
}

function crashLine(crash: Crash) {
  return (
    crash.lines.find((l) => /(Exception|Error)\b/.test(l))?.trim() ??
    crash.lines[0]?.trim() ??
    "The process ended unexpectedly"
  )
}

export function AppCrashed({
  label,
  crash,
  reopening,
  onLogcat,
  onReopen,
  onDismiss,
}: {
  label: string
  crash: Crash
  reopening: boolean
  onLogcat?: () => void
  onReopen: () => void
  onDismiss: () => void
}) {
  return (
    <StateCard
      place="top"
      tone="danger"
      icon={<TriangleAlertIcon className="text-danger" />}
      title={`${label} crashed`}
      detail={`${crashLine(crash)} · ${timeOfDay.format(crash.time)}`}
    >
      {onLogcat && (
        <Button size="sm" variant="outline" onClick={onLogcat}>
          Logcat
        </Button>
      )}
      <Button size="sm" disabled={reopening} onClick={onReopen}>
        Reopen
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Dismiss" onClick={onDismiss}>
        <XIcon />
      </Button>
    </StateCard>
  )
}

export function AppClosed({ label, reopening, onReopen }: { label: string; reopening: boolean; onReopen: () => void }) {
  return (
    <StateCard
      place="top"
      icon={<RotateCwIcon className="text-muted-foreground" />}
      title={`${label} is closed`}
      detail="It was swiped away, stopped or killed"
    >
      <Button size="sm" disabled={reopening} onClick={onReopen}>
        Reopen
      </Button>
    </StateCard>
  )
}
