import {
  GlobeIcon,
  Loader2Icon,
  LocateFixedIcon,
  type LucideIcon,
  MapPinIcon,
  NavigationIcon,
  RouteIcon,
} from "lucide-react"
import { lazy, Suspense, useMemo, useState } from "react"
import { toast } from "sonner"
import type { DeviceSettings, DeviceState } from "@/api/client"
import { useMap } from "@/api/queries"
import {
  maxRoadPoints,
  type Plan,
  RoutePlanner,
  RouteStatus,
  routeLine,
  usePlannedPath,
} from "@/components/session/geo-route"
import { CardLine, Note, ShadeCard, ShadeHeader, ShadePanel, ShadeRoot, Tile } from "@/components/session/shade"
import { useDevice, useNetwork, useUpdateDevice } from "@/components/session/use-device"
import { HoverCardTrigger } from "@/components/ui/hover-card"
import { CITIES, defaultGeo } from "@/lib/device-presets"
import { type Point, travelMode, travelModes } from "@/lib/geo"
import { cn } from "@/lib/utils"

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

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon: LucideIcon }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div role="radiogroup" className="grid auto-cols-fr grid-flow-col gap-1 rounded-full bg-neutral-800 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={cn(
            "flex items-center justify-center gap-2 rounded-full py-2 text-sm font-medium transition-colors [&_svg]:size-4",
            o.value === value ? "bg-sky-200 text-sky-950" : "text-neutral-300 hover:bg-neutral-700",
          )}
          onClick={() => onChange(o.value)}
        >
          <o.icon />
          {o.label}
        </button>
      ))}
    </div>
  )
}

const coordinatesRe = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/

function parseCoordinates(text: string) {
  const m = text.match(coordinatesRe)
  if (!m) return undefined
  const p = { latitude: Number(m[1]), longitude: Number(m[2]) }
  return Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 ? p : undefined
}

function GpsShade({ s, busy, set, vpnCountry }: { s: DeviceState; busy: boolean; set: Set; vpnCountry?: string }) {
  const [text, setText] = useState("")
  const [locating, setLocating] = useState(false)
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
  const vpnCity = vpnCountry ? CITIES.find((c) => c.country === vpnCountry.toUpperCase()) : undefined
  const typed = parseCoordinates(text)
  const name = geoName(s.geo)
  const coords = `${here.latitude.toFixed(4)}, ${here.longitude.toFixed(4)}`
  const goTo = (p: Point) => set({ geo: p })

  const locate = () => {
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false)
        goTo({ latitude: Number(p.coords.latitude.toFixed(6)), longitude: Number(p.coords.longitude.toFixed(6)) })
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
        summary={name === coords ? coords : `${name} · ${coords}`}
        busy={busy}
        onReset={s.geoOverride || route ? () => set({ resetGeo: true }) : undefined}
      />
      {map?.enabled && (
        <div className="relative overflow-hidden rounded-3xl">
          <Suspense fallback={mapPlaceholder}>
            <GeoMap
              map={map}
              point={here}
              line={line}
              moving={!!route?.moving}
              disabled={busy}
              onPick={(p) => {
                if (!plan) {
                  goTo(p)
                  return
                }
                if (planned.onRoads && plan.points.length >= maxRoadPoints) {
                  toast.error(`At most ${maxRoadPoints} stops along roads`)
                  return
                }
                setPlan({ ...plan, points: [...plan.points, p] })
              }}
            />
          </Suspense>
          <button
            type="button"
            aria-label="Where I am"
            title="Where I am"
            disabled={busy || locating}
            className="absolute top-2 right-2 grid size-9 place-items-center rounded-full bg-neutral-900/90 text-neutral-100 shadow-md transition-colors hover:bg-neutral-800 disabled:opacity-60 [&_svg]:size-4"
            onClick={locate}
          >
            {locating ? <Loader2Icon className="animate-spin" /> : <LocateFixedIcon />}
          </button>
        </div>
      )}

      {route ? (
        <RouteStatus route={route} busy={busy} onStop={() => set({ stopRoute: true })} />
      ) : (
        <>
          {map?.enabled && (
            <Segmented
              options={[
                { value: "place", label: "Place", icon: MapPinIcon },
                { value: "route", label: "Route", icon: RouteIcon },
              ]}
              value={plan ? "route" : "place"}
              onChange={(v) =>
                setPlan(v === "route" ? { points: [], mode: "walk", loop: false, roads: routing } : null)
              }
            />
          )}
          {plan ? (
            <RoutePlanner
              busy={busy}
              routing={routing}
              plan={plan}
              setPlan={setPlan}
              planned={planned}
              onGo={(r) => {
                set({ route: r })
                setPlan(null)
              }}
            />
          ) : (
            <>
              <Tile
                icon={GlobeIcon}
                label="Follow the VPN location"
                status={s.geoOverride ? "Off, set for this session" : vpnCity ? `Around ${vpnCity.name}` : "On"}
                on={!s.geoOverride}
                wide
                disabled={busy}
                onClick={() => set(s.geoOverride ? { resetGeo: true } : { geo: here })}
              />
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (typed) goTo(typed)
                }}
              >
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste coordinates and press Enter"
                  aria-label="Latitude, longitude"
                  aria-invalid={text !== "" && !typed}
                  className="h-10 w-full rounded-full bg-neutral-800 px-4 font-mono text-sm text-neutral-100 outline-none placeholder:font-sans placeholder:text-neutral-500 focus-visible:ring-2 focus-visible:ring-sky-300 aria-invalid:ring-2 aria-invalid:ring-red-300/60"
                />
              </form>
              {map?.enabled && <Note>Tap the map or drag the dot to move the device.</Note>}
            </>
          )}
        </>
      )}
    </>
  )
}
