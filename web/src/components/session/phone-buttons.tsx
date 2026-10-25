import { useQueryClient } from "@tanstack/react-query"
import {
  BellIcon,
  ChevronLeftIcon,
  CircleIcon,
  LockIcon,
  LockOpenIcon,
  MinusIcon,
  PlusIcon,
  PowerIcon,
  RotateCcwSquareIcon,
  RotateCwSquareIcon,
  SquareIcon,
  ToggleRightIcon,
  Volume2Icon,
  VolumeXIcon,
  type LucideIcon,
} from "lucide-react"
import type { CSSProperties } from "react"
import type { DeviceAction } from "@/api/client"
import type { LiveScreen } from "@/components/session/live-screen"
import { deviceKey, useDevice, useRunDeviceAction, useUpdateDevice } from "@/components/session/use-device"
import { Button } from "@/components/ui/button"
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
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { type LockMode, setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"
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
    bar: "w-1 self-stretch group-hover/key:w-1.5 group-focus-visible/key:w-1.5 group-active/key:w-0.5",
    first: "rounded-tr-sm",
    last: "rounded-br-sm",
    only: "rounded-r-sm",
  },
  left: {
    rocker: "bottom-[17%] right-full h-[15%] flex-col-reverse",
    power: "bottom-[37%] right-full h-[9%] flex-col",
    key: "-mr-1 flex-row-reverse pr-1 pl-1",
    bar: "w-1 self-stretch group-hover/key:w-1.5 group-focus-visible/key:w-1.5 group-active/key:w-0.5",
    first: "rounded-bl-sm",
    last: "rounded-tl-sm",
    only: "rounded-l-sm",
  },
  top: {
    rocker: "left-[17%] bottom-full w-[15%] flex-row",
    power: "left-[37%] bottom-full w-[9%] flex-row",
    key: "-mb-1 flex-col-reverse pt-1 pb-1",
    bar: "h-1 self-stretch group-hover/key:h-1.5 group-focus-visible/key:h-1.5 group-active/key:h-0.5",
    first: "rounded-tl-sm",
    last: "rounded-tr-sm",
    only: "rounded-t-sm",
  },
  bottom: {
    rocker: "right-[17%] top-full w-[15%] flex-row-reverse",
    power: "right-[37%] top-full w-[9%] flex-row",
    key: "-mt-1 flex-col pt-1 pb-1",
    bar: "h-1 self-stretch group-hover/key:h-1.5 group-focus-visible/key:h-1.5 group-active/key:h-0.5",
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
}: {
  provider: string
  id: string
  live: LiveScreen
  edge: KeyEdge
}) {
  const run = useRunDeviceAction(provider, id, live)
  const layout = edges[edge]
  return (
    <>
      <ShadeSideContext value={edge}>
        <VolumeRocker provider={provider} id={id} run={run} layout={layout} />
        <PowerKey run={run} layout={layout} />
      </ShadeSideContext>
      {corners.map((c) => (
        <CornerMenu key={c.name} corner={c} run={run} />
      ))}
    </>
  )
}

const inset = 3.5

type Corner = { name: string; arc: string; place: CSSProperties; side: "left" | "right"; align: "start" | "end" }

const corners: Corner[] = [
  {
    name: "top-left",
    arc: "M0 100A100 100 0 0 1 100 0",
    place: { top: inset, left: inset },
    side: "left",
    align: "start",
  },
  {
    name: "top-right",
    arc: "M0 0A100 100 0 0 1 100 100",
    place: { top: inset, right: inset },
    side: "right",
    align: "start",
  },
  {
    name: "bottom-right",
    arc: "M100 0A100 100 0 0 1 0 100",
    place: { bottom: inset, right: inset },
    side: "right",
    align: "end",
  },
  {
    name: "bottom-left",
    arc: "M100 100A100 100 0 0 1 0 0",
    place: { bottom: inset, left: inset },
    side: "left",
    align: "end",
  },
]

const cornerGroups: { title: string; keys: { action: DeviceAction; label: string; icon: LucideIcon }[] }[] = [
  {
    title: "Navigation",
    keys: [
      { action: "back", label: "Back", icon: ChevronLeftIcon },
      { action: "home", label: "Home", icon: CircleIcon },
      { action: "recents", label: "Recent apps", icon: SquareIcon },
    ],
  },
  {
    title: "System",
    keys: [
      { action: "notifications", label: "Notifications", icon: BellIcon },
      { action: "quick-settings", label: "Quick settings", icon: ToggleRightIcon },
    ],
  },
  {
    title: "Rotation",
    keys: [
      { action: "rotate-left", label: "Rotate left", icon: RotateCcwSquareIcon },
      { action: "rotate-right", label: "Rotate right", icon: RotateCwSquareIcon },
    ],
  },
]

function CornerMenu({ corner, run }: { corner: Corner; run: Run }) {
  const size = `calc(var(--sr) + var(--bz) - ${inset}px)`
  return (
    <HoverCard openDelay={150} closeDelay={200}>
      <HoverCardTrigger asChild>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-label="Navigation and rotation"
          className="group/corner pointer-events-none absolute overflow-visible"
          style={{ ...corner.place, width: size, height: size }}
        >
          <path
            d={corner.arc}
            fill="none"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            className="stroke-neutral-600 stroke-[3px] transition-all duration-150 group-hover/corner:stroke-neutral-400 group-hover/corner:stroke-[4px]"
          />
          <path
            d={corner.arc}
            fill="none"
            vectorEffect="non-scaling-stroke"
            pointerEvents="stroke"
            className="cursor-pointer stroke-transparent stroke-[9px]"
          />
        </svg>
      </HoverCardTrigger>
      <HoverCardContent side={corner.side} align={corner.align} className="flex w-60 flex-col gap-2.5 p-2.5">
        {cornerGroups.map((g) => (
          <section key={g.title} className="grid gap-1">
            <h4 className="text-muted-foreground px-0.5 text-[11px] font-medium tracking-wide uppercase">{g.title}</h4>
            <div className="grid grid-cols-3 gap-1">
              {g.keys.map((k) => (
                <Button
                  key={k.action}
                  variant="ghost"
                  className="h-auto flex-col justify-start gap-1 px-1 py-1.5 text-[11px] font-normal whitespace-normal"
                  onClick={() => run(k.action)}
                >
                  <k.icon />
                  {k.label}
                </Button>
              ))}
            </div>
          </section>
        ))}
      </HoverCardContent>
    </HoverCard>
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
          "transition-all duration-150 ease-out group-active/key:duration-75",
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

  return (
    <ShadeRoot>
      <HoverCardTrigger asChild>
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
      </HoverCardTrigger>
      <ShadePanel className="w-80">
        <ShadeHeader
          title="Volume"
          summary={
            !s
              ? "Loading…"
              : !hasVolume
                ? "Not reported by this device"
                : muted
                  ? "Muted"
                  : `${s.volume} of ${s.volumeMax}`
          }
        />
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
