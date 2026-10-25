import {
  ChevronDownIcon,
  ClapperboardIcon,
  FileTextIcon,
  Link2OffIcon,
  LinkIcon,
  MaximizeIcon,
  PauseIcon,
  PinIcon,
  PlayIcon,
  PointerIcon,
  SkipBackIcon,
  SkipForwardIcon,
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
  useRecordingEvents,
  useSetMarkers,
  useShareRecording,
} from "@/api/queries"
import { BakeDialog } from "@/components/recording/bake-dialog"
import { InfoView } from "@/components/recording/info-view"
import { LogcatView } from "@/components/recording/logcat-view"
import { MarkerPin, newMarkerId } from "@/components/recording/markers"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { bakingSupported } from "@/lib/recording/bake"
import { Player } from "@/lib/recording/player"
import { loadIcon, type SceneApp } from "@/lib/recording/scene"
import { summarize } from "@/lib/recording/summary"
import { clock, segmentsOf, Telemetry } from "@/lib/recording/timeline"
import { cn } from "@/lib/utils"

const rates = [0.5, 1, 2, 4]

function Tonal({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full bg-[#354b3b] px-4 text-sm font-medium text-[#d1e8d5] transition-colors hover:bg-[#3f5946] disabled:opacity-40 [&_svg]:size-4",
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
        "grid size-10 place-items-center rounded-full text-[#c0c9c1] transition-colors hover:bg-[#262b28] [&_svg]:size-5",
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
  const [app] = useState<SceneApp>(() => ({
    title: r.label || r.package,
    subtitle: r.package,
    version: r.versionName,
    icon: loadIcon(r.iconUrl),
  }))
  const [player] = useState(() => new Player(r.filesUrl, manifest))
  const state = useSyncExternalStore(player.subscribe, player.getState)
  const [baking, setBaking] = useState(false)
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
      await navigator.clipboard.writeText(v.share.url)
      toast.success("Link copied", {
        description: "Anyone with it can watch. The recording is kept while it is shared.",
      })
    } catch (e) {
      toast.error("Could not share", { description: e instanceof Error ? e.message : String(e) })
    }
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
    startedAt: new Date(manifest.startedAt).getTime(),
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
        className="grid gap-3 [--phone-max-w:calc(100vw-4rem)] [--stage-h:68dvh] lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:[--phone-max-w:min(44vw,900px)] lg:[--stage-h:var(--stage-h-lg,60dvh)]"
      >
        <div className="order-3 flex h-[60dvh] min-h-0 flex-col lg:order-1 lg:h-auto [&>section]:flex-1">
          <LogcatView player={player} time={state.time} />
        </div>

        <div className="order-1 grid min-h-0 place-items-center lg:order-2">
          <div
            className="relative box-content rounded-[44px] bg-black p-2.5 shadow-[0_0_0_1.5px_#404943,0_24px_60px_-20px_#000]"
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
                className="absolute inset-0 m-auto grid size-16 place-items-center rounded-full bg-[#78dc9a] text-[#003919] shadow-lg transition-transform hover:scale-105"
              >
                <PlayIcon className="size-7 translate-x-0.5 fill-current" />
              </button>
            )}
          </div>
        </div>

        <div className="order-2 min-h-0 lg:order-3 lg:overflow-y-auto lg:pr-1">
          <InfoView summary={summary} iconUrl={r.iconUrl} />
        </div>
      </div>

      <div className="grid gap-2 rounded-[28px] bg-[#1c211e] px-5 py-3">
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
            className="grid size-12 place-items-center rounded-full bg-[#78dc9a] text-[#003919] transition-transform hover:scale-105 [&_svg]:size-6 [&_svg]:fill-current"
          >
            {state.playing ? <PauseIcon /> : <PlayIcon className="translate-x-px" />}
          </button>
          <IconButton aria-label="Forward 5 seconds" onClick={() => void player.seek(state.time + 5000)}>
            <SkipForwardIcon />
          </IconButton>
          <span className="mx-2 font-mono text-sm text-[#c0c9c1] tabular-nums">
            {clock(state.time)} <span className="text-[#6f7872]">/ {clock(state.duration)}</span>
          </span>
          <div className="flex rounded-full bg-[#262b28] p-0.5" role="group" aria-label="Speed">
            {rates.map((x) => (
              <button
                key={x}
                type="button"
                aria-pressed={state.rate === x}
                onClick={() => player.setRate(x)}
                className={cn(
                  "h-8 rounded-full px-3 font-mono text-xs transition-colors",
                  state.rate === x ? "bg-[#354b3b] text-[#d1e8d5]" : "text-[#8a938c] hover:text-[#c0c9c1]",
                )}
              >
                {x}×
              </button>
            ))}
          </div>
          {own && (
            <Tonal className="ml-2" title="Pin this moment on the timeline (M)" onClick={addMarker}>
              <PinIcon />
              Marker
            </Tonal>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
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
                  className={cn(r.keep && "bg-[#0a5230] text-[#94f7b5] hover:bg-[#0d6139] disabled:opacity-100")}
                  onClick={() => keep.mutate({ id: r.id, keep: !r.keep })}
                >
                  <PinIcon className={cn(r.keep && "fill-current")} />
                  {r.keep ? "Kept" : "Keep"}
                </Tonal>
                <Tonal
                  disabled={share.isPending}
                  title={r.share ? "Copy the share link" : "Make a link anyone can open, and keep the recording"}
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
                  <FileTextIcon />
                  Logcat
                  <ChevronDownIcon className="-mr-1 opacity-70" />
                </Tonal>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                side="top"
                className="w-64 rounded-2xl border-0 bg-[#262b28] p-1.5 text-[#e0e3de] shadow-2xl ring-1 ring-white/10"
              >
                <DropdownMenuItem
                  asChild
                  className="gap-0 rounded-xl px-3 py-2 focus:bg-[#313633] focus:text-[#e0e3de]"
                >
                  <a href={r.logcatLogUrl} download className="grid gap-0.5">
                    <span className="text-sm font-medium">Colored .log</span>
                    <span className="text-xs text-[#8a938c]">
                      Levels and colours as ANSI, for less -R, bat or an IDE
                    </span>
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem
                  asChild
                  className="gap-0 rounded-xl px-3 py-2 focus:bg-[#313633] focus:text-[#e0e3de]"
                >
                  <a href={r.logcatUrl} download className="grid gap-0.5">
                    <span className="text-sm font-medium">Plain text</span>
                    <span className="text-xs text-[#8a938c]">The same lines without colour codes</span>
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {!detail.shared && bakingSupported() && (
              <Tonal disabled={r.state === "recording"} onClick={() => setBaking(true)}>
                <ClapperboardIcon />
                Download video
              </Tonal>
            )}
            <IconButton
              aria-label="Show taps and swipes"
              aria-pressed={showTouches}
              title={showTouches ? "Hide taps and swipes" : "Show taps and swipes"}
              className={cn(showTouches && "bg-[#354b3b] text-[#d1e8d5]", telemetry.touches.empty && "hidden")}
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
          telemetry={telemetry}
          app={app}
          markers={markers}
        />
      )}
    </div>
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
      <div className="absolute inset-x-0 top-[28px] h-1.5 overflow-hidden rounded-full bg-[#313633]">
        {segments.map((s) => (
          <span
            key={s.file}
            className="absolute inset-y-0 bg-[#404943]"
            style={{ left: pct(s.start), width: pct(s.duration) }}
          />
        ))}
        <span className="absolute inset-y-0 left-0 rounded-full bg-[#78dc9a]" style={{ width: pct(time) }} />
      </div>
      {closes.map((c) => (
        <span
          key={c.t}
          title={`App closed at ${clock(c.t)}`}
          className="absolute top-[24px] h-3.5 w-1 -translate-x-1/2 rounded-full bg-[#ffb4ab]"
          style={{ left: pct(c.t) }}
        />
      ))}
      <span
        className="absolute top-[22px] h-[18px] w-1 -translate-x-1/2 rounded-full bg-[#78dc9a] shadow-[0_0_0_3px_#1c211e]"
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
          className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded-lg bg-[#313633] px-2 py-0.5 font-mono text-xs text-[#e0e3de] tabular-nums"
          style={{ left: pct(hover) }}
        >
          {clock(hover)}
        </span>
      )}
    </div>
  )
}
