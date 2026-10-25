import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DatabaseIcon,
  FlaskConicalIcon,
  GlobeIcon,
  LayoutGridIcon,
  MonitorSmartphoneIcon,
  RocketIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react"
import { useMemo, useState } from "react"
import type { ArtifactView, Display, ProviderView } from "@/api/client"
import { useAppDataFor, useProviders } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { artifactTitle } from "@/components/artifact-list"
import { AndroidVersionCard } from "@/components/launch/android-version"
import { ChoiceCard, ChoiceGroup, Section } from "@/components/launch/choice-card"
import { DevicePicker } from "@/components/launch/device-picker"
import { ScreenCard } from "@/components/launch/screen-card"
import { WebViewChoice } from "@/components/launch/webview-choice"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
import { useLaunchTarget, useStartSession } from "@/hooks/use-launch-target"
import { formatBytes, formatRelative } from "@/lib/format"
import { useFavoriteScreens } from "@/lib/launch-prefs"
import { locationFlag } from "@/lib/location"
import { cn } from "@/lib/utils"

type Slot = ProviderView["capacity"]["slots"][number]

const FRESH = "__fresh__"

type Kind = { title: string; icon: LucideIcon; blurb: string }

const kinds: Record<string, Kind> = {
  emulator: {
    title: "Virtual device",
    icon: MonitorSmartphoneIcon,
    blurb:
      "Android in a container. Pick the Android version and screen, switch locations on the fly. Ready in about half a minute.",
  },
  physical: {
    title: "Real phone",
    icon: SmartphoneIcon,
    blurb: "A physical phone on USB with real hardware and sensors. Limited to the phones plugged in.",
  },
  fake: {
    title: "Simulated device",
    icon: FlaskConicalIcon,
    blurb: "A pretend device for trying the portal out.",
  },
}

const fakeKind: Kind = {
  title: "Simulated device",
  icon: FlaskConicalIcon,
  blurb: "A pretend device for trying the portal out.",
}

const isVirtual = (p: ProviderView) =>
  (p.capabilities.versions?.length ?? 0) > 0 || (p.capabilities.screens?.length ?? 0) > 0

const freeSlots = (p: ProviderView) => p.capacity.slots.filter((s) => s.state === "free").length

