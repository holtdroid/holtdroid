import { RocketIcon } from "lucide-react"
import { useState } from "react"
import type { ArtifactView, ProviderView } from "@/api/client"
import { useAppDataFor } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { artifactTitle } from "@/components/artifact-list"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { useLaunchTarget, useStartSession } from "@/hooks/use-launch-target"
import { formatBytes, formatRelative } from "@/lib/format"
import { locationLabel } from "@/lib/location"

type Slot = ProviderView["capacity"]["slots"][number]

const FRESH = "__fresh__"
const ANY = "__any__"

const slotState = (s: Slot) => (s.state === "free" ? "" : ` · ${s.state}`)

export function LaunchDialog({ artifact, onClose }: { artifact: ArtifactView | null; onClose: () => void }) {
  const [chosenProvider, setChosenProvider] = useState<string | null>(null)
  const [chosenLocation, setChosenLocation] = useState<string | null>(null)
  const [chosenSlot, setChosenSlot] = useState<string | null>(null)
  const { usable, provider, slot, target, locations, defaultLocation, location, free, total } = useLaunchTarget(
    chosenProvider,
    chosenLocation,
    chosenSlot,
  )
  const launch = useStartSession()
  const appData = useAppDataFor(artifact?.app?.package)
  const [chosenData, setChosenData] = useState(FRESH)
  const [withCache, setWithCache] = useState(false)
  const snapshot = appData.items.find((d) => d.id === chosenData)
  const appVersion = artifact?.app?.versionCode ?? 0
  const newerData = !!snapshot?.versionCode && appVersion > 0 && snapshot.versionCode > appVersion
  const selectProvider = (name: string) => {
    setChosenProvider(name === ANY ? "" : name)
    setChosenLocation(null)
    setChosenSlot(null)
  }
  const abis = slot?.capabilities?.abis ?? provider?.capabilities.abis
  const missingABI =
    artifact?.app && artifact.app.abis.length > 0 && abis ? !artifact.app.abis.some((abi) => abis.includes(abi)) : false
  const allFree = usable.reduce((n, p) => n + p.capacity.slots.filter((s) => s.state === "free").length, 0)
  const allTotal = usable.reduce((n, p) => n + p.capacity.slots.length, 0)
  const slots = provider?.capacity.slots ?? []

  const submit = () => {
    if (!artifact || usable.length === 0) return
    const choice = snapshot && { id: snapshot.id, cache: withCache && snapshot.cache }
    launch(artifact, { provider: target, slot: slot?.id, location }, choice)
  }

  const title = artifact ? artifactTitle(artifact) : ""

  return (
    <Dialog open={!!artifact} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <div className="flex items-center gap-3 pr-6">
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
            <Label>Provider</Label>
            <Select
              value={usable.length === 0 ? "" : (provider?.name ?? ANY)}
              onValueChange={selectProvider}
              disabled={usable.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="No providers available" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>
                  Any · {allFree}/{allTotal} free
                </SelectItem>
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
            {!provider && usable.length > 1 && (
              <p className="text-muted-foreground text-xs">
                Takes the first provider with a free device, in the order they are configured.
              </p>
            )}
          </div>

          {slots.length > 1 && (
            <div className="grid gap-2">
              <Label>Device</Label>
              <Select value={slot?.id ?? ANY} onValueChange={(v) => setChosenSlot(v === ANY ? null : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any free device</SelectItem>
                  {slots.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                      {s.capabilities?.android ? ` · Android ${s.capabilities.android}` : ""}
                      {slotState(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
                      {locationLabel(l)}
                      {l.id === defaultLocation ? " (default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">You can switch the location any time during the session.</p>
            </div>
          )}

          {appData.data?.enabled && (
            <div className="grid gap-2">
              <Label>App data</Label>
              <Select value={snapshot?.id ?? FRESH} onValueChange={setChosenData}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FRESH}>Fresh install, no data</SelectItem>
                  {appData.items.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      Saved {formatRelative(d.createdAt)} · {d.versionName || "unknown build"} · {formatBytes(d.size)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {snapshot && appData.data.cache && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="launch-cache"
                    checked={withCache && snapshot.cache}
                    disabled={!snapshot.cache}
                    onCheckedChange={(v) => setWithCache(v === true)}
                  />
                  <Label htmlFor="launch-cache" className="font-normal">
                    {snapshot.cache ? "Also restore the cache" : "This save has no cache"}
                  </Label>
                </div>
              )}
              {appData.items.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  Nothing saved for this app yet. Its data is saved when you stop a session.
                </p>
              )}
            </div>
          )}

          {newerData && (
            <Alert>
              <AlertDescription>
                This data comes from a newer build ({snapshot?.versionName || snapshot?.versionCode}). The app may fail
                to read it.
              </AlertDescription>
            </Alert>
          )}
          {usable.length > 0 && free === 0 && (
            <Alert>
              <AlertDescription>
                {slot
                  ? `“${slot.label}” is ${slot.state}.`
                  : provider
                    ? `All ${total} devices of “${provider.name}” are busy.`
                    : `All ${total} devices are busy.`}{" "}
                You'll wait in line and the device starts as soon as {slot ? "it frees" : "one frees"} up, as long as
                you stay on its page.
              </AlertDescription>
            </Alert>
          )}
          {missingABI && (
            <Alert>
              <AlertDescription>
                This APK ships native code for {artifact?.app?.abis.join(", ")}, which “{slot?.label ?? provider?.name}”
                may not run.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={usable.length === 0}>
            <RocketIcon />
            {free === 0 ? "Join the queue" : "Launch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
