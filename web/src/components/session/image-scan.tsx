import { ScanSearchIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useImageScan } from "@/components/session/use-live-devtools"

/**
 * What the Images and SVG tabs miss while the image scan is off, with a way
 * to turn it on; once on, a quiet way to turn it off.
 */
export function ImageScanSwitch({ provider, id }: { provider: string; id: string }) {
  const scan = useImageScan(provider, id)
  if (scan.enabled === undefined) return null
  if (scan.enabled) {
    return (
      <button
        type="button"
        disabled={scan.pending}
        onClick={() => scan.set(false)}
        title="Stop running the image script in the app's pages"
        className="mr-2 text-xs text-muted-foreground hover:text-foreground"
      >
        Image scan on · turn off
      </button>
    )
  }
  return null
}

export function ImageScanNotice({ provider, id, what }: { provider: string; id: string; what: "images" | "svg" }) {
  const scan = useImageScan(provider, id)
  if (scan.enabled !== false) return null
  return (
    <div className="mx-4 mb-2 flex items-start gap-3 rounded-xl bg-stage-surface-container px-3 py-2.5 text-xs text-stage-on-surface-variant">
      <ScanSearchIcon className="mt-0.5 size-4 shrink-0 text-stage-outline" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm text-stage-on-surface">
          {what === "images"
            ? "This session doesn't check where its pages draw images"
            : "This session doesn't collect the pages' inline SVGs"}
        </p>
        <p>
          {what === "images"
            ? "Only the files themselves are checked: formats and compression. "
            : "Paths in scripts, pages, stylesheets and SVG files are still checked. "}
          The image scan runs a small script in the app's pages once a second. Turned on now, it sees what the pages
          show from here on; reload the page in the app to also check how it loads. To have it from the start, switch on{" "}
          <span className="text-stage-on-surface">Check how pages draw their images</span> when launching.
        </p>
      </div>
      <Button size="sm" variant="secondary" disabled={scan.pending} onClick={() => scan.set(true)}>
        Turn on
      </Button>
    </div>
  )
}
