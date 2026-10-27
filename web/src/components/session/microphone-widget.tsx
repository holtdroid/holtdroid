import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AudioLinesIcon,
  AudioWaveformIcon,
  FileMusicIcon,
  Loader2Icon,
  type LucideIcon,
  MicIcon,
  MicOffIcon,
  Trash2Icon,
  UploadIcon,
  VideoIcon,
  WavesIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { agentClient, api, type MediaView, type Microphone, type MicrophoneSource, unwrap } from "@/api/client"
import { useDeleteMedia, useMedia, useUploadMedia } from "@/api/queries"
import {
  CardLine,
  Note,
  Row,
  Section,
  ShadeButton,
  ShadeCard,
  ShadeHeader,
  ShadePanel,
  ShadeRoot,
} from "@/components/session/shade"
import { HoverCardTrigger } from "@/components/ui/hover-card"
import { formatBytes } from "@/lib/format"
import { type BrowserMicrophone, microphoneURL, openBrowserMicrophone } from "@/lib/microphone"
import { cn } from "@/lib/utils"

type Signal = Extract<MicrophoneSource, "off" | "tone" | "beeps" | "noise">

const signals: Record<Signal, { label: string; hint: string; icon: LucideIcon }> = {
  off: { label: "Off", hint: "The device's own microphone, which hears silence", icon: MicOffIcon },
  tone: { label: "Line-up tone", hint: "1 kHz at -18 dBFS, the broadcast test tone", icon: AudioWaveformIcon },
  beeps: { label: "Beeps", hint: "A short 1 kHz beep every second, to check delay", icon: AudioLinesIcon },
  noise: { label: "Pink noise", hint: "Steady noise across all frequencies", icon: WavesIcon },
}

function summary(m: Microphone) {
  switch (m.source) {
    case "file":
      return m.file ?? "Media file"
    case "browser":
      return "Your microphone"
    default:
      return signals[m.source].label
  }
}

function micKey(provider: string, id: string) {
  return ["microphone", provider, id]
}

export function MicrophoneWidget({ provider, id }: { provider: string; id: string }) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  const qc = useQueryClient()
  const state = useQuery({
    queryKey: micKey(provider, id),
    queryFn: () => unwrap(client.GET("/v1/microphone")),
    refetchInterval: 15_000,
  })
  const set = useMutation({
    mutationFn: (body: { source: Exclude<MicrophoneSource, "browser">; mediaId?: string }) =>
      unwrap(api.PUT("/api/v1/sessions/{provider}/{id}/microphone", { params: { path: { provider, id } }, body })),
    onSuccess: (m) => qc.setQueryData(micKey(provider, id), m),
    onError: (e) => toast.error("Could not change the microphone", { description: e.message }),
  })
  const browser = useRef<BrowserMicrophone | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [starting, setStarting] = useState(false)

  useEffect(() => () => browser.current?.stop(), [])

  const startBrowser = async () => {
    setStarting(true)
    try {
      browser.current = await openBrowserMicrophone(microphoneURL(provider, id), (reason) => {
        browser.current = null
        setStreaming(false)
        if (reason) toast.error("Your microphone stopped reaching the device", { description: reason })
        void qc.invalidateQueries({ queryKey: micKey(provider, id) })
      })
      setStreaming(true)
      void qc.invalidateQueries({ queryKey: micKey(provider, id) })
    } catch (e) {
      toast.error("Could not use your microphone", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setStarting(false)
    }
  }

  const choose = (body: { source: Exclude<MicrophoneSource, "browser">; mediaId?: string }) => {
    browser.current?.stop()
    set.mutate(body)
  }

  const m = state.data
  if (!m?.available) return null
  const source = streaming ? "browser" : m.source

  return (
    <ShadeRoot>
      <HoverCardTrigger asChild>
        <ShadeCard
          aria-label={source === "off" ? "Microphone" : "Turn the microphone off"}
          changed={source !== "off"}
          className={cn(source !== "off" && "cursor-pointer")}
          onClick={() => source !== "off" && choose({ source: "off" })}
        >
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <MicIcon className="size-4 shrink-0 text-neutral-400" />
            <span className="truncate">Microphone</span>
          </span>
          <CardLine icon={source === "off" ? MicOffIcon : source === "browser" ? MicIcon : AudioWaveformIcon}>
            {streaming ? "Your microphone" : summary(m)}
          </CardLine>
        </ShadeCard>
      </HoverCardTrigger>
      <ShadePanel>
        <ShadeHeader title="Microphone" summary={`What apps hear: ${streaming ? "your microphone" : summary(m)}`} />
        <Section title="Test signal">
          {(Object.entries(signals) as [Signal, (typeof signals)[Signal]][]).map(([s, info]) => (
            <Row
              key={s}
              selected={source === s}
              busy={set.isPending && set.variables?.source === s}
              icon={info.icon}
              title={info.label}
              onClick={() => choose({ source: s })}
            >
              {info.hint}
            </Row>
          ))}
        </Section>
        <Section title="Live">
          <Row
            selected={source === "browser"}
            busy={starting}
            icon={MicIcon}
            title="Your microphone"
            onClick={() => (streaming ? choose({ source: "off" }) : void startBrowser())}
          >
            {streaming ? "Apps hear this browser's microphone · click to stop" : "Apps hear this browser's microphone"}
          </Row>
        </Section>
        <MediaLibrary
          playing={m.source === "file" && !streaming ? m.mediaId : undefined}
          pending={set.isPending && set.variables?.source === "file" ? set.variables.mediaId : undefined}
          onPlay={(mediaId) => choose({ source: "file", mediaId })}
        />
        {m.error && <Note>The last source stopped: {m.error}</Note>}
      </ShadePanel>
    </ShadeRoot>
  )
}

