import { useMemo, useState } from "react"
import { ImagesView } from "@/components/recording/images-view"
import { useImageReport } from "@/components/recording/use-audits"
import { ImageScanNotice, ImageScanSwitch } from "@/components/session/image-scan"
import { LiveToolbar } from "@/components/session/live-toolbar"
import { useLiveBodies, useLiveDevTools } from "@/components/session/use-live-devtools"
import { useNow } from "@/hooks/use-now"
import { wallClock } from "@/lib/format"
import { imageFormat, isImageRequest } from "@/lib/recording/images"

const wantBody = (r: Parameters<typeof isImageRequest>[0]) =>
  isImageRequest(r) && imageFormat(r.mimeType, r.url) !== "svg"

/** The Images tab of a session: the WebViews' images as they load, checked against how their pages draw them. */
export function ImagesPanel({ provider, id }: { provider: string; id: string }) {
  const [paused, setPaused] = useState(false)
  const [picked, setPicked] = useState<string>()
  const live = useLiveDevTools(provider, id, paused)
  const requests = useLiveBodies(provider, id, live.requests, wantBody, 300)
  const now = useNow(2000)
  const input = useMemo(
    () => ({ requests, shots: live.shots, kinds: live.kinds, now }),
    [requests, live.shots, live.kinds, now],
  )
  const report = useImageReport(input, true)

  return (
    <div className="devtools-skin flex h-full flex-col bg-background text-[12px]">
      <LiveToolbar
        paused={paused}
        onPause={() => setPaused((v) => !v)}
        onClear={() => {
          live.clear()
          setPicked(undefined)
        }}
      >
        <ImageScanSwitch provider={provider} id={id} />
        {report.summary.images} images
      </LiveToolbar>
      <ImageScanNotice provider={provider} id={id} what="images" />
      <div className="flex min-h-0 flex-1 flex-col">
        <ImagesView
          report={report}
          picked={picked}
          onPick={setPicked}
          wallClock={(ms) => wallClock(ms)}
          live
          empty={
            paused
              ? "Paused."
              : "No images in the app's WebViews yet. Everything they load during the session shows up here, also after a reload."
          }
        />
      </div>
    </div>
  )
}
