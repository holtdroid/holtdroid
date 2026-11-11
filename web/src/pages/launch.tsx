import { Link, useNavigate } from "@tanstack/react-router"
import { type ReactNode, useEffect, useEffectEvent, useState } from "react"
import type { ArtifactView, ProviderView, WebViewView } from "@/api/client"
import { useArtifact, useLaunch, useProviders, useWebViews } from "@/api/queries"
import { artifactTitle } from "@/components/artifact-list"
import { type StartInfo, StartProgress } from "@/components/session/start-progress"
import { Button } from "@/components/ui/button"
import { locationLabel } from "@/lib/location"
import { screenName } from "@/lib/screens"

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

export function launchInfo(
  search: LaunchSearch,
  artifact: ArtifactView | undefined,
  pool: ProviderView[],
  webviews: WebViewView[],
): StartInfo {
  const caps = pool.map((p) => p.capabilities)
  const slot = pool.flatMap((p) => p.capacity.slots).find((s) => s.id === search.slot)
  const screen = caps.flatMap((c) => c.screens ?? []).find((d) => d.id === search.screen)
  const location = caps.flatMap((c) => c.locations).find((l) => l.id === search.location)
  const webview = webviews.find((w) => w.id === search.webview)
  const appData = search.data ? (search.cache ? "Saved data with cache" : "Saved data") : "Fresh install"
  return {
    label: artifact ? artifactTitle(artifact) : undefined,
    iconUrl: artifact?.iconUrl,
    versionName: artifact?.app?.versionName,
    badges: [
      slot ? slot.capabilities?.model || slot.label : screen && screenName(screen),
      search.android && `Android ${search.android}`,
      webview?.title,
      location && locationLabel(location),
    ].filter((b): b is string => !!b),
    rows: [
      ...(artifact?.app
        ? [
            [
              "Package",
              <span key="package" className="font-mono">
                {artifact.app.package}
              </span>,
            ] as [string, ReactNode],
          ]
        : []),
      ...(search.provider ? [["Provider", search.provider] as [string, ReactNode]] : []),
      ["App data", appData],
    ],
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

  const build = useArtifact(source, artifact)
  const catalog = useWebViews(!!webview)
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
      webview={catalog.data?.items.find((w) => w.id === webview)?.version}
      queued={wasQueued}
      info={launchInfo(
        { source, artifact, provider, slot, screen, android, location, webview, data, cache },
        build.data,
        pool,
        catalog.data?.items ?? [],
      )}
    >
      {(error || queued) && (
        <Button variant={error ? "default" : "outline"} asChild>
          <Link to="/">{error ? "Back to apps" : "Leave the queue"}</Link>
        </Button>
      )}
    </StartProgress>
  )
}
