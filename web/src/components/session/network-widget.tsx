import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowDownUpIcon,
  ArrowUpIcon,
  GlobeIcon,
  PlaneIcon,
  SignalIcon,
  UsbIcon,
  WifiIcon,
  WifiOffIcon,
  type LucideIcon,
} from "lucide-react"
import { useMemo } from "react"
import { toast } from "sonner"
import { agentClient, type DeviceSettings, type DeviceState, type Location, type Metrics, unwrap } from "@/api/client"
import { byteRate } from "@/components/session/metrics"
import { summary } from "@/components/session/network-panel"
import { networkKey, useDevice, useNetwork, useUpdateDevice } from "@/components/session/use-device"
import {
  CardLine,
  Note,
  Row,
  Section,
  ShadeCard,
  ShadeHeader,
  ShadePanel,
  Tile,
  ShadeRoot,
} from "@/components/session/shade"
import { HoverCardTrigger } from "@/components/ui/hover-card"
import { rememberLocation } from "@/lib/launch-prefs"
import { locationFlag } from "@/lib/location"

export function NetworkWidget({
  provider,
  id,
  locations,
  metrics,
  onConditions,
}: {
  provider: string
  id: string
  locations: Location[]
  metrics: Metrics[]
  onConditions?: () => void
}) {
  const m = metrics.at(-1)
  const device = useDevice(provider, id)
  const update = useUpdateDevice(provider, id)
  const network = useNetwork(provider, id, locations.length > 0)
  const s = device.data
  const n = network.data
  const location = locations.find((l) => l.id === n?.location)
  const region = s?.networkRegions?.find((r) => r.id === s.networkRegion?.region)
  const emulated = !!s && ((!!s.networkProfile && s.networkProfile !== "full") || !!region)
  const radios = !s?.usbNetwork
  const changed = !!s && (s.airplaneMode || s.wifi !== radios || s.mobileData !== radios || emulated)

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
            <span className="truncate">
              {s?.airplaneMode ? "Airplane mode" : s && emulated ? summary(s, region) : linkSummary(s)}
            </span>
          </span>
          {m && (
            <CardLine icon={ArrowDownUpIcon}>
              ↓ {byteRate(m.device.rxRate)} ↑ {byteRate(m.device.txRate)}
            </CardLine>
          )}
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
            metrics={metrics}
            onConditions={onConditions}
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
  metrics,
  onConditions,
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
  metrics: Metrics[]
  onConditions?: () => void
}) {
  const radios = !s.usbNetwork
  const region = s.networkRegions?.find((r) => r.id === s.networkRegion?.region)
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
                  ...(s.networkProfile && { networkProfile: "full", networkRegion: { region: "" } }),
                })
            : undefined
        }
      />

      {metrics.length > 0 && <Traffic history={metrics} />}
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

      {s.networkProfiles && onConditions && (
        <Section title="Network conditions">
          <Row selected={false} icon={ActivityIcon} title={summary(s, region)} onClick={onConditions}>
            Slow links, scenarios and regions in the Network tab
          </Row>
        </Section>
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

function Traffic({ history }: { history: Metrics[] }) {
  const last = history.at(-1)
  if (!last) return null
  const totals = history.map((h) => h.device.rxRate + h.device.txRate)
  const top = Math.max(...totals, 1)
  const points = totals.map((v, i) => `${(i / Math.max(totals.length - 1, 1)) * 100},${30 - (v / top) * 28}`).join(" ")
  return (
    <section className="grid gap-1.5">
      <h4 className="px-1 text-xs font-medium text-neutral-400">Device traffic</h4>
      <div className="grid grid-cols-2 gap-1.5">
        <Rate icon={ArrowDownIcon} label="Download" value={last.device.rxRate} />
        <Rate icon={ArrowUpIcon} label="Upload" value={last.device.txRate} />
      </div>
      <svg
        viewBox="0 0 100 30"
        preserveAspectRatio="none"
        className="h-10 w-full rounded-2xl bg-neutral-800"
        aria-hidden
      >
        <polyline
          points={points}
          fill="none"
          vectorEffect="non-scaling-stroke"
          strokeWidth={1.5}
          strokeLinejoin="round"
          className="stroke-sky-300"
        />
      </svg>
      <Note>Everything the device sends and receives, every two seconds over the last minute.</Note>
    </section>
  )
}

function Rate({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="grid gap-0.5 rounded-2xl bg-neutral-800 px-3 py-2">
      <span className="flex items-center gap-1 text-sm font-medium tabular-nums">
        <Icon className="size-3.5 text-sky-300" />
        {byteRate(value)}
      </span>
      <span className="text-[11px] text-neutral-400">{label}</span>
    </div>
  )
}
