import { GlobeIcon, LocateFixedIcon, MapPinIcon, NavigationIcon } from "lucide-react"
import { lazy, Suspense, useMemo, useState } from "react"
import { toast } from "sonner"
import type { DeviceSettings, DeviceState } from "@/api/client"
import { useMap } from "@/api/queries"
import { maxRoadPoints, type Plan, RouteControl, routeLine, usePlannedPath } from "@/components/session/geo-route"
import {
  CardLine,
  Note,
  ShadeButton,
  ShadeCard,
  ShadeHeader,
  ShadePanel,
  ShadeRoot,
  Tile,
} from "@/components/session/shade"
import { useDevice, useNetwork, useUpdateDevice } from "@/components/session/use-device"
import { HoverCardTrigger } from "@/components/ui/hover-card"
import { CITIES, defaultGeo } from "@/lib/device-presets"
import { travelMode, travelModes } from "@/lib/geo"

const GeoMap = lazy(() => import("@/components/session/geo-map"))

const mapPlaceholder = <div className="h-56 w-full bg-neutral-800" />

type Set = (patch: DeviceSettings) => void

function geoName(geo: DeviceState["geo"]) {
  if (!geo) return defaultGeo.name
  const city = CITIES.find(
    (c) => Math.abs(c.latitude - geo.latitude) < 0.01 && Math.abs(c.longitude - geo.longitude) < 0.01,
  )
  return city?.name ?? `${geo.latitude.toFixed(4)}, ${geo.longitude.toFixed(4)}`
}

export function GpsWidget({ provider, id, vpn }: { provider: string; id: string; vpn: boolean }) {
  const device = useDevice(provider, id)
  const update = useUpdateDevice(provider, id)
  const network = useNetwork(provider, id, vpn)
  const s = device.data
  if (!s?.canFakeGeo) return null
  const route = s.route
  const status = route?.moving
    ? `${travelModes[travelMode(route.speed)].label} · ${Math.round(route.currentSpeed * 3.6)} km/h`
    : s.geoOverride
      ? "Set by hand"
      : "Follows the VPN"

  return (
    <ShadeRoot>
      <HoverCardTrigger asChild>
        <ShadeCard aria-label="GPS location" changed={s.geoOverride || !!route}>
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <MapPinIcon className="size-4 shrink-0 text-neutral-400" />
            <span className="truncate">{geoName(s.geo)}</span>
          </span>
          <CardLine icon={route?.moving ? NavigationIcon : s.geoOverride ? MapPinIcon : GlobeIcon}>{status}</CardLine>
        </ShadeCard>
      </HoverCardTrigger>
      <ShadePanel>
        <GpsShade
          s={s}
          busy={update.isPending}
          set={(patch) => update.mutate(patch)}
          vpnCountry={network.data?.country}
        />
      </ShadePanel>
    </ShadeRoot>
  )
}

function GpsShade({ s, busy, set, vpnCountry }: { s: DeviceState; busy: boolean; set: Set; vpnCountry?: string }) {
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
        setOverride(true)
        goTo(Number(p.coords.latitude.toFixed(6)), Number(p.coords.longitude.toFixed(6)))
      },
      (e) => {
        setLocating(false)
        toast.error("Could not get your location", { description: e.message })
      },
    )
  }

  return (
    <>
      <ShadeHeader
        title="GPS location"
        summary={`${geoName(s.geo)} · ${here.latitude.toFixed(4)}, ${here.longitude.toFixed(4)}`}
        busy={busy}
        onReset={
          s.geoOverride
            ? () => {
                setOverride(false)
                set({ resetGeo: true })
              }
            : undefined
        }
      />
      {map?.enabled && (
        <div className="overflow-hidden rounded-3xl">
          <Suspense fallback={mapPlaceholder}>
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
        </div>
      )}
      {map?.enabled && (
        <RouteControl s={s} set={set} busy={busy} routing={routing} plan={plan} setPlan={setPlan} planned={planned} />
      )}

      <Tile
        icon={GlobeIcon}
        label="Follow the VPN location"
        status={manual ? "Off, set by hand for this session" : vpnCity ? `On, around ${vpnCity.name}` : "On"}
        on={!manual}
        wide
        disabled={busy}
        onClick={() => {
          if (manual) {
            setOverride(false)
            if (s.geoOverride) set({ resetGeo: true })
          } else setOverride(true)
        }}
      />

      {manual && (
        <section className="grid gap-2">
          <h4 className="px-1 text-xs font-medium text-neutral-400">Somewhere else</h4>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (point && valid) goTo(point.latitude, point.longitude)
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="52.2297, 21.0122"
              aria-label="Latitude, longitude"
              className="h-10 min-w-0 flex-1 rounded-full bg-neutral-800 px-4 font-mono text-sm text-neutral-100 outline-none placeholder:text-neutral-500 focus-visible:ring-2 focus-visible:ring-sky-300"
            />
            <ShadeButton primary type="submit" disabled={busy || !valid}>
              Set
            </ShadeButton>
          </form>
          <div className="flex flex-wrap gap-2">
            <ShadeButton disabled={busy || locating} onClick={locate}>
              <LocateFixedIcon />
              Where I am
            </ShadeButton>
            {vpnCity && (
              <ShadeButton disabled={busy} onClick={() => goTo(vpnCity.latitude, vpnCity.longitude)}>
                <GlobeIcon />
                {vpnCity.name}
              </ShadeButton>
            )}
          </div>
          {map?.enabled && <Note>Or click the map.</Note>}
        </section>
      )}
    </>
  )
}
