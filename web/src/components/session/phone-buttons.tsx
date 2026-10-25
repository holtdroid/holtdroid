import { useQueryClient } from "@tanstack/react-query"
import {
  BellIcon,
  CameraIcon,
  ChevronLeftIcon,
  CircleIcon,
  LockIcon,
  LockOpenIcon,
  MinusIcon,
  PlusIcon,
  PowerIcon,
  SquareIcon,
  ToggleRightIcon,
  Volume2Icon,
  VolumeXIcon,
  type LucideIcon,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { type DeviceAction, sessionBase } from "@/api/client"
import type { LiveScreen } from "@/components/session/live-screen"
import { deviceKey, useDevice, useRunDeviceAction, useUpdateDevice } from "@/components/session/use-device"
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
import { type LockMode, setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"
import { download, stamp } from "@/lib/adb"
import { cn } from "@/lib/utils"

type Run = (a: DeviceAction) => void

const lockModes: Record<LockMode, { label: string; hint: string; icon: LucideIcon }> = {
  lock: { label: "Lock screen", hint: "Show the lock screen", icon: LockIcon },
  "screen-off": { label: "Turn screen off", hint: "Press the power button", icon: PowerIcon },
}

export type KeyEdge = "right" | "top" | "bottom" | "left"

type EdgeLayout = { rocker: string; power: string; key: string; bar: string; first: string; last: string; only: string }

const edges: Record<KeyEdge, EdgeLayout> = {
  right: {
    rocker: "top-[17%] left-full h-[15%] flex-col",
    power: "top-[37%] left-full h-[9%] flex-col",
    key: "-ml-1 flex-row pr-1 pl-1",
    bar: "w-1.5 origin-left scale-x-[0.67] self-stretch group-hover/key:scale-x-100 group-focus-visible/key:scale-x-100 group-active/key:scale-x-[0.33]",
    first: "rounded-tr-sm",
    last: "rounded-br-sm",
    only: "rounded-r-sm",
  },
  left: {
    rocker: "bottom-[17%] right-full h-[15%] flex-col-reverse",
    power: "bottom-[37%] right-full h-[9%] flex-col",
    key: "-mr-1 flex-row-reverse pr-1 pl-1",
    bar: "w-1.5 origin-right scale-x-[0.67] self-stretch group-hover/key:scale-x-100 group-focus-visible/key:scale-x-100 group-active/key:scale-x-[0.33]",
    first: "rounded-bl-sm",
    last: "rounded-tl-sm",
    only: "rounded-l-sm",
  },
  top: {
    rocker: "left-[17%] bottom-full w-[15%] flex-row",
    power: "left-[37%] bottom-full w-[9%] flex-row",
    key: "-mb-1 flex-col-reverse pt-1 pb-1",
    bar: "h-1.5 origin-bottom scale-y-[0.67] self-stretch group-hover/key:scale-y-100 group-focus-visible/key:scale-y-100 group-active/key:scale-y-[0.33]",
    first: "rounded-tl-sm",
    last: "rounded-tr-sm",
    only: "rounded-t-sm",
  },
  bottom: {
    rocker: "right-[17%] top-full w-[15%] flex-row-reverse",
    power: "right-[37%] top-full w-[9%] flex-row",
    key: "-mt-1 flex-col pt-1 pb-1",
    bar: "h-1.5 origin-top scale-y-[0.67] self-stretch group-hover/key:scale-y-100 group-focus-visible/key:scale-y-100 group-active/key:scale-y-[0.33]",
    first: "rounded-br-sm",
    last: "rounded-bl-sm",
    only: "rounded-b-sm",
  },
}

export function PhoneButtons({
  provider,
  id,
  live,
  edge,
  pkg,
}: {
  provider: string
  id: string
  live: LiveScreen
  edge: KeyEdge
  pkg: string
}) {
  const run = useRunDeviceAction(provider, id, live)
  const shot = useScreenshot(provider, id, live, pkg)
  const layout = edges[edge]
  return (
    <>
      <ShadeSideContext value={edge}>
        <VolumeRocker provider={provider} id={id} run={run} layout={layout} />
        <PowerKey run={run} layout={layout} />
      </ShadeSideContext>
      <NavBar
        place="top"
        offset={edge === "top" ? keyArea : 0}
        keys={[
          { label: "Notifications", icon: BellIcon, onClick: () => run("notifications") },
          { label: "Quick settings", icon: ToggleRightIcon, onClick: () => run("quick-settings") },
          { label: "Screenshot", icon: CameraIcon, disabled: shot.shooting, onClick: shot.take },
        ]}
      />
      <NavBar
        place="bottom"
        offset={edge === "bottom" ? keyArea : 0}
        keys={[
          { label: "Back", icon: ChevronLeftIcon, onClick: () => run("back") },
          { label: "Home", icon: CircleIcon, onClick: () => run("home") },
          { label: "Recent apps", icon: SquareIcon, onClick: () => run("recents") },
        ]}
      />
    </>
  )
}

export const keyArea = 4 + 18
export const navArea = 24

type NavKey = { label: string; icon: LucideIcon; disabled?: boolean; onClick: () => void }

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

function NavBar({ place, keys, offset }: { place: "top" | "bottom"; keys: NavKey[]; offset: number }) {
  const top = place === "top"
  return (
    <div
      className={cn(
        "group/nav absolute left-1/2 flex w-[70%] -translate-x-1/2 justify-center",
        top ? "bottom-full items-end" : "top-full items-start",
      )}
      style={{ height: navArea, ...(top ? { marginBottom: offset } : { marginTop: offset }) }}
    >
      <span
        className={cn(
          "pointer-events-none absolute h-1.5 w-14 rounded-full bg-neutral-500/60 transition-opacity duration-150 group-focus-within/nav:opacity-0 group-hover/nav:opacity-0",
          top ? "bottom-2" : "top-2",
        )}
      />
      <div
        className={cn(
          "pointer-events-none flex gap-1.5 opacity-0 transition-all delay-200 duration-150 group-focus-within/nav:pointer-events-auto group-focus-within/nav:translate-y-0 group-focus-within/nav:opacity-100 group-focus-within/nav:delay-0 group-hover/nav:pointer-events-auto group-hover/nav:translate-y-0 group-hover/nav:opacity-100 group-hover/nav:delay-0",
          top ? "translate-y-1" : "-translate-y-1",
        )}
      >
        {keys.map((k) => (
          <button
            key={k.label}
            type="button"
            disabled={k.disabled}
            className="flex h-9 items-center gap-1.5 rounded-full bg-neutral-900 px-3.5 text-xs whitespace-nowrap text-neutral-100 shadow-lg ring-1 ring-white/15 transition hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:outline-none active:scale-95"
            onClick={k.onClick}
          >
            <k.icon className="size-4" />
            {k.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function SideKey({
  label,
  icon: Icon,
  flagged,
  layout,
  className,
  onClick,
}: {
  label: string
  icon: LucideIcon
  flagged?: boolean
  layout: EdgeLayout
  className?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn("group/key flex flex-1 cursor-pointer items-center gap-1 outline-none", layout.key)}
      onClick={onClick}
    >
      <span
        className={cn(
          "transition-[scale,background-color] duration-150 ease-out group-active/key:duration-75",
          layout.bar,
          flagged
            ? "bg-amber-500 group-hover/key:bg-amber-400 group-focus-visible/key:bg-amber-400"
            : "bg-neutral-600 group-hover/key:bg-neutral-400 group-focus-visible/key:bg-neutral-400",
          className,
        )}
      />
      <span
        className={cn(
          "transition-opacity [&_svg]:size-3.5",
          flagged ? "text-amber-600" : "text-muted-foreground",
          "opacity-75 group-hover/key:opacity-100 group-focus-visible/key:opacity-100",
        )}
      >
        <Icon />
      </span>
    </button>
  )
}

function VolumeRocker({ provider, id, run, layout }: { provider: string; id: string; run: Run; layout: EdgeLayout }) {
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

  const keys = (
    <div className={cn("absolute flex", layout.rocker)}>
      <SideKey
        label="Volume up"
        icon={PlusIcon}
        flagged={muted}
        layout={layout}
        className={layout.first}
        onClick={() => press("volume-up")}
      />
      <SideKey
        label="Volume down"
        icon={MinusIcon}
        flagged={muted}
        layout={layout}
        className={layout.last}
        onClick={() => press("volume-down")}
      />
    </div>
  )
  if (!hasVolume) return keys

  return (
    <ShadeRoot>
      <HoverCardTrigger asChild>{keys}</HoverCardTrigger>
      <ShadePanel className="w-80">
        <ShadeHeader title="Volume" summary={muted ? "Muted" : `${s.volume} of ${s.volumeMax}`} />
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
      </ShadePanel>
    </ShadeRoot>
  )
}

function PowerKey({ run, layout }: { run: Run; layout: EdgeLayout }) {
  const { lockMode } = useScreenPrefs()
  const mode = lockModes[lockMode] ? lockMode : "lock"
  return (
    <ShadeRoot>
      <HoverCardTrigger asChild>
        <div className={cn("absolute flex", layout.power)}>
          <SideKey
            label={lockModes[mode].label}
            icon={lockModes[mode].icon}
            layout={layout}
            className={layout.only}
            onClick={() => run(mode)}
          />
        </div>
      </HoverCardTrigger>
      <ShadePanel className="w-80">
        <ShadeHeader title="Power" summary={`The key: ${lockModes[mode].label.toLowerCase()}`} />
        <div className="grid grid-cols-3 gap-2">
          <PowerAction icon={LockOpenIcon} label="Wake and unlock" onClick={() => run("unlock")} />
          {(Object.entries(lockModes) as [LockMode, (typeof lockModes)[LockMode]][]).map(([m, info]) => (
            <PowerAction key={m} icon={info.icon} label={info.label} onClick={() => run(m)} />
          ))}
        </div>
        <Section title="Pressing the side key">
          {(Object.entries(lockModes) as [LockMode, (typeof lockModes)[LockMode]][]).map(([m, info]) => (
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
      className="group/action flex flex-col items-center gap-2 rounded-3xl bg-neutral-800 px-2 py-3 text-center text-xs text-neutral-100 transition-colors hover:bg-neutral-700"
      onClick={onClick}
    >
      <span className="grid size-11 place-items-center rounded-full bg-sky-200 text-sky-950 transition-transform group-active/action:scale-95">
        <Icon className="size-5" />
      </span>
      {label}
    </button>
  )
}
