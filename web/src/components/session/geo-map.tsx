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

function locationDot() {
  const el = document.createElement("div")
  el.className = "geo-dot"
  for (const part of ["halo", "beam", "core"]) {
    const span = document.createElement("span")
    span.className = `geo-dot-${part}`
    el.append(span)
  }
  return el
}

function bearing(a: Point, b: Point) {
  const rad = Math.PI / 180
  const y = Math.sin((b.longitude - a.longitude) * rad) * Math.cos(b.latitude * rad)
  const x =
    Math.cos(a.latitude * rad) * Math.sin(b.latitude * rad) -
    Math.sin(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.cos((b.longitude - a.longitude) * rad)
  return Math.atan2(y, x) / rad
}

function collapseAttribution(m: MapLibre, el: HTMLElement) {
  const collapse = () => {
    const attribution = el.querySelector(".maplibregl-compact-show")
    if (!attribution) return
    attribution.classList.remove("maplibregl-compact-show")
    attribution.removeAttribute("open")
    m.off("sourcedata", collapse)
  }
  m.on("sourcedata", collapse)
}

export default function GeoMap({
  map,
  point,
  line = noLine,
  moving = false,
  disabled,
  onPick,
}: {
  map: MapView
  point: Point
  line?: Point[]
  moving?: boolean
  disabled: boolean
  onPick: (p: Point) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const instance = useRef<{ map: MapLibre; marker: Marker; style: string; last: Point } | null>(null)
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
    collapseAttribution(m, el)
    const marker = new Marker({ element: locationDot(), draggable: true, rotationAlignment: "map" })
      .setLngLat(center)
      .addTo(m)
    marker.on("dragend", () => {
      const p = marker.getLngLat()
      pick(p.lat, p.lng)
    })
    m.on("click", (e) => pick(e.lngLat.lat, e.lngLat.lng))
    m.on("style.load", () => redraw(m))
    instance.current = { map: m, marker, style: start.style, last: { latitude: center[1], longitude: center[0] } }
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
    const dot = i.marker.getElement()
    if (moving && (i.last.latitude !== point.latitude || i.last.longitude !== point.longitude)) {
      i.marker.setRotation(bearing(i.last, point))
    }
    dot.toggleAttribute("data-moving", moving)
    i.last = point
    i.marker.setLngLat(lngLat)
    if (!i.map.getBounds().contains(lngLat)) i.map.easeTo({ center: lngLat })
  }, [point, moving])

  useEffect(() => {
    const i = instance.current
    if (i) drawRoute(i.map, line)
  }, [line])

  return <div ref={container} className="geo-map bg-muted h-56 w-full overflow-hidden rounded-md" />
}
