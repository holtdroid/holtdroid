import { Loader2Icon } from "lucide-react"
import { useEffect, useEffectEvent, useRef } from "react"
import type { ArtifactView } from "@/api/client"
import { AppIcon } from "@/components/app-icon"
import { artifactTitle } from "@/components/artifact-list"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useLaunchTarget, useStartSession } from "@/hooks/use-launch-target"

export function QuickLauncher({
  artifact,
  onStarted,
  onFallback,
}: {
  artifact: ArtifactView
  onStarted: () => void
  onFallback: () => void
}) {
  const { loaded, provider, location, locations, free } = useLaunchTarget()
  const launch = useStartSession()
  const fired = useRef(false)
  const locationLabel = locations.find((l) => l.id === location)?.label

  const fire = useEffectEvent(() => {
    if (!provider || free === 0) {
      onFallback()
      return
    }
    launch.start(artifact, provider.name, location, onStarted, onFallback)
  })

  useEffect(() => {
    if (!loaded || fired.current) return
    fired.current = true
    fire()
  }, [loaded])

  return (
    <Dialog open onOpenChange={(open) => !open && onFallback()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <AppIcon src={artifact.iconUrl} className="size-10" />
            <div className="min-w-0">
              <DialogTitle className="truncate">Launching {artifactTitle(artifact)}</DialogTitle>
              <DialogDescription className="flex items-center gap-2 truncate text-xs">
                <Loader2Icon className="size-3.5 animate-spin" />
                {provider
                  ? `on ${provider.name}${locationLabel ? ` · ${locationLabel}` : ""}`
                  : "Looking for a device…"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
