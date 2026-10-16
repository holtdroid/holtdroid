import { EarthIcon, LanguagesIcon, SlidersHorizontalIcon } from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"
import type { DeviceSettings, DeviceState, NetworkProfile } from "@/api/client"
import { Combobox, type ComboboxOption } from "@/components/combobox"
import { TimeDialog } from "@/components/session/time-dialog"
import { useDevice, useUpdateDevice } from "@/components/session/use-device"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useNow } from "@/hooks/use-now"
import { browserTimeZone, formatClockOffset } from "@/lib/format"

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

const LOCALES = [
  "en-US",
  "en-GB",
  "ru-RU",
  "uk-UA",
  "pl-PL",
  "lt-LT",
  "lv-LV",
  "et-EE",
  "de-DE",
  "fr-FR",
  "es-ES",
  "es-419",
  "pt-BR",
  "pt-PT",
  "it-IT",
  "nl-NL",
  "sv-SE",
  "nb-NO",
  "da-DK",
  "fi-FI",
  "cs-CZ",
  "sk-SK",
  "hu-HU",
  "ro-RO",
  "bg-BG",
  "el-GR",
  "tr-TR",
  "kk-KZ",
  "ka-GE",
  "hy-AM",
  "az-AZ",
  "he-IL",
  "ar-EG",
  "ar-SA",
  "fa-IR",
  "hi-IN",
  "bn-BD",
  "th-TH",
  "vi-VN",
  "id-ID",
  "ms-MY",
  "ja-JP",
  "ko-KR",
  "zh-CN",
  "zh-TW",
]

const shifts: { label: string; apply: (d: Date, sign: number) => void }[] = [
  { label: "5 s", apply: (d, s) => d.setSeconds(d.getSeconds() + 5 * s) },
  { label: "30 s", apply: (d, s) => d.setSeconds(d.getSeconds() + 30 * s) },
  { label: "1 h", apply: (d, s) => d.setHours(d.getHours() + s) },
  { label: "1 day", apply: (d, s) => d.setDate(d.getDate() + s) },
  { label: "1 week", apply: (d, s) => d.setDate(d.getDate() + 7 * s) },
  { label: "1 month", apply: (d, s) => d.setMonth(d.getMonth() + s) },
  { label: "1 year", apply: (d, s) => d.setFullYear(d.getFullYear() + s) },
]

function shiftOffset(apply: (d: Date, sign: number) => void, sign: number) {
  const now = Date.now()
  const d = new Date(now)
  apply(d, sign)
  return d.getTime() - now
}

