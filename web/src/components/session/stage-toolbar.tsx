import { useQueryClient } from "@tanstack/react-query"
import {
  BellIcon,
  ChevronLeftIcon,
  CircleIcon,
  KeyboardIcon,
  LockIcon,
  LockOpenIcon,
  MinusIcon,
  PlusIcon,
  PowerIcon,
  RotateCcwIcon,
  RotateCwIcon,
  ScanIcon,
  SquareIcon,
  ToggleRightIcon,
  Volume2Icon,
  VolumeXIcon,
  type LucideIcon,
} from "lucide-react"
import { type ComponentProps, useState } from "react"
import { toast } from "sonner"
import { type DeviceAction, sessionBase } from "@/api/client"
import type { LiveScreen } from "@/components/session/live-screen"
import {
  deviceKey,
  useDevice,
  useRestartApp,
  useRunDeviceAction,
  useUpdateDevice,
} from "@/components/session/use-device"
import {
  Row,
  Section,
  ShadeHeader,
  ShadePanel,
  ShadeRoot,
  ShadeSideContext,
  ShadeSlider,
  Tile,
} from "@/components/session/shade"
import { HoverCardTrigger } from "@/components/ui/hover-card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { download, stamp } from "@/lib/adb"
import { type LockMode, setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"
import { cn } from "@/lib/utils"

type Run = (a: DeviceAction) => void

const lockModes: Record<LockMode, { label: string; hint: string; icon: LucideIcon }> = {
  lock: { label: "Lock screen", hint: "Show the lock screen", icon: LockIcon },
  "screen-off": { label: "Turn screen off", hint: "Press the power button", icon: PowerIcon },
}

export const toolSize = 36

export function StageToolbar({
  provider,
  id,
  live,
  pkg,
  across,
}: {
  provider: string
  id: string
  live: LiveScreen
  pkg: string
  across: boolean
}) {
  const run = useRunDeviceAction(provider, id, live)
  const shot = useScreenshot(provider, id, live, pkg)
  const restart = useRestartApp(provider, id)
  const prefs = useScreenPrefs()
  const tip = across ? "bottom" : "right"
  const uhid = prefs.keyboard === "uhid"
  return (
    <ShadeSideContext value={across ? "top" : "right"}>
      <div
        role="toolbar"
        aria-label="Device"
        aria-orientation={across ? "horizontal" : "vertical"}
        className={cn(
          "flex shrink-0 gap-1.5",
          across ? "flex-row flex-wrap justify-center rounded-xl border bg-card p-1" : "flex-col",
        )}
      >
        <Tool label="Back" side={tip} icon={ChevronLeftIcon} onClick={() => run("back")} />
        <Tool label="Home" side={tip} icon={CircleIcon} onClick={() => run("home")} />
        <Tool label="Recent apps" side={tip} icon={SquareIcon} onClick={() => run("recents")} />
        <Tool label="Notifications" side={tip} icon={BellIcon} onClick={() => run("notifications")} />
        <Tool label="Quick settings" side={tip} icon={ToggleRightIcon} onClick={() => run("quick-settings")} />
        <Separator across={across} />
        <RotateTool run={run} />
        <Tool label="Screenshot" side={tip} icon={ScanIcon} disabled={shot.shooting} onClick={shot.take} />
        <Tool
          label={uhid ? "Keyboard: USB keyboard" : "Keyboard: text input"}
          side={tip}
          icon={KeyboardIcon}
          on={uhid}
          onClick={() => setScreenPrefs({ keyboard: uhid ? "text" : "uhid" })}
        />
        <VolumeTool provider={provider} id={id} run={run} />
        <PowerTool run={run} />
        <Separator across={across} />
        <Tool
          label="Restart app"
          side={tip}
          icon={RotateCwIcon}
          disabled={restart.isPending}
          onClick={() => restart.mutate()}
        />
      </div>
    </ShadeSideContext>
  )
}

function Separator({ across }: { across: boolean }) {
  return <span aria-hidden className={cn("shrink-0 bg-border", across ? "mx-0.5 my-1 w-px" : "mx-1.5 my-1 h-px")} />
}

function ToolButton({
  icon: Icon,
  on,
  className,
  ...props
}: ComponentProps<"button"> & { icon: LucideIcon; on?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cn(
        "grid size-9 shrink-0 cursor-pointer place-items-center rounded-[10px] border bg-card text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-95 disabled:cursor-default disabled:opacity-50 [&_svg]:size-4",
        on && "border-foreground text-foreground",
        className,
      )}
      {...props}
    >
      <Icon />
    </button>
  )
}

function Tool({
  label,
  side,
  ...props
}: ComponentProps<typeof ToolButton> & { label: string; side: "right" | "bottom" }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToolButton aria-label={label} {...props} />
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}

