import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CameraIcon, CameraOffIcon, type LucideIcon, TvIcon, WebcamIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { agentClient, api, type Camera, type CameraSource, unwrap } from "@/api/client"
import { MediaLibrary } from "@/components/session/media-library"
import { CardLine, Note, Row, Section, ShadeCard, ShadeHeader, ShadePanel, ShadeRoot } from "@/components/session/shade"
import { HoverCardTrigger } from "@/components/ui/hover-card"
import { type BrowserCamera, cameraURL, openBrowserCamera } from "@/lib/camera"

type Card = Extract<CameraSource, "bars" | "black">
type Settable = Exclude<CameraSource, "browser">

const cards: Record<Card, { label: string; hint: string; icon: LucideIcon }> = {
  bars: { label: "Test card", hint: "Color bars with a running clock, to spot a frozen or late picture", icon: TvIcon },
  black: { label: "No picture", hint: "A black frame, as from a covered lens", icon: CameraOffIcon },
}

function summary(c: Camera, streaming: boolean) {
  if (streaming || c.source === "browser") return "Your camera"
  if (c.source === "file") return c.file ?? "Media file"
  return cards[c.source].label
}

function cameraKey(provider: string, id: string) {
  return ["camera", provider, id]
}

export function CameraWidget({ provider, id }: { provider: string; id: string }) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  const qc = useQueryClient()
  const state = useQuery({
    queryKey: cameraKey(provider, id),
    queryFn: () => unwrap(client.GET("/v1/camera")),
    refetchInterval: 5_000,
  })
  const set = useMutation({
    mutationFn: (body: { source: Settable; mediaId?: string }) =>
      unwrap(api.PUT("/api/v1/sessions/{provider}/{id}/camera", { params: { path: { provider, id } }, body })),
    onSuccess: (c) => qc.setQueryData(cameraKey(provider, id), c),
    onError: (e) => toast.error("Could not change the camera", { description: e.message }),
  })
  const browser = useRef<BrowserCamera | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [starting, setStarting] = useState(false)

  useEffect(() => () => browser.current?.stop(), [])

  const startBrowser = async () => {
    setStarting(true)
    try {
      browser.current = await openBrowserCamera(cameraURL(provider, id), (reason) => {
        browser.current = null
        setStreaming(false)
        if (reason) toast.error("Your camera stopped reaching the device", { description: reason })
        void qc.invalidateQueries({ queryKey: cameraKey(provider, id) })
      })
      setStreaming(true)
      void qc.invalidateQueries({ queryKey: cameraKey(provider, id) })
    } catch (e) {
      toast.error("Could not use your camera", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setStarting(false)
    }
  }

  const choose = (body: { source: Settable; mediaId?: string }) => {
    browser.current?.stop()
    set.mutate(body)
  }

  const c = state.data
  if (!c?.available) return null
  const source = streaming ? "browser" : c.source
  const label = summary(c, streaming)

  return (
    <ShadeRoot>
      <HoverCardTrigger asChild>
        <ShadeCard aria-label="Camera" changed={source !== "bars"}>
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <CameraIcon className="size-4 shrink-0 text-neutral-400" />
            <span className="truncate">Camera</span>
          </span>
          <CardLine icon={source === "browser" ? WebcamIcon : source === "black" ? CameraOffIcon : TvIcon}>
            {c.inUse ? `${label} · in use` : label}
          </CardLine>
        </ShadeCard>
      </HoverCardTrigger>
      <ShadePanel>
        <ShadeHeader
          title="Camera"
          summary={c.inUse ? `An app is looking: ${label.toLowerCase()}` : `Apps will see: ${label.toLowerCase()}`}
        />
        <Section title="Picture">
          {(Object.entries(cards) as [Card, (typeof cards)[Card]][]).map(([s, info]) => (
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
            icon={WebcamIcon}
            title="Your camera"
            onClick={() => (streaming ? choose({ source: "bars" }) : void startBrowser())}
          >
            {streaming ? "Apps see this browser's camera · click to stop" : "Apps see this browser's camera"}
          </Row>
        </Section>
        <MediaLibrary
          kinds={["image", "video"]}
          accept="image/*,video/*"
          add="Add an image or a video"
          note="An image stays on screen, a video plays on repeat; QR codes and documents work best as images."
          playing={c.source === "file" && !streaming ? c.mediaId : undefined}
          pending={set.isPending && set.variables?.source === "file" ? set.variables.mediaId : undefined}
          onPlay={(mediaId) => choose({ source: "file", mediaId })}
        />
        <Note>Nothing runs while no app has the camera open.</Note>
        {c.error && <Note>The last source stopped: {c.error}</Note>}
      </ShadePanel>
    </ShadeRoot>
  )
}
