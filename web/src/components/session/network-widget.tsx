import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  GlobeIcon,
  PlaneIcon,
  RepeatIcon,
  SignalIcon,
  SlidersHorizontalIcon,
  UsbIcon,
  WifiIcon,
  WifiOffIcon,
  type LucideIcon,
} from "lucide-react"
import { useMemo } from "react"
import { toast } from "sonner"
import { agentClient, type DeviceSettings, type DeviceState, type Location, type Metrics, unwrap } from "@/api/client"
import { byteRate } from "@/components/session/metrics"
import { networkKey, useDevice, useNetwork, useUpdateDevice } from "@/components/session/use-device"
import { Note, SectionTitle, ShadeCard, ShadeHeader, ShadePanel, ShadeRoot, Tile } from "@/components/session/shade"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { useNow } from "@/hooks/use-now"
import { rememberLocation } from "@/lib/launch-prefs"
import { locationFlag } from "@/lib/location"
import { emulating, mbit, position, stepLink, stepName, summary } from "@/lib/network-conditions"
import { cn } from "@/lib/utils"

const quick = ["full", "lte", "3g", "edge", "subway"]

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
  const device = useDevice(provider, id)
  const update = useUpdateDevice(provider, id)
  const network = useNetwork(provider, id, locations.length > 0)
  const s = device.data
  const n = network.data
  const location = locations.find((l) => l.id === n?.location)
  const region = s?.networkRegions?.find((r) => r.id === s.networkRegion?.region)
  const emulated = !!s && emulating(s)
  const radios = !s?.usbNetwork
  const changed = !!s && (s.airplaneMode || s.wifi !== radios || s.mobileData !== radios || emulated)
  const link = s?.airplaneMode ? "Airplane mode" : s && emulated ? summary(s, region) : linkSummary(s)

  return (
    <ShadeRoot>
      <ShadeCard
        aria-label="Network"
        icon={linkIcon(s)}
        changed={changed}
        summary={location ? `${link} · through ${location.label}` : link}
      />
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

function linkIcon(s?: DeviceState): LucideIcon {
  if (s?.airplaneMode) return PlaneIcon
  if (s && emulating(s)) return SignalIcon
  if (!s || s.wifi) return WifiIcon
  if (s.mobileData) return SignalIcon
  if (s.usbNetwork) return UsbIcon
  return WifiOffIcon
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

      {s.networkProfiles && <Conditions s={s} busy={busy} set={set} onMore={onConditions} />}

      {locations.length > 0 && (
        <Exit provider={provider} id={id} locations={locations} current={current} country={country} ip={ip} />
      )}

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

      {metrics.length > 0 && <Traffic history={metrics} />}
    </>
  )
}