function useScreenshot(provider: string, id: string, live: LiveScreen, pkg: string) {
  const [shooting, setShooting] = useState(false)
  const take = async () => {
    setShooting(true)
    try {
      let blob = await live.connection?.snapshot()
      if (!blob) {
        const resp = await fetch(`${sessionBase(provider, id)}/v1/device/screenshot`)
        if (!resp.ok) throw new Error(resp.statusText || `HTTP ${resp.status}`)
        blob = await resp.blob()
      }
      download(blob, `${pkg}-${stamp()}.png`)
    } catch (e) {
      toast.error("Could not take a screenshot", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setShooting(false)
    }
  }
  return { shooting, take: () => void take() }
}

function RotateTool({ run }: { run: Run }) {
  return (
    <ShadeRoot>
      <HoverCardTrigger asChild>
        <ToolButton icon={RotateCcwIcon} aria-label="Rotate left" onClick={() => run("rotate-left")} />
      </HoverCardTrigger>
      <ShadePanel className="w-72">
        <ShadeHeader title="Rotate" summary="Turns the device a quarter turn" />
        <div className="grid grid-cols-2 gap-2">
          <Tile
            icon={RotateCcwIcon}
            label="Rotate left"
            status="Counter-clockwise"
            on={false}
            onClick={() => run("rotate-left")}
          />
          <Tile
            icon={RotateCwIcon}
            label="Rotate right"
            status="Clockwise"
            on={false}
            onClick={() => run("rotate-right")}
          />
        </div>
      </ShadePanel>
    </ShadeRoot>
  )
}

function VolumeTool({ provider, id, run }: { provider: string; id: string; run: Run }) {
  const device = useDevice(provider, id)
  const update = useUpdateDevice(provider, id)
  const qc = useQueryClient()
  const s = device.data
  const hasVolume = !!s && s.volumeMax > 0
  const muted = hasVolume && s.muted

  const press = (a: "volume-up" | "volume-down") => {
    run(a)
    window.setTimeout(() => void qc.invalidateQueries({ queryKey: deviceKey(provider, id) }), 400)
  }

  return (
    <ShadeRoot>
      <HoverCardTrigger asChild>
        <ToolButton icon={muted ? VolumeXIcon : Volume2Icon} aria-label="Volume" on={muted} />
      </HoverCardTrigger>
      <ShadePanel className="w-80">
        <ShadeHeader
          title="Volume"
          summary={!hasVolume ? "Media volume" : muted ? "Muted" : `${s.volume} of ${s.volumeMax}`}
        />
        <div className="grid grid-cols-2 gap-2">
          <Tile
            icon={MinusIcon}
            label="Volume down"
            status="Key press"
            on={false}
            onClick={() => press("volume-down")}
          />
          <Tile icon={PlusIcon} label="Volume up" status="Key press" on={false} onClick={() => press("volume-up")} />
        </div>
        {hasVolume && (
          <>
            <ShadeSlider
              key={s.volume}
              icon={muted ? VolumeXIcon : Volume2Icon}
              label="Media volume"
              value={s.volume}
              max={s.volumeMax}
              disabled={update.isPending}
              onCommit={(volume) => update.mutate({ volume })}
            />
            <Tile
              icon={muted ? VolumeXIcon : Volume2Icon}
              label="Mute the device"
              on={muted}
              wide
              disabled={update.isPending}
              onClick={() => update.mutate({ muted: !muted })}
            />
          </>
        )}
      </ShadePanel>
    </ShadeRoot>
  )
}

function PowerTool({ run }: { run: Run }) {
  const { lockMode } = useScreenPrefs()
  const mode = lockModes[lockMode] ? lockMode : "lock"
  const modes = Object.entries(lockModes) as [LockMode, (typeof lockModes)[LockMode]][]
  return (
    <ShadeRoot>
      <HoverCardTrigger asChild>
        <ToolButton
          icon={PowerIcon}
          aria-label={`Power: ${lockModes[mode].label.toLowerCase()}`}
          onClick={() => run(mode)}
        />
      </HoverCardTrigger>
      <ShadePanel className="w-80">
        <ShadeHeader title="Power" summary={`The key: ${lockModes[mode].label.toLowerCase()}`} />
        <div className="grid grid-cols-3 gap-2">
          <PowerAction icon={LockOpenIcon} label="Wake and unlock" onClick={() => run("unlock")} />
          {modes.map(([m, info]) => (
            <PowerAction key={m} icon={info.icon} label={info.label} onClick={() => run(m)} />
          ))}
        </div>
        <Section title="Pressing the power button">
          {modes.map(([m, info]) => (
            <Row
              key={m}
              selected={m === mode}
              icon={info.icon}
              title={info.label}
              onClick={() => setScreenPrefs({ lockMode: m })}
            >
              {info.hint}
            </Row>
          ))}
        </Section>
      </ShadePanel>
    </ShadeRoot>
  )
}

function PowerAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="group/action flex cursor-pointer flex-col items-center gap-2 rounded-xl border bg-card px-2 py-3 text-center text-xs transition-colors hover:bg-muted"
      onClick={onClick}
    >
      <span className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground transition-transform group-active/action:scale-95">
        <Icon className="size-4" />
      </span>
      {label}
    </button>
  )
}
