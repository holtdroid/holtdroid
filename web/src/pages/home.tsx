import { useState } from "react"
import type { ArtifactView } from "@/api/client"
import { ArtifactList } from "@/components/artifact-list"
import { LaunchDialog } from "@/components/launch-dialog"
import { SessionsPanel } from "@/components/sessions-panel"

export function HomePage() {
  const [launching, setLaunching] = useState<ArtifactView | null>(null)

  return (
    <div className="mx-auto grid h-full max-w-7xl gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:p-6">
      <div className="flex min-h-0 flex-col gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">APKs</h1>
          <p className="text-muted-foreground text-sm">Pick a build to launch it on a fresh Android device.</p>
        </div>
        <ArtifactList onLaunch={setLaunching} />
      </div>
      <SessionsPanel />
      <LaunchDialog artifact={launching} onClose={() => setLaunching(null)} />
    </div>
  )
}
