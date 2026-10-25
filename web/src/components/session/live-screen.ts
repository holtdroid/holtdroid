import { useQuery } from "@tanstack/react-query"
import { useEffect, useState, useSyncExternalStore } from "react"
import { sessionBase } from "@/api/client"
import { decodableCodecs, type ScreenConnection, type StreamStats } from "@/lib/scrcpy"

export function displayURL(provider: string, id: string, stream: "scrcpy" | "audio") {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws"
  return `${scheme}://${window.location.host}${sessionBase(provider, id)}/display/${stream}`
}

export class LiveScreen {
  #connection: ScreenConnection | null = null
  readonly #listeners = new Set<() => void>()

  get connection() {
    return this.#connection
  }

  set(connection: ScreenConnection | null) {
    this.#connection = connection
    for (const l of this.#listeners) l()
  }

  release(connection: ScreenConnection | undefined) {
    if (connection && this.#connection === connection) this.set(null)
  }

  subscribe = (l: () => void) => {
    this.#listeners.add(l)
    return () => this.#listeners.delete(l)
  }
}

export function useLiveScreen() {
  const [live] = useState(() => new LiveScreen())
  return live
}

export function useScreenLive(live: LiveScreen) {
  return useSyncExternalStore(live.subscribe, () => live.connection !== null)
}

export function useDecodableCodecs() {
  return useQuery({ queryKey: ["decodable-codecs"], queryFn: decodableCodecs, staleTime: Infinity }).data
}

export type StreamRate = { fps: number; bitrate: number; dropped: number }

export function useStreamRate(live: LiveScreen) {
  const [rate, setRate] = useState<StreamRate | null>(null)
  useEffect(() => {
    let prev: { at: number; stats: StreamStats; connection: ScreenConnection } | null = null
    const timer = window.setInterval(() => {
      const connection = live.connection
      if (!connection) {
        prev = null
        setRate(null)
        return
      }
      const at = performance.now()
      const stats = connection.stats()
      if (prev?.connection === connection) {
        const secs = (at - prev.at) / 1000
        setRate({
          fps: (stats.frames - prev.stats.frames) / secs,
          bitrate: ((stats.bytes - prev.stats.bytes) * 8) / secs,
          dropped: stats.skipped - prev.stats.skipped,
        })
      }
      prev = { at, stats, connection }
    }, 2000)
    return () => window.clearInterval(timer)
  }, [live])
  return rate
}

export function bitRate(bps: number) {
  return bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} Mb/s` : `${Math.round(bps / 1e3)} kb/s`
}
