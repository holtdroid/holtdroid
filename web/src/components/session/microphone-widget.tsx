import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AudioLinesIcon, AudioWaveformIcon, type LucideIcon, MicIcon, MicOffIcon, WavesIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { agentClient, api, type Microphone, type MicrophoneSource, unwrap } from "@/api/client"
import { MediaLibrary } from "@/components/session/media-library"
import { CardLine, Note, Row, Section, ShadeCard, ShadeHeader, ShadePanel, ShadeRoot } from "@/components/session/shade"
import { HoverCardTrigger } from "@/components/ui/hover-card"
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
          kinds={["audio", "video"]}
          accept="audio/*,video/*"
          add="Add audio or video"
          note="A file plays on repeat; a video gives its sound."
          playing={m.source === "file" && !streaming ? m.mediaId : undefined}
          pending={set.isPending && set.variables?.source === "file" ? set.variables.mediaId : undefined}
          onPlay={(mediaId) => choose({ source: "file", mediaId })}
        />
        {m.error && <Note>The last source stopped: {m.error}</Note>}
      </ShadePanel>
    </ShadeRoot>
  )
}