export function LaunchDialog({ artifact, onClose }: { artifact: ArtifactView | null; onClose: () => void }) {
  const [shown, setShown] = useState(artifact)
  if (artifact && artifact !== shown) setShown(artifact)
  return (
    <Dialog open={!!artifact} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-[772px]">
        {shown && <LaunchFlow key={`${shown.source}/${shown.id}`} artifact={shown} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function LaunchFlow({ artifact, onClose }: { artifact: ArtifactView; onClose: () => void }) {
  const providers = useProviders()
  const usable = useMemo(() => (providers.data ?? []).filter((p) => !p.error), [providers.data])
  const [picked, setPicked] = useState<string | null>(null)
  const [step, setStep] = useState<"provider" | "options">("provider")
  const [chosenLocation, setChosenLocation] = useState<string | null>(null)
  const [chosenSlot, setChosenSlot] = useState<string | null>(null)
  const [chosenScreen, setChosenScreen] = useState<string | null>(null)
  const [chosenAndroid, setChosenAndroid] = useState<string | null>(null)
  const [chosenWebView, setChosenWebView] = useState<string | null>(null)
  const [chosenData, setChosenData] = useState(FRESH)
  const [withCache, setWithCache] = useState(false)

  const single = usable.length === 1
  const recommended = usable.find(isVirtual)?.name ?? usable[0]?.name
  const selected = picked ?? recommended ?? ""
  const stage = single || step === "options" ? "options" : "provider"

  const {
    provider,
    slot,
    locations,
    defaultLocation,
    location,
    screens,
    screen,
    versions,
    android,
    webviews,
    webview,
    free,
    total,
  } = useLaunchTarget(
    stage === "options" ? selected : "",
    chosenLocation,
    chosenSlot,
    chosenScreen,
    chosenAndroid,
    chosenWebView,
  )
  const launch = useStartSession()
  const appData = useAppDataFor(artifact.app?.package)
  const snapshot = appData.items.find((d) => d.id === chosenData)
  const appVersion = artifact.app?.versionCode ?? 0
  const newerData = !!snapshot?.versionCode && appVersion > 0 && snapshot.versionCode > appVersion

  const abis = slot?.capabilities?.abis ?? provider?.capabilities.abis
  const missingABI =
    artifact.app && artifact.app.abis.length > 0 && abis ? !artifact.app.abis.some((abi) => abis.includes(abi)) : false
  const slots = provider?.capacity.slots ?? []
  const virtual = provider ? isVirtual(provider) : false
  const [pickerOpen, setPickerOpen] = useState(false)
  const favorites = useFavoriteScreens()
  const starred = favorites.map((id) => screens.find((s) => s.id === id)).filter((s): s is Display => !!s)
  const shortlist = [...starred, ...screens.filter((s) => !starred.includes(s))].slice(0, 5)
  const chosen = screens.find((s) => s.id === screen)
  const visibleScreens = chosen && !shortlist.includes(chosen) ? [...shortlist.slice(0, 4), chosen] : shortlist

  const submit = () => {
    if (usable.length === 0) return
    const choice = snapshot && { id: snapshot.id, cache: withCache && snapshot.cache }
    launch(
      artifact,
      {
        provider: provider?.name ?? selected,
        slot: virtual ? undefined : slot?.id,
        location,
        screen,
        android,
        webview: provider?.capabilities.webview ? webview : undefined,
      },
      choice,
    )
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-3 pr-6">
          <AppIcon src={artifact.iconUrl} className="size-10" />
          <div className="min-w-0">
            <DialogTitle className="truncate">Launch {artifactTitle(artifact)}</DialogTitle>
            <DialogDescription className="truncate font-mono text-xs">
              {artifact.app?.package ?? artifact.fileName}
              {artifact.app?.versionName ? ` · ${artifact.app.versionName}` : ""}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="-mx-1 grid min-h-0 content-start gap-5 overflow-y-auto px-1 py-1">
        {usable.length === 0 && (
          <Alert>
            <AlertDescription>No providers are available right now.</AlertDescription>
          </Alert>
        )}

        {stage === "provider" && (
          <Section title="Where should it run?" hint="A virtual device is the most flexible choice.">
            <ChoiceGroup label="Provider" className="sm:grid-cols-2">
              {usable.map((p) => (
                <ProviderCard
                  key={p.name}
                  provider={p}
                  recommended={p.name === recommended && usable.length > 1}
                  selected={p.name === selected}
                  onSelect={() => setPicked(p.name)}
                />
              ))}
            </ChoiceGroup>
          </Section>
        )}

        {stage === "options" && provider && (
          <>
            {virtual && versions.length > 1 && (
              <Section title="Android version">
                <ChoiceGroup label="Android version" className="grid-cols-2 sm:grid-cols-5">
                  {versions.map((v) => (
                    <AndroidVersionCard
                      key={v}
                      version={v}
                      selected={v === android}
                      onSelect={() => setChosenAndroid(v)}
                    />
                  ))}
                </ChoiceGroup>
              </Section>
            )}

            {virtual && screens.length > 1 && (
              <Section title="Screen" hint="The size is fixed for the session; the density can still be changed later.">
                <ChoiceGroup label="Screen" className="grid-cols-2 sm:grid-cols-3">
                  {visibleScreens.map((s) => (
                    <ScreenCard
                      key={s.id}
                      display={s}
                      selected={s.id === screen}
                      onSelect={() => setChosenScreen(s.id)}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="text-muted-foreground hover:bg-muted/50 hover:text-foreground focus-visible:ring-ring/50 flex min-w-0 items-center gap-3 rounded-xl border border-dashed p-3 text-left transition outline-none focus-visible:ring-3"
                  >
                    <span className="bg-muted grid size-10 shrink-0 place-items-center rounded-lg">
                      <LayoutGridIcon className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="text-foreground block text-sm font-medium">More devices</span>
                      <span className="block text-xs">{screens.length - visibleScreens.length} more, with search</span>
                    </span>
                  </button>
                </ChoiceGroup>
                <DevicePicker
                  open={pickerOpen}
                  onOpenChange={setPickerOpen}
                  screens={screens}
                  selected={screen}
                  onSelect={setChosenScreen}
                />
              </Section>
            )}

            {webviews.length > 0 && (
              <WebViewChoice webviews={webviews} selected={webview} android={android} onSelect={setChosenWebView} />
            )}

            {!virtual && slots.length > 0 && (
              <Section title="Device" hint="Any available device starts on the first one that is free.">
                <ChoiceGroup label="Device" className="sm:grid-cols-2">
                  <ChoiceCard selected={!slot} onSelect={() => setChosenSlot(null)}>
                    <div className="flex items-center gap-2.5">
                      <span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg">
                        <SparklesIcon className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">Any available device</div>
                        <div className="text-muted-foreground text-xs">
                          {freeSlots(provider)} of {slots.length} free
                        </div>
                      </div>
                    </div>
                  </ChoiceCard>
                  {slots.map((s) => (
                    <DeviceCard key={s.id} slot={s} selected={s.id === slot?.id} onSelect={() => setChosenSlot(s.id)} />
                  ))}
                </ChoiceGroup>
              </Section>
            )}

            {locations.length > 0 && (
              <Section title="VPN location" hint="You can switch the location any time during the session.">
                <div role="radiogroup" aria-label="VPN location" className="flex flex-wrap gap-1.5">
                  {locations.map((l) => (
                    <Button
                      key={l.id}
                      type="button"
                      role="radio"
                      aria-checked={l.id === location}
                      className="h-9 gap-2 px-3"
                      variant={l.id === location ? "default" : "outline"}
                      onClick={() => setChosenLocation(l.id)}
                    >
                      <span className="text-lg leading-none">
                        {locationFlag(l) ?? <GlobeIcon className="size-4" />}
                      </span>
                      {l.label}
                      {l.id === defaultLocation && <span className="opacity-60">· default</span>}
                    </Button>
                  ))}
                </div>
              </Section>
            )}

            {appData.data?.enabled && (
              <Section
                title="App data"
                hint="What the app keeps on the device: logins, settings and databases. It is saved when a session stops."
              >
                <ChoiceGroup label="App data" className="sm:grid-cols-2">
                  <ChoiceCard selected={!snapshot} onSelect={() => setChosenData(FRESH)}>
                    <div className="flex items-center gap-2.5">
                      <span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg">
                        <SparklesIcon className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">Fresh install</div>
                        <div className="text-muted-foreground text-xs">A clean device, nothing saved</div>
                      </div>
                    </div>
                  </ChoiceCard>
                  {appData.items.map((d) => (
                    <ChoiceCard key={d.id} selected={d.id === snapshot?.id} onSelect={() => setChosenData(d.id)}>
                      <div className="flex items-center gap-2.5">
                        <span className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-lg">
                          <DatabaseIcon className="size-4" />
                        </span>
                        <div className="min-w-0 pr-5">
                          <div className="text-sm font-medium">Saved {formatRelative(d.createdAt)}</div>
                          <div className="text-muted-foreground truncate text-xs">
                            {d.versionName || "unknown build"} · {formatBytes(d.size)}
                          </div>
                        </div>
                      </div>
                    </ChoiceCard>
                  ))}
                </ChoiceGroup>
                {appData.items.length === 0 && (
                  <p className="text-muted-foreground text-xs">
                    Nothing saved for this app yet. Its data is saved when you stop a session.
                  </p>
                )}
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
              </Section>
            )}

            {newerData && (
              <Alert>
                <AlertDescription>
                  This data comes from a newer build ({snapshot?.versionName || snapshot?.versionCode}). The app may
                  fail to read it.
                </AlertDescription>
              </Alert>
            )}
            {free === 0 && (
              <Alert>
                <AlertDescription>
                  {slot
                    ? `“${slot.label}” is ${slot.state}.`
                    : `All ${total} ${total === 1 ? "device" : "devices"} of “${provider.name}” are busy.`}{" "}
                  You'll wait in line and the device starts as soon as {slot ? "it frees" : "one frees"} up, as long as
                  you stay on its page.
                </AlertDescription>
              </Alert>
            )}
            {missingABI && (
              <Alert>
                <AlertDescription>
                  This APK ships native code for {artifact.app?.abis.join(", ")}, which “{slot?.label ?? provider.name}”
                  may not run.
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </div>

      <DialogFooter className="items-center sm:justify-between">
        {stage === "options" && !single ? (
          <Button variant="ghost" onClick={() => setStep("provider")}>
            <ArrowLeftIcon />
            Back
          </Button>
        ) : (
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        )}
        {stage === "provider" ? (
          <Button onClick={() => setStep("options")} disabled={!selected}>
            Continue
            <ArrowRightIcon />
          </Button>
        ) : (
          <Button onClick={submit} disabled={usable.length === 0}>
            <RocketIcon />
            {free === 0 ? "Join the queue" : "Launch"}
          </Button>
        )}
      </DialogFooter>
    </>
  )
}

function ProviderCard({
  provider: p,
  recommended,
  selected,
  onSelect,
}: {
  provider: ProviderView
  recommended: boolean
  selected: boolean
  onSelect: () => void
}) {
  const kind = kinds[p.capabilities.kind] ?? fakeKind
  const Icon = kind.icon
  const free = freeSlots(p)
  const total = p.capacity.slots.length
  return (
    <ChoiceCard selected={selected} onSelect={onSelect} className="gap-3 p-4">
      <div className="flex items-center gap-3">
        <span className="bg-primary/10 text-primary grid size-11 shrink-0 place-items-center rounded-xl">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{kind.title}</span>
            {recommended && <Badge variant="secondary">Recommended</Badge>}
          </div>
          <div className="text-muted-foreground truncate text-xs">{p.name}</div>
        </div>
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed">{kind.blurb}</p>
      <div className="flex items-center gap-1.5 text-xs">
        <span className={cn("size-2 rounded-full", free > 0 ? "bg-emerald-500" : "bg-amber-500")} />
        <span className="font-medium tabular-nums">
          {free} of {total}
        </span>
        <span className="text-muted-foreground">{free > 0 ? "available" : "busy, you would wait in line"}</span>
      </div>
    </ChoiceCard>
  )
}

const slotStates: Record<Slot["state"], { label: string; dot: string }> = {
  free: { label: "Available", dot: "bg-emerald-500" },
  busy: { label: "In use", dot: "bg-amber-500" },
  offline: { label: "Offline", dot: "bg-muted-foreground/40" },
  maintenance: { label: "Maintenance", dot: "bg-sky-500" },
}

function DeviceCard({ slot, selected, onSelect }: { slot: Slot; selected: boolean; onSelect: () => void }) {
  const caps = slot.capabilities
  const state = slotStates[slot.state]
  const facts = [caps?.android && `Android ${caps.android}`, caps?.root && "rooted"].filter(Boolean).join(" · ")
  return (
    <ChoiceCard selected={selected} onSelect={onSelect} disabled={slot.state === "offline"}>
      <div className="flex items-center gap-2.5">
        <span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg">
          <SmartphoneIcon className="size-4" />
        </span>
        <div className="min-w-0 pr-5">
          <div className="truncate text-sm font-medium">{caps?.model || slot.label}</div>
          <div className="text-muted-foreground truncate text-xs">{facts || slot.label}</div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <span className={cn("size-2 rounded-full", state.dot)} />
        <span>{state.label}</span>
        {caps?.root && <ShieldCheckIcon className="text-muted-foreground ml-auto size-3.5" />}
      </div>
    </ChoiceCard>
  )
}
