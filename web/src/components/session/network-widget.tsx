import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ActivityIcon,
  CheckIcon,
  GlobeIcon,
  Loader2Icon,
  PlaneIcon,
  RotateCcwIcon,
  SignalIcon,
  UsbIcon,
  WifiIcon,
  WifiOffIcon,
  type LucideIcon,
} from "lucide-react"
import { type ReactNode, useMemo } from "react"
import { toast } from "sonner"
import {
  agentClient,
  type DeviceSettings,
  type DeviceState,
  type Location,
  type NetworkProfileInfo,
  unwrap,
} from "@/api/client"
import { networkKey, useDevice, useNetwork, useUpdateDevice } from "@/components/session/use-device"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { rememberLocation } from "@/lib/launch-prefs"
import { locationFlag } from "@/lib/location"
import { cn } from "@/lib/utils"

export const networkWidgetWidth = 128

export function NetworkWidget({ provider, id, locations }: { provider: string; id: string; locations: Location[] }) {
  const device = useDevice(provider, id)
  const update = useUpdateDevice(provider, id)
  const network = useNetwork(provider, id, locations.length > 0)
  const s = device.data
  const n = network.data
  const location = locations.find((l) => l.id === n?.location)
  const profile = s?.networkProfiles?.find((p) => p.id === s.networkProfile)
  const radios = !s?.usbNetwork
  const changed =
    !!s &&
    (s.airplaneMode ||
      s.wifi !== radios ||
      s.mobileData !== radios ||
      (!!s.networkProfile && s.networkProfile !== "full"))

  return (
    <HoverCard openDelay={150} closeDelay={200}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label="Network"
          className="relative grid cursor-default gap-1.5 rounded-2xl bg-neutral-900 p-3 text-left text-neutral-100 shadow-lg ring-1 ring-black/50 transition-colors outline-none hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-sky-300 dark:ring-white/15"
          style={{ width: networkWidgetWidth }}
        >
          {changed && <span className="absolute top-2.5 right-2.5 size-2 rounded-full bg-amber-500" />}
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            {location ? (
              <span className="text-base leading-none">
                {locationFlag(location) ?? <GlobeIcon className="size-4" />}
              </span>
            ) : (
              <LinkIcon s={s} className="size-4 shrink-0 text-neutral-400" />
            )}
            <span className="truncate">{location?.label ?? linkSummary(s)}</span>
          </span>
          {n?.externalIp && <span className="truncate font-mono text-[11px] text-neutral-400">{n.externalIp}</span>}
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-300">
            <LinkIcon s={s} className="size-3.5 shrink-0" />
            <span className="truncate">{s?.airplaneMode ? "Airplane mode" : (profile?.name ?? linkSummary(s))}</span>
          </span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        className="flex max-h-(--radix-hover-card-content-available-height) w-96 flex-col gap-4 overflow-y-auto rounded-[28px] border-0 bg-neutral-900 p-4 text-neutral-100 shadow-2xl ring-1 ring-white/10"
      >
        {s ? (
          <Shade
            s={s}
            busy={update.isPending}
            set={(patch) => update.mutate(patch)}
            changed={changed}
            provider={provider}
            id={id}
            locations={locations}
            current={n?.location}
            country={n?.country}
            ip={n?.externalIp}
          />
        ) : (
          <p className="text-sm text-neutral-400">Loading the device…</p>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

function LinkIcon({ s, className }: { s?: DeviceState; className: string }) {
  if (s?.airplaneMode) return <PlaneIcon className={className} />
  if (!s || s.wifi) return <WifiIcon className={className} />
  if (s.mobileData) return <SignalIcon className={className} />
  if (s.usbNetwork) return <UsbIcon className={className} />
  return <WifiOffIcon className={className} />
}

function linkSummary(s?: DeviceState) {
  if (!s) return "Network"
  if (s.airplaneMode) return "Airplane mode"
  return (
    [s.usbNetwork && "USB", s.wifi && "Wi-Fi", s.mobileData && "Mobile data"].filter(Boolean).join(" · ") || "Offline"
  )
}

function Shade({
  s,
  busy,
  set,
  changed,
  provider,
  id,
  locations,
  current,
  country,
  ip,
}: {
  s: DeviceState
  busy: boolean
  set: (patch: DeviceSettings) => void
  changed: boolean
  provider: string
  id: string
  locations: Location[]
  current?: string
  country?: string
  ip?: string
}) {
  const radios = !s.usbNetwork
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="grid">
          <span className="text-base font-medium">Network</span>
          <span className="text-xs text-neutral-400">{linkSummary(s)}</span>
        </div>
        {changed && (
          <button
            type="button"
            disabled={busy}
            className="flex items-center gap-1.5 rounded-full bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:bg-neutral-700 disabled:opacity-50"
            onClick={() =>
              set({
                airplaneMode: false,
                wifi: radios,
                mobileData: radios,
                ...(s.networkProfile && { networkProfile: "full" }),
              })
            }
          >
            <RotateCcwIcon className="size-3.5" />
            Reset
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Tile icon={WifiIcon} label="Wi-Fi" on={s.wifi} disabled={busy} onClick={() => set({ wifi: !s.wifi })} />
        <Tile
          icon={SignalIcon}
          label="Mobile data"
          on={s.mobileData}
          disabled={busy}
          onClick={() => set({ mobileData: !s.mobileData })}
        />
        <Tile
          icon={PlaneIcon}
          label="Airplane mode"
          on={s.airplaneMode}
          disabled={busy}
          wide
          onClick={() => set({ airplaneMode: !s.airplaneMode })}
        />
      </div>
      {s.usbNetwork && (
        <p className="px-1 text-xs text-neutral-400">
          This phone reaches the internet over USB through the session&apos;s VPN, so Wi-Fi and mobile data stay off.
        </p>
      )}

      {locations.length > 0 && (
        <Locations provider={provider} id={id} locations={locations} current={current} country={country} ip={ip} />
      )}

      {s.networkProfiles && (
        <Conditions
          profiles={s.networkProfiles}
          current={s.networkProfile}
          busy={busy}
          onChange={(networkProfile) => set({ networkProfile })}
        />
      )}
    </>
  )
}

function Tile({
  icon: Icon,
  label,
  on,
  disabled,
  wide,
  onClick,
}: {
  icon: LucideIcon
  label: string
  on: boolean
  disabled: boolean
  wide?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      className={cn(
        "flex h-16 items-center gap-3 rounded-full px-4 text-left transition-colors disabled:opacity-60",
        on ? "bg-sky-200 text-sky-950 hover:bg-sky-100" : "bg-neutral-800 text-neutral-100 hover:bg-neutral-700",
        wide && "col-span-2",
      )}
      onClick={onClick}
    >
      <Icon className="size-5 shrink-0" />
      <span className="grid min-w-0">
        <span className="truncate text-sm font-medium">{label}</span>
        <span className={cn("text-xs", on ? "text-sky-900" : "text-neutral-400")}>{on ? "On" : "Off"}</span>
      </span>
    </button>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h4 className="px-1 text-xs font-medium text-neutral-400">{title}</h4>
      <div className="grid gap-1 overflow-hidden rounded-3xl">{children}</div>
    </section>
  )
}

function Row({
  selected,
  busy = false,
  disabled,
  flag,
  icon: Icon = GlobeIcon,
  title,
  children,
  onClick,
}: {
  selected: boolean
  busy?: boolean
  disabled?: boolean
  flag?: string
  icon?: LucideIcon
  title: string
  children?: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left transition-colors first:rounded-t-3xl last:rounded-b-3xl disabled:cursor-default",
        selected ? "bg-sky-200 text-sky-950" : "bg-neutral-800 text-neutral-100 hover:bg-neutral-700",
      )}
      onClick={onClick}
    >
      <span className="grid size-6 shrink-0 place-items-center text-lg leading-none">
        {flag ?? <Icon className="size-4" />}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {children && <span className={cn("text-xs", selected ? "text-sky-900" : "text-neutral-400")}>{children}</span>}
      </span>
      {busy ? (
        <Loader2Icon className="size-4 shrink-0 animate-spin" />
      ) : (
        selected && <CheckIcon className="size-4 shrink-0" />
      )}
    </button>
  )
}

function Locations({
  provider,
  id,
  locations,
  current,
  country,
  ip,
}: {
  provider: string
  id: string
  locations: Location[]
  current?: string
  country?: string
  ip?: string
}) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  const qc = useQueryClient()
  const change = useMutation({
    mutationFn: (location: string) => unwrap(client.PUT("/v1/network/location", { body: { location } })),
    onSuccess: (n) => {
      qc.setQueryData(networkKey(provider, id), n)
      rememberLocation(provider, n.location)
      toast.success(`Now browsing from ${n.country || n.location}`, { description: n.externalIp })
    },
    onError: (e) => toast.error("Could not switch location", { description: e.message }),
  })

  return (
    <Section title="VPN location">
      {locations.map((l) => {
        const selected = l.id === current
        const switching = change.isPending && change.variables === l.id
        return (
          <Row
            key={l.id}
            selected={selected}
            busy={switching}
            disabled={change.isPending}
            flag={locationFlag(l)}
            title={l.label}
            onClick={() => !selected && change.mutate(l.id)}
          >
            {selected && ip && <span className="font-mono">{[country, ip].filter(Boolean).join(" · ")}</span>}
          </Row>
        )
      })}
    </Section>
  )
}

function Conditions({
  profiles,
  current,
  busy,
  onChange,
}: {
  profiles: NetworkProfileInfo[]
  current?: string
  busy: boolean
  onChange: (id: string) => void
}) {
  const groups = [
    { title: "Network conditions", items: profiles.filter((p) => !p.scenario) },
    { title: "Scenarios", items: profiles.filter((p) => p.scenario) },
  ]
  return (
    <>
      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <Section key={g.title} title={g.title}>
              {g.items.map((p) => {
                const selected = p.id === current
                const numbers = linkNumbers(p)
                return (
                  <Row
                    key={p.id}
                    selected={selected}
                    disabled={busy}
                    icon={p.scenario ? ActivityIcon : SignalIcon}
                    title={p.name}
                    onClick={() => !selected && onChange(p.id)}
                  >
                    {p.description}
                    {numbers && <span className="mt-0.5 block font-mono text-[11px]">{numbers}</span>}
                  </Row>
                )
              })}
            </Section>
          ),
      )}
    </>
  )
}

function linkNumbers(p: NetworkProfileInfo) {
  return [
    p.rtt && `+${p.rtt}${p.jitter ? ` ±${p.jitter}` : ""} ms`,
    (p.down || p.up) && `↓ ${bandwidth(p.down)} ↑ ${bandwidth(p.up)}`,
    p.loss && `${p.loss}% loss`,
  ]
    .filter(Boolean)
    .join(" · ")
}

function bandwidth(kbit?: number) {
  if (!kbit) return "∞"
  return kbit >= 1000 ? `${kbit / 1000} Mbit/s` : `${kbit} kbit/s`
}
