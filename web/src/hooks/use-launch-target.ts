import { useNavigate, useSearch } from "@tanstack/react-router"
import { useMemo } from "react"
import type { AppDataChoice, AppDataList, ArtifactView, ProviderView } from "@/api/client"
import { useProviders } from "@/api/queries"
import { lastLocation, lastProvider, type QuickLaunchMode, rememberLaunch } from "@/lib/launch-prefs"

const freeSlots = (p: ProviderView) => p.capacity.slots.filter((s) => s.state === "free").length

export function useLaunchTarget(chosenProvider: string | null = null, chosenLocation: string | null = null) {
  const providers = useProviders()
  const usable = useMemo(() => (providers.data ?? []).filter((p) => !p.error), [providers.data])
  const remembered = lastProvider()
  const provider =
    usable.find((p) => p.name === chosenProvider) ??
    usable.find((p) => p.name === remembered) ??
    usable.find((p) => freeSlots(p) > 0) ??
    usable[0]
  const locations = provider?.capabilities.locations ?? []
  const defaultLocation = provider?.capabilities.defaultLocation
  const location = [
    chosenLocation,
    provider ? lastLocation(provider.name) : null,
    defaultLocation,
    locations[0]?.id,
  ].find((id): id is string => !!id && locations.some((l) => l.id === id))

  return {
    loaded: providers.isSuccess,
    usable,
    provider,
    locations,
    defaultLocation,
    location,
    free: provider ? freeSlots(provider) : 0,
    total: provider?.capacity.slots.length ?? 0,
  }
}

export function useStartSession() {
  const navigate = useNavigate()
  const linked = useSearch({ strict: false }).launch !== undefined
  return (artifact: ArtifactView, provider: string, location: string | undefined, appData?: AppDataChoice) => {
    rememberLaunch(provider, location)
    void navigate({
      to: "/launch",
      search: {
        source: artifact.source,
        artifact: artifact.id,
        provider,
        location,
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
