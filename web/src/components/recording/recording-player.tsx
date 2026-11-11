import { useQuery } from "@tanstack/react-query"
import {
  ArchiveIcon,
  ChevronDownIcon,
  ClapperboardIcon,
  DownloadIcon,
  FileTextIcon,
  FlagIcon,
  GlobeIcon,
  InfoIcon,
  type LucideIcon,
  Link2OffIcon,
  LinkIcon,
  MaximizeIcon,
  PauseIcon,
  PinIcon,
  PlayIcon,
  PointerIcon,
  RotateCcwIcon,
  RotateCwIcon,
  VideoOffIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react"
import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { toast } from "sonner"
import type { RecordingDetail, RecordingManifest, RecordingMarker } from "@/api/client"
import {
  type RecordingSource,
  useAuth,
  useKeepRecording,
  useRecordingDevTools,
  useRecordingEvents,
  useReferences,
  useSetMarkers,
  useShareRecording,
} from "@/api/queries"
import { BakeDialog } from "@/components/recording/bake-dialog"
import { newMarkerId, QuickMarker } from "@/components/recording/markers"
import { SideCards } from "@/components/recording/side-cards"
import { type Lanes, screenIcons, Timeline } from "@/components/recording/timeline"
import { RecordingTools, savedTab } from "@/components/recording/tools-view"
import { PixelOverlay } from "@/components/session/pixel-perfect/overlay"
import { recordingSource } from "@/components/session/pixel-perfect/source"
import { usePixelPerfectOf } from "@/components/session/pixel-perfect/state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useNow } from "@/hooks/use-now"
import { download } from "@/lib/adb"
import { formatDuration, formatRelative } from "@/lib/format"
import { bakingSupported } from "@/lib/recording/bake"
import { DevToolsLog, toHar } from "@/lib/recording/devtools"
import { remoteFiles } from "@/lib/recording/files"
import { appLane, CrashScan, issuesOf, networkLane, nextAfter, screenLane, spanAt } from "@/lib/recording/lanes"
import { parseView, type PlayerView, viewHash } from "@/lib/recording/link"
import { buildLogcat } from "@/lib/recording/logfile"
import { Player } from "@/lib/recording/player"
import { loadIcon, type SceneApp } from "@/lib/recording/scene"
import { summarize } from "@/lib/recording/summary"
import { clock, segmentsOf, Telemetry } from "@/lib/recording/timeline"
import { cn } from "@/lib/utils"

const rates = [0.5, 1, 2, 4]
const framePad = 10
const stageMargin = 24

/** The row above a recording: its title on the left, actions on the right. */
export function RecordingHeader({ children }: { children: ReactNode }) {
  return <header className="flex flex-wrap items-center gap-3.5">{children}</header>
}

function Tool({ pressed, className, ...props }: ComponentProps<"button"> & { pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "grid size-9 place-items-center rounded-[10px] border bg-card text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-4",
        pressed && "border-foreground text-foreground",
        className,
      )}
      {...props}
    />
  )
}

function sourceKey(source: RecordingSource) {
  return source.kind === "shared" ? `s:${source.token}` : `${source.kind}:${source.id}`
}

