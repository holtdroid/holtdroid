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
      <ShadeCard
        aria-label="Battery"
        icon={s ? batteryIcon(s) : BatteryFullIcon}
        changed={!!s && isChanged(s)}
        summary={s && summary(s)}
      />
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
          <h4 className="px-1 text-xs font-medium text-muted-foreground">Charge level</h4>
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
