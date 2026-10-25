import { MapIcon, PlayIcon, RepeatIcon, RouteIcon, SquareIcon, Undo2Icon } from "lucide-react"
import { useMemo } from "react"
import type { DeviceSettings, DeviceState } from "@/api/client"
import { useRoadRoute } from "@/api/queries"
import { Chips, ShadeButton, Tile } from "@/components/session/shade"
import { cn } from "@/lib/utils"
import { formatDistance, pathLength, type Point, type TravelMode, travelMode, travelModes } from "@/lib/geo"

type GeoRoute = NonNullable<DeviceSettings["route"]>

export type Plan = { points: Point[]; mode: TravelMode; loop: boolean; roads: boolean }

export const maxRoadPoints = 18

export function routeLine(route: NonNullable<DeviceState["route"]>): Point[] {
  return route.loop && route.points[0] ? [...route.points, route.points[0]] : route.points
}

export function usePlannedPath(here: Point, plan: Plan | null, routing: boolean) {
  const waypoints = useMemo(
    () => (plan ? (plan.loop ? [here, ...plan.points, here] : [here, ...plan.points]) : []),
    [here, plan],
  )
  const roads = useRoadRoute(waypoints, plan?.mode ?? "walk", routing && !!plan?.roads && plan.points.length > 0)
  const onRoads = routing && !!plan?.roads
  const path = onRoads && roads.data ? roads.data.points : waypoints
  return { path, onRoads, roads }
}

export function RouteStatus({
  route,
  busy,
  onStop,
}: {
  route: NonNullable<DeviceState["route"]>
  busy: boolean
  onStop: () => void
}) {
  const m = travelModes[travelMode(route.speed)]
  return (
    <div className="flex items-center gap-3 rounded-full bg-neutral-800 py-2 pr-2 pl-4">
      <RouteIcon className="size-5 shrink-0 text-sky-200" />
      <span className="grid min-w-0 flex-1 text-sm">
        <span className="truncate font-medium">
          {route.moving ? `${m.label} · ${Math.round(route.currentSpeed * 3.6)} km/h` : "Arrived"}
        </span>
        <span className="truncate text-xs text-neutral-400">
          {formatDistance(route.travelled)} of {formatDistance(route.length)}
          {route.loop && ", in a loop"}
        </span>
      </span>
      <ShadeButton primary={route.moving} disabled={busy} onClick={onStop}>
        <SquareIcon />
        {route.moving ? "Stop" : "Done"}
      </ShadeButton>
    </div>
  )
}

export function RoutePlanner({
  busy,
  routing,
  plan,
  setPlan,
  planned,
  onGo,
}: {
  busy: boolean
  routing: boolean
  plan: Plan
  setPlan: (plan: Plan) => void
  planned: ReturnType<typeof usePlannedPath>
  onGo: (route: GeoRoute) => void
}) {
  const { path, onRoads, roads } = planned
  const stops = plan.points.length
  const waiting = onRoads && stops > 0 && !roads.data
  const failed = onRoads && !!roads.error
  const note =
    stops === 0
      ? "Tap the map to add stops."
      : onRoads && roads.isFetching
        ? "Finding the way…"
        : failed
          ? `No way along roads: ${roads.error.message}`
          : `${stops} ${stops === 1 ? "stop" : "stops"} · ${formatDistance(onRoads && roads.data ? roads.data.length : pathLength(path))}`
  return (
    <>
      <Chips
        title="Pace"
        options={(Object.entries(travelModes) as [TravelMode, (typeof travelModes)[TravelMode]][]).map(([k, m]) => ({
          value: k,
          label: `${m.label} · ${Math.round(m.speed * 3.6)} km/h`,
        }))}
        value={plan.mode}
        onChange={(mode) => setPlan({ ...plan, mode })}
      />
      <div className={cn("grid gap-2", routing && "grid-cols-2")}>
        {routing && (
          <Tile
            icon={MapIcon}
            label="Roads"
            status={plan.roads ? "Follow them" : "Straight lines"}
            on={plan.roads}
            onClick={() =>
              setPlan({
                ...plan,
                roads: !plan.roads,
                points: !plan.roads ? plan.points.slice(0, maxRoadPoints) : plan.points,
              })
            }
          />
        )}
        <Tile
          icon={RepeatIcon}
          label="Loop"
          status={plan.loop ? "Back to the start" : "Stop at the end"}
          on={plan.loop}
          onClick={() => setPlan({ ...plan, loop: !plan.loop })}
        />
      </div>
      <p className={cn("px-1 text-xs", failed ? "text-red-300" : "text-neutral-400")}>{note}</p>
      <div className="flex gap-2">
        <ShadeButton
          primary
          className="flex-1"
          disabled={busy || stops === 0 || waiting}
          onClick={() => onGo({ points: path, speed: travelModes[plan.mode].speed, loop: plan.loop })}
        >
          <PlayIcon />
          Go
        </ShadeButton>
        <ShadeButton
          aria-label="Remove the last stop"
          title="Remove the last stop"
          disabled={stops === 0}
          onClick={() => setPlan({ ...plan, points: plan.points.slice(0, -1) })}
        >
          <Undo2Icon />
        </ShadeButton>
      </div>
    </>
  )
}
