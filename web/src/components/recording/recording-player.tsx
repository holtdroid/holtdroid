import {
  ClapperboardIcon,
  FileTextIcon,
  MaximizeIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "lucide-react"
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type { RecordingDetail, RecordingManifest } from "@/api/client"
import { type RecordingSource, useRecordingEvents } from "@/api/queries"
import { BakeDialog } from "@/components/recording/bake-dialog"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { bakingSupported } from "@/lib/recording/bake"
import { Player } from "@/lib/recording/player"
import { loadIcon, type SceneApp } from "@/lib/recording/scene"
import { clock, segmentsOf, Telemetry } from "@/lib/recording/timeline"

const rates = [0.5, 1, 2, 4]

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
  const [player] = useState(() => new Player(r.filesUrl, manifest, telemetry, app))
  const state = useSyncExternalStore(player.subscribe, player.getState)
  const [baking, setBaking] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => player.update(manifest, telemetry), [player, manifest, telemetry])
  useEffect(() => () => player.dispose(), [player])

  const onKey = (e: KeyboardEvent) => {
    if (e.key === " " || e.key === "k") player.toggle()
    else if (e.key === "ArrowLeft") void player.seek(state.time - 5000)
    else if (e.key === "ArrowRight") void player.seek(state.time + 5000)
    else return
    e.preventDefault()
  }

  return (
    <div className="grid gap-3">
      <div
        ref={box}
        tabIndex={0}
        onKeyDown={onKey}
        className="group/player relative overflow-hidden rounded-xl border bg-black outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
      >
        <canvas
          ref={(c) => {
            player.attach(c)
            return () => player.attach(null)
          }}
          onClick={() => player.toggle()}
          className="block aspect-video w-full cursor-pointer"
        />
        {!state.playing && (
          <button
            type="button"
            aria-label="Play"
            onClick={() => player.play()}
            className="absolute inset-0 m-auto grid size-16 place-items-center rounded-full bg-black/60 text-white opacity-90 backdrop-blur transition hover:scale-105"
          >
            <PlayIcon className="size-7 translate-x-0.5" />
          </button>
        )}
      </div>

      <Timeline
        duration={state.duration}
        time={state.time}
        manifest={manifest}
        telemetry={telemetry}
        onSeek={(t) => void player.seek(t)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Back 5 seconds"
          onClick={() => void player.seek(state.time - 5000)}
        >
          <SkipBackIcon />
        </Button>
        <Button size="sm" onClick={() => player.toggle()} className="w-24">
          {state.playing ? <PauseIcon /> : <PlayIcon />}
          {state.playing ? "Pause" : "Play"}
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Forward 5 seconds"
          onClick={() => void player.seek(state.time + 5000)}
        >
          <SkipForwardIcon />
        </Button>
        <span className="text-muted-foreground font-mono text-sm tabular-nums">
          {clock(state.time)} / {clock(state.duration)}
        </span>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={String(state.rate)}
          onValueChange={(v) => v && player.setRate(Number(v))}
        >
          {rates.map((x) => (
            <ToggleGroupItem key={x} value={String(x)} className="px-2 font-mono text-xs">
              {x}×
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={r.logcatUrl} download>
              <FileTextIcon />
              Logcat
            </a>
          </Button>
          {!detail.shared && bakingSupported() && (
            <Button variant="outline" size="sm" disabled={r.state === "recording"} onClick={() => setBaking(true)}>
              <ClapperboardIcon />
              Download video
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Full screen"
            onClick={() => void box.current?.requestFullscreen().catch(() => undefined)}
          >
            <MaximizeIcon />
          </Button>
        </div>
      </div>
      {baking && (
        <BakeDialog
          onClose={() => setBaking(false)}
          recording={r}
          manifest={manifest}
          telemetry={telemetry}
          app={app}
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
  onSeek,
}: {
  duration: number
  time: number
  manifest: RecordingManifest
  telemetry: Telemetry
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
      className="group/timeline relative h-6 cursor-pointer touch-none select-none"
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
      <div className="bg-muted absolute inset-x-0 top-2.5 h-1.5 overflow-hidden rounded-full">
        {segments.map((s) => (
          <span
            key={s.file}
            className="absolute inset-y-0 bg-zinc-400/40"
            style={{ left: pct(s.start), width: pct(s.duration) }}
          />
        ))}
        <span className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: pct(time) }} />
      </div>
      {closes.map((c) => (
        <span
          key={c.t}
          title={`App closed at ${clock(c.t)}`}
          className="absolute top-1.5 h-3.5 w-0.5 rounded bg-red-500"
          style={{ left: pct(c.t) }}
        />
      ))}
      <span
        className="absolute top-1 size-4 -translate-x-1/2 rounded-full border-2 border-white bg-emerald-500 shadow"
        style={{ left: pct(time) }}
      />
      {hover !== null && (
        <span
          className="bg-popover text-popover-foreground pointer-events-none absolute -top-7 -translate-x-1/2 rounded border px-1.5 py-0.5 font-mono text-xs tabular-nums shadow"
          style={{ left: pct(hover) }}
        >
          {clock(hover)}
        </span>
      )}
    </div>
  )
}
