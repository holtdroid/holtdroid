import type { View } from "../../guides/showcase"
import type { PortalState } from "../../guides/types"

export type Moment = {
  step: string
  title: string
  text: string
  href: string
  guide: string
  state: Partial<PortalState>
  view: View
}

export const hero: { state: Partial<PortalState>; view: View } = {
  state: { page: "session", sessions: 1, tab: "devtools", devtools: "network", request: "catalog" },
  view: [0, 0, 1180, 720],
}

export const moments: Moment[] = [
  {
    step: "01 · Launch",
    title: "Pick the exact device",
    text: "The Android version, a screen with its cutout, the WebView version and a country.",
    href: "/guides/first-steps/launch-app/",
    guide: "launch-app",
    state: { dialog: "launch" },
    view: [0, 0, 1180, 720],
  },
  {
    step: "02 · Session",
    title: "See what the app loads",
    text: "DevTools, network, logcat, DNS and routes next to the screen, on a slow network if you want.",
    href: "/guides/first-steps/session-tour/",
    guide: "session-tour",
    state: { page: "session", sessions: 1, tab: "logcat" },
    view: [0, 0, 1180, 720],
  },
  {
    step: "03 · Recording",
    title: "Hand over one link",
    text: "Video, taps, network and logcat on one timeline, with markers where things went wrong.",
    href: "/guides/recordings/record-share/",
    guide: "record-share",
    state: { page: "recording", sessions: 1, markers: 2 },
    view: [0, 0, 1180, 720],
  },
]
