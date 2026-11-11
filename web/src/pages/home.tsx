import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { useState } from "react"
import type { ArtifactView } from "@/api/client"
import { useArtifact, useArtifacts } from "@/api/queries"
import { AppDescription } from "@/components/app-description"
import { AppIcon } from "@/components/app-icon"
import { appTitle, ArtifactList } from "@/components/artifact-list"
import { LaunchDialog } from "@/components/launch-dialog"
import { QuickLauncher } from "@/components/quick-launcher"
import { RecentRecordings } from "@/components/recent-recordings"
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
    <div className="h-full overflow-y-auto pb-(--dock-space)">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-8 lg:px-8 lg:pt-7">
        {pkg && <AppHeader pkg={pkg} />}
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
        <ArtifactList
          pkg={pkg}
          onLaunch={setLaunching}
          upload={!pkg && search.upload}
          onUploadClose={search.upload ? clearLink : undefined}
          aside={
            <>
              <SessionsPanel />
              <RecentRecordings />
            </>
          }
        />
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
  const title = latest ? appTitle(latest) : pkg
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" asChild>
          <Link to="/" aria-label="All apps">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <AppIcon src={latest?.iconUrl} className="size-10 rounded-[11px]" />
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-semibold tracking-[-.01em]">{title}</h1>
          <p className="text-muted-foreground truncate font-mono text-xs">{pkg}</p>
        </div>
      </div>
      <AppDescription pkg={pkg} title={title} />
    </div>
  )
}
