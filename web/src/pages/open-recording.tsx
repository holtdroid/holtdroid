import { Link } from "@tanstack/react-router"
import { ArchiveIcon, FolderOpenIcon, ShieldCheckIcon } from "lucide-react"
import { type DragEvent, useEffect, useRef, useState } from "react"
import type { RecordingDetail } from "@/api/client"
import { RecordingPlayer } from "@/components/recording/recording-player"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { type Bundle, bundleExtension, BundleError, openBundle } from "@/lib/recording/bundle"
import { cn } from "@/lib/utils"
import logo from "@/logo.svg"
import { Title } from "@/pages/recording"

type State =
  | { kind: "idle" }
  | { kind: "loading"; name: string }
  | { kind: "ready"; bundle: Bundle; name: string }
  | { kind: "failed"; message: string }

/** Plays a .holtdroid file from disk: nothing is uploaded, and the file is read piece by piece. */
export function OpenRecordingPage() {
  const [state, setState] = useState<State>({ kind: "idle" })
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const icon = useRef<string | undefined>(undefined)

  useEffect(
    () => () => {
      if (icon.current) URL.revokeObjectURL(icon.current)
    },
    [],
  )

  const open = async (file: File | undefined) => {
    if (!file) return
    if (icon.current) URL.revokeObjectURL(icon.current)
    icon.current = undefined
    setState({ kind: "loading", name: file.name })
    try {
      const bundle = await openBundle(file)
      icon.current = bundle.iconUrl
      setState({ kind: "ready", bundle, name: file.name })
    } catch (e) {
      setState({
        kind: "failed",
        message:
          e instanceof BundleError
            ? e.message
            : `Could not read the file: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    void open(e.dataTransfer.files[0])
  }

  const picker = (
    <>
      <input
        ref={input}
        type="file"
        accept={`${bundleExtension},.zip`}
        className="hidden"
        onChange={(e) => {
          void open(e.target.files?.[0])
          e.target.value = ""
        }}
      />
      <Button onClick={() => input.current?.click()}>
        <FolderOpenIcon />
        {state.kind === "ready" ? "Open another file" : "Choose a file"}
      </Button>
    </>
  )

  const detail: RecordingDetail | null =
    state.kind === "ready"
      ? {
          recording: state.bundle.recording,
          markers: state.bundle.markers,
          manifest: state.bundle.manifest,
          shared: false,
        }
      : null

  return (
    <div
      className="flex h-dvh flex-col overflow-y-auto lg:overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
      onDrop={onDrop}
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        {state.kind === "ready" ? (
          <Title r={state.bundle.recording} back={false} />
        ) : (
          <span className="font-medium">Open a recording file</span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {state.kind === "ready" && picker}
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src={logo} alt="" className="size-6" />
            Holtdroid
          </Link>
        </div>
      </header>
      <div className="min-h-0 flex-1 p-2 lg:p-3">
        {state.kind === "ready" && detail ? (
          <RecordingPlayer
            key={`${state.name}-${state.bundle.size}`}
            source={{
              kind: "local",
              id: state.bundle.recording.id,
              files: state.bundle.files,
              manifest: state.bundle.manifest,
            }}
            detail={detail}
            manifest={state.bundle.manifest}
          />
        ) : (
          <div
            className={cn(
              "grid h-full min-h-72 place-items-center rounded-3xl border-2 border-dashed p-8 text-center transition-colors",
              over ? "border-emerald-500 bg-emerald-500/5" : "border-border",
            )}
          >
            {state.kind === "loading" ? (
              <div className="grid justify-items-center gap-3">
                <Spinner className="size-6" />
                <p className="text-muted-foreground text-sm">Reading {state.name}…</p>
              </div>
            ) : (
              <div className="grid max-w-md justify-items-center gap-4">
                <ArchiveIcon className="text-muted-foreground size-12" />
                <div className="grid gap-1">
                  <h1 className="text-lg font-semibold">Drop a {bundleExtension} file here</h1>
                  <p className="text-muted-foreground text-sm">
                    A recording downloaded from Holtdroid plays right in this browser, with its logcat, device state,
                    network, taps and markers.
                  </p>
                </div>
                {picker}
                {state.kind === "failed" && (
                  <Alert variant="destructive">
                    <AlertDescription>{state.message}</AlertDescription>
                  </Alert>
                )}
                <p className="text-muted-foreground flex items-start gap-2 text-left text-xs">
                  <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" />
                  Nothing is uploaded. The file is read piece by piece from your disk, so a big one doesn&apos;t fill
                  the memory.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
