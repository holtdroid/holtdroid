import {
  BatteryChargingIcon,
  BatteryFullIcon,
  BatteryLowIcon,
  BatteryMediumIcon,
  GlobeIcon,
  LocateFixedIcon,
  MapPinIcon,
  MoonIcon,
  SunIcon,
  SunMoonIcon,
  type LucideIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { type DeviceSettings, type DeviceState, type Location } from "@/api/client"
import { Combobox } from "@/components/combobox"
import { ControlGroup, RailControl } from "@/components/session/rail-control"
import { RailItem } from "@/components/session/rail-item"
import { useDevice, useNetwork, useUpdateDevice } from "@/components/session/use-device"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CITIES, defaultGeo } from "@/lib/device-presets"
import { setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"

const defaultBattery = 65

const fontScales = [0.85, 1, 1.15, 1.3, 1.5, 2]

const displaySizes = [
  { k: 0.85, label: "Small" },
  { k: 1, label: "Default" },
  { k: 1.15, label: "Large" },
  { k: 1.3, label: "Larger" },
]

const batteryPresets = [5, 15, 50, 65, 100]

type ThemeMode = "light" | "dark" | "sync"

const themes: Record<ThemeMode, { label: string; icon: LucideIcon; next: ThemeMode }> = {
  light: { label: "Light", icon: SunIcon, next: "dark" },
  dark: { label: "Dark", icon: MoonIcon, next: "sync" },
  sync: { label: "Match the portal", icon: SunMoonIcon, next: "light" },
}

const placeholders: [string, LucideIcon][] = [
  ["Battery", BatteryFullIcon],
  ["Display", SunIcon],
]

type Props = { s: DeviceState; set: (patch: DeviceSettings) => void; busy: boolean }

export function DeviceControls({ provider, id, locations }: { provider: string; id: string; locations: Location[] }) {
  const device = useDevice(provider, id)
  const update = useUpdateDevice(provider, id)
  const s = device.data
  if (!s) {
    return (
      <>
        {placeholders.map(([name, Icon]) => (
          <RailItem key={name} label="Loading device settings" text={name} disabled>
            <Icon />
          </RailItem>
        ))}
      </>
    )
  }
  const props: Props = { s, set: (patch) => update.mutate(patch), busy: update.isPending }
  return (
    <>
      <BatteryControl {...props} />
      <DisplayControl {...props} />
      {s.canFakeGeo && <GpsControl {...props} provider={provider} id={id} vpn={locations.length > 0} />}
    </>
  )
}

function BatteryControl({ s, set, busy }: Props) {
  const level = s.batteryLevel
  const icon = s.charging
    ? BatteryChargingIcon
    : level <= 20
      ? BatteryLowIcon
      : level <= 60
        ? BatteryMediumIcon
        : BatteryFullIcon

  return (
    <RailControl
      label="Battery"
      icon={icon}
      active={s.batterySaver}
      changed={s.batterySaver || (s.canSimulateBattery && (s.charging || level !== defaultBattery))}
      summary={[`${level}%`, s.charging ? "charging" : "on battery", s.batterySaver && "saver on"]
        .filter(Boolean)
        .join(" · ")}
      hint={`Click the icon to turn battery saver ${s.batterySaver ? "off" : "on"}`}
      onClick={() => set({ batterySaver: !s.batterySaver })}
      onReset={() =>
        set(
          s.canSimulateBattery
            ? { batterySaver: false, charging: false, batteryLevel: defaultBattery }
            : { batterySaver: false },
        )
      }
    >
      <ControlGroup>
        <Toggle
          label="Battery saver"
          hint="Unplugs the charger: Android turns the saver off while charging"
          checked={s.batterySaver}
          disabled={busy}
          onChange={(v) => set({ batterySaver: v })}
        />
        {s.canSimulateBattery && (
          <Toggle label="Charging" checked={s.charging} disabled={busy} onChange={(v) => set({ charging: v })} />
        )}
      </ControlGroup>
      {s.canSimulateBattery && (
        <BatteryLevel key={level} level={level} disabled={busy} onCommit={(v) => set({ batteryLevel: v })} />
      )}
    </RailControl>
  )
}

function BatteryLevel({
  level,
  disabled,
  onCommit,
}: {
  level: number
  disabled: boolean
  onCommit: (v: number) => void
}) {
  const [value, setValue] = useState(level)
  return (
    <ControlGroup title="Charge level">
      <div className="flex items-center gap-3">
        <Slider
          min={0}
          max={100}
          step={1}
          value={[value]}
          disabled={disabled}
          onValueChange={([v = value]) => setValue(v)}
          onValueCommit={([v = value]) => onCommit(v)}
        />
        <span className="w-10 text-right text-sm tabular-nums">{value}%</span>
      </div>
      <div className="flex gap-1">
        {batteryPresets.map((p) => (
          <Button
            key={p}
            size="xs"
            variant={p === level ? "secondary" : "ghost"}
            disabled={disabled}
            className="flex-1 tabular-nums"
            onClick={() => onCommit(p)}
          >
            {p}%
          </Button>
        ))}
      </div>
    </ControlGroup>
  )
}

function DisplayControl({ s, set, busy }: Props) {
  const { deviceTheme } = useScreenPrefs()
  const { resolvedTheme } = useTheme()
  const siteDark = resolvedTheme === "dark"
  const mode: ThemeMode = deviceTheme === "sync" ? "sync" : s.darkMode ? "dark" : "light"
  const synced = useRef<boolean | null>(null)

  const follow = useEffectEvent(() => {
    if (deviceTheme !== "sync" || s.darkMode === siteDark || synced.current === siteDark) return
    synced.current = siteDark
    set({ darkMode: siteDark })
  })
  const drifted = deviceTheme === "sync" && s.darkMode !== siteDark
  useEffect(() => {
    if (drifted) follow()
  }, [drifted])

  const choose = (m: ThemeMode) => {
    if (m === "sync") {
      synced.current = null
      setScreenPrefs({ deviceTheme: "sync" })
      return
    }
    setScreenPrefs({ deviceTheme: "manual" })
    if (s.darkMode !== (m === "dark")) set({ darkMode: m === "dark" })
  }

  const font = fontScales.find((f) => Math.abs(f - s.fontScale) < 0.01)
  const size = displaySizes.find((d) => Math.round(s.defaultDensity * d.k) === s.density)
  const resized = s.defaultDensity > 0 && s.density !== s.defaultDensity
  const changed = Math.abs(s.fontScale - 1) > 0.01 || resized || mode === "dark"

  return (
    <RailControl
      label="Display"
      icon={themes[mode].icon}
      changed={changed}
      summary={[
        mode === "sync" ? `Matches the portal (${s.darkMode ? "dark" : "light"})` : themes[mode].label,
        `font ${Math.round(s.fontScale * 100)}%`,
        resized && (size?.label.toLowerCase() ?? `${s.density} dpi`),
      ]
        .filter(Boolean)
        .join(" · ")}
      hint={`Click the icon to switch to ${themes[themes[mode].next].label.toLowerCase()}`}
      onClick={() => choose(themes[mode].next)}
      onReset={() => {
        if (mode === "dark") choose("light")
        set({ fontScale: 1, ...(resized && { density: 0 }) })
      }}
    >
      <ControlGroup title="Theme">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={mode}
          onValueChange={(v) => v && choose(v as ThemeMode)}
          disabled={busy}
          className="w-full"
        >
          {(Object.entries(themes) as [ThemeMode, (typeof themes)[ThemeMode]][]).map(([m, t]) => (
            <ToggleGroupItem key={m} value={m} className="flex-1 gap-1.5 text-xs">
              <t.icon />
              {m === "sync" ? "Portal" : t.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </ControlGroup>
      <ControlGroup title="Font size">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={font ? String(font) : ""}
          onValueChange={(v) => v && set({ fontScale: Number(v) })}
          disabled={busy}
          className="w-full"
        >
          {fontScales.map((f) => (
            <ToggleGroupItem key={f} value={String(f)} className="flex-1 px-0 text-xs tabular-nums">
              {Math.round(f * 100)}%
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </ControlGroup>
      {s.defaultDensity > 0 && (
        <ControlGroup title="Display size">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={size ? String(size.k) : ""}
            onValueChange={(v) => v && set({ density: v === "1" ? 0 : Math.round(s.defaultDensity * Number(v)) })}
            disabled={busy}
            className="w-full"
          >
            {displaySizes.map((d) => (
              <ToggleGroupItem key={d.k} value={String(d.k)} className="flex-1 text-xs">
                {d.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </ControlGroup>
      )}
    </RailControl>
  )
}

function geoName(geo: DeviceState["geo"]) {
  if (!geo) return defaultGeo.name
  const city = CITIES.find(
    (c) => Math.abs(c.latitude - geo.latitude) < 0.01 && Math.abs(c.longitude - geo.longitude) < 0.01,
  )
  return city?.name ?? `${geo.latitude.toFixed(4)}, ${geo.longitude.toFixed(4)}`
}

function GpsControl({ s, set, busy, provider, id, vpn }: Props & { provider: string; id: string; vpn: boolean }) {
  const network = useNetwork(provider, id, vpn)
  return (
    <RailControl
      label="GPS location"
      icon={MapPinIcon}
      changed={s.geoOverride}
      summary={geoName(s.geo)}
      onReset={() => set({ resetGeo: true })}
    >
      <GeoControl s={s} set={set} busy={busy} vpnCountry={network.data?.country} />
    </RailControl>
  )
}

function GeoControl({ s, set, busy, vpnCountry }: Props & { vpnCountry?: string }) {
  const [text, setText] = useState("")
  const [locating, setLocating] = useState(false)
  const [override, setOverride] = useState(s.geoOverride)
  const manual = override || s.geoOverride
  const cities = useMemo(
    () =>
      CITIES.map((c) => ({
        value: c.name,
        label: c.name,
        hint: new Intl.DisplayNames(undefined, { type: "region" }).of(c.country),
      })),
    [],
  )
  const vpnCity = vpnCountry ? CITIES.find((c) => c.country === vpnCountry.toUpperCase()) : undefined
  const parsed = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/)
  const point = parsed && { latitude: Number(parsed[1]), longitude: Number(parsed[2]) }
  const valid = !!point && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180
  const goTo = (latitude: number, longitude: number) => set({ geo: { latitude, longitude } })

  const locate = () => {
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false)
        goTo(Number(p.coords.latitude.toFixed(6)), Number(p.coords.longitude.toFixed(6)))
      },
      (e) => {
        setLocating(false)
        toast.error("Could not get your location", { description: e.message })
      },
    )
  }

  return (
    <ControlGroup title="GPS location">
      <div className="flex items-center gap-2 text-sm">
        <MapPinIcon className="text-muted-foreground size-4" />
        <span className="min-w-0 flex-1 truncate">{geoName(s.geo)}</span>
        {!manual && <span className="text-muted-foreground text-xs">follows the VPN location</span>}
      </div>
      <label className="flex items-center justify-between gap-2 text-sm">
        <span>Override for this session</span>
        <Switch
          checked={manual}
          disabled={busy}
          onCheckedChange={(v) => {
            setOverride(v)
            if (!v && s.geoOverride) set({ resetGeo: true })
          }}
        />
      </label>
      {manual && (
        <>
          <Combobox
            className="w-full"
            icon={MapPinIcon}
            placeholder="Search cities…"
            options={cities}
            value=""
            disabled={busy}
            onChange={(name) => {
              const c = CITIES.find((x) => x.name === name)
              if (c) goTo(c.latitude, c.longitude)
            }}
          />
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (point && valid) goTo(point.latitude, point.longitude)
            }}
          >
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="52.2297, 21.0122"
              aria-label="Latitude, longitude"
              className="h-8 font-mono text-xs"
            />
            <Button type="submit" size="sm" variant="outline" disabled={busy || !valid}>
              Set
            </Button>
          </form>
          <div className="flex flex-wrap gap-1">
            <Button size="xs" variant="ghost" disabled={busy || locating} onClick={locate}>
              <LocateFixedIcon />
              Use mine
            </Button>
            {vpnCity && (
              <Button
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() => goTo(vpnCity.latitude, vpnCity.longitude)}
              >
                <GlobeIcon />
                Match VPN ({vpnCity.name})
              </Button>
            )}
          </div>
        </>
      )}
    </ControlGroup>
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
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Label className="flex items-center justify-between gap-3 font-normal">
      <span className="grid gap-0.5">
        <span className="text-sm">{label}</span>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </Label>
  )
}
