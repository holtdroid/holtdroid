import { useNavigate } from "@tanstack/react-router"
import { Loader2Icon, RocketIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { ArtifactView } from "@/api/client"
import { useLaunch, useProviders } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { artifactTitle } from "@/components/artifact-list"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { lastLocation, rememberLocation } from "@/lib/last-location"

export function LaunchDialog({ artifact, onClose }: { artifact: ArtifactView | null; onClose: () => void }) {
  const providers = useProviders()
  const launch = useLaunch()
  const navigate = useNavigate()
  const [chosenProvider, setChosenProvider] = useState("")
  const [chosenLocation, setChosenLocation] = useState<string | null>(null)

  const usable = useMemo(() => (providers.data ?? []).filter((p) => !p.error), [providers.data])
  const provider =
    usable.find((p) => p.name === chosenProvider) ??
    usable.find((p) => p.capacity.slots.some((s) => s.state === "free")) ??
    usable[0]
  const selectProvider = (name: string) => {
    setChosenProvider(name)
    setChosenLocation(null)
  }
  const locations = provider?.capabilities.locations ?? []
  const defaultLocation = provider?.capabilities.defaultLocation
  const location = [
    chosenLocation,
    provider ? lastLocation(provider.name) : null,
    defaultLocation,
    locations[0]?.id,
  ].find((id): id is string => !!id && locations.some((l) => l.id === id))
  const free = provider?.capacity.slots.filter((s) => s.state === "free").length ?? 0
  const total = provider?.capacity.slots.length ?? 0
  const missingABI =
    artifact?.app && artifact.app.abis.length > 0 && provider
      ? !artifact.app.abis.some((abi) => provider.capabilities.abis.includes(abi))
      : false

  const submit = () => {
    if (!artifact || !provider) return
    launch.mutate(
      {
        source: artifact.source,
        artifactId: artifact.id,
        provider: provider.name,
        location,
      },
      {
        onSuccess: (session) => {
          if (location) rememberLocation(session.provider, location)
          onClose()
          void navigate({ to: "/session/$provider/$id", params: { provider: session.provider, id: session.id } })
        },
        onError: (err) => toast.error("Could not launch", { description: err.message }),
      },
    )
  }

  const title = artifact ? artifactTitle(artifact) : ""

  return (
    <Dialog open={!!artifact} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3">
            {artifact && <AppIcon src={artifact.iconUrl} className="size-10" />}
            <div className="min-w-0">
              <DialogTitle className="truncate">Launch {title}</DialogTitle>
              <DialogDescription className="truncate font-mono text-xs">
                {artifact?.app?.package ?? artifact?.fileName}
                {artifact?.app?.versionName ? ` · ${artifact.app.versionName}` : ""}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Device</Label>
            <Select value={provider?.name ?? ""} onValueChange={selectProvider} disabled={usable.length === 0}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="No providers available" />
              </SelectTrigger>
              <SelectContent>
                {usable.map((p) => {
                  const n = p.capacity.slots.filter((s) => s.state === "free").length
                  return (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name} · {p.capabilities.kind} · {n}/{p.capacity.slots.length} free
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          {locations.length > 0 && (
            <div className="grid gap-2">
              <Label>VPN location</Label>
              <Select value={location ?? ""} onValueChange={setChosenLocation}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.id === defaultLocation ? `${l.label} (default)` : l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">You can switch the location any time during the session.</p>
            </div>
          )}

          {provider && free === 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                All {total} slots of “{provider.name}” are busy. Stop a session or wait for one to expire.
              </AlertDescription>
            </Alert>
          )}
          {missingABI && (
            <Alert>
              <AlertDescription>
                This APK ships native code for {artifact?.app?.abis.join(", ")}, which “{provider?.name}” may not run.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!provider || free === 0 || launch.isPending}>
            {launch.isPending ? <Loader2Icon className="animate-spin" /> : <RocketIcon />}
            {launch.isPending ? "Preparing…" : "Launch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
