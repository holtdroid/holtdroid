import { useMemo, useState } from "react"
import { SvgView } from "@/components/recording/svg-view"
import { useSvgReport } from "@/components/recording/use-audits"
import { ImageScanNotice, ImageScanSwitch } from "@/components/session/image-scan"
import { LiveToolbar } from "@/components/session/live-toolbar"
import { useLiveBodies, useLiveDevTools } from "@/components/session/use-live-devtools"
import type { ImageRequest } from "@/lib/recording/images"
import { svgSources } from "@/lib/recording/svgpaths"

const textTypes = new Set(["Script", "Document", "Stylesheet"])
const wantBody = (r: ImageRequest) =>
  !!r.end &&
  !r.error &&
  (textTypes.has(r.resourceType ?? "") || r.mimeType === "image/svg+xml" || /\.svg(?:$|\?)/i.test(r.url))

/** The SVG tab of a session: the paths in the WebViews' scripts, pages, stylesheets, SVG files and inline SVGs. */
export function SvgPanel({ provider, id }: { provider: string; id: string }) {
  const [paused, setPaused] = useState(false)
  const [picked, setPicked] = useState<string>()
  const live = useLiveDevTools(provider, id, paused)
  const requests = useLiveBodies(provider, id, live.requests, wantBody, 200)
  const withBodies = requests.filter((r) => r.body)
  const inline = live.shots.filter((s) => s.svgs?.length)
  const sig = `${withBodies.map((r) => r.key).join("|")}#${inline.length}`
  const sources = useMemo(
    () =>
      svgSources(
        withBodies,
        inline.map((s) => ({ target: s.target, frame: s.frame, url: s.url ?? "", svgs: s.svgs ?? [] })),
      ),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [sig],
  )
  const report = useSvgReport(sources, true)

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
        {report.summary.paths} paths
      </LiveToolbar>
      <ImageScanNotice provider={provider} id={id} what="svg" />
      <div className="flex min-h-0 flex-1 flex-col">
        <SvgView
          report={report}
          picked={picked}
          onPick={setPicked}
          empty={
            paused
              ? "Paused."
              : "No SVG paths in what the app's WebViews loaded yet. Scripts, pages, stylesheets and SVG files are searched as they load, and the inline SVGs pages draw."
          }
        />
      </div>
    </div>
  )
}
