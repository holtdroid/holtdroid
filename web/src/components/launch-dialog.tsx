import {
  ChevronDownIcon,
  ClockIcon,
  CloudIcon,
  DatabaseIcon,
  FlaskConicalIcon,
  GitBranchIcon,
  GlobeIcon,
  PlayIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  SparklesIcon,
  UsbIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"
import type { ArtifactView, Display, Location, ProviderView } from "@/api/client"
import { useAppDataFor, useArtifacts, useProviders, useRecordings } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { artifactTitle } from "@/components/artifact-list"
import { androidName, AndroidVersionCard } from "@/components/launch/android-version"
import { ChoiceCard, ChoiceGroup, Chip, Section } from "@/components/launch/choice-card"
import { DevicePicker } from "@/components/launch/device-picker"
import { LivePreview } from "@/components/launch/live-preview"
import { ScreenCard } from "@/components/launch/screen-card"
import { WebViewChoice } from "@/components/launch/webview-choice"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useLaunchTarget, useStartSession } from "@/hooks/use-launch-target"
import { bestVariant, groupVariants, variantsOf } from "@/lib/abi"
import { apiLevels, needsAndroid, newestRunnable } from "@/lib/android"
import { formatBytes, formatRelative } from "@/lib/format"
import {
  recordPreference,
  rememberRecord,
  rememberSaveAppData,
  saveAppDataPreference,
  useFavoriteScreens,
} from "@/lib/launch-prefs"
import { locationFlag, locationLabel } from "@/lib/location"
import { cutoutName, screenName, shortlist } from "@/lib/screens"
import { cn } from "@/lib/utils"
import { kindLabel } from "@/lib/webview-kinds"

type Slot = ProviderView["capacity"]["slots"][number]

const FRESH = "__fresh__"

type Kind = { title: string; icon: LucideIcon; blurb: string }

const kinds: Record<string, Kind> = {
  emulator: {
    title: "Virtual device",
    icon: CloudIcon,
    blurb: "Android in a container: any version and screen, locations switch on the fly.",
  },
  physical: {
    title: "Physical phone",
    icon: UsbIcon,
    blurb: "A real phone on USB with its own hardware and sensors.",
  },
}

const fakeKind: Kind = {
  title: "Simulated device",
  icon: FlaskConicalIcon,
  blurb: "A pretend device for trying the portal out.",
}

const kindOf = (p: ProviderView) => kinds[p.capabilities.kind] ?? fakeKind

const isVirtual = (p: ProviderView) =>
  (p.capabilities.versions?.length ?? 0) > 0 || (p.capabilities.screens?.length ?? 0) > 0

const freeSlots = (p: ProviderView) => p.capacity.slots.filter((s) => s.state === "free").length

const newestFirst = (a: ArtifactView, b: ArtifactView) =>
  (b.app?.versionCode ?? 0) - (a.app?.versionCode ?? 0) || b.uploadedAt.localeCompare(a.uploadedAt)

function LocationCode({ location: l, selected }: { location: Location; selected: boolean }) {
  if (/^[a-z]{2}$/i.test(l.id))
    return (
      <span className={cn("font-mono text-[11px]", selected ? "opacity-70" : "text-muted-foreground")}>
        {l.id.toUpperCase()}
      </span>
    )
  const flag = locationFlag(l)
  return flag ? <span className="leading-none">{flag}</span> : <GlobeIcon className="size-3.5" />
}

