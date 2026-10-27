import { type Display, sessionBase, type UIHierarchy } from "@/api/client"
import type { LiveScreen } from "@/components/session/live-screen"
import { probeViews } from "@/lib/pixel-perfect/elements"
import { probeWebViews, type WebViewProbe } from "@/lib/pixel-perfect/webview"
import type { Player } from "@/lib/recording/player"

/** Where Pixel perfect gets the screen from: a live session or a recording. */
export type ScreenSource = {
  kind: "session" | "recording"
  /** The screen as it is shown now. */
  snapshot(): Promise<Blob>
  /** The best picture to compare: a lossless screenshot where the device is there to take one. */
  screenshot(): Promise<Blob | null>
  /** count pictures gap ms apart, for the motion mask. */
  burst(count: number, gap: number): Promise<Blob[]>
  /** The native views on the screen; only a live device has them. */
  views?: () => Promise<UIHierarchy>
  /** The WebView pages on the screen through DevTools; only a live device has them. */
  webviews?: () => Promise<WebViewProbe[]>
}

/** What the screen belongs to, for uploads and reports. */
export type PixelTarget = {
  package: string
  label?: string
  versionName?: string
  display?: Display
  /** Where in a recording the compared frame is, for the report. */
  moment?: () => string
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function sessionSource(live: LiveScreen, provider: string, id: string): ScreenSource {
  const snapshot = async () => {
    const blob = await live.connection?.snapshot()
    if (!blob) throw new Error("The screen isn't connected")
    return blob
  }
  return {
    kind: "session",
    snapshot,
    async screenshot() {
      const r = await fetch(`${sessionBase(provider, id)}/v1/device/screenshot`)
      if (!r.ok) throw new Error(`Screenshot failed (${r.status})`)
      return r.blob()
    },
    async burst(count, gap) {
      const out: Blob[] = []
      for (let i = 0; i < count; i++) {
        if (i > 0) await sleep(gap)
        out.push(await snapshot())
      }
      return out
    },
    views: () => probeViews(provider, id),
    webviews: () => probeWebViews(provider, id),
  }
}

/** A recording's frame at the playhead; comparing it pauses playback. */
export function recordingSource(player: Player): ScreenSource {
  const snapshot = async () => {
    player.pause()
    const blob = await player.still()
    if (!blob) throw new Error("The recording has no frame here yet")
    return blob
  }
  return {
    kind: "recording",
    snapshot,
    screenshot: () => Promise.resolve(null),
    burst: (count, gap) => player.stills(count, gap),
  }
}
