import {
  ArchiveIcon,
  ChevronDownIcon,
  ClapperboardIcon,
  DownloadIcon,
  FileTextIcon,
  GlobeIcon,
  type LucideIcon,
  Link2OffIcon,
  LinkIcon,
  MaximizeIcon,
  PauseIcon,
  PinIcon,
  PlayIcon,
  PointerIcon,
  SkipBackIcon,
  SkipForwardIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react"
import {
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { toast } from "sonner"
import type { RecordingDetail, RecordingManifest } from "@/api/client"
import type { RecordingMarker } from "@/api/client"
import {
  type RecordingSource,
  useKeepRecording,
  useRecordingDevTools,
  useRecordingEvents,
  useSetMarkers,
  useShareRecording,
} from "@/api/queries"
import { BakeDialog } from "@/components/recording/bake-dialog"
import { SideCards } from "@/components/recording/side-cards"
import { MarkerPin, newMarkerId } from "@/components/recording/markers"
import { RecordingTools, savedTab } from "@/components/recording/tools-view"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { bakingSupported } from "@/lib/recording/bake"
import { DevToolsLog, toHar } from "@/lib/recording/devtools"
import { parseView, type PlayerView, viewHash } from "@/lib/recording/link"
import { remoteFiles } from "@/lib/recording/files"
import { buildLogcat } from "@/lib/recording/logfile"
import { Player } from "@/lib/recording/player"
import { loadIcon, type SceneApp } from "@/lib/recording/scene"
import { summarize } from "@/lib/recording/summary"
import { clock, segmentsOf, Telemetry } from "@/lib/recording/timeline"
import { download } from "@/lib/adb"
import { cn } from "@/lib/utils"

const rates = [0.5, 1, 2, 4]

function Tonal({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full bg-stage-secondary-container px-4 text-sm font-medium text-stage-on-secondary-container transition-colors hover:bg-stage-secondary-container-hover disabled:opacity-40 [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function IconButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "grid size-10 place-items-center rounded-full text-stage-on-surface-variant transition-colors hover:bg-stage-surface-container [&_svg]:size-5",
        className,
      )}
      {...props}
    />
  )
}

export function RecordingPlayer({
  source,
  detail,
  manifest,
}: {
  source: RecordingSource
  detail: RecordingDetail
  manifest: RecordingManifest
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
  const state = useSyncExternalStore(player.subscribe, player.getState)
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
  const [baking, setBaking] = useState(false)
  const [linked] = useState(() => parseView(window.location.hash))
  const [view, setView] = useState<PlayerView>(() => ({ ...linked, tab: linked.tab ?? savedTab() }))
  const changeView = (patch: PlayerView) => setView((v) => ({ ...v, ...patch }))
  const [showTouches, setShowTouches] = useState(true)
  const box = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const [gridHeight, setGridHeight] = useState(0)
  const keep = useKeepRecording()
  const share = useShareRecording()
  const own = source.kind === "own"
  const markers = detail.markers
  const saveMarkers = useSetMarkers(r.id)
  const [editing, setEditing] = useState<string | null>(null)
  const attach = useCallback(
    (c: HTMLCanvasElement | null) => {
      player.attach(c)
      return () => player.attach(null)
    },
    [player],
  )

  useEffect(() => {
    if (linked.t !== undefined) void player.seek(linked.t)
  }, [player, linked])
  useEffect(() => player.update(manifest), [player, manifest])
  useEffect(() => player.setTouches(telemetry.touches), [player, telemetry])
  useEffect(() => player.setShowTouches(showTouches), [player, showTouches])
  useEffect(() => () => player.dispose(), [player])
  useEffect(() => {
    const el = grid.current
    const observer = new ResizeObserver(([entry]) => setGridHeight(Math.round(entry?.contentRect.height ?? 0)))
    if (el) observer.observe(el)
    return () => observer.disconnect()
  }, [])

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
    setEditing(marker.id)
  }

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

  const summary = summarize({
    t: state.time,
    duration: state.duration,
    startedAt,
    snap: telemetry.at(state.time),
    app,
  })

  return (
    <div
      ref={box}
      tabIndex={-1}
      onKeyDown={onKey}
      className="android-stage flex flex-col gap-3 rounded-[32px] p-3 outline-none lg:h-full lg:p-4"
    >
      <div
        ref={grid}
        style={{ "--stage-h-lg": `${gridHeight}px` } as CSSProperties}
        className="grid gap-3 [--phone-max-w:calc(100vw-4rem)] [--stage-h:68dvh] lg:min-h-0 lg:flex-1 lg:grid-cols-[208px_auto_minmax(380px,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:[--phone-max-w:min(40vw,900px)] lg:[--stage-h:var(--stage-h-lg,60dvh)]"
      >
        <div className="order-2 -m-1 min-h-0 overflow-x-auto p-1 lg:order-1 lg:overflow-x-visible lg:overflow-y-auto">
          <SideCards summary={summary} iconUrl={r.iconUrl} />
        </div>

        <div className="order-3 flex h-[70dvh] min-h-0 flex-col lg:h-auto">
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
          />
        </div>

        <div className="order-1 grid min-h-0 place-items-center lg:order-2">
          <div
            className="relative box-content rounded-[44px] bg-black p-2.5 shadow-[0_0_0_1.5px_var(--stage-outline-variant),0_24px_60px_-20px_#000]"
            style={{
              aspectRatio: `${state.size.w} / ${state.size.h}`,
              height: `min(calc(var(--stage-h) - 1.25rem), calc((var(--phone-max-w) - 1.25rem) * ${state.size.h / state.size.w}))`,
            }}
          >
            <canvas
              ref={attach}
              onClick={() => player.toggle()}
              className="block size-full cursor-pointer rounded-[34px] bg-black"
            />
            {!state.playing && (
              <button
                type="button"
                aria-label="Play"
                onClick={() => player.play()}
                className="absolute inset-0 m-auto grid size-16 place-items-center rounded-full bg-stage-primary text-stage-on-primary shadow-lg transition-transform hover:scale-105"
              >
                <PlayIcon className="size-7 translate-x-0.5 fill-current" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-2 rounded-[28px] bg-stage-surface-low px-5 py-3">
        <Timeline
          duration={state.duration}
          time={state.time}
          manifest={manifest}
          telemetry={telemetry}
          markers={markers}
          editable={own}
          editing={editing}
          onEditing={setEditing}
          onMarkers={setMarkers}
          onSeek={(t) => void player.seek(t)}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <IconButton aria-label="Back 5 seconds" onClick={() => void player.seek(state.time - 5000)}>
            <SkipBackIcon />
          </IconButton>
          <button
            type="button"
            aria-label={state.playing ? "Pause" : "Play"}
            onClick={() => player.toggle()}
            className="grid size-12 place-items-center rounded-full bg-stage-primary text-stage-on-primary transition-transform hover:scale-105 [&_svg]:size-6 [&_svg]:fill-current"
          >
            {state.playing ? <PauseIcon /> : <PlayIcon className="translate-x-px" />}
          </button>
          <IconButton aria-label="Forward 5 seconds" onClick={() => void player.seek(state.time + 5000)}>
            <SkipForwardIcon />
          </IconButton>
          <span className="mx-2 font-mono text-sm text-stage-on-surface-variant tabular-nums">
            {clock(state.time)} <span className="text-stage-outline-dim">/ {clock(state.duration)}</span>
          </span>
          <div className="flex rounded-full bg-stage-surface-container p-0.5" role="group" aria-label="Speed">
            {rates.map((x) => (
              <button
                key={x}
                type="button"
                aria-pressed={state.rate === x}
                onClick={() => player.setRate(x)}
                className={cn(
                  "h-8 rounded-full px-3 font-mono text-xs transition-colors",
                  state.rate === x
                    ? "bg-stage-secondary-container text-stage-on-secondary-container"
                    : "text-stage-outline hover:text-stage-on-surface-variant",
                )}
              >
                {x}×
              </button>
            ))}
          </div>
          {state.sound && (
            <IconButton
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
            </IconButton>
          )}
          {own && (
            <Tonal className="ml-2" title="Pin this moment on the timeline (M)" onClick={addMarker}>
              <PinIcon />
              Marker
            </Tonal>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {source.kind === "shared" && (
              <Tonal title="Copy a link that opens here, with this tab and what is open in it" onClick={copyMoment}>
                <LinkIcon />
                Link to {clock(state.time)}
              </Tonal>
            )}
            {own && (
              <>
                <Tonal
                  aria-pressed={r.keep}
                  disabled={!!r.share || keep.isPending}
                  title={
                    r.share
                      ? "Kept while it is shared"
                      : r.keep
                        ? "Let retention delete it when its time is up"
                        : "Keep it past the retention period"
                  }
                  className={cn(
                    r.keep &&
                      "bg-stage-primary-container text-stage-on-primary-container hover:bg-stage-primary-container-hover disabled:opacity-100",
                  )}
                  onClick={() => keep.mutate({ id: r.id, keep: !r.keep })}
                >
                  <PinIcon className={cn(r.keep && "fill-current")} />
                  {r.keep ? "Kept" : "Keep"}
                </Tonal>
                <Tonal
                  disabled={share.isPending}
                  title={
                    r.share
                      ? `Copy the share link at ${clock(state.time)}, with this tab and what is open in it`
                      : `Make a link anyone can open at ${clock(state.time)}, and keep the recording`
                  }
                  onClick={() => void copyLink()}
                >
                  <LinkIcon />
                  {r.share ? "Copy link" : "Share"}
                </Tonal>
                {r.share && (
                  <IconButton
                    aria-label="Stop sharing"
                    title="Stop sharing: the link stops working"
                    disabled={share.isPending}
                    onClick={() => share.mutate({ id: r.id, share: false })}
                  >
                    <Link2OffIcon />
                  </IconButton>
                )}
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Tonal>
                  <DownloadIcon />
                  Download
                  <ChevronDownIcon className="-mr-1 opacity-70" />
                </Tonal>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                side="top"
                className="w-80 rounded-2xl border-0 bg-stage-surface-container p-1.5 text-stage-on-surface shadow-2xl ring-1 ring-black/10 dark:ring-white/10"
              >
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
            <IconButton
              aria-label="Show taps and swipes"
              aria-pressed={showTouches}
              title={showTouches ? "Hide taps and swipes" : "Show taps and swipes"}
              className={cn(
                showTouches && "bg-stage-secondary-container text-stage-on-secondary-container",
                telemetry.touches.empty && "hidden",
              )}
              onClick={() => setShowTouches((v) => !v)}
            >
              <PointerIcon />
            </IconButton>
            <IconButton
              aria-label="Full screen"
              onClick={() => void box.current?.requestFullscreen().catch(() => undefined)}
            >
              <MaximizeIcon />
            </IconButton>
          </div>
        </div>
      </div>

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
      <Icon className="mt-0.5 size-4 shrink-0 text-stage-primary" />
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-stage-outline">{hint}</span>
      </span>
    </>
  )
  const cls = "items-start gap-3 rounded-xl px-3 py-2 focus:bg-stage-surface-high focus:text-stage-on-surface"
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

function Timeline({
  duration,
  time,
  manifest,
  telemetry,
  markers,
  editable,
  editing,
  onEditing,
  onMarkers,
  onSeek,
}: {
  duration: number
  time: number
  manifest: RecordingManifest
  telemetry: Telemetry
  markers: RecordingMarker[]
  editable: boolean
  editing: string | null
  onEditing: (id: string | null) => void
  onMarkers: (items: RecordingMarker[]) => void
  onSeek: (t: number) => void
}) {
  const [hover, setHover] = useState<number | null>(null)
  const segments = useMemo(() => segmentsOf(manifest), [manifest])
  const closes = telemetry.status.filter((s, i, all) => !s.v.appRunning && all[i - 1]?.v.appRunning)
  const dnsChanges = telemetry.dnsChanges
  const pct = (t: number) => `${duration > 0 ? (t / duration) * 100 : 0}%`
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * duration
  }

  return (
    <div
      role="slider"
      tabIndex={-1}
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={time}
      className="relative h-10 cursor-pointer touch-none select-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        onSeek(at(e))
      }}
      onPointerMove={(e) => {
        setHover(at(e))
        if (e.buttons === 1) onSeek(at(e))
      }}
      onPointerLeave={() => setHover(null)}
    >
      <div className="absolute inset-x-0 top-[28px] h-1.5 overflow-hidden rounded-full bg-stage-surface-high">
        {segments.map((s) => (
          <span
            key={s.file}
            className="absolute inset-y-0 bg-stage-outline-variant"
            style={{ left: pct(s.start), width: pct(s.duration) }}
          />
        ))}
        <span className="absolute inset-y-0 left-0 rounded-full bg-stage-primary" style={{ width: pct(time) }} />
      </div>
      {closes.map((c) => (
        <span
          key={c.t}
          title={`App closed at ${clock(c.t)}`}
          className="absolute top-[24px] h-3.5 w-1 -translate-x-1/2 rounded-full bg-stage-error"
          style={{ left: pct(c.t) }}
        />
      ))}
      {dnsChanges.map((c) => (
        <span
          key={`dns-${c.t}`}
          title={`${c.v.flushed ? "DNS cache cleared" : "DNS rewrites or TTL changed"} at ${clock(c.t)}`}
          className="absolute top-[24px] h-3.5 w-1 -translate-x-1/2 rounded-full bg-violet-500"
          style={{ left: pct(c.t) }}
        />
      ))}
      <span
        className="absolute top-[22px] h-[18px] w-1 -translate-x-1/2 rounded-full bg-stage-primary shadow-[0_0_0_3px_var(--stage-surface-low)]"
        style={{ left: pct(time) }}
      />
      {markers.map((m) => (
        <MarkerPin
          key={m.id}
          marker={m}
          left={pct(m.t)}
          open={editing === m.id}
          editable={editable}
          onOpen={(open) => {
            if (open) onSeek(m.t)
            onEditing(open ? m.id : null)
          }}
          onChange={(next) => onMarkers(markers.map((x) => (x.id === m.id ? next : x)))}
          onRemove={() => {
            onEditing(null)
            onMarkers(markers.filter((x) => x.id !== m.id))
          }}
        />
      ))}
      {hover !== null && (
        <span
          className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded-lg bg-stage-surface-high px-2 py-0.5 font-mono text-xs text-stage-on-surface tabular-nums"
          style={{ left: pct(hover) }}
        >
          {clock(hover)}
        </span>
      )}
    </div>
  )
}
