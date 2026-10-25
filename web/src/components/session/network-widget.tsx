import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ActivityIcon, GlobeIcon, PlaneIcon, SignalIcon, UsbIcon, WifiIcon, WifiOffIcon } from "lucide-react"
import { useMemo } from "react"
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
import { Note, Row, Section, ShadeCard, ShadeHeader, ShadePanel, Tile, ShadeRoot } from "@/components/session/shade"
import { HoverCardTrigger } from "@/components/ui/hover-card"
import { rememberLocation } from "@/lib/launch-prefs"
import { locationFlag } from "@/lib/location"

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
    <ShadeRoot>
      <HoverCardTrigger asChild>
        <ShadeCard aria-label="Network" changed={changed}>
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
        </ShadeCard>
      </HoverCardTrigger>
      <ShadePanel>
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
          <Note>Loading the device…</Note>
        )}
      </ShadePanel>
    </ShadeRoot>
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
      <ShadeHeader
        title="Network"
        summary={linkSummary(s)}
        busy={busy}
        onReset={
          changed
            ? () =>
                set({
                  airplaneMode: false,
                  wifi: radios,
                  mobileData: radios,
                  ...(s.networkProfile && { networkProfile: "full" }),
                })
            : undefined
        }
      />

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
        <Note>
          This phone reaches the internet over USB through the session&apos;s VPN, so Wi-Fi and mobile data stay off.
        </Note>
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
