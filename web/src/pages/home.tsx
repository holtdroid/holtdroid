import { useNavigate, useSearch } from "@tanstack/react-router"
import { useState } from "react"
import type { ArtifactView } from "@/api/client"
import { useArtifact } from "@/api/queries"
import { ArtifactList } from "@/components/artifact-list"
import { LaunchDialog } from "@/components/launch-dialog"
import { SessionsPanel } from "@/components/sessions-panel"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export function HomePage() {
  const [launching, setLaunching] = useState<ArtifactView | null>(null)
  const search = useSearch({ from: "/" })
  const navigate = useNavigate()
  const linked = useArtifact(search.source ?? "", search.launch ?? "")
  const clearLink = () => void navigate({ to: "/", search: {}, replace: true })

  const close = () => {
    setLaunching(null)
    if (search.launch) clearLink()
  }

  return (
    <div className="mx-auto grid h-full max-w-7xl gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:p-6">
      <div className="flex min-h-0 flex-col gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">APKs</h1>
          <p className="text-muted-foreground text-sm">Pick a build to launch it on a fresh Android device.</p>
        </div>
        {linked.isError && (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-2">
              The linked build is gone or not visible to you.
              <Button variant="ghost" size="sm" onClick={clearLink}>
                Dismiss
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <ArtifactList onLaunch={setLaunching} />
      </div>
      <SessionsPanel />
      <LaunchDialog artifact={launching ?? (search.launch ? (linked.data ?? null) : null)} onClose={close} />
    </div>
  )
}
