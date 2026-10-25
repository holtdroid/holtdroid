import { Link, useNavigate } from "@tanstack/react-router"
import { useEffect, useEffectEvent, useState } from "react"
import { useLaunch, useProviders } from "@/api/queries"
import { StartProgress } from "@/components/session/start-progress"
import { Button } from "@/components/ui/button"

export type LaunchSearch = {
  source: string
  artifact: string
  provider?: string
  slot?: string
  screen?: string
  android?: string
  location?: string
  webview?: string
  data?: string
  cache?: boolean
}

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined)

export function validateLaunchSearch(search: Record<string, unknown>): LaunchSearch {
  return {
    source: str(search.source) ?? "",
    artifact: str(search.artifact) ?? "",
    provider: str(search.provider),
    slot: str(search.slot),
    screen: str(search.screen),
    android: str(search.android),
    location: str(search.location),
    webview: str(search.webview),
    data: str(search.data),
    cache: search.cache === true || search.cache === "true" || undefined,
  }
}

export function LaunchPage({
  source,
  artifact,
  provider,
  slot,
  screen,
  android,
  location,
  webview,
  data,
  cache,
}: LaunchSearch) {
  const launch = useLaunch()
  const navigate = useNavigate()
  const providers = useProviders()
  const [error, setError] = useState<string | null>(null)
  const [wasQueued, setWasQueued] = useState(false)

  const start = useEffectEvent((signal: AbortSignal) => {
    launch(
      {
        source,
        artifactId: artifact,
        provider,
        slot,
        screen,
        android,
        location,
        webview,
        appData: data ? { id: data, cache: !!cache } : undefined,
        queue: true,
      },
      signal,
    ).then(
      (session) =>
        void navigate({
          to: "/session/$provider/$id",
          params: { provider: session.provider, id: session.id },
          replace: true,
        }),
      (err: unknown) => {
        if (!signal.aborted) setError(err instanceof Error ? err.message : String(err))
      },
    )
  })

  useEffect(() => {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => start(ctrl.signal), 0)
    return () => {
      window.clearTimeout(timer)
      ctrl.abort()
    }
  }, [])

  const pool = (providers.data ?? []).filter(
    (p) =>
      !p.error &&
      (provider ? p.name === provider : !location || p.capabilities.locations.some((l) => l.id === location)),
  )
  const slots = pool.flatMap((p) => p.capacity.slots).filter((s) => !slot || s.id === slot)
  const total = slots.length
  const queued = !error && total > 0 && slots.every((s) => s.state !== "free")
  const busy = slot
    ? `“${slots[0]?.label ?? slot}” is busy`
    : provider
      ? `All ${total} devices of “${provider}” are busy`
      : `All ${total} devices are busy`
  if (queued && !wasQueued) setWasQueued(true)
  const appData = data ? (cache ? "cache" : "data") : undefined

  return (
    <StartProgress
      state={error ? "failed" : queued ? "queued" : "provisioning"}
      reason={error ?? undefined}
      detail={
        queued
          ? `${busy}. You're in line: the device starts as soon as ${slot ? "it" : "one"} frees up. Leaving this page gives up your place.`
          : undefined
      }
      appData={appData}
      queued={wasQueued}
    >
      {(error || queued) && (
        <Button variant={error ? "default" : "outline"} size="sm" asChild>
          <Link to="/">{error ? "Back to APKs" : "Leave the queue"}</Link>
        </Button>
      )}
    </StartProgress>
  )
}