function Conditions({
  s,
  busy,
  set,
  onMore,
}: {
  s: DeviceState
  busy: boolean
  set: (patch: DeviceSettings) => void
  onMore?: () => void
}) {
  const now = useNow()
  const profiles = s.networkProfiles ?? []
  const shown = profiles.filter((p) => quick.includes(p.id) || p.id === s.networkProfile)
  const profile = profiles.find((p) => p.id === s.networkProfile)
  const pos = position(s, now)
  const step = pos && profile?.steps?.[pos.step]
  const link = step ? (step.profile === profile.id ? profile : stepLink(profiles, step)) : profile
  const outage = !!step && !step.profile
  const route = s.networkRoute
  const rtt = outage ? "—" : link?.rtt ? `${link.rtt} ms` : route?.edge ? `${route.edge} ms` : "—"
  const down = link?.down ?? (link?.id === "full" ? route?.down : undefined)
  const rate = outage ? "0" : link?.down || link?.up ? `${mbit(down)} / ${mbit(link?.up)}` : mbit(down)
  const loss = outage ? "100%" : link?.loss ? `${link.loss}%` : "0%"
  return (
    <section className="grid gap-2.5">
      <SectionTitle>Conditions</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((p) => {
          const on = p.id === s.networkProfile
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              disabled={busy}
              className={cn(
                "h-[26px] cursor-pointer rounded-[7px] border px-2.5 text-xs font-medium transition-colors disabled:cursor-default",
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              onClick={() => !on && set({ networkProfile: p.id })}
            >
              {p.id === "full" ? "No limits" : p.name}
            </button>
          )
        })}
        {onMore && (
          <button
            type="button"
            className="flex h-[26px] cursor-pointer items-center gap-1 rounded-[7px] border border-dashed px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={onMore}
          >
            <SlidersHorizontalIcon className="size-3" />
            All…
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 rounded-xl border bg-muted py-2.5 text-center">
        <Metric value={rtt} label="Ping" />
        <Metric value={rate} label="Mbit/s" divided />
        <Metric value={loss} label="Loss" divided />
      </div>
      {profile && pos && step && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RepeatIcon className="size-3 shrink-0 text-warning" />
          {profile.name} · step {pos.step + 1} of {pos.count}: {stepName(profiles, step, profile)}
        </span>
      )}
      {onMore && (
        <button
          type="button"
          className="flex cursor-pointer items-center justify-between rounded-[9px] border bg-card px-3 py-2 text-left transition-colors hover:bg-muted"
          onClick={onMore}
        >
          <span className="grid min-w-0">
            <span className="text-[13px] font-medium">Network conditions</span>
            <span className="truncate text-xs text-muted-foreground">
              {summary(
                s,
                s.networkRegions?.find((r) => r.id === s.networkRegion?.region),
              )}{" "}
              · networks, scenarios, regions
            </span>
          </span>
          <SlidersHorizontalIcon className="size-4 shrink-0 text-muted-foreground" />
        </button>
      )}
    </section>
  )
}

function Metric({ value, label, divided }: { value: string; label: string; divided?: boolean }) {
  return (
    <div className={cn("grid", divided && "border-l")}>
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

function Exit({
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
  const selected = locations.find((l) => l.id === current)

  return (
    <section className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-xs text-muted-foreground">VPN exit</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="min-w-0 flex-1 justify-between"
              disabled={change.isPending}
              aria-label="VPN location"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {change.isPending ? (
                  <Spinner className="size-3.5" />
                ) : selected ? (
                  <span>{locationFlag(selected) ?? <GlobeIcon />}</span>
                ) : (
                  <GlobeIcon />
                )}
                <span className="truncate">{selected?.label ?? "Choose a location"}</span>
              </span>
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuRadioGroup value={current ?? ""} onValueChange={(v) => v !== current && change.mutate(v)}>
              {locations.map((l) => (
                <DropdownMenuRadioItem key={l.id} value={l.id}>
                  <span>{locationFlag(l)}</span>
                  {l.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {ip && (
        <span className="pl-16 font-mono text-[11px] text-muted-foreground">
          {[country, ip].filter(Boolean).join(" · ")}
        </span>
      )}
    </section>
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
      <SectionTitle>Device traffic</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5">
        <Rate icon={ArrowDownIcon} label="Download" value={last.device.rxRate} />
        <Rate icon={ArrowUpIcon} label="Upload" value={last.device.txRate} />
      </div>
      <svg
        viewBox="0 0 100 30"
        preserveAspectRatio="none"
        className="h-10 w-full rounded-xl border bg-muted"
        aria-hidden
      >
        <polyline
          points={points}
          fill="none"
          vectorEffect="non-scaling-stroke"
          strokeWidth={1.5}
          strokeLinejoin="round"
          className="stroke-info"
        />
      </svg>
      <Note>Everything the device sends and receives, every two seconds over the last minute.</Note>
    </section>
  )
}

function Rate({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="grid gap-0.5 rounded-xl border bg-muted px-3 py-2">
      <span className="flex items-center gap-1 text-sm font-medium tabular-nums">
        <Icon className="size-3.5 text-info" />
        {byteRate(value)}
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  )
}