export function RecordingPlayer({
  source,
  detail,
  manifest,
  title,
  extra,
}: {
  source: RecordingSource
  detail: RecordingDetail
  manifest: RecordingManifest
  /** the left of the header: back, icon, name and badges */
  title: ReactNode
  /** anything after the actions, such as a file picker */
  extra?: ReactNode
}) {
  const r = detail.recording
  const events = useRecordingEvents(source, manifest.events.length)
  const telemetry = useMemo(() => new Telemetry(events.data?.items ?? []), [events.data])
  const devtools = useRecordingDevTools(source, manifest.devtools.length)
  const devlog = useMemo(() => new DevToolsLog(devtools.data?.items ?? []), [devtools.data])
  const startedAt = new Date(manifest.startedAt).getTime()
  const [app] = useState<SceneApp>(() => ({
    title: r.label || r.package,
    subtitle: r.package,
    version: r.versionName,
    icon: loadIcon(r.iconUrl),
  }))
  const files = useMemo(() => (source.kind === "local" ? source.files : remoteFiles(r.filesUrl)), [source, r.filesUrl])
  const [player] = useState(() => new Player(files, manifest))
  const [scan] = useState(() => new CrashScan(files, r.package))
  const state = useSyncExternalStore(player.subscribe, player.getState)
  const pp = usePixelPerfectOf(() => recordingSource(player), r.screen)
  const identity = useAuth().data?.identity
  const pixelEnabled = useReferences(!!identity && !identity.pending).data?.enabled === true
  const pixel = useMemo(
    () =>
      pixelEnabled
        ? {
            pp,
            target: {
              package: r.package,
              label: r.title || r.label,
              versionName: r.versionName,
              display: r.screen,
              moment: () => `recording at ${formatDuration(player.getState().time)}`,
            },
          }
        : undefined,
    [pixelEnabled, pp, player, r.package, r.title, r.label, r.versionName, r.screen],
  )
  const growing = r.state === "recording"
  const crashes = useQuery({
    queryKey: ["recording-crashes", sourceKey(source), manifest.logcat.length, growing],
    queryFn: () => scan.scan(manifest.logcat, growing),
    staleTime: Infinity,
  }).data
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const clocks = useMemo(
    () => ({
      startedAt,
      offsetAt: (t: number) => telemetry.deviceAt(t)?.timeOffset ?? 0,
      zoneAt: (t: number) => telemetry.deviceAt(t)?.timeZone,
      duration: state.duration,
      seek: (t: number) => void player.seek(t),
    }),
    [startedAt, telemetry, state.duration, player],
  )
  const segments = useMemo(() => segmentsOf(manifest), [manifest])
  const lanes = useMemo<Lanes>(() => {
    const found = crashes ?? []
    return {
      screen: screenLane(segments, telemetry.screens, telemetry.touches.keys, state.duration),
      app: appLane(telemetry.status, state.duration, app.title),
      crashes: found,
      network: networkLane(telemetry.device, telemetry.network, state.duration),
      dns: telemetry.dnsChanges.map((c) => ({
        t: c.t,
        title: c.v.flushed ? "DNS cache cleared" : "DNS rewrites or TTL changed",
      })),
      taps: telemetry.touches.gestures.map((g) => ({ t: g.start })),
      issues: issuesOf(devlog, telemetry.status, found, state.duration),
    }
  }, [segments, telemetry, devlog, crashes, state.duration, app.title])
  const [baking, setBaking] = useState(false)
  const [linked] = useState(() => parseView(window.location.hash))
  const [view, setView] = useState<PlayerView>(() => ({ ...linked, tab: linked.tab ?? savedTab() }))
  const changeView = (patch: PlayerView) => setView((v) => ({ ...v, ...patch }))
  const [showTouches, setShowTouches] = useState(true)
  const box = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ w: 0, h: 0 })
  const keep = useKeepRecording()
  const share = useShareRecording()
  const own = source.kind === "own"
  const markers = detail.markers
  const saveMarkers = useSetMarkers(r.id)
  const [editing, setEditing] = useState<string | null>(null)
  const [quick, setQuick] = useState<string | null>(null)
  const now = useNow(60_000)
  const attach = useCallback(
    (c: HTMLCanvasElement | null) => {
      canvas.current = c
      player.attach(c)
      return () => player.attach(null)
    },
    [player],
  )
  const measure = useCallback((el: HTMLDivElement | null) => {
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect
      if (rect) setArea({ w: Math.round(rect.width), h: Math.round(rect.height) })
    })
    if (el) observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (linked.t !== undefined) void player.seek(linked.t)
  }, [player, linked])
  useEffect(() => player.update(manifest), [player, manifest])
  useEffect(() => player.setTouches(telemetry.touches), [player, telemetry])
  useEffect(() => player.setShowTouches(showTouches), [player, showTouches])
  useEffect(() => () => player.dispose(), [player])

  const copyLink = async () => {
    try {
      const v = r.share ? r : await share.mutateAsync({ id: r.id, share: true })
      if (!v.share) return
      await navigator.clipboard.writeText(v.share.url + viewHash({ ...view, t: state.time }))
      toast.success(`Link to ${clock(state.time)} copied`, {
        description:
          "It opens at this moment with this tab and what is open in it. Anyone with it can watch; the recording is kept while it is shared.",
      })
    } catch (e) {
      toast.error("Could not share", { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const copyMoment = () => {
    const url = `${window.location.origin}${window.location.pathname}${viewHash({ ...view, t: state.time })}`
    void navigator.clipboard.writeText(url).then(
      () => toast.success(`Link to ${clock(state.time)} copied`),
      () => toast.error("Could not copy"),
    )
  }

  const saveLogcat = async (colored: boolean) => {
    try {
      const blob = await buildLogcat(files, manifest, r, colored)
      download(blob, `${r.package}-${r.id}-logcat.${colored ? "log" : "txt"}`)
    } catch (e) {
      toast.error("Could not build the logcat", { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const saveHar = () => {
    const har = toHar(devlog, startedAt, { name: "Holtdroid", version: "1" })
    download(new Blob([JSON.stringify(har, null, 2)], { type: "application/json" }), `${r.package}-${r.id}.har`)
  }

  const setMarkers = (items: RecordingMarker[]) => saveMarkers.mutate(items)
  const addMarker = () => {
    const marker: RecordingMarker = { id: newMarkerId(), t: Math.round(state.time), label: "", icon: "pin" }
    setMarkers([...markers, marker])
    setEditing(null)
    setQuick(marker.id)
  }
  const nameQuick = (label: string | null) => {
    const id = quick
    setQuick(null)
    if (label && id) setMarkers(markers.map((m) => (m.id === id ? { ...m, label } : m)))
    box.current?.focus()
  }
  const quickMarker = quick ? markers.find((m) => m.id === quick) : undefined

  const onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName
    if (tag === "INPUT" || tag === "TEXTAREA") return
    if (e.key === " " || e.key === "k") player.toggle()
    else if (e.key === "ArrowLeft") void player.seek(state.time - 5000)
    else if (e.key === "ArrowRight") void player.seek(state.time + 5000)
    else if (e.key === "m" && own) addMarker()
    else return
    e.preventDefault()
  }

  const snap = telemetry.at(state.time)
  const summary = summarize({ t: state.time, duration: state.duration, startedAt, snap, app })
  const screen = spanAt(lanes.screen, state.time)
  const ScreenIcon = screen ? (screenIcons[screen.kind] ?? VideoOffIcon) : undefined
  const screenLabel = screen ? screen.label || "No video" : undefined

  const ratio = state.size.w / state.size.h
  const maxW = Math.max(0, area.w - 2 * (stageMargin + framePad))
  const maxH = Math.max(0, area.h - 2 * (stageMargin + framePad))
  const fit = maxH * ratio > maxW ? { w: maxW, h: maxW / ratio } : { w: maxH * ratio, h: maxH }

  const errors = lanes.issues.filter((i) => i.level === "error").map((i) => i.t)
  const jumps: { label: string; times: number[]; className?: string }[] = [
    { label: "Error", times: errors, className: "text-danger" },
    { label: "Marker", times: markers.map((m) => m.t).toSorted((a, b) => a - b) },
    { label: "Tap", times: lanes.taps.map((t) => t.t) },
  ]

  return (
    <div ref={box} tabIndex={-1} onKeyDown={onKey} className="flex flex-col gap-4 bg-background outline-none">
      <RecordingHeader>
        {title}
        <span className="flex-1" />
        <div className="flex flex-wrap items-center gap-2">
          {own &&
            (r.share ? (
              <Badge variant="secondary">
                <LinkIcon />
                Shared, kept
              </Badge>
            ) : r.keep ? (
              <Badge variant="success">
                <PinIcon />
                Kept
              </Badge>
            ) : (
              r.expiresAt && (
                <Badge variant="secondary">
                  <InfoIcon />
                  Deleted {formatRelative(r.expiresAt, now)}
                </Badge>
              )
            ))}
          {own && (
            <Button
              variant={r.keep ? "default" : "outline"}
              aria-pressed={r.keep}
              disabled={!!r.share || keep.isPending}
              title={
                r.share
                  ? "Kept while it is shared"
                  : r.keep
                    ? "Let retention delete it when its time is up"
                    : "Keep it past the retention period"
              }
              onClick={() => keep.mutate({ id: r.id, keep: !r.keep })}
            >
              {r.keep ? "Kept" : "Keep"}
            </Button>
          )}
          {source.kind === "shared" && (
            <Button
              variant="outline"
              title="Copy a link that opens here, with this tab and what is open in it"
              onClick={copyMoment}
            >
              <LinkIcon />
              Link at {clock(state.time)}
            </Button>
          )}
          {own && (
            <Button
              variant="outline"
              disabled={share.isPending}
              title={
                r.share
                  ? `Copy the share link at ${clock(state.time)}, with this tab and what is open in it`
                  : `Make a link anyone can open at ${clock(state.time)}, and keep the recording`
              }
              onClick={() => void copyLink()}
            >
              <LinkIcon />
              Link at {clock(state.time)}
            </Button>
          )}
          {own && r.share && (
            <Button
              variant="outline"
              size="icon"
              aria-label="Stop sharing"
              title="Stop sharing: the link stops working"
              disabled={share.isPending}
              onClick={() => share.mutate({ id: r.id, share: false })}
            >
              <Link2OffIcon />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <DownloadIcon />
                Export
                <ChevronDownIcon className="size-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              {!detail.shared && bakingSupported() && (
                <MenuItem
                  icon={ClapperboardIcon}
                  title="Video (.mp4)"
                  hint="Rendered in your browser with the device panels, in 1296p"
                  disabled={r.state === "recording"}
                  onSelect={() => setBaking(true)}
                />
              )}
              {source.kind !== "local" && (
                <MenuItem
                  icon={ArchiveIcon}
                  title="Recording file (.holtdroid)"
                  hint="Everything in one file; open it on the Open page, no server needed"
                  href={r.exportUrl}
                />
              )}
              {!devlog.empty && (
                <MenuItem
                  icon={GlobeIcon}
                  title="Network (.har)"
                  hint="The WebViews' requests with bodies and the WebSockets; opens in Chrome DevTools"
                  onSelect={saveHar}
                />
              )}
              <MenuItem
                icon={FileTextIcon}
                title="Logcat, colored (.log)"
                hint="Levels and colours as ANSI codes: less -R, bat, an IDE"
                href={source.kind === "local" ? undefined : r.logcatLogUrl}
                onSelect={source.kind === "local" ? () => void saveLogcat(true) : undefined}
              />
              <MenuItem
                icon={FileTextIcon}
                title="Logcat, plain text (.txt)"
                hint="The same lines without colour codes"
                href={source.kind === "local" ? undefined : r.logcatUrl}
                onSelect={source.kind === "local" ? () => void saveLogcat(false) : undefined}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          {extra}
        </div>
      </RecordingHeader>

      <div className="flex flex-col gap-4 lg:grid lg:h-[max(460px,calc(100dvh-30rem))] lg:grid-cols-[240px_minmax(0,1fr)_minmax(340px,400px)] xl:grid-cols-[260px_minmax(0,1fr)_minmax(360px,420px)]">
        <aside className="order-2 min-h-0 lg:order-none lg:overflow-y-auto">
          <SideCards
            summary={summary}
            screen={screenLabel}
            traffic={snap.history.map((m) => ({ t: m.t, v: m.v.device.rxRate + m.v.device.txRate }))}
          />
        </aside>

        <section className="order-1 flex min-h-[60dvh] flex-col overflow-hidden rounded-2xl border bg-stage lg:order-none lg:min-h-0">
          <div className="flex items-center gap-2 px-3.5 py-3">
            {screen && ScreenIcon && (
              <Badge variant="outline" className="h-6 bg-card px-2">
                <ScreenIcon />
                {screenLabel} since {clock(screen.start)}
              </Badge>
            )}
            <span className="flex-1" />
            {!telemetry.touches.empty && (
              <Tool
                pressed={showTouches}
                aria-label={showTouches ? "Hide taps and swipes" : "Show taps and swipes"}
                title={showTouches ? "Hide taps and swipes" : "Show taps and swipes"}
                onClick={() => setShowTouches((v) => !v)}
              >
                <PointerIcon />
              </Tool>
            )}
            <Tool
              aria-label="Full screen"
              title="Full screen"
              onClick={() => void box.current?.requestFullscreen().catch(() => undefined)}
            >
              <MaximizeIcon />
            </Tool>
          </div>
          <div ref={measure} className="relative min-h-0 flex-1">
            <div className="absolute inset-0 grid place-items-center">
              <div
                className="relative rounded-[40px] border bg-frame shadow-float"
                style={{ padding: framePad, width: fit.w + 2 * framePad, height: fit.h + 2 * framePad }}
              >
                <div className="relative size-full overflow-hidden rounded-[30px]">
                  <canvas
                    ref={attach}
                    onClick={() => player.toggle()}
                    className="block size-full cursor-pointer bg-black"
                  />
                  {pixel && <PixelOverlay pp={pp} canvasRef={canvas} />}
                </div>
                {!state.playing && (
                  <button
                    type="button"
                    aria-label="Play"
                    onClick={() => player.play()}
                    className="absolute inset-0 m-auto grid size-16 place-items-center rounded-full bg-primary text-primary-foreground shadow-float transition-transform hover:scale-105"
                  >
                    <PlayIcon className="size-7 translate-x-0.5 fill-current" />
                  </button>
                )}
              </div>
            </div>
            {quickMarker && (
              <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
                <QuickMarker key={quickMarker.id} marker={quickMarker} onDone={nameQuick} />
              </div>
            )}
            {own && !quickMarker && (
              <Button
                variant="outline"
                className="absolute right-4 bottom-4 h-9 shadow-float"
                title="Pin this moment on the timeline (M)"
                onClick={addMarker}
              >
                <FlagIcon className="text-warning" />
                Marker
                <kbd className="rounded-[5px] border px-[5px] font-sans text-[11px] text-muted-foreground">M</kbd>
              </Button>
            )}
          </div>
        </section>

        <div className="order-3 flex h-[70dvh] min-h-0 flex-col lg:order-none lg:h-auto">
          <RecordingTools
            player={player}
            time={state.time}
            log={devlog}
            dns={telemetry.dns}
            conns={telemetry.conns}
            network={telemetry.network}
            share={source.kind === "shared" ? source.token : undefined}
            clocks={clocks}
            view={view}
            onView={changeView}
            pixel={pixel}
            issues={lanes.issues}
          />
        </div>
      </div>

      <section className="grid gap-2.5 rounded-2xl border bg-card px-[18px] pt-3.5 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Back 5 seconds"
            onClick={() => void player.seek(state.time - 5000)}
          >
            <RotateCcwIcon />
          </Button>
          <Button
            size="icon-lg"
            className="rounded-xl [&_svg]:fill-current"
            aria-label={state.playing ? "Pause" : "Play"}
            onClick={() => player.toggle()}
          >
            {state.playing ? <PauseIcon /> : <PlayIcon className="translate-x-px" />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Forward 5 seconds"
            onClick={() => void player.seek(state.time + 5000)}
          >
            <RotateCwIcon />
          </Button>
          <span className="mx-2 font-mono text-sm">
            {clock(state.time, true)} <span className="text-muted-foreground">/ {clock(state.duration)}</span>
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Speed" className="font-mono">
                {state.rate}×
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup value={String(state.rate)} onValueChange={(v) => player.setRate(Number(v))}>
                {rates.map((x) => (
                  <DropdownMenuRadioItem key={x} value={String(x)} className="font-mono">
                    {x}×
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {state.sound && (
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={state.muted ? "Turn the sound on" : "Turn the sound off"}
              aria-pressed={state.muted}
              title={
                state.rate !== 1
                  ? "There is no sound at other speeds than 1×"
                  : state.muted
                    ? "Turn the sound on"
                    : "Turn the sound off"
              }
              className={cn(state.rate !== 1 && "opacity-50")}
              onClick={() => player.setMuted(!state.muted)}
            >
              {state.muted || state.rate !== 1 ? <VolumeXIcon /> : <Volume2Icon />}
            </Button>
          )}
          <span className="flex-1" />
          <span className="text-xs text-muted-foreground">Jump to</span>
          {jumps.map((j) => (
            <Button
              key={j.label}
              variant="outline"
              size="sm"
              className={j.className}
              disabled={j.times.length === 0}
              onClick={() => {
                const t = nextAfter(j.times, state.time)
                if (t !== undefined) void player.seek(t)
              }}
            >
              {j.label}
            </Button>
          ))}
        </div>
        <Timeline
          duration={state.duration}
          time={state.time}
          lanes={lanes}
          markers={markers}
          editable={own}
          editing={editing}
          onEditing={setEditing}
          onMarkers={setMarkers}
          onSeek={(t) => void player.seek(t)}
        />
      </section>

      {baking && (
        <BakeDialog
          onClose={() => setBaking(false)}
          recording={r}
          manifest={manifest}
          files={files}
          telemetry={telemetry}
          app={{ ...app, recordingTitle: r.title }}
          markers={markers}
        />
      )}
    </div>
  )
}

function MenuItem({
  icon: Icon,
  title,
  hint,
  href,
  disabled,
  onSelect,
}: {
  icon: LucideIcon
  title: string
  hint: string
  href?: string
  disabled?: boolean
  onSelect?: () => void
}) {
  const body = (
    <>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
    </>
  )
  const cls = "items-start gap-3 px-3 py-2"
  return href ? (
    <DropdownMenuItem asChild className={cls}>
      <a href={href} download>
        {body}
      </a>
    </DropdownMenuItem>
  ) : (
    <DropdownMenuItem className={cls} disabled={disabled} onSelect={onSelect}>
      {body}
    </DropdownMenuItem>
  )
}
