import { PlayIcon, RouteIcon, SquareIcon, Undo2Icon } from "lucide-react"
import { useState } from "react"
import type { DeviceSettings, DeviceState } from "@/api/client"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatDistance, pathLength, type Point, type TravelMode, travelMode, travelModes } from "@/lib/geo"

export function routeLine(route: NonNullable<DeviceState["route"]>): Point[] {
  return route.loop && route.points[0] ? [...route.points, route.points[0]] : route.points
}

export function RouteControl({
  s,
  set,
  busy,
  here,
  plan,
  setPlan,
}: {
  s: DeviceState
  set: (patch: DeviceSettings) => void
  busy: boolean
  here: Point
  plan: Point[] | null
  setPlan: (plan: Point[] | null) => void
}) {
  const [mode, setMode] = useState<TravelMode>("walk")
  const [loop, setLoop] = useState(false)
  const route = s.route

  if (route) {
    const m = travelModes[travelMode(route.speed)]
    return (
      <div className="flex items-center gap-2 text-sm">
        <RouteIcon className="text-muted-foreground size-4" />
        <span className="min-w-0 flex-1 truncate">
          {route.moving ? m.label : "Arrived"} · {formatDistance(route.travelled)} of {formatDistance(route.length)}
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
      <Button size="xs" variant="ghost" className="self-start" disabled={busy} onClick={() => setPlan([])}>
        <RouteIcon />
        Move along a route
      </Button>
    )
  }

  const points = [here, ...plan]
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">
        {plan.length === 0
          ? "Click the map to add points; the device goes there in straight lines."
          : `${plan.length} ${plan.length === 1 ? "point" : "points"}, ${formatDistance(pathLength(loop ? [...points, here] : points))}`}
      </p>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={mode}
        onValueChange={(v) => v && setMode(v as TravelMode)}
        className="w-full"
      >
        {(Object.entries(travelModes) as [TravelMode, (typeof travelModes)[TravelMode]][]).map(([k, m]) => (
          <ToggleGroupItem key={k} value={k} className="flex-1 text-xs">
            {m.label} · {Math.round(m.speed * 3.6)} km/h
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <label className="flex items-center justify-between gap-2 text-sm">
        <span>Loop back to the start</span>
        <Switch checked={loop} onCheckedChange={setLoop} />
      </label>
      <div className="flex gap-1">
        <Button
          size="xs"
          disabled={busy || plan.length === 0}
          onClick={() => {
            set({ route: { points, speed: travelModes[mode].speed, loop } })
            setPlan(null)
          }}
        >
          <PlayIcon />
          Go
        </Button>
        <Button size="xs" variant="ghost" disabled={plan.length === 0} onClick={() => setPlan(plan.slice(0, -1))}>
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
