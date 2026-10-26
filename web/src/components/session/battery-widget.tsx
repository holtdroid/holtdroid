import {
  BatteryChargingIcon,
  BatteryFullIcon,
  BatteryLowIcon,
  BatteryMediumIcon,
  LeafIcon,
  PlugZapIcon,
  type LucideIcon,
} from "lucide-react"
import type { DeviceSettings, DeviceState } from "@/api/client"
import {
  CardLine,
  Chips,
  Note,
  ShadeCard,
  ShadeHeader,
  ShadePanel,
  ShadeRoot,
  ShadeSlider,
  Tile,
} from "@/components/session/shade"
import { useDevice, useUpdateDevice } from "@/components/session/use-device"
import { HoverCardTrigger } from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"

const defaultLevel = 65
const presets = [5, 15, 50, 65, 100].map((p) => ({ value: p, label: `${p}%` }))

function batteryIcon(s: DeviceState): LucideIcon {
  if (s.charging) return BatteryChargingIcon
  if (s.batteryLevel <= 20) return BatteryLowIcon
  if (s.batteryLevel <= 60) return BatteryMediumIcon
  return BatteryFullIcon
}

function isChanged(s: DeviceState) {
  return s.batterySaver || (s.canSimulateBattery && (s.charging || s.batteryLevel !== defaultLevel))
}

function summary(s: DeviceState) {
  return [`${s.batteryLevel}%`, s.charging ? "charging" : "on battery", s.batterySaver && "saver on"]
    .filter(Boolean)
    .join(" · ")
}

export function BatteryWidget({ provider, id }: { provider: string; id: string }) {
  const device = useDevice(provider, id)
  const update = useUpdateDevice(provider, id)
  const s = device.data

  return (
    <ShadeRoot>
      <HoverCardTrigger asChild>
        <ShadeCard aria-label="Battery" changed={!!s && isChanged(s)}>
          {s ? <BatteryCard s={s} /> : <CardLine icon={BatteryFullIcon}>Battery</CardLine>}
        </ShadeCard>
      </HoverCardTrigger>
      <ShadePanel>
        {s ? (
          <BatteryShade s={s} busy={update.isPending} set={(patch) => update.mutate(patch)} />
        ) : (
          <Note>Loading the device…</Note>
        )}
      </ShadePanel>
    </ShadeRoot>
  )
}

function BatteryGlyph({ s, className }: { s: DeviceState; className: string }) {
  if (s.charging) return <BatteryChargingIcon className={className} />
  if (s.batteryLevel <= 20) return <BatteryLowIcon className={className} />
  if (s.batteryLevel <= 60) return <BatteryMediumIcon className={className} />
  return <BatteryFullIcon className={className} />
}

function BatteryCard({ s }: { s: DeviceState }) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold tabular-nums">
        <BatteryGlyph
          s={s}
          className={cn("size-4 shrink-0", s.batteryLevel <= 15 && !s.charging ? "text-amber-400" : "text-neutral-400")}
        />
        {s.batteryLevel}%
      </span>
      <CardLine icon={s.batterySaver ? LeafIcon : PlugZapIcon}>
        {s.batterySaver ? "Saver on" : s.charging ? "Charging" : "On battery"}
      </CardLine>
    </>
  )
}

function BatteryShade({ s, busy, set }: { s: DeviceState; busy: boolean; set: (patch: DeviceSettings) => void }) {
  return (
    <>
      <ShadeHeader
        title="Battery"
        summary={summary(s)}
        busy={busy}
        onReset={
          isChanged(s)
            ? () =>
                set(
                  s.canSimulateBattery
                    ? { batterySaver: false, charging: false, batteryLevel: defaultLevel }
                    : { batterySaver: false },
                )
            : undefined
        }
      />
      <div className={cn("grid gap-2", s.canSimulateBattery && "grid-cols-2")}>
        <Tile
          icon={LeafIcon}
          label="Battery saver"
          on={s.batterySaver}
          disabled={busy}
          onClick={() => set({ batterySaver: !s.batterySaver })}
        />
        {s.canSimulateBattery && (
          <Tile
            icon={PlugZapIcon}
            label="Charging"
            on={s.charging}
            disabled={busy}
            onClick={() => set({ charging: !s.charging })}
          />
        )}
      </div>
      {s.canSimulateBattery ? (
        <section className="grid gap-2">
          <h4 className="px-1 text-xs font-medium text-neutral-400">Charge level</h4>
          <ShadeSlider
            key={s.batteryLevel}
            icon={batteryIcon(s)}
            label="Charge level"
            value={s.batteryLevel}
            min={1}
            max={100}
            unit="%"
            disabled={busy}
            onCommit={(batteryLevel) => set({ batteryLevel })}
          />
          <Chips
            title="Presets"
            options={presets}
            value={s.batteryLevel}
            onChange={(batteryLevel) => set({ batteryLevel })}
          />
        </section>
      ) : (
        <Note>This device&apos;s charge can&apos;t be simulated; battery saver works.</Note>
      )}
      <Note>Turning battery saver on unplugs the charger: Android turns the saver off while charging.</Note>
    </>
  )
}
