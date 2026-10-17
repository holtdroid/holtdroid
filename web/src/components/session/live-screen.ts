import { useQuery } from "@tanstack/react-query"
import { useState, useSyncExternalStore } from "react"
import { sessionBase } from "@/api/client"
import { decodableCodecs, type ScreenConnection } from "@/lib/scrcpy"

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
