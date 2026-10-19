import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BatteryChargingIcon,
  BatteryFullIcon,
  BatteryLowIcon,
  BatteryMediumIcon,
  ClockIcon,
  EarthIcon,
  GlobeIcon,
  KeyboardIcon,
  LanguagesIcon,
  LocateFixedIcon,
  MapPinIcon,
  MinusIcon,
  MoonIcon,
  PlaneIcon,
  PlusIcon,
  SignalIcon,
  SunIcon,
  SunMoonIcon,
  WifiIcon,
  WifiOffIcon,
  type LucideIcon,
  XIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { type ReactNode, useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  agentClient,
  type DeviceSettings,
  type DeviceState,
  type Location,
  type NetworkProfile,
  unwrap,
} from "@/api/client"
import { Combobox, type ComboboxOption } from "@/components/combobox"
import { ControlGroup, RailControl } from "@/components/session/rail-control"
import { RailItem } from "@/components/session/rail-item"
import { TimeDialog } from "@/components/session/time-dialog"
import { networkKey, useDevice, useNetwork, useUpdateDevice } from "@/components/session/use-device"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useNow } from "@/hooks/use-now"
import { CITIES, defaultGeo, LOCALES } from "@/lib/device-presets"
import { browserTimeZone, formatClockOffset } from "@/lib/format"
import { baseLayout, desiredLocales, detectLayouts, sameLocales } from "@/lib/keyboard-layouts"
import { rememberLocation } from "@/lib/launch-prefs"
import { locationLabel } from "@/lib/location"
import { setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"

const defaultBattery = 65

const networks: { value: NetworkProfile; label: string }[] = [
  { value: "full", label: "No limits" },
  { value: "lte", label: "LTE (4G)" },
  { value: "hsdpa", label: "HSDPA (3.5G)" },
  { value: "umts", label: "UMTS (3G)" },
  { value: "edge", label: "EDGE (2.5G)" },
  { value: "gprs", label: "GPRS" },
  { value: "gsm", label: "GSM (2G)" },
]

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

const units: { id: string; short: string; one: string; many: string; apply: (d: Date, n: number) => void }[] = [
  { id: "s", short: "s", one: "second", many: "seconds", apply: (d, n) => d.setSeconds(d.getSeconds() + n) },
  { id: "min", short: "min", one: "minute", many: "minutes", apply: (d, n) => d.setMinutes(d.getMinutes() + n) },
  { id: "h", short: "h", one: "hour", many: "hours", apply: (d, n) => d.setHours(d.getHours() + n) },
  { id: "d", short: "d", one: "day", many: "days", apply: (d, n) => d.setDate(d.getDate() + n) },
  { id: "w", short: "wk", one: "week", many: "weeks", apply: (d, n) => d.setDate(d.getDate() + 7 * n) },
  { id: "mo", short: "mo", one: "month", many: "months", apply: (d, n) => d.setMonth(d.getMonth() + n) },
  { id: "y", short: "yr", one: "year", many: "years", apply: (d, n) => d.setFullYear(d.getFullYear() + n) },
]

const placeholders: [string, LucideIcon][] = [
  ["Network", WifiIcon],
  ["Battery", BatteryFullIcon],
  ["Display", SunIcon],
  ["Language and region", LanguagesIcon],
  ["Date and time", ClockIcon],
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
      <NetworkControl {...props} provider={provider} id={id} locations={locations} />
      <BatteryControl {...props} />
      <DisplayControl {...props} />
      <LanguageControl {...props} provider={provider} id={id} vpn={locations.length > 0} />
      <TimeControl {...props} onSubmit={(patch) => update.mutateAsync(patch)} />
    </>
  )
}

