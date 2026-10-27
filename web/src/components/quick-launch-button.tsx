import { CheckIcon, DatabaseIcon, HardDriveIcon, type LucideIcon, PackageIcon, ZapIcon } from "lucide-react"
import { type ReactNode, useRef, useState } from "react"
import type { ArtifactView } from "@/api/client"
import { useAppData } from "@/api/queries"
import { Button } from "@/components/ui/button"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { quickAppData, useLaunchTarget, useStartSession } from "@/hooks/use-launch-target"
import { needsAndroid } from "@/lib/android"
import { formatRelative } from "@/lib/format"
import { type QuickLaunchMode, quickLaunchMode, rememberQuickLaunchMode } from "@/lib/launch-prefs"
import { locationLabel } from "@/lib/location"
import { cn } from "@/lib/utils"

export function QuickLaunchButton({ artifact }: { artifact: ArtifactView }) {
  const { usable, provider, target, locations, location, free, screen, android, webview, blocked } = useLaunchTarget(
    null,
    null,
    null,
    null,
    null,
    null,
    artifact.minSdk,
    true,
    artifact.app?.package,
  )
  const launch = useStartSession()
  const appData = useAppData()
  const [mode, setMode] = useState<QuickLaunchMode>(quickLaunchMode)
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<number | undefined>(undefined)

  const pkg = artifact.app?.package
  const rules = appData.data
  const latest = rules?.items.find((d) => d.package === pkg)
  const disabled = usable.length === 0 || blocked
  const place = locations.find((l) => l.id === location)
  const where = `${provider?.name ?? "any device"}${android ? ` · Android ${android}` : ""}${place ? ` · ${locationLabel(place)}` : ""}`
  const hint = blocked
    ? `${needsAndroid(artifact.minSdk ?? 0)}; ${provider ? `“${provider.name}” doesn't offer it` : "no device here offers it"}`
    : usable.length === 0
      ? "No providers available"
      : free === 0
        ? `${provider ? `All slots of “${provider.name}”` : "All devices"} are busy, launching waits in line`
        : `Quick launch on ${where}`

  const fire = (m: QuickLaunchMode) => {
    if (disabled) return
    setOpen(false)
    if (m !== mode) {
      setMode(m)
      rememberQuickLaunchMode(m)
    }
    launch(artifact, { provider: target, location, screen, android, webview }, quickAppData(m, rules, pkg))
  }

  const button = (
    <Button variant="outline" size="icon" disabled={disabled} onClick={() => fire(mode)}>
      <ZapIcon />
      <span className="sr-only">Quick launch</span>
    </Button>
  )

  if (!rules?.enabled || disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={disabled ? 0 : undefined}>{button}</span>
        </TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
    )
  }

  const show = () => {
    window.clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const hide = () => {
    closeTimer.current = window.setTimeout(() => setOpen(false), 150)
  }
  const saved = latest ? `Saved ${formatRelative(latest.createdAt)}` : "Nothing saved yet, starts fresh"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span onMouseEnter={show} onMouseLeave={hide}>
          {button}
        </span>
      </PopoverAnchor>
      <PopoverContent
        align="end"
        className="w-72 p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        <p className="text-muted-foreground px-2 py-1.5 text-xs">Quick launch on {where}</p>
        <ModeItem icon={PackageIcon} active={mode === "fresh"} onSelect={() => fire("fresh")} label="Fresh install">
          Without app data
        </ModeItem>
        <ModeItem icon={DatabaseIcon} active={mode === "data"} onSelect={() => fire("data")} label="With app data">
          {saved}
        </ModeItem>
        {rules.cache && (
          <ModeItem
            icon={HardDriveIcon}
            active={mode === "cache"}
            onSelect={() => fire("cache")}
            label="With app data and cache"
          >
            {latest && !latest.cache ? "The latest save has no cache" : saved}
          </ModeItem>
        )}
      </PopoverContent>
    </Popover>
  )
}

function ModeItem({
  icon: Icon,
  label,
  active,
  onSelect,
  children,
}: {
  icon: LucideIcon
  label: string
  active: boolean
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm outline-none [&_svg]:size-4 [&_svg]:shrink-0",
        active && "font-medium",
      )}
    >
      <Icon className="text-muted-foreground" />
      <span className="grid min-w-0 flex-1">
        <span>{label}</span>
        <span className="text-muted-foreground truncate text-xs font-normal">{children}</span>
      </span>
      {active && <CheckIcon />}
    </button>
  )
}
