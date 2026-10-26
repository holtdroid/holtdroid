import { Loader2Icon } from "lucide-react"
import { useEffect, useEffectEvent, useRef } from "react"
import type { ArtifactView } from "@/api/client"
import { useAppData } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { artifactTitle } from "@/components/artifact-list"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { quickAppData, useLaunchTarget, useStartSession } from "@/hooks/use-launch-target"
import { quickLaunchMode } from "@/lib/launch-prefs"
import { locationLabel } from "@/lib/location"

export function QuickLauncher({ artifact, onFallback }: { artifact: ArtifactView; onFallback: () => void }) {
  const { loaded, usable, provider, target, location, locations, screen, android, webview, blocked } = useLaunchTarget(
    null,
    null,
    null,
    null,
    null,
    null,
    artifact.minSdk,
  )
  const launch = useStartSession()
  const appData = useAppData()
  const ready = loaded && !appData.isPending
  const fired = useRef(false)
  const place = locations.find((l) => l.id === location)

  const fire = useEffectEvent(() => {
    if (usable.length === 0 || blocked) {
      onFallback()
      return
    }
    const choice = quickAppData(quickLaunchMode(), appData.data, artifact.app?.package)
    launch(artifact, { provider: target, location, screen, android, webview }, choice)
  })

  useEffect(() => {
    if (!ready || fired.current) return
    fired.current = true
    fire()
  }, [ready])

  return (
    <Dialog open onOpenChange={(open) => !open && onFallback()}>
      <DialogContent showCloseButton={false} className="grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <AppIcon src={artifact.iconUrl} className="size-10" />
            <div className="min-w-0">
              <DialogTitle className="truncate">Launching {artifactTitle(artifact)}</DialogTitle>
              <DialogDescription className="flex items-center gap-2 truncate text-xs">
                <Loader2Icon className="size-3.5 animate-spin" />
                {usable.length > 0
                  ? `on ${provider?.name ?? "any device"}${android ? ` · Android ${android}` : ""}${place ? ` · ${locationLabel(place)}` : ""}`
                  : "Looking for a device…"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
