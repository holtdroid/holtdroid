import { CheckIcon, ClapperboardIcon, DownloadIcon, Loader2Icon } from "lucide-react"
import { useRef, useState } from "react"
import type { RecordingManifest, RecordingMarker, RecordingView } from "@/api/client"
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
import { download } from "@/lib/adb"
import { formatBytes, formatDuration } from "@/lib/format"
import { bake, bakeFps, type BakeProgress, canSaveToFile, openSink, type Sink } from "@/lib/recording/bake"
import { type SceneApp, sceneLayout } from "@/lib/recording/scene"
import { clock, segmentsOf, type Telemetry } from "@/lib/recording/timeline"

type Stage =
  | { kind: "idle" }
  | { kind: "running"; progress: Omit<BakeProgress, "canvas"> | null }
  | { kind: "done"; file: Blob | null; size: number; elapsed: number }
  | { kind: "failed"; message: string }

function ticks(duration: number) {
  const steps = [10_000, 30_000, 60_000, 300_000, 600_000, 1_800_000, 3_600_000]
  const step = steps.find((s) => duration / s <= 8) ?? 3_600_000
  const out: number[] = []
  for (let t = step; t < duration; t += step) out.push(t)
  return out
}

export function BakeDialog({
  onClose,
  recording,
  manifest,
  telemetry,
  app,
  markers,
}: {
  onClose: () => void
  recording: RecordingView
  manifest: RecordingManifest
  telemetry: Telemetry
  app: SceneApp
  markers: RecordingMarker[]
}) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" })
  const abort = useRef<AbortController | null>(null)
  const preview = useRef<HTMLCanvasElement>(null)
  const name = `${recording.package}-${recording.id}.mp4`
  const duration = manifest.duration
  const segments = segmentsOf(manifest)
  const layout = sceneLayout(manifest)

  const start = async () => {
    let sink: Sink
    try {
      sink = await openSink(name)
    } catch {
      return
    }
    const ctrl = new AbortController()
    abort.current = ctrl
    setStage({ kind: "running", progress: null })
    bake({
      filesUrl: recording.filesUrl,
      manifest,
      telemetry,
      app,
      markers,
      sink,
      signal: ctrl.signal,
      onProgress: ({ canvas, ...p }) => {
        const ctx = preview.current?.getContext("2d")
        ctx?.drawImage(canvas, 0, 0, preview.current!.width, preview.current!.height)
        setStage({ kind: "running", progress: p })
      },
    })
      .then(async () => {
        const file = await sink.file()
        if (file) download(file, name)
        setStage((s) => ({
          kind: "done",
          file,
          size: file?.size ?? sink.size(),
          elapsed: s.kind === "running" ? (s.progress?.elapsed ?? 0) : 0,
        }))
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) setStage({ kind: "idle" })
        else setStage({ kind: "failed", message: e instanceof Error ? e.message : String(e) })
      })
  }

  const close = () => {
    abort.current?.abort()
    onClose()
  }

  const p = stage.kind === "running" ? stage.progress : null
  const done = stage.kind === "done" ? duration : (p?.t ?? 0)
  const fraction = duration > 0 ? done / duration : 0
  const speed = p && p.elapsed > 0 ? p.t / p.elapsed : 0
  const eta = p && speed > 0 ? (duration - p.t) / speed : 0

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Download as a video</DialogTitle>
          <DialogDescription>
            The recording is rendered here in your browser with the logcat, device and network panels, at {layout.width}
            ×{layout.height} and {bakeFps} fps. Keep this tab open until it finishes.{" "}
            {canSaveToFile()
              ? "You pick where to save it first, and it is written to that file as it goes, so it doesn't fill the memory."
              : "This browser can't write to a file you pick, so the video is collected in its private storage and downloaded at the end."}
          </DialogDescription>
        </DialogHeader>

        <div className="relative overflow-hidden rounded-lg border bg-black">
          <canvas
            ref={preview}
            width={960}
            height={Math.round((960 * layout.height) / layout.width)}
            className="block w-full"
            style={{ aspectRatio: `${layout.width} / ${layout.height}` }}
          />
          {stage.kind === "idle" && (
            <div className="text-muted-foreground absolute inset-0 grid place-items-center text-sm">
              <ClapperboardIcon className="size-10 opacity-60" />
            </div>
          )}
        </div>

        <div className="grid gap-1.5">
          <div className="bg-muted relative h-3 overflow-hidden rounded-full">
            {segments.map((s) => (
              <span
                key={s.file}
                className="absolute inset-y-0 bg-zinc-400/30"
                style={{ left: `${(s.start / duration) * 100}%`, width: `${(s.duration / duration) * 100}%` }}
              />
            ))}
            <span
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-600 to-emerald-400 transition-[width] duration-200"
              style={{ width: `${fraction * 100}%` }}
            />
          </div>
          <div className="text-muted-foreground relative h-4 font-mono text-[11px] tabular-nums">
            <span className="absolute left-0">0:00</span>
            {ticks(duration).map((t) => (
              <span key={t} className="absolute -translate-x-1/2" style={{ left: `${(t / duration) * 100}%` }}>
                {clock(t)}
              </span>
            ))}
            <span className="absolute right-0">{clock(duration)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium tabular-nums">{Math.floor(fraction * 100)}%</span>
            {stage.kind === "running" && p && (
              <>
                <span className="text-muted-foreground font-mono tabular-nums">
                  {clock(p.t)} of {clock(duration)}
                </span>
                {speed > 0 && <span className="text-muted-foreground">{speed.toFixed(1)}× real time</span>}
                {eta > 0 && <span className="text-muted-foreground">about {formatDuration(eta)} left</span>}
              </>
            )}
            {stage.kind === "done" && (
              <span className="text-muted-foreground inline-flex items-center gap-1">
                <CheckIcon className="size-4 text-emerald-500" />
                {stage.file ? "" : "Saved to your file: "}
                {formatBytes(stage.size)} in {formatDuration(stage.elapsed)}
              </span>
            )}
          </div>
        </div>

        {stage.kind === "failed" && (
          <Alert variant="destructive">
            <AlertDescription>Rendering failed: {stage.message}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {stage.kind === "running" ? "Cancel" : "Close"}
          </Button>
          {stage.kind === "done" ? (
            stage.file ? (
              <Button onClick={() => download(stage.file!, name)}>
                <DownloadIcon />
                Save again
              </Button>
            ) : null
          ) : (
            <Button disabled={stage.kind === "running"} onClick={() => void start()}>
              {stage.kind === "running" ? <Loader2Icon className="animate-spin" /> : <ClapperboardIcon />}
              {stage.kind === "running" ? "Rendering…" : stage.kind === "failed" ? "Try again" : "Render"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