export function LaunchDialog({
  artifact,
  onSwitch,
  onClose,
}: {
  artifact: ArtifactView | null
  onSwitch: (artifact: ArtifactView) => void
  onClose: () => void
}) {
  const [shown, setShown] = useState(artifact)
  const [visible, setVisible] = useState(!!artifact)
  const [round, setRound] = useState(0)
  if (!!artifact !== visible) {
    setVisible(!!artifact)
    if (artifact) setRound(round + 1)
  }
  if (artifact && artifact !== shown) setShown(artifact)
  return (
    <Dialog open={!!artifact} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1200px]"
      >
        {shown && (
          <LaunchFlow
            key={`${round}/${shown.app?.package ?? `${shown.source}/${shown.id}`}`}
            artifact={shown}
            onSwitch={onSwitch}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function LaunchFlow({ artifact, onSwitch }: { artifact: ArtifactView; onSwitch: (artifact: ArtifactView) => void }) {
  const providers = useProviders()
  const usable = useMemo(() => (providers.data ?? []).filter((p) => !p.error), [providers.data])
  const builds = useArtifacts("").data?.items ?? []
  const siblings = builds.filter((b) => b.app && b.app.package === artifact.app?.package)
  const variants = variantsOf(builds, artifact)
  const runsOn = (abis: string[] | undefined) => !!bestVariant(variants, abis, siblings)
  const [picked, setPicked] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [chosenLocation, setChosenLocation] = useState<string | null>(null)
  const [chosenSlot, setChosenSlot] = useState<string | null>(null)
  const [chosenScreen, setChosenScreen] = useState<string | null>(null)
  const [chosenAndroid, setChosenAndroid] = useState<string | null>(null)
  const [chosenWebView, setChosenWebView] = useState<string | null>(null)
  const [chosenData, setChosenData] = useState(FRESH)
  const [withCache, setWithCache] = useState(false)

  const fitting = usable.filter((p) => runsOn(p.capabilities.abis))
  const recommended = (fitting.find(isVirtual) ?? fitting[0] ?? usable[0])?.name
  const selected = picked ?? recommended ?? ""

  const {
    provider,
    slot,
    locations,
    defaultLocation,
    location,
    screens,
    screen,
    versions,
    runs,
    android,
    webviews,
    webview,
    webviewPackage,
    free,
    total,
  } = useLaunchTarget(
    selected,
    chosenLocation,
    chosenSlot,
    chosenScreen,
    chosenAndroid,
    chosenWebView,
    artifact.minSdk,
    false,
    artifact.app?.package,
  )
  const launch = useStartSession()
  const abis = slot?.capabilities?.abis ?? provider?.capabilities.abis
  const build = bestVariant(variants, abis, siblings)
  const shown = build ?? artifact
  const alternativeFor = (v: string) =>
    runs(v) || !artifact.app
      ? undefined
      : newestRunnable(
          siblings.filter((b) => bestVariant([b], abis, siblings)),
          artifact.app.package,
          apiLevels[v],
        )
  const appData = useAppDataFor(artifact.app?.package)
  const recordings = useRecordings()
  const [record, setRecord] = useState(recordPreference)
  const [saveData, setSaveData] = useState(saveAppDataPreference)
  const snapshot = appData.items.find((d) => d.id === chosenData)
  const appVersion = shown.app?.versionCode ?? 0
  const newerData = !!snapshot?.versionCode && appVersion > 0 && snapshot.versionCode > appVersion

  const builtFor = [...new Set(variants.flatMap((v) => v.app?.abis ?? []))]
  const slots = provider?.capacity.slots ?? []
  const virtual = provider ? isVirtual(provider) : false
  const favorites = useFavoriteScreens()
  const cards = shortlist(screens, favorites, screen, 4)
  const chosen = screens.find((s) => s.id === screen)
  const display: Display | undefined = virtual ? chosen : (slot?.capabilities?.screen ?? undefined)
  const chosenWebViewView = webviews.find((w) => w.id === webview)
  const place = locations.find((l) => l.id === location)
  const minSdk = artifact.minSdk ?? 0
  const title = artifactTitle(shown)
  const versionGroups = groupVariants(siblings).toSorted((a, b) => newestFirst(a[0]!, b[0]!))
  const latest = versionGroups[0]?.some((b) => variants.includes(b)) ?? false
  const recordable = !!recordings.data?.enabled && recordings.data.mode !== "always"
  const recording = record ?? recordings.data?.mode === "auto"

  const submit = () => {
    if (usable.length === 0 || !build) return
    const choice = snapshot && { id: snapshot.id, cache: withCache && snapshot.cache }
    launch(
      build,
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

  if (picking)
    return (
      <DevicePicker
        screens={screens}
        selected={screen}
        onSelect={(id) => {
          setChosenScreen(id)
          setPicking(false)
        }}
        onBack={() => setPicking(false)}
      />
    )

  const facts = [
    shown.meta.tags?.branch,
    shown.app?.versionCode ? `build ${shown.app.versionCode}` : undefined,
    minSdk ? `minSdk ${minSdk}` : undefined,
    variants.length > 1 && build ? build.app?.abis.join(", ") : undefined,
  ].filter(Boolean)

  const kind = provider ? kindOf(provider) : undefined
  const deviceName = virtual
    ? chosen
      ? screenName(chosen)
      : (kind?.title ?? "")
    : slot
      ? slot.capabilities?.model || slot.label
      : "Any available phone"
  const deviceFacts = display
    ? [cutoutName(display), `${display.dpi} dpi`, display.radius ? "rounded corners" : undefined]
    : [
        slot?.capabilities?.android && `Android ${slot.capabilities.android}`,
        slot?.capabilities?.root && "rooted",
        !slot && provider && `${freeSlots(provider)} of ${slots.length} free`,
      ]
  const androidShown = android ?? slot?.capabilities?.android

  const rows: [string, ReactNode][] = []
  if (provider && usable.length > 1) rows.push(["Runs on", kind?.title ?? provider.name])
  if (androidShown)
    rows.push(["Android", androidName(androidShown) ? `${androidShown} · ${androidName(androidShown)}` : androidShown])
  if (webviews.length > 0)
    rows.push([
      "WebView",
      chosenWebViewView ? (
        <span key="webview" className="font-mono text-[12.5px]">
          {kindLabel(chosenWebViewView.package).replace(" WebView", "")} {chosenWebViewView.version}
        </span>
      ) : (
        "Built-in"
      ),
    ])
  if (place) rows.push(["Location", locationLabel(place)])
  if (appData.data?.enabled)
    rows.push([
      "App data",
      snapshot
        ? `Saved ${formatRelative(snapshot.createdAt)}${withCache && snapshot.cache ? ", with cache" : ""}`
        : "Fresh install",
    ])
  if (recordings.data?.enabled && recordings.data.mode === "always")
    rows.push(["Recording", "Every session is recorded"])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col lg:overflow-y-auto">
        <div className="flex items-center gap-3 border-b px-6 py-[18px]">
          <AppIcon src={shown.iconUrl ?? artifact.iconUrl} className="size-10 rounded-[11px]" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <DialogTitle className="truncate text-lg font-semibold">{title}</DialogTitle>
              {shown.app?.versionName && (
                <span className="text-muted-foreground shrink-0 font-mono text-[15px]">{shown.app.versionName}</span>
              )}
              {latest && siblings.length > 1 && <Badge variant="info">Latest</Badge>}
            </div>
            <DialogDescription className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
              {shown.meta.tags?.branch && <GitBranchIcon className="size-3.5 shrink-0" />}
              <span className="truncate">
                {facts.length > 0 ? facts.join(" · ") : (shown.app?.package ?? shown.fileName)}
              </span>
            </DialogDescription>
          </div>
          {versionGroups.length > 1 && <OtherBuild groups={versionGroups} current={variants} onSwitch={onSwitch} />}
          <DialogClose asChild>
            <Button variant="outline" size="icon" aria-label="Close" className="lg:hidden">
              <XIcon />
            </Button>
          </DialogClose>
        </div>

        <div className="grid content-start gap-6 px-6 pt-5 pb-6">
          {usable.length === 0 && (
            <Alert>
              <AlertDescription>No providers are available right now.</AlertDescription>
            </Alert>
          )}

          {usable.length > 1 && (
            <div
              role="radiogroup"
              aria-label="Where it runs"
              className="bg-muted flex gap-0.5 rounded-[11px] border p-[3px]"
            >
              {usable.map((p) => (
                <ProviderSegment
                  key={p.name}
                  provider={p}
                  label={
                    usable.filter((o) => kindOf(o) === kindOf(p)).length > 1
                      ? `${kindOf(p).title} · ${p.name}`
                      : kindOf(p).title
                  }
                  runs={runsOn(p.capabilities.abis)}
                  selected={p.name === selected}
                  onSelect={() => setPicked(p.name)}
                />
              ))}
            </div>
          )}

          {provider && (
            <>
              {virtual && versions.length > 0 && !android && (
                <Alert>
                  <AlertDescription>
                    {needsAndroid(minSdk)}; none of this provider's Android versions is new enough.
                  </AlertDescription>
                </Alert>
              )}

              {virtual && versions.length > 1 && (
                <Section title="Android" hint={versions.some((v) => !runs(v)) ? needsAndroid(minSdk) : undefined}>
                  <ChoiceGroup
                    label="Android version"
                    className="grid-cols-3 sm:grid-cols-(--cols)"
                    style={{ "--cols": `repeat(${Math.min(versions.length, 6)}, minmax(0, 1fr))` }}
                  >
                    {versions.toReversed().map((v) => {
                      const alternative = alternativeFor(v)
                      return (
                        <AndroidVersionCard
                          key={v}
                          version={v}
                          selected={v === android}
                          blockedBy={runs(v) ? undefined : needsAndroid(minSdk)}
                          alternative={alternative && (alternative.app?.versionName || artifactTitle(alternative))}
                          onSelect={() => {
                            setChosenAndroid(v)
                            if (alternative) onSwitch(alternative)
                          }}
                        />
                      )
                    })}
                  </ChoiceGroup>
                </Section>
              )}

              {virtual && screens.length > 1 && (
                <Section title="Screen" hint="Size is fixed for the session; density can change later">
                  <ChoiceGroup label="Screen" className="grid-cols-2 sm:grid-cols-5">
                    {cards.map((s) => (
                      <ScreenCard
                        key={s.id}
                        display={s}
                        selected={s.id === screen}
                        favorite={favorites.includes(s.id)}
                        onSelect={() => setChosenScreen(s.id)}
                      />
                    ))}
                    {screens.length > cards.length && (
                      <button
                        type="button"
                        onClick={() => setPicking(true)}
                        className="hover:bg-muted focus-visible:ring-ring/50 flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-3 text-center transition outline-none focus-visible:ring-3"
                      >
                        <span className="text-xl font-semibold">{screens.length}</span>
                        <span className="text-[13px] font-medium">All devices</span>
                        <span className="text-muted-foreground w-full truncate text-xs">
                          {[...new Set(screens.map((s) => s.brand).filter(Boolean))].slice(0, 3).join(", ")}…
                        </span>
                      </button>
                    )}
                  </ChoiceGroup>
                </Section>
              )}

              {!virtual && slots.length > 0 && (
                <Section title="Phone" hint="Any available phone starts on the first one that is free">
                  <ChoiceGroup label="Phone" className="grid-cols-2 sm:grid-cols-3">
                    <ChoiceCard selected={!slot} onSelect={() => setChosenSlot(null)}>
                      <span className="flex items-center gap-2 pr-5 font-medium">
                        <SparklesIcon className="text-muted-foreground size-3.5" />
                        Any available
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {freeSlots(provider)} of {slots.length} free
                      </span>
                    </ChoiceCard>
                    {slots.map((s) => (
                      <DeviceCard
                        key={s.id}
                        slot={s}
                        runs={runsOn(s.capabilities?.abis)}
                        selected={s.id === slot?.id}
                        onSelect={() => setChosenSlot(s.id)}
                      />
                    ))}
                  </ChoiceGroup>
                </Section>
              )}

              {webviews.length > 0 && (
                <WebViewChoice
                  webviews={webviews}
                  selected={webview}
                  preferred={webviewPackage}
                  android={androidShown}
                  onSelect={setChosenWebView}
                />
              )}

              {(locations.length > 0 || appData.data?.enabled) && (
                <div
                  className={cn(
                    "grid gap-6",
                    locations.length > 0 && appData.data?.enabled && "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]",
                  )}
                >
                  {locations.length > 0 && (
                    <Section title="VPN location" hint="Switchable during the session">
                      <div role="radiogroup" aria-label="VPN location" className="flex flex-wrap gap-1.5">
                        {locations.map((l) => (
                          <Chip
                            key={l.id}
                            role="radio"
                            aria-checked={l.id === location}
                            selected={l.id === location}
                            onSelect={() => setChosenLocation(l.id)}
                          >
                            <LocationCode location={l} selected={l.id === location} />
                            {l.label}
                            {l.id === defaultLocation && <span className="text-xs opacity-60">default</span>}
                          </Chip>
                        ))}
                      </div>
                    </Section>
                  )}

                  {appData.data?.enabled && (
                    <Section title="App data">
                      <ChoiceGroup label="App data" className="grid-cols-2">
                        <ChoiceCard selected={!snapshot} onSelect={() => setChosenData(FRESH)} className="px-3 py-2.5">
                          <span className="flex items-center gap-1.5 pr-5 text-[13px] font-medium">
                            <SparklesIcon className="size-3.5 shrink-0" />
                            Fresh install
                          </span>
                          <span className="text-muted-foreground text-xs">Nothing saved</span>
                        </ChoiceCard>
                        {appData.items.map((d) => (
                          <ChoiceCard
                            key={d.id}
                            selected={d.id === snapshot?.id}
                            onSelect={() => setChosenData(d.id)}
                            className="px-3 py-2.5"
                          >
                            <span className="flex items-center gap-1.5 pr-5 text-[13px] font-medium">
                              <DatabaseIcon className="size-3.5 shrink-0" />
                              <span className="truncate">Saved {formatRelative(d.createdAt)}</span>
                            </span>
                            <span className="text-muted-foreground truncate text-xs">
                              {d.versionName || "unknown build"} · {formatBytes(d.size)}
                            </span>
                          </ChoiceCard>
                        ))}
                      </ChoiceGroup>
                      {appData.items.length === 0 && (
                        <p className="text-muted-foreground text-xs">
                          Nothing saved for this app yet. Save it from a session, or when one ends.
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
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="launch-save-data"
                          checked={saveData}
                          onCheckedChange={(v) => {
                            setSaveData(v === true)
                            rememberSaveAppData(v === true)
                          }}
                        />
                        <Label htmlFor="launch-save-data" className="font-normal">
                          Save app data when the session ends
                        </Label>
                      </div>
                    </Section>
                  )}
                </div>
              )}

              {newerData && (
                <Alert>
                  <AlertDescription>
                    This data comes from a newer build ({snapshot?.versionName || snapshot?.versionCode}). The app may
                    fail to read it.
                  </AlertDescription>
                </Alert>
              )}
              {!build && (
                <Alert>
                  <AlertDescription>
                    {variants.length > 1 ? "These builds ship" : "This build ships"} native code only for{" "}
                    {builtFor.join(", ")}, which “{slot?.label ?? provider.name}” doesn't run.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </div>
      </div>

      <aside className="max-lg:contents lg:bg-muted lg:flex lg:w-[340px] lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:border-l">
        <div className="max-lg:bg-muted max-lg:border-t lg:contents">
          <div className="hidden items-center justify-between border-b px-5 py-[18px] lg:flex">
            <span className="text-muted-foreground font-mono text-xs">Preview</span>
            <DialogClose asChild>
              <Button variant="outline" size="icon" aria-label="Close">
                <XIcon />
              </Button>
            </DialogClose>
          </div>
          <div className="px-5 pt-7 pb-2">
            <LivePreview display={display} />
          </div>
          <div className="px-5 pt-2 text-center">
            <div className="font-semibold">{deviceName}</div>
            <div className="text-muted-foreground text-xs">{deviceFacts.filter(Boolean).join(" · ")}</div>
          </div>
          {rows.length > 0 && (
            <dl className="m-5 grid grid-cols-[96px_minmax(0,1fr)] gap-y-2.5 text-[13px]">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 truncate">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="bg-muted mt-auto grid gap-3 border-t px-5 pt-4 pb-5 max-lg:sticky max-lg:bottom-0 max-lg:z-10">
          {provider && (
            <p className={cn("flex items-start gap-2 text-xs", free === 0 ? "text-warning" : "text-muted-foreground")}>
              <ClockIcon className="mt-px size-3.5 shrink-0" />
              {free === 0
                ? `${slot ? `“${slot.label}” is ${slot.state}` : `All ${total} ${total === 1 ? "device" : "devices"} of “${provider.name}” are busy`}. You'll wait in line and it starts as soon as ${slot ? "it frees" : "one frees"} up, as long as you stay on its page.`
                : `${free} of ${total} ${total === 1 ? "device" : "devices"} free`}
            </p>
          )}
          {recordable && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="launch-record"
                checked={recording}
                onCheckedChange={(v) => {
                  setRecord(v === true)
                  rememberRecord(v === true)
                }}
              />
              <Label
                htmlFor="launch-record"
                className="font-normal"
                title="The screen, logcat, device and network on the server, to watch or share later in Recordings"
              >
                Record from start
              </Label>
            </div>
          )}
          <Button size="lg" className="w-full" onClick={submit} disabled={usable.length === 0 || !build}>
            <PlayIcon />
            {free === 0 ? "Join the queue" : "Launch"}
          </Button>
        </div>
      </aside>
    </div>
  )
}

function OtherBuild({
  groups,
  current,
  onSwitch,
}: {
  groups: ArtifactView[][]
  current: ArtifactView[]
  onSwitch: (artifact: ArtifactView) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="max-sm:hidden">
          Other build
          <ChevronDownIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
        <DropdownMenuLabel>{groups.length} builds</DropdownMenuLabel>
        {groups.map((g) => {
          const b = g[0]!
          return (
            <DropdownMenuItem
              key={`${b.source}/${b.id}`}
              disabled={g.some((v) => current.includes(v))}
              onSelect={() => onSwitch(b)}
              className="gap-2"
            >
              <span className="w-16 shrink-0 truncate font-mono text-xs">{b.app?.versionName || "—"}</span>
              <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                {b.meta.tags?.branch || b.source}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">{formatRelative(b.uploadedAt)}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ProviderSegment({
  provider: p,
  label,
  runs,
  selected,
  onSelect,
}: {
  provider: ProviderView
  label: string
  runs: boolean
  selected: boolean
  onSelect: () => void
}) {
  const kind = kindOf(p)
  const Icon = kind.icon
  const free = freeSlots(p)
  const button = (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={!runs}
      onClick={onSelect}
      className={cn(
        "focus-visible:ring-ring/50 flex h-[34px] w-full min-w-0 items-center justify-center gap-2 rounded-lg border px-2.5 text-[13px] font-medium transition outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
        selected
          ? "bg-card text-foreground shadow-xs"
          : "text-muted-foreground hover:text-foreground border-transparent",
      )}
    >
      <Icon />
      <span className="truncate">{label}</span>
      <Badge variant={free > 0 ? "success" : "secondary"}>{free} free</Badge>
    </button>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={runs ? undefined : 0} className="flex min-w-0 flex-1">
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {runs ? kind.blurb : "Doesn't run this build's native code"} ({p.name}, {free} of {p.capacity.slots.length}{" "}
        free)
      </TooltipContent>
    </Tooltip>
  )
}

const slotStates: Record<Slot["state"], { label: string; dot: string }> = {
  free: { label: "Available", dot: "bg-success" },
  busy: { label: "In use", dot: "bg-warning" },
  offline: { label: "Offline", dot: "bg-muted-foreground/40" },
  maintenance: { label: "Maintenance", dot: "bg-violet" },
}

function DeviceCard({
  slot,
  runs,
  selected,
  onSelect,
}: {
  slot: Slot
  runs: boolean
  selected: boolean
  onSelect: () => void
}) {
  const caps = slot.capabilities
  const state = slotStates[slot.state]
  const facts = [caps?.android && `Android ${caps.android}`, caps?.root && "rooted"].filter(Boolean).join(" · ")
  return (
    <ChoiceCard selected={selected} onSelect={onSelect} disabled={slot.state === "offline" || !runs}>
      <span className="flex min-w-0 items-center gap-2 pr-5 font-medium">
        <SmartphoneIcon className="text-muted-foreground size-3.5 shrink-0" />
        <span className="truncate">{caps?.model || slot.label}</span>
      </span>
      <span className="text-muted-foreground truncate text-xs">{facts || slot.label}</span>
      <span className="flex items-center gap-1.5 text-xs">
        <span className={cn("size-1.5 rounded-full", state.dot)} />
        <span>{runs ? state.label : "Doesn't run this build"}</span>
        {caps?.root && <ShieldCheckIcon className="text-muted-foreground ml-auto size-3.5" />}
      </span>
    </ChoiceCard>
  )
}
