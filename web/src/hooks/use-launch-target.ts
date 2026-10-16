import { useNavigate } from "@tanstack/react-router"
import { useMemo } from "react"
import { toast } from "sonner"
import type { ArtifactView, ProviderView } from "@/api/client"
import { useLaunch, useProviders } from "@/api/queries"
import { lastLocation, lastProvider, rememberLaunch } from "@/lib/launch-prefs"

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
  const launch = useLaunch()
  const navigate = useNavigate()
  const start = (artifact: ArtifactView, provider: string, location: string | undefined, onStarted?: () => void) =>
    launch.mutate(
      { source: artifact.source, artifactId: artifact.id, provider, location },
      {
        onSuccess: (session) => {
          rememberLaunch(session.provider, location)
          onStarted?.()
          void navigate({ to: "/session/$provider/$id", params: { provider: session.provider, id: session.id } })
        },
        onError: (err) => toast.error("Could not launch", { description: err.message }),
      },
    )
  return { start, isPending: launch.isPending }
}
