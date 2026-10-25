import { MapIcon, PlayIcon, RepeatIcon, RouteIcon, SquareIcon, Undo2Icon } from "lucide-react"
import { useMemo } from "react"
import type { DeviceSettings, DeviceState } from "@/api/client"
import { useRoadRoute } from "@/api/queries"
import { Chips, ShadeButton, Tile } from "@/components/session/shade"
import { cn } from "@/lib/utils"
import { formatDistance, pathLength, type Point, type TravelMode, travelMode, travelModes } from "@/lib/geo"

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

export function RouteControl({
  s,
  set,
  busy,
  routing,
  plan,
  setPlan,
  planned,
}: {
  s: DeviceState
  set: (patch: DeviceSettings) => void
  busy: boolean
  routing: boolean
  plan: Plan | null
  setPlan: (plan: Plan | null) => void
  planned: ReturnType<typeof usePlannedPath>
}) {
  const route = s.route

  if (route) {
    const m = travelModes[travelMode(route.speed)]
    return (
      <div className="flex items-center gap-3 rounded-3xl bg-neutral-800 py-2 pr-2 pl-4">
        <RouteIcon className="size-4 shrink-0 text-sky-200" />
        <span className="grid min-w-0 flex-1 text-sm">
          <span className="truncate font-medium">
            {route.moving ? `${m.label} · ${Math.round(route.currentSpeed * 3.6)} km/h` : "Arrived"}
          </span>
          <span className="truncate text-xs text-neutral-400">
            {formatDistance(route.travelled)} of {formatDistance(route.length)}
            {route.loop && ", in a loop"}
          </span>
        </span>
        <ShadeButton disabled={busy} onClick={() => set({ stopRoute: true })}>
          <SquareIcon />
          {route.moving ? "Stop" : "Done"}
        </ShadeButton>
      </div>
    )
  }

  if (!plan) {
    return (
      <ShadeButton disabled={busy} onClick={() => setPlan({ points: [], mode: "walk", loop: false, roads: routing })}>
        <RouteIcon />
        Move along a route
      </ShadeButton>
    )
  }

  const { path, onRoads, roads } = planned
  const waiting = onRoads && plan.points.length > 0 && !roads.data
  const hint =
    plan.points.length === 0
      ? `Click the map to add points; the device goes there ${onRoads ? "along roads" : "in straight lines"}.`
      : onRoads && roads.isFetching
        ? "Finding the way…"
        : onRoads && roads.error
          ? `No route along roads: ${roads.error.message}`
          : `${plan.points.length} ${plan.points.length === 1 ? "point" : "points"}, ${formatDistance(roads.data && onRoads ? roads.data.length : pathLength(path))}`
  return (
    <section className="grid gap-2">
      <p className={cn("px-1 text-xs", onRoads && roads.error ? "text-red-300" : "text-neutral-400")}>{hint}</p>
      <Chips
        title="Speed"
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
            label="Follow roads"
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
          label="Loop back"
          on={plan.loop}
          onClick={() => setPlan({ ...plan, loop: !plan.loop })}
        />
      </div>
      <div className="flex gap-2">
        <ShadeButton
          primary
          className="flex-1"
          disabled={busy || plan.points.length === 0 || waiting}
          onClick={() => {
            set({ route: { points: path, speed: travelModes[plan.mode].speed, loop: plan.loop } })
            setPlan(null)
          }}
        >
          <PlayIcon />
          Go
        </ShadeButton>
        <ShadeButton
          disabled={plan.points.length === 0}
          onClick={() => setPlan({ ...plan, points: plan.points.slice(0, -1) })}
        >
          <Undo2Icon />
          Undo
        </ShadeButton>
        <ShadeButton onClick={() => setPlan(null)}>Cancel</ShadeButton>
      </div>
    </section>
  )
}
