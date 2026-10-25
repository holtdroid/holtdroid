import { CalendarClockIcon, ClockIcon, EarthIcon, MinusIcon, PlusIcon, SearchIcon, ShieldIcon } from "lucide-react"
import { useMemo, useState } from "react"
import type { DeviceSettings, DeviceState } from "@/api/client"
import {
  CardLine,
  Chips,
  Note,
  Row,
  Section,
  ShadeCard,
  ShadeHeader,
  ShadePanel,
  Tile,
} from "@/components/session/shade"
import { TimeDialog } from "@/components/session/time-dialog"
import { useDevice, useUpdateDevice } from "@/components/session/use-device"
import { HoverCard, HoverCardTrigger } from "@/components/ui/hover-card"
import { useNow } from "@/hooks/use-now"
import { browserTimeZone, formatClockOffset } from "@/lib/format"
import { cn } from "@/lib/utils"

const units: { id: string; short: string; one: string; many: string; apply: (d: Date, n: number) => void }[] = [
  { id: "s", short: "s", one: "second", many: "seconds", apply: (d, n) => d.setSeconds(d.getSeconds() + n) },
  { id: "min", short: "min", one: "minute", many: "minutes", apply: (d, n) => d.setMinutes(d.getMinutes() + n) },
  { id: "h", short: "h", one: "hour", many: "hours", apply: (d, n) => d.setHours(d.getHours() + n) },
  { id: "d", short: "d", one: "day", many: "days", apply: (d, n) => d.setDate(d.getDate() + n) },
  { id: "w", short: "wk", one: "week", many: "weeks", apply: (d, n) => d.setDate(d.getDate() + 7 * n) },
  { id: "mo", short: "mo", one: "month", many: "months", apply: (d, n) => d.setMonth(d.getMonth() + n) },
  { id: "y", short: "yr", one: "year", many: "years", apply: (d, n) => d.setFullYear(d.getFullYear() + n) },
]

function zoneName(zone: string) {
  return zone.replaceAll("_", " ")
}

function zoneCity(zone: string) {
  return zoneName(zone.slice(zone.lastIndexOf("/") + 1))
}

function zoneOffset(zone: string) {
  try {
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts()
      .find((p) => p.type === "timeZoneName")?.value
    return offset === "GMT" ? "UTC" : offset?.replace("GMT", "UTC")
  } catch {
    return undefined
  }
}

function deviceFormat(s: DeviceState, options: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat(s.locale, { timeZone: s.timeZone, ...options })
  } catch {
    return new Intl.DateTimeFormat(undefined, options)
  }
}

export function TimeWidget({ provider, id }: { provider: string; id: string }) {
  const device = useDevice(provider, id)
  const update = useUpdateDevice(provider, id)
  const [exact, setExact] = useState(false)
  const s = device.data
  const shifted = !!s && Math.abs(s.timeOffset) >= 1500
  const changed = !!s && (shifted || !s.autoTime || s.timeZoneOverride)

  return (
    <>
      <HoverCard openDelay={150} closeDelay={200}>
        <HoverCardTrigger asChild>
          <ShadeCard aria-label="Date and time" changed={changed}>
            {s ? <CardClock s={s} shifted={shifted} /> : <CardLine icon={ClockIcon}>Date and time</CardLine>}
          </ShadeCard>
        </HoverCardTrigger>
        <ShadePanel>
          {s ? (
            <TimeShade
              s={s}
              busy={update.isPending}
              changed={changed}
              set={(patch) => update.mutate(patch)}
              onExact={() => setExact(true)}
            />
          ) : (
            <Note>Loading the device…</Note>
          )}
        </ShadePanel>
      </HoverCard>
      {exact && s && (
        <TimeDialog state={s} onClose={() => setExact(false)} onSubmit={(patch) => update.mutateAsync(patch)} />
      )}
    </>
  )
}

function CardClock({ s, shifted }: { s: DeviceState; shifted: boolean }) {
  const now = useNow() + s.timeOffset
  const time = useMemo(() => deviceFormat(s, { hour: "2-digit", minute: "2-digit" }), [s])
  const date = useMemo(() => deviceFormat(s, { weekday: "short", day: "numeric", month: "short" }), [s])
  return (
    <>
      <span className="text-2xl leading-none font-medium tabular-nums">{time.format(now)}</span>
      <span className="truncate text-xs text-neutral-400">{date.format(now)}</span>
      <CardLine icon={shifted ? CalendarClockIcon : EarthIcon}>
        {shifted ? formatClockOffset(s.timeOffset) : zoneCity(s.timeZone)}
      </CardLine>
    </>
  )
}

