import { useQueryClient } from "@tanstack/react-query"
import { CheckIcon, LockIcon, LockOpenIcon, PowerIcon, Volume2Icon, VolumeXIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import type { DeviceAction } from "@/api/client"
import { useDeviceAudio } from "@/components/session/device-audio"
import type { LiveScreen } from "@/components/session/live-screen"
import { deviceKey, useDevice, useRunDeviceAction, useUpdateDevice } from "@/components/session/use-device"
import { Button } from "@/components/ui/button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { type LockMode, setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"
import { cn } from "@/lib/utils"

type Run = (a: DeviceAction) => void

const lockModes: Record<LockMode, { label: string; hint: string; icon: ReactNode }> = {
  lock: { label: "Lock screen", hint: "Show the lock screen", icon: <LockIcon /> },
  "screen-off": { label: "Turn screen off", hint: "Press the power button", icon: <PowerIcon /> },
}

export function PhoneButtons({ provider, id, live }: { provider: string; id: string; live: LiveScreen }) {
  const run = useRunDeviceAction(provider, id, live)
  return (
    <>
      <VolumeRocker provider={provider} id={id} live={live} run={run} />
      <PowerKey run={run} />
    </>
  )
}

function SideKey({
  label,
  flagged,
  className,
  onClick,
}: {
  label: string
  flagged?: boolean
  className?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="group/key -ml-1 flex flex-1 cursor-pointer items-stretch pr-2 pl-1 outline-none"
      onClick={onClick}
    >
      <span
        className={cn(
          "w-1 transition-colors",
          flagged
            ? "bg-amber-500 group-hover/key:bg-amber-400 group-focus-visible/key:bg-amber-400"
            : "bg-neutral-600 group-hover/key:bg-neutral-400 group-focus-visible/key:bg-neutral-400",
          className,
        )}
      />
    </button>
  )
}

function VolumeRocker({ provider, id, live, run }: { provider: string; id: string; live: LiveScreen; run: Run }) {
  const audio = useDeviceAudio(provider, id, live)
  const device = useDevice(provider, id)
  const update = useUpdateDevice(provider, id)
  const qc = useQueryClient()
  const s = device.data
  const hasVolume = !!s && s.volumeMax > 0
  const deviceMuted = hasVolume && s.muted
  const flagged = deviceMuted || (audio.supported && (!audio.on || audio.muted))

  const press = (a: "volume-up" | "volume-down") => {
    run(a)
    window.setTimeout(() => void qc.invalidateQueries({ queryKey: deviceKey(provider, id) }), 400)
  }

  return (
    <HoverCard openDelay={150} closeDelay={150}>
      <HoverCardTrigger asChild>
        <div className="absolute top-[17%] left-full flex h-[15%] flex-col">
          <SideKey label="Volume up" flagged={flagged} className="rounded-tr-sm" onClick={() => press("volume-up")} />
          <SideKey
            label="Volume down"
            flagged={flagged}
            className="rounded-br-sm"
            onClick={() => press("volume-down")}
          />
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="flex w-72 flex-col gap-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">Device volume</span>
          {hasVolume && (
            <span className={cn("text-xs tabular-nums", deviceMuted ? "text-amber-600" : "text-muted-foreground")}>
              {deviceMuted ? "Muted" : `${s.volume} of ${s.volumeMax}`}
            </span>
          )}
        </div>
        {hasVolume ? (
          <>
            <VolumeSlider
              key={s.volume}
              volume={s.volume}
              max={s.volumeMax}
              disabled={update.isPending}
              onCommit={(volume) => update.mutate({ volume })}
            />
            <Toggle
              label="Mute the device"
              hint="Android's media volume; unmuting brings the level back"
              checked={s.muted}
              disabled={update.isPending}
              onChange={(muted) => update.mutate({ muted })}
            />
          </>
        ) : (
          <p className="text-muted-foreground text-xs">
            {s ? "This device doesn't report its volume; the side keys still press volume up and down." : "Loading…"}
          </p>
        )}
        <Separator />
        <Toggle
          label="Device audio"
          hint={audio.status}
          checked={audio.on}
          disabled={!audio.supported}
          onChange={audio.setOn}
        />
        <Toggle
          label="Silence this tab"
          hint="Keeps the device audio connected but quiet here"
          checked={audio.muted}
          disabled={!audio.supported || !audio.on}
          onChange={audio.setMuted}
        />
      </HoverCardContent>
    </HoverCard>
  )
}

function VolumeSlider({
  volume,
  max,
  disabled,
  onCommit,
}: {
  volume: number
  max: number
  disabled: boolean
  onCommit: (v: number) => void
}) {
  const [value, setValue] = useState(volume)
  return (
    <div className="flex items-center gap-3">
      {value === 0 ? (
        <VolumeXIcon className="text-muted-foreground size-4 shrink-0" />
      ) : (
        <Volume2Icon className="text-muted-foreground size-4 shrink-0" />
      )}
      <Slider
        min={0}
        max={max}
        step={1}
        value={[value]}
        disabled={disabled}
        onValueChange={([v = value]) => setValue(v)}
        onValueCommit={([v = value]) => onCommit(v)}
      />
    </div>
  )
}

function PowerKey({ run }: { run: Run }) {
  const { lockMode } = useScreenPrefs()
  const mode = lockModes[lockMode] ? lockMode : "lock"
  return (
    <HoverCard openDelay={150} closeDelay={150}>
      <HoverCardTrigger asChild>
        <div className="absolute top-[37%] left-full flex h-[9%] flex-col">
          <SideKey label={lockModes[mode].label} className="rounded-r-sm" onClick={() => run(mode)} />
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="flex w-56 flex-col gap-0.5 p-1">
        <Button
          variant="ghost"
          className="h-auto justify-start gap-2 px-2 py-1.5 text-left"
          onClick={() => run("unlock")}
        >
          <LockOpenIcon />
          <span className="flex flex-1 flex-col">
            <span>Wake and unlock</span>
            <span className="text-muted-foreground text-xs font-normal">Turn the screen on, skip the lock screen</span>
          </span>
        </Button>
        {(Object.entries(lockModes) as [LockMode, (typeof lockModes)[LockMode]][]).map(([m, info]) => (
          <Button
            key={m}
            variant="ghost"
            className="h-auto justify-start gap-2 px-2 py-1.5 text-left"
            onClick={() => {
              setScreenPrefs({ lockMode: m })
              run(m)
            }}
          >
            {info.icon}
            <span className="flex flex-1 flex-col">
              <span>{info.label}</span>
              <span className="text-muted-foreground text-xs font-normal">{info.hint}</span>
            </span>
            {m === mode && <CheckIcon className="text-muted-foreground" />}
          </Button>
        ))}
        <p className="text-muted-foreground px-2 pt-1 pb-1.5 text-xs">Clicking the button does the checked one</p>
      </HoverCardContent>
    </HoverCard>
  )
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Label className="flex items-center justify-between gap-3 font-normal">
      <span className="grid gap-0.5">
        <span className="text-sm">{label}</span>
        <span className="text-muted-foreground text-xs">{hint}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </Label>
  )
}
