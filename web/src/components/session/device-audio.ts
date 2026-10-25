import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { displayURL, type LiveScreen, useScreenLive } from "@/components/session/live-screen"
import { useUserActivation } from "@/hooks/use-user-activation"
import { type AudioConnection, AudioUnavailableError, audioSupported, openAudio } from "@/lib/audio"
import { getScreenPrefs, setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"

export function useDeviceAudio(provider: string, id: string, live: LiveScreen) {
  const { audio: wanted, audioMuted: muted } = useScreenPrefs()
  const screenLive = useScreenLive(live)
  const activated = useUserActivation()
  const supported = useQuery({ queryKey: ["audio-supported"], queryFn: audioSupported, staleTime: Infinity }).data
  const [connected, setConnected] = useState(false)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const on = wanted && unavailable === null
  const active = on && supported === true && screenLive && activated

  useEffect(() => {
    if (!active) return undefined
    let stopped = false
    let conn: AudioConnection | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    const connect = async () => {
      try {
        conn = await openAudio(displayURL(provider, id, "audio"), () => getScreenPrefs().audioMuted)
        if (stopped) return
        setConnected(true)
        setLastError(null)
        await conn.done
      } catch (e) {
        if (e instanceof AudioUnavailableError) {
          setUnavailable(e.message)
          return
        }
        setLastError(e instanceof Error ? e.message : String(e))
      } finally {
        conn?.close()
        conn = null
        setConnected(false)
      }
      if (!stopped) retry = setTimeout(() => void connect(), 3000)
    }
    void connect()
    return () => {
      stopped = true
      clearTimeout(retry)
      conn?.close()
    }
  }, [active, provider, id])

  const setOn = (v: boolean) => {
    if (v) setUnavailable(null)
    setScreenPrefs({ audio: v })
  }

  const status =
    supported === false
      ? "This browser can't play the device audio"
      : unavailable !== null
        ? `${unavailable}. Turn it on to try again`
        : !wanted
          ? "Off: the device's sound doesn't play here"
          : connected
            ? muted
              ? "Connected, muted in this tab"
              : "Playing in this tab"
            : !activated
              ? "Starts after your first click on the page"
              : !screenLive
                ? "Starts with the screen"
                : lastError
                  ? `Reconnecting: ${lastError}`
                  : "Connecting…"

  return {
    supported: supported === true,
    on,
    muted,
    connected,
    status,
    setOn,
    setMuted: (v: boolean) => setScreenPrefs({ audioMuted: v }),
  }
}
