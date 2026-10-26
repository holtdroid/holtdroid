import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { useState } from "react"
import type { ArtifactView } from "@/api/client"
import { useArtifact, useArtifacts } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { appTitle, ArtifactList } from "@/components/artifact-list"
import { LaunchDialog } from "@/components/launch-dialog"
import { QuickLauncher } from "@/components/quick-launcher"
import { SessionsPanel } from "@/components/sessions-panel"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export function HomePage({ pkg }: { pkg?: string }) {
  const [launching, setLaunching] = useState<ArtifactView | null>(null)
  const search = useSearch({ strict: false })
  const navigate = useNavigate()
  const linked = useArtifact(search.source ?? "", search.launch ?? "")
  const clearLink = () => void navigate({ to: "/", search: {}, replace: true })
  const dropQuick = () =>
    void navigate({ to: "/", search: { source: search.source, launch: search.launch }, replace: true })

  const close = () => {
    setLaunching(null)
    if (search.launch) clearLink()
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-7xl gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:p-6">
        <div className="flex flex-col gap-3">
          {pkg ? (
            <AppHeader pkg={pkg} />
          ) : (
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Apps</h1>
              <p className="text-muted-foreground text-sm">
                Launch the latest build of an app on a fresh Android device, or open it to pick another build.
              </p>
            </div>
          )}
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
          <ArtifactList pkg={pkg} onLaunch={setLaunching} />
        </div>
        <SessionsPanel className="lg:sticky lg:top-6 lg:max-h-[calc(100dvh-6.5rem)]" />
        {search.quick && linked.data && <QuickLauncher artifact={linked.data} onFallback={dropQuick} />}
        <LaunchDialog
          artifact={launching ?? (search.launch && !search.quick ? (linked.data ?? null) : null)}
          onSwitch={setLaunching}
          onClose={close}
        />
      </div>
    </div>
  )
}

function AppHeader({ pkg }: { pkg: string }) {
  const artifacts = useArtifacts("")
  const latest = artifacts.data?.items.find((a) => a.app?.package === pkg)
  return (
    <div className="flex items-center gap-3">
      <Button variant="ghost" size="icon" asChild>
        <Link to="/" aria-label="All apps">
          <ArrowLeftIcon />
        </Link>
      </Button>
      <AppIcon src={latest?.iconUrl} className="size-10" />
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight">{latest ? appTitle(latest) : pkg}</h1>
        <p className="text-muted-foreground truncate font-mono text-sm">{pkg}</p>
      </div>
    </div>
  )
}
