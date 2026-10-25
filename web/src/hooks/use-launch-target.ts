import { useNavigate, useSearch } from "@tanstack/react-router"
import { useMemo } from "react"
import type { AppDataChoice, AppDataList, ArtifactView, ProviderView } from "@/api/client"
import { useProviders } from "@/api/queries"
import {
  lastAndroid,
  lastLocation,
  lastProvider,
  lastScreen,
  type QuickLaunchMode,
  rememberLaunch,
} from "@/lib/launch-prefs"

const freeSlots = (p: ProviderView) => p.capacity.slots.filter((s) => s.state === "free").length

const offers = (p: ProviderView, location: string | undefined) =>
  !location || p.capabilities.locations.some((l) => l.id === location)

const distinct = <T extends { id: string }>(items: T[]) =>
  items.filter((x, i, all) => all.findIndex((o) => o.id === x.id) === i)

export function useLaunchTarget(
  chosenProvider: string | null = null,
  chosenLocation: string | null = null,
  chosenSlot: string | null = null,
  chosenScreen: string | null = null,
  chosenAndroid: string | null = null,
) {
  const providers = useProviders()
  const usable = useMemo(() => (providers.data ?? []).filter((p) => !p.error), [providers.data])
  const wanted = chosenProvider ?? lastProvider() ?? ""
  const provider = wanted ? usable.find((p) => p.name === wanted) : undefined
  const pool = provider ? [provider] : usable
  const locations = pool
    .flatMap((p) => p.capabilities.locations)
    .filter((l, i, all) => all.findIndex((o) => o.id === l.id) === i)
  const defaultLocation = pool.find((p) => p.capabilities.defaultLocation)?.capabilities.defaultLocation
  const location = [chosenLocation, lastLocation(provider?.name ?? ""), defaultLocation, locations[0]?.id].find(
    (id): id is string => !!id && locations.some((l) => l.id === id),
  )
  const slot = provider?.capacity.slots.find((s) => s.id === chosenSlot)
  const candidates = pool.filter((p) => offers(p, location))
  const screens = distinct(pool.flatMap((p) => p.capabilities.screens ?? []))
  const screen = [chosenScreen, lastScreen(provider?.name ?? ""), screens[0]?.id].find(
    (id): id is string => !!id && screens.some((s) => s.id === id),
  )
  const versions = [...new Set(pool.flatMap((p) => p.capabilities.versions ?? []))]
  const android = [chosenAndroid, lastAndroid(provider?.name ?? ""), versions[0]].find(
    (v): v is string => !!v && versions.includes(v),
  )

  return {
    loaded: providers.isSuccess,
    usable,
    provider,
    slot,
    target: provider?.name ?? "",
    locations,
    defaultLocation,
    location,
    screens,
    screen,
    versions,
    android,
    free: slot ? Number(slot.state === "free") : candidates.reduce((n, p) => n + freeSlots(p), 0),
    total: slot ? 1 : candidates.reduce((n, p) => n + p.capacity.slots.length, 0),
  }
}

export function useStartSession() {
  const navigate = useNavigate()
  const linked = useSearch({ strict: false }).launch !== undefined
  return (
    artifact: ArtifactView,
    target: { provider: string; slot?: string; location?: string; screen?: string; android?: string },
    appData?: AppDataChoice,
  ) => {
    rememberLaunch(target.provider, target.location, target.screen, target.android)
    void navigate({
      to: "/launch",
      search: {
        source: artifact.source,
        artifact: artifact.id,
        provider: target.provider || undefined,
        slot: target.slot,
        screen: target.screen,
        android: target.android,
        location: target.location,
        data: appData?.id,
        cache: appData?.cache || undefined,
      },
      replace: linked,
    })
  }
}

export function quickAppData(
  mode: QuickLaunchMode,
  list: AppDataList | undefined,
  pkg: string | undefined,
): AppDataChoice | undefined {
  if (mode === "fresh" || !list?.enabled || !pkg) return undefined
  const latest = list.items.find((d) => d.package === pkg)
  return latest && { id: latest.id, cache: mode === "cache" && list.cache && latest.cache }
}
