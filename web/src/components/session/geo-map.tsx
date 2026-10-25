import "maplibre-gl/dist/maplibre-gl.css"
import { Map as MapLibre, Marker, setWorkerUrl } from "maplibre-gl"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url"
import { useTheme } from "next-themes"
import { useEffect, useEffectEvent, useRef } from "react"
import type { MapView } from "@/api/client"

setWorkerUrl(workerUrl)

type Point = { latitude: number; longitude: number }

const absolute = (url: string) => ({ url: url.startsWith("/") ? new URL(url, location.origin).href : url })

export default function GeoMap({
  map,
  point,
  disabled,
  onPick,
}: {
  map: MapView
  point: Point
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
    m.on("click", (e) => {
      marker.setLngLat(e.lngLat)
      pick(e.lngLat.lat, e.lngLat.lng)
    })
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

  return <div ref={container} className="bg-muted h-56 w-full overflow-hidden rounded-md" />
}