function NetworkControl({
  s,
  set,
  busy,
  provider,
  id,
  locations,
}: Props & { provider: string; id: string; locations: Location[] }) {
  const slow = !!s.networkProfile && s.networkProfile !== "full"
  const speed = networks.find((n) => n.value === s.networkProfile)?.label
  const summary = s.airplaneMode
    ? "Airplane mode"
    : [s.wifi && "Wi-Fi", s.mobileData && "Mobile data", slow && speed].filter(Boolean).join(" · ") || "Offline"
  const icon = s.airplaneMode ? PlaneIcon : s.wifi ? WifiIcon : s.mobileData ? SignalIcon : WifiOffIcon

  return (
    <RailControl
      label="Network"
      icon={icon}
      active={s.airplaneMode}
      changed={s.airplaneMode || !s.wifi || !s.mobileData || slow}
      summary={summary}
      hint={`Click the icon to turn airplane mode ${s.airplaneMode ? "off" : "on"}`}
      onClick={() => set({ airplaneMode: !s.airplaneMode })}
      onReset={() =>
        set({ airplaneMode: false, wifi: true, mobileData: true, ...(s.networkProfile && { networkProfile: "full" }) })
      }
    >
      <ControlGroup>
        <Toggle
          label="Airplane mode"
          checked={s.airplaneMode}
          disabled={busy}
          onChange={(v) => set({ airplaneMode: v })}
        />
        <Toggle label="Wi-Fi" checked={s.wifi} disabled={busy} onChange={(v) => set({ wifi: v })} />
        <Toggle label="Mobile data" checked={s.mobileData} disabled={busy} onChange={(v) => set({ mobileData: v })} />
        {s.networkProfile && (
          <Row label="Speed">
            <Select
              value={s.networkProfile}
              disabled={busy}
              onValueChange={(v) => set({ networkProfile: v as NetworkProfile })}
            >
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {networks.map((n) => (
                  <SelectItem key={n.value} value={n.value}>
                    {n.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        )}
      </ControlGroup>
      {locations.length > 0 && <VPNLocation provider={provider} id={id} locations={locations} />}
    </RailControl>
  )
}

function VPNLocation({ provider, id, locations }: { provider: string; id: string; locations: Location[] }) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  const qc = useQueryClient()
  const network = useNetwork(provider, id)
  const change = useMutation({
    mutationFn: (location: string) => unwrap(client.PUT("/v1/network/location", { body: { location } })),
    onSuccess: (n) => {
      qc.setQueryData(networkKey(provider, id), n)
      rememberLocation(provider, n.location)
      toast.success(`Now browsing from ${n.country || n.location}`, { description: n.externalIp })
    },
    onError: (e) => toast.error("Could not switch location", { description: e.message }),
  })
  const n = network.data

  return (
    <ControlGroup title="VPN">
      <Row label="Location">
        <Select value={n?.location ?? ""} onValueChange={(v) => change.mutate(v)} disabled={change.isPending}>
          <SelectTrigger size="sm" className="w-40">
            <GlobeIcon />
            <SelectValue placeholder="Location" />
          </SelectTrigger>
          <SelectContent>
            {locations.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {locationLabel(l)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      {n?.externalIp && (
        <p className="text-muted-foreground font-mono text-xs">
          {[n.country, n.externalIp].filter(Boolean).join(" · ")}
        </p>
      )}
    </ControlGroup>
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

function languageName(tag: string, inLanguage?: string) {
  try {
    const name = new Intl.DisplayNames(inLanguage ? [inLanguage] : undefined, { type: "language" }).of(tag) ?? tag
    return name.charAt(0).toLocaleUpperCase(inLanguage) + name.slice(1)
  } catch {
    return tag
  }
}

function localeOptions(tags: string[]): ComboboxOption[] {
  return tags.map((tag) => ({ value: tag, label: languageName(tag, tag), hint: `${languageName(tag)} · ${tag}` }))
}

function timeZoneOptions(current: string): ComboboxOption[] {
  const zones = new Set(["UTC", ...Intl.supportedValuesOf("timeZone")])
  zones.add(current)
  return [...zones].map((zone) => {
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts()
      .find((p) => p.type === "timeZoneName")?.value
    return {
      value: zone,
      label: zone.replaceAll("_", " "),
      hint: offset === "GMT" ? "UTC" : offset?.replace("GMT", "UTC"),
    }
  })
}

function geoName(geo: DeviceState["geo"]) {
  if (!geo) return defaultGeo.name
  const city = CITIES.find(
    (c) => Math.abs(c.latitude - geo.latitude) < 0.01 && Math.abs(c.longitude - geo.longitude) < 0.01,
  )
  return city?.name ?? `${geo.latitude.toFixed(4)}, ${geo.longitude.toFixed(4)}`
}

function LanguageControl({ s, set, busy, provider, id, vpn }: Props & { provider: string; id: string; vpn: boolean }) {
  const { keyboardLayouts } = useScreenPrefs()
  const detected = useQuery({
    queryKey: ["keyboard-layouts"],
    queryFn: detectLayouts,
    staleTime: Infinity,
    enabled: keyboardLayouts === null,
  })
  const layouts = keyboardLayouts ?? detected.data ?? null
  const network = useNetwork(provider, id, vpn)
  const applied = useRef(false)

  const appOnly = s.languageScope === "app"
  const applyLayouts = useEffectEvent((l: string[]) => {
    if (appOnly) return
    const want = desiredLocales(s.locale, l)
    if (!sameLocales(want, s.locales)) set({ locales: want })
  })
  useEffect(() => {
    if (!layouts || applied.current) return
    applied.current = true
    applyLayouts(layouts)
  }, [layouts])

  const current = layouts ?? [baseLayout]
  const setLayouts = (l: string[]) => {
    setScreenPrefs({ keyboardLayouts: l })
    set({ locales: desiredLocales(s.locale, l) })
  }
  const languages = useMemo(
    () => localeOptions(LOCALES.includes(s.locale) ? LOCALES : [s.locale, ...LOCALES]),
    [s.locale],
  )
  const zones = useMemo(() => timeZoneOptions(s.timeZone), [s.timeZone])
  const mine = browserTimeZone()
  const relabeled = s.locale !== baseLayout

  return (
    <RailControl
      label="Language and region"
      icon={LanguagesIcon}
      changed={relabeled || !!s.geo}
      summary={[languageName(s.locale, s.locale), s.timeZone.replaceAll("_", " "), s.geo && `GPS ${geoName(s.geo)}`]
        .filter(Boolean)
        .join(" · ")}
      onReset={() =>
        set({
          ...(relabeled && { locales: appOnly ? [baseLayout] : desiredLocales(baseLayout, current) }),
          ...(s.geo && { resetGeo: true }),
        })
      }
    >
      <ControlGroup>
        <Row label={appOnly ? "App language" : "Language"}>
          <Combobox
            className="w-44"
            icon={LanguagesIcon}
            placeholder="Search languages…"
            options={languages}
            value={s.locale}
            disabled={busy}
            onChange={(tag) => set({ locales: appOnly ? [tag] : desiredLocales(tag, current) })}
          />
        </Row>
        <Row label="Time zone">
          <Combobox
            className="w-44"
            icon={EarthIcon}
            placeholder="Search time zones…"
            options={zones}
            value={s.timeZone}
            disabled={busy}
            onChange={(timeZone) => set({ timeZone })}
          />
        </Row>
        {mine && mine !== s.timeZone && (
          <Button
            size="xs"
            variant="link"
            className="justify-self-end"
            disabled={busy}
            onClick={() => set({ timeZone: mine })}
          >
            Use mine ({mine.replaceAll("_", " ")})
          </Button>
        )}
      </ControlGroup>
      {appOnly ? (
        <p className="text-muted-foreground text-xs">
          This phone can&apos;t change its system language without root, so this sets the app&apos;s own language.
          Keyboard languages are set in the phone&apos;s keyboard.
        </p>
      ) : (
        <KeyboardLayouts
          layouts={current}
          guessed={keyboardLayouts === null}
          disabled={busy || layouts === null}
          onChange={setLayouts}
        />
      )}
      {s.canFakeGeo && <GeoControl s={s} set={set} busy={busy} vpnCountry={network.data?.country} />}
    </RailControl>
  )
}

function KeyboardLayouts({
  layouts,
  guessed,
  disabled,
  onChange,
}: {
  layouts: string[]
  guessed: boolean
  disabled: boolean
  onChange: (layouts: string[]) => void
}) {
  const options = useMemo(() => localeOptions(LOCALES.filter((l) => !layouts.includes(l))), [layouts])
  return (
    <ControlGroup title="Keyboard layouts">
      <div className="flex flex-wrap gap-1.5">
        {layouts.map((l) => (
          <Badge key={l} variant="secondary" className="gap-1 pr-1">
            {languageName(l, l)}
            <button
              type="button"
              aria-label={`Remove ${l}`}
              disabled={disabled || layouts.length === 1}
              className="hover:text-foreground text-muted-foreground rounded-sm disabled:opacity-40"
              onClick={() => onChange(layouts.filter((x) => x !== l))}
            >
              <XIcon className="size-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Combobox
        className="w-full"
        icon={KeyboardIcon}
        placeholder="Add a layout…"
        options={options}
        value=""
        disabled={disabled || layouts.length >= 7}
        onChange={(tag) => onChange([...layouts, tag])}
      />
      <p className="text-muted-foreground text-xs">
        {guessed ? "Picked from your keyboard. " : ""}Added as system languages, so the on-screen keyboard offers them;
        switch with its globe key or Ctrl+Space. Remembered in this browser.
      </p>
    </ControlGroup>
  )
}

function GeoControl({ s, set, busy, vpnCountry }: Props & { vpnCountry?: string }) {
  const [text, setText] = useState("")
  const [locating, setLocating] = useState(false)
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
        {!s.geo && <span className="text-muted-foreground text-xs">emulator default</span>}
      </div>
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
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => goTo(vpnCity.latitude, vpnCity.longitude)}>
            <GlobeIcon />
            Match VPN ({vpnCity.name})
          </Button>
        )}
      </div>
    </ControlGroup>
  )
}

function TimeControl({ s, set, busy, onSubmit }: Props & { onSubmit: (patch: DeviceSettings) => Promise<unknown> }) {
  const shifted = Math.abs(s.timeOffset) >= 1500
  return (
    <RailControl
      label="Date and time"
      icon={ClockIcon}
      changed={!s.autoTime || shifted}
      summary={shifted ? formatClockOffset(s.timeOffset) : s.autoTime ? "Real time" : "Real time, not kept in sync"}
      onReset={() => set({ autoTime: true })}
    >
      <DeviceClock state={s} />
      <Toggle
        label="Real time"
        hint="Keep the clock in sync with the actual time"
        checked={s.autoTime}
        disabled={busy}
        onChange={(v) => set({ autoTime: v })}
      />
      <TimeShift offset={s.timeOffset} disabled={busy} onShift={(timeOffset) => set({ timeOffset })} />
      <TimeDialog state={s} disabled={busy} onSubmit={onSubmit} />
    </RailControl>
  )
}

function TimeShift({
  offset,
  disabled,
  onShift,
}: {
  offset: number
  disabled: boolean
  onShift: (offset: number) => void
}) {
  const [unitId, setUnitId] = useState("d")
  const [amount, setAmount] = useState(1)
  const unit = units.find((u) => u.id === unitId) ?? units[3]!
  const what = `${amount} ${amount === 1 ? unit.one : unit.many}`

  const shift = (sign: number) => {
    const now = Date.now()
    const d = new Date(now + offset)
    unit.apply(d, sign * amount)
    onShift(d.getTime() - now)
  }

  return (
    <ControlGroup title="Shift the clock">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={unitId}
        onValueChange={(v) => v && setUnitId(v)}
        className="w-full"
      >
        {units.map((u) => (
          <ToggleGroupItem key={u.id} value={u.id} className="flex-1 px-0 text-xs" aria-label={u.many}>
            {u.short}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={disabled}
          aria-label={`Back ${what}`}
          onClick={() => shift(-1)}
        >
          <MinusIcon />
          Back
        </Button>
        <Input
          type="number"
          min={1}
          max={999}
          value={amount}
          onChange={(e) => setAmount(Math.min(999, Math.max(1, Math.round(Number(e.target.value)) || 1)))}
          aria-label={`How many ${unit.many}`}
          className="h-8 w-16 text-center tabular-nums"
        />
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={disabled}
          aria-label={`Forward ${what}`}
          onClick={() => shift(1)}
        >
          Forward
          <PlusIcon />
        </Button>
      </div>
      <p className="text-muted-foreground text-center text-xs">Each press moves the device clock by {what}</p>
    </ControlGroup>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      {children}
    </div>
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

function DeviceClock({ state }: { state: DeviceState }) {
  const now = useNow()
  const format = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(state.locale, {
        timeZone: state.timeZone,
        dateStyle: "medium",
        timeStyle: "medium",
      })
    } catch {
      return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" })
    }
  }, [state.locale, state.timeZone])
  const synced = Math.abs(state.timeOffset) < 1500
  return (
    <div className="bg-muted/50 grid gap-1 rounded-lg border p-3">
      <span className="font-mono text-lg tabular-nums">{format.format(now + state.timeOffset)}</span>
      <span className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">{state.timeZone.replaceAll("_", " ")}</span>
        <Badge variant={synced ? "outline" : "secondary"}>{formatClockOffset(state.timeOffset)}</Badge>
      </span>
    </div>
  )
}