function localeOptions(current: string): ComboboxOption[] {
  const tags = LOCALES.includes(current) ? LOCALES : [current, ...LOCALES]
  const local = new Intl.DisplayNames(undefined, { type: "language" })
  return tags.map((tag) => {
    const own = new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag
    return { value: tag, label: own.charAt(0).toLocaleUpperCase(tag) + own.slice(1), hint: `${local.of(tag)} · ${tag}` }
  })
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

export function DeviceSettingsSheet({ provider, id }: { provider: string; id: string }) {
  return (
    <Sheet modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="Device settings">
              <SlidersHorizontalIcon />
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent side="left">Device settings</TooltipContent>
      </Tooltip>
      <SheetContent className="gap-0 sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <SheetHeader className="border-b">
          <SheetTitle>Device settings</SheetTitle>
          <SheetDescription>Changes apply to the running device right away.</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <DeviceSettingsForm provider={provider} id={id} />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

function DeviceSettingsForm({ provider, id }: { provider: string; id: string }) {
  const device = useDevice(provider, id)
  const update = useUpdateDevice(provider, id)
  const s = device.data

  if (!s) {
    return (
      <div className="grid gap-3 p-4">
        {device.error ? (
          <p className="text-destructive text-sm">{device.error.message}</p>
        ) : (
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8" />)
        )}
      </div>
    )
  }

  const set = (patch: DeviceSettings) => update.mutate(patch)
  const busy = update.isPending

  return (
    <div className="grid gap-6 p-4">
      <Section title="Connectivity">
        <Toggle
          label="Airplane mode"
          checked={s.airplaneMode}
          disabled={busy}
          onChange={(v) => set({ airplaneMode: v })}
        />
        <Toggle label="Wi-Fi" checked={s.wifi} disabled={busy} onChange={(v) => set({ wifi: v })} />
        <Toggle label="Mobile data" checked={s.mobileData} disabled={busy} onChange={(v) => set({ mobileData: v })} />
        {s.networkProfile && (
          <Row label="Network speed">
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
      </Section>

      <Section title="Battery">
        <Toggle
          label="Battery saver"
          hint="Unplugs the charger: Android turns the saver off while charging"
          checked={s.batterySaver}
          disabled={busy}
          onChange={(v) => set({ batterySaver: v })}
        />
        <Toggle label="Charging" checked={s.charging} disabled={busy} onChange={(v) => set({ charging: v })} />
        <BatteryLevel key={s.batteryLevel} level={s.batteryLevel} onCommit={(v) => set({ batteryLevel: v })} />
      </Section>

      <Section title="Display">
        <Toggle label="Dark theme" checked={s.darkMode} disabled={busy} onChange={(v) => set({ darkMode: v })} />
        <div className="grid gap-2">
          <Label className="text-sm font-normal">Font size</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={String(fontScales.find((f) => Math.abs(f - s.fontScale) < 0.01) ?? "")}
            onValueChange={(v) => v && set({ fontScale: Number(v) })}
            disabled={busy}
            className="w-full"
          >
            {fontScales.map((f) => (
              <ToggleGroupItem key={f} value={String(f)} className="flex-1 tabular-nums">
                {Math.round(f * 100)}%
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {s.defaultDensity > 0 && <DisplaySize state={s} disabled={busy} onChange={(density) => set({ density })} />}
      </Section>

      <Section title="Language and region">
        <LanguageRow state={s} disabled={busy} onChange={(locale) => set({ locale })} />
        <TimeZoneRow state={s} disabled={busy} onChange={(timeZone) => set({ timeZone })} />
      </Section>

      <Section title="Date and time">
        <DeviceClock state={s} />
        <Toggle
          label="Real time"
          hint="Keep the clock in sync with the actual time"
          checked={s.autoTime}
          disabled={busy}
          onChange={(v) => set({ autoTime: v })}
        />
        <div className="grid gap-2">
          <Label className="text-sm font-normal">Shift from real time</Label>
          {[-1, 1].map((sign) => (
            <div key={sign} className="grid grid-cols-7 gap-1">
              {shifts.map((shift) => (
                <Button
                  key={shift.label}
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  className="px-0 tabular-nums"
                  onClick={() => set({ timeOffset: shiftOffset(shift.apply, sign) })}
                >
                  {sign > 0 ? "+" : "−"}
                  {shift.label}
                </Button>
              ))}
            </div>
          ))}
        </div>
        <TimeDialog state={s} disabled={busy} onSubmit={(patch) => update.mutateAsync(patch)} />
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</h3>
      {children}
    </section>
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

function BatteryLevel({ level, onCommit }: { level: number; onCommit: (v: number) => void }) {
  const [value, setValue] = useState(level)
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-sm">
        <span>Battery level</span>
        <span className="text-muted-foreground tabular-nums">{value}%</span>
      </div>
      <Slider
        min={0}
        max={100}
        step={1}
        value={[value]}
        onValueChange={([v = value]) => setValue(v)}
        onValueCommit={([v = value]) => onCommit(v)}
      />
    </div>
  )
}

function DisplaySize({
  state,
  disabled,
  onChange,
}: {
  state: DeviceState
  disabled: boolean
  onChange: (density: number) => void
}) {
  const current = displaySizes.find((d) => Math.round(state.defaultDensity * d.k) === state.density)
  return (
    <div className="grid gap-2">
      <Label className="text-sm font-normal">Display size</Label>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={current ? String(current.k) : ""}
        onValueChange={(v) => v && onChange(v === "1" ? 0 : Math.round(state.defaultDensity * Number(v)))}
        disabled={disabled}
        className="w-full"
      >
        {displaySizes.map((d) => (
          <ToggleGroupItem key={d.k} value={String(d.k)} className="flex-1">
            {d.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

function LanguageRow({
  state,
  disabled,
  onChange,
}: {
  state: DeviceState
  disabled: boolean
  onChange: (locale: string) => void
}) {
  const options = useMemo(() => localeOptions(state.locale), [state.locale])
  return (
    <Row label="Language">
      <Combobox
        className="w-52"
        icon={LanguagesIcon}
        placeholder="Search languages…"
        options={options}
        value={state.locale}
        disabled={disabled}
        onChange={onChange}
      />
    </Row>
  )
}

function TimeZoneRow({
  state,
  disabled,
  onChange,
}: {
  state: DeviceState
  disabled: boolean
  onChange: (zone: string) => void
}) {
  const options = useMemo(() => timeZoneOptions(state.timeZone), [state.timeZone])
  const mine = browserTimeZone()
  return (
    <div className="grid gap-1.5">
      <Row label="Time zone">
        <Combobox
          className="w-52"
          icon={EarthIcon}
          placeholder="Search time zones…"
          options={options}
          value={state.timeZone}
          disabled={disabled}
          onChange={onChange}
        />
      </Row>
      {mine && mine !== state.timeZone && (
        <Button
          size="xs"
          variant="link"
          className="justify-self-end"
          disabled={disabled}
          onClick={() => onChange(mine)}
        >
          Use mine ({mine.replaceAll("_", " ")})
        </Button>
      )}
    </div>
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
