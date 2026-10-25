import "maplibre-gl/dist/maplibre-gl.css"
import { type GeoJSONSource, Map as MapLibre, Marker, setWorkerUrl } from "maplibre-gl"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url"
import { useTheme } from "next-themes"
import { useEffect, useEffectEvent, useRef } from "react"
import type { MapView } from "@/api/client"
import type { Point } from "@/lib/geo"

setWorkerUrl(workerUrl)

const absolute = (url: string) => ({ url: url.startsWith("/") ? new URL(url, location.origin).href : url })

const routeColor = "#2563eb"

const noLine: Point[] = []

function routeData(line: Point[]): Parameters<GeoJSONSource["setData"]>[0] {
  const coords = line.map((p) => [p.longitude, p.latitude])
  return {
    type: "FeatureCollection",
    features:
      coords.length > 1
        ? [
            { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } },
            ...coords.map((c) => ({
              type: "Feature" as const,
              properties: {},
              geometry: { type: "Point" as const, coordinates: c },
            })),
          ]
        : [],
  }
}

function drawRoute(m: MapLibre, line: Point[]) {
  const data = routeData(line)
  const source = m.getSource<GeoJSONSource>("route")
  if (source) {
    void source.setData(data)
    return
  }
  if (!m.isStyleLoaded()) return
  m.addSource("route", { type: "geojson", data })
  m.addLayer({
    id: "route-line",
    type: "line",
    source: "route",
    filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": routeColor, "line-width": 3, "line-opacity": 0.8 },
  })
  m.addLayer({
    id: "route-points",
    type: "circle",
    source: "route",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 3.5,
      "circle-color": "#fff",
      "circle-stroke-color": routeColor,
      "circle-stroke-width": 2,
    },
  })
}

export default function GeoMap({
  map,
  point,
  line = noLine,
  disabled,
  onPick,
}: {
  map: MapView
  point: Point
  line?: Point[]
  disabled: boolean
  onPick: (p: Point) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const instance = useRef<{ map: MapLibre; marker: Marker; style: string } | null>(null)
  const { resolvedTheme } = useTheme()
  const style = (resolvedTheme === "dark" ? map.darkStyle : map.style) ?? ""
  const pick = useEffectEvent((latitude: number, longitude: number) => {
    if (!disabled) onPick({ latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)) })
  })
  const initial = useEffectEvent(() => ({ style, center: [point.longitude, point.latitude] as [number, number] }))
  const redraw = useEffectEvent((m: MapLibre) => drawRoute(m, line))

  useEffect(() => {
    const el = container.current
    if (!el) return undefined
    const start = initial()
    const center = start.center
    const m = new MapLibre({
      container: el,
      style: start.style,
      center,
      zoom: 11,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true },
      transformRequest: absolute,
    })
    m.touchZoomRotate.disableRotation()
    const marker = new Marker({ draggable: true }).setLngLat(center).addTo(m)
    marker.on("dragend", () => {
      const p = marker.getLngLat()
      pick(p.lat, p.lng)
    })
    m.on("click", (e) => pick(e.lngLat.lat, e.lngLat.lng))
    m.on("style.load", () => redraw(m))
    instance.current = { map: m, marker, style: start.style }
    return () => {
      instance.current = null
      m.remove()
    }
  }, [])

  useEffect(() => {
    const i = instance.current
    if (!i || i.style === style) return
    i.style = style
    i.map.setStyle(style)
  }, [style])

  useEffect(() => {
    const i = instance.current
    if (!i) return
    const lngLat: [number, number] = [point.longitude, point.latitude]
    i.marker.setLngLat(lngLat)
    if (!i.map.getBounds().contains(lngLat)) i.map.easeTo({ center: lngLat })
  }, [point.latitude, point.longitude])

  useEffect(() => {
    const i = instance.current
    if (i) drawRoute(i.map, line)
  }, [line])

  return <div ref={container} className="bg-muted h-56 w-full overflow-hidden rounded-md" />
}
