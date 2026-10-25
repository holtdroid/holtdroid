import { PlayIcon, RouteIcon, SquareIcon, Undo2Icon } from "lucide-react"
import { useMemo } from "react"
import type { DeviceSettings, DeviceState } from "@/api/client"
import { useRoadRoute } from "@/api/queries"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
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
      <div className="flex items-center gap-2 text-sm">
        <RouteIcon className="text-muted-foreground size-4" />
        <span className="min-w-0 flex-1 truncate">
          {route.moving ? `${m.label} · ${Math.round(route.currentSpeed * 3.6)} km/h` : "Arrived"} ·{" "}
          {formatDistance(route.travelled)} of {formatDistance(route.length)}
          {route.loop && " (loop)"}
        </span>
        <Button size="xs" variant="outline" disabled={busy} onClick={() => set({ stopRoute: true })}>
          <SquareIcon />
          {route.moving ? "Stop" : "Done"}
        </Button>
      </div>
    )
  }

  if (!plan) {
    return (
      <Button
        size="xs"
        variant="ghost"
        className="self-start"
        disabled={busy}
        onClick={() => setPlan({ points: [], mode: "walk", loop: false, roads: routing })}
      >
        <RouteIcon />
        Move along a route
      </Button>
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
    <div className="flex flex-col gap-2">
      <p className={onRoads && roads.error ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>{hint}</p>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={plan.mode}
        onValueChange={(v) => v && setPlan({ ...plan, mode: v as TravelMode })}
        className="w-full"
      >
        {(Object.entries(travelModes) as [TravelMode, (typeof travelModes)[TravelMode]][]).map(([k, m]) => (
          <ToggleGroupItem key={k} value={k} className="flex-1 text-xs">
            {m.label} · {Math.round(m.speed * 3.6)} km/h
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {routing && (
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>Follow roads</span>
          <Switch
            checked={plan.roads}
            onCheckedChange={(on) =>
              setPlan({ ...plan, roads: on, points: on ? plan.points.slice(0, maxRoadPoints) : plan.points })
            }
          />
        </label>
      )}
      <label className="flex items-center justify-between gap-2 text-sm">
        <span>Loop back to the start</span>
        <Switch checked={plan.loop} onCheckedChange={(loop) => setPlan({ ...plan, loop })} />
      </label>
      <div className="flex gap-1">
        <Button
          size="xs"
          disabled={busy || plan.points.length === 0 || waiting}
          onClick={() => {
            set({ route: { points: path, speed: travelModes[plan.mode].speed, loop: plan.loop } })
            setPlan(null)
          }}
        >
          <PlayIcon />
          Go
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={plan.points.length === 0}
          onClick={() => setPlan({ ...plan, points: plan.points.slice(0, -1) })}
        >
          <Undo2Icon />
          Undo
        </Button>
        <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setPlan(null)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