function TimeShade({
  s,
  busy,
  changed,
  set,
  onExact,
}: {
  s: DeviceState
  busy: boolean
  changed: boolean
  set: (patch: DeviceSettings) => void
  onExact: () => void
}) {
  const now = useNow() + s.timeOffset
  const time = useMemo(() => deviceFormat(s, { hour: "2-digit", minute: "2-digit", second: "2-digit" }), [s])
  const date = useMemo(() => deviceFormat(s, { weekday: "long", day: "numeric", month: "long", year: "numeric" }), [s])
  const shifted = Math.abs(s.timeOffset) >= 1500

  return (
    <>
      <ShadeHeader
        title="Date and time"
        summary={shifted ? formatClockOffset(s.timeOffset) : s.autoTime ? "Real time" : "Real time, not kept in sync"}
        busy={busy}
        onReset={
          changed ? () => set({ autoTime: true, ...(s.timeZoneOverride && { resetTimeZone: true }) }) : undefined
        }
      />
      <div className="grid gap-1 px-1">
        <span className="text-4xl leading-none font-light tabular-nums">{time.format(now)}</span>
        <span className="text-sm text-neutral-300">{date.format(now)}</span>
        <span className="flex items-center gap-1.5 text-xs text-neutral-400">
          <EarthIcon className="size-3.5" />
          {zoneName(s.timeZone)} · {zoneOffset(s.timeZone)}
          {shifted && (
            <span className="ml-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-300">
              {formatClockOffset(s.timeOffset)}
            </span>
          )}
        </span>
      </div>

      <Tile
        icon={ClockIcon}
        label="Real time"
        status={s.autoTime ? "Kept in sync with the actual time" : "Not kept in sync"}
        on={s.autoTime}
        disabled={busy}
        wide
        onClick={() => set({ autoTime: !s.autoTime })}
      />

      <TimeShift offset={s.timeOffset} disabled={busy} onShift={(timeOffset) => set({ timeOffset })} />
      <button
        type="button"
        disabled={busy}
        className="flex items-center justify-center gap-2 rounded-full bg-neutral-800 px-4 py-2.5 text-sm text-neutral-100 transition-colors hover:bg-neutral-700 disabled:opacity-50"
        onClick={onExact}
      >
        <CalendarClockIcon className="size-4" />
        Set an exact moment…
      </button>

      <TimeZones s={s} busy={busy} set={set} />
    </>
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
    <div className="grid gap-2">
      <Chips
        title="Shift the clock"
        options={units.map((u) => ({ value: u.id, label: u.short }))}
        value={unitId}
        onChange={setUnitId}
      />
      <div className="flex items-center gap-1.5">
        <StepButton label={`Back ${what}`} disabled={disabled} onClick={() => shift(-1)}>
          <MinusIcon className="size-4" />
          Back
        </StepButton>
        <input
          type="number"
          min={1}
          max={999}
          value={amount}
          onChange={(e) => setAmount(Math.min(999, Math.max(1, Math.round(Number(e.target.value)) || 1)))}
          aria-label={`How many ${unit.many}`}
          className="h-10 w-16 rounded-full bg-neutral-800 text-center text-sm text-neutral-100 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        />
        <StepButton label={`Forward ${what}`} disabled={disabled} onClick={() => shift(1)}>
          Forward
          <PlusIcon className="size-4" />
        </StepButton>
      </div>
      <Note>Each press moves the device clock by {what}.</Note>
    </div>
  )
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-neutral-800 text-sm text-neutral-100 transition-colors hover:bg-neutral-700 disabled:opacity-50"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function TimeZones({ s, busy, set }: { s: DeviceState; busy: boolean; set: (patch: DeviceSettings) => void }) {
  const [query, setQuery] = useState("")
  const mine = browserTimeZone()
  const zones = useMemo(() => ["UTC", ...Intl.supportedValuesOf("timeZone")], [])
  const q = query.trim().toLowerCase().replaceAll(" ", "_")
  const matches = q
    ? zones.filter((z) => z.toLowerCase().includes(q) && z !== s.timeZone && z !== s.vpnTimeZone).slice(0, 6)
    : []
  const following = !s.timeZoneOverride && !!s.vpnTimeZone

  return (
    <Section title="Time zone">
      {s.vpnTimeZone && (
        <Row
          selected={following}
          disabled={busy}
          icon={ShieldIcon}
          title="Same as the VPN location"
          onClick={() => !following && set({ resetTimeZone: true })}
        >
          {zoneName(s.vpnTimeZone)} · {zoneOffset(s.vpnTimeZone)}
        </Row>
      )}
      {!following && (
        <Row selected disabled={busy} icon={EarthIcon} title={zoneName(s.timeZone)} onClick={() => undefined}>
          {zoneOffset(s.timeZone)}
          {s.vpnTimeZone ? " · picked for this session" : ""}
        </Row>
      )}
      {mine && mine !== s.timeZone && mine !== s.vpnTimeZone && (
        <Row
          selected={false}
          disabled={busy}
          icon={EarthIcon}
          title={`Yours: ${zoneName(mine)}`}
          onClick={() => set({ timeZone: mine })}
        >
          {zoneOffset(mine)}
        </Row>
      )}
      <label className="flex items-center gap-2 rounded-md bg-neutral-800 px-4 py-2.5 last:rounded-b-3xl">
        <SearchIcon className="size-4 shrink-0 text-neutral-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search time zones…"
          aria-label="Search time zones"
          className="min-w-0 flex-1 bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
        />
      </label>
      {matches.map((z) => (
        <Row
          key={z}
          selected={false}
          disabled={busy}
          icon={EarthIcon}
          title={zoneName(z)}
          onClick={() => {
            setQuery("")
            set({ timeZone: z })
          }}
        >
          {zoneOffset(z)}
        </Row>
      ))}
      {q && matches.length === 0 && (
        <p className={cn("rounded-md bg-neutral-800 px-4 py-2.5 text-xs text-neutral-400 last:rounded-b-3xl")}>
          No time zone matches “{query}”
        </p>
      )}
    </Section>
  )
}