function MediaLibrary({
  playing,
  pending,
  onPlay,
}: {
  playing?: string
  pending?: string
  onPlay: (id: string) => void
}) {
  const media = useMedia()
  const upload = useUploadMedia()
  const remove = useDeleteMedia()
  const input = useRef<HTMLInputElement>(null)
  const l = media.data
  if (!l?.enabled) return null

  const add = (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      upload.mutate(file, {
        onError: (e) => toast.error(`Could not add ${file.name}`, { description: e.message }),
      })
    }
  }

  return (
    <section className="grid gap-1.5">
      <div className="flex items-baseline justify-between px-1 text-xs text-neutral-400">
        <h4 className="font-medium">Media library</h4>
        <span className="tabular-nums">
          {formatBytes(l.used)}
          {l.quota > 0 && ` of ${formatBytes(l.quota)}`}
        </span>
      </div>
      {l.items.length > 0 && (
        <div className="grid gap-1 overflow-hidden rounded-3xl">
          {l.items.map((item) => (
            <MediaRow
              key={item.id}
              item={item}
              selected={item.id === playing}
              busy={item.id === pending}
              deleting={remove.isPending && remove.variables === item.id}
              onPlay={() => onPlay(item.id)}
              onDelete={() => remove.mutate(item.id)}
            />
          ))}
        </div>
      )}
      <ShadeButton disabled={upload.isPending} onClick={() => input.current?.click()}>
        {upload.isPending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
        Add audio or video
      </ShadeButton>
      <input
        ref={input}
        type="file"
        accept="audio/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          add(e.target.files)
          e.target.value = ""
        }}
      />
      <Note>A file plays on repeat; a video gives its sound. Up to {formatBytes(l.maxFileSize)} a file.</Note>
    </section>
  )
}

function MediaRow({
  item,
  selected,
  busy,
  deleting,
  onPlay,
  onDelete,
}: {
  item: MediaView
  selected: boolean
  busy: boolean
  deleting: boolean
  onPlay: () => void
  onDelete: () => void
}) {
  const Icon = item.kind === "video" ? VideoIcon : FileMusicIcon
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-md pr-2 transition-colors first:rounded-t-3xl last:rounded-b-3xl",
        selected ? "bg-sky-200 text-sky-950" : "bg-neutral-800 text-neutral-100 hover:bg-neutral-700",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left"
        onClick={onPlay}
      >
        {busy ? <Loader2Icon className="size-4 shrink-0 animate-spin" /> : <Icon className="size-4 shrink-0" />}
        <span className="grid min-w-0">
          <span className="truncate text-sm font-medium">{item.name}</span>
          <span className={cn("text-xs", selected ? "text-sky-900" : "text-neutral-400")}>
            {formatBytes(item.size)}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={`Delete ${item.name}`}
        disabled={deleting}
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-50",
          selected ? "hover:bg-sky-300" : "text-neutral-400 hover:bg-neutral-600 hover:text-neutral-100",
        )}
        onClick={onDelete}
      >
        {deleting ? <Loader2Icon className="size-4 animate-spin" /> : <Trash2Icon className="size-4" />}
      </button>
    </div>
  )
}
