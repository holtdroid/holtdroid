import { GlobeIcon, LocateFixedIcon, MapPinIcon } from "lucide-react"
import { lazy, Suspense, useMemo, useState } from "react"
import { toast } from "sonner"
import { type DeviceSettings, type DeviceState, type Location } from "@/api/client"
import { useMap } from "@/api/queries"
import { maxRoadPoints, type Plan, RouteControl, routeLine, usePlannedPath } from "@/components/session/geo-route"
import { ControlGroup, RailControl } from "@/components/session/rail-control"
import { RailSection } from "@/components/session/rail-item"
import { useDevice, useNetwork, useUpdateDevice } from "@/components/session/use-device"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { CITIES, defaultGeo } from "@/lib/device-presets"

const GeoMap = lazy(() => import("@/components/session/geo-map"))

type Props = { s: DeviceState; set: (patch: DeviceSettings) => void; busy: boolean }

export function DeviceControls({ provider, id, locations }: { provider: string; id: string; locations: Location[] }) {
  const device = useDevice(provider, id)
  const update = useUpdateDevice(provider, id)
  const s = device.data
  if (!s?.canFakeGeo) return null
  return (
    <>
      <RailSection title="Device" />
      <GpsControl
        s={s}
        set={(patch) => update.mutate(patch)}
        busy={update.isPending}
        provider={provider}
        id={id}
        vpn={locations.length > 0}
      />
    </>
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
  const vpnCity = vpnCountry ? CITIES.find((c) => c.country === vpnCountry.toUpperCase()) : undefined
  const parsed = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/)
  const point = parsed && { latitude: Number(parsed[1]), longitude: Number(parsed[2]) }
  const valid = !!point && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180
  const goTo = (latitude: number, longitude: number) => set({ geo: { latitude, longitude } })
  const map = useMap().data
  const [plan, setPlan] = useState<Plan | null>(null)
  const here = s.geo ?? defaultGeo
  const route = s.route
  const routing = !!map?.routing
  const planned = usePlannedPath(here, plan, routing)
  const line = useMemo(() => {
    if (plan) return planned.path
    return route ? routeLine(route) : undefined
  }, [plan, planned.path, route])

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
      {map?.enabled && (
        <Suspense fallback={<div className="bg-muted h-56 w-full rounded-md" />}>
          <GeoMap
            map={map}
            point={here}
            line={line}
            moving={!!route?.moving}
            disabled={busy}
            onPick={(p) => {
              if (plan) {
                if (planned.onRoads && plan.points.length >= maxRoadPoints) {
                  toast.error(`At most ${maxRoadPoints} points along roads`)
                  return
                }
                setPlan({ ...plan, points: [...plan.points, p] })
                return
              }
              setOverride(true)
              goTo(p.latitude, p.longitude)
            }}
          />
        </Suspense>
      )}
      {map?.enabled && (
        <RouteControl s={s} set={set} busy={busy} routing={routing} plan={plan} setPlan={setPlan} planned={planned} />
      )}
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
