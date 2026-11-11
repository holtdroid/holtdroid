import type { View } from "../../guides/showcase"
import type { PortalState } from "../../guides/types"
import type { IconName } from "../dock/icons"
import type { Frame } from "./Scene"

export const hero: { frames: Frame[]; narrow: View[] } = {
  frames: [
    {
      label: "01 Configure",
      hold: 1500,
      state: { dialog: "launch", android: "16", webview: "builtin", location: "none" },
    },
    { label: "01 Configure", hold: 1500, state: { location: "nl", webview: "beta" } },
    { label: "01 Configure", hold: 1500, state: { android: "15", record: true } },
    {
      label: "02 Boot",
      hold: 1000,
      state: { dialog: "none", page: "session", sessions: 1, start: "provisioning" },
    },
    { label: "02 Boot", hold: 1000, state: { start: "booting" } },
    { label: "02 Boot", hold: 1000, state: { start: "installing" } },
    { label: "02 Boot", hold: 1000, state: { start: "instrumenting" } },
    {
      label: "03 Debug",
      hold: 2000,
      state: { start: "ready", tab: "devtools", devtools: "network", request: "none" },
    },
    { label: "03 Debug", hold: 5200, state: { request: "catalog" } },
  ],
  narrow: [
    [90, 58, 680, 640],
    [325, 90, 530, 499],
    [300, 100, 560, 527],
  ],
}

export const recording: { frames: Frame[]; narrow: View } = {
  frames: [
    { hold: 1400, state: { page: "recording", sessions: 1, recTab: "findings", markers: 0, recPlaying: true } },
    { hold: 1200, state: { markers: 1 } },
    { hold: 1200, state: { markers: 2 } },
    { hold: 1600, state: { recTab: "network" } },
    { hold: 2500, state: { toast: "rec-link" } },
  ],
  narrow: [229, 40, 950, 620],
}

export function cumulate(frames: Frame[]): Partial<PortalState>[] {
  const out: Partial<PortalState>[] = []
  for (const f of frames) out.push({ ...out.at(-1), ...f.state })
  return out
}

export type Vignette = "vpn" | "network" | "clipboard" | "appdata" | "quick" | "logcat"

export type Tile = {
  title: string
  text: string
  href: string
  size: "xl" | "l" | "m" | "s"
  scene?: { state: Partial<PortalState>; view: View; label: string }
  vignette?: Vignette
  wipe?: boolean
}

const ready: Partial<PortalState> = { page: "session", sessions: 1, start: "ready" }

export const bento: Tile[] = [
  {
    title: "The screen, in the tab",
    text: "Streamed with scrcpy and decoded by WebCodecs: H.264 by default, H.265 or AV1 where the browser decodes them, up to 1080p, with the device's audio and a USB keyboard that types in any layout.",
    href: "/start/introduction/",
    size: "xl",
    scene: { state: ready, view: [17, 100, 590, 540], label: "A device's screen with its controls" },
  },
  {
    title: "DevTools for every WebView",
    text: "Debugging is switched on at runtime, so the APK is installed exactly as shipped. Elements, console and network for every WebView in the app.",
    href: "/concepts/devtools/",
    size: "l",
    scene: {
      state: { ...ready, tab: "devtools", devtools: "console" },
      view: [603, 104, 566, 540],
      label: "Chrome DevTools console next to the screen",
    },
  },
  {
    title: "A country per device",
    text: "Where VPN locations are configured, each device reaches the internet through its own. Switch it from the session without restarting.",
    href: "/concepts/vpn/",
    size: "s",
    vignette: "vpn",
  },
  {
    title: "Bad networks on purpose",
    text: "Networks from 5G down to GPRS, a region's round trips to CDNs, and scenarios like a subway ride. Emulator sessions with a VPN location.",
    href: "/session-tools/network/",
    size: "s",
    vignette: "network",
  },
  {
    title: "Clipboard both ways",
    text: "Copy on your computer, paste on the device, and back. Or only one way.",
    href: "/guides/conditions/clipboard/",
    size: "s",
    vignette: "clipboard",
  },
  {
    title: "DNS, routes and WebSockets",
    text: "Every lookup with rewrites to your own addresses, every connection with its country and network, every socket frame taken apart.",
    href: "/session-tools/dns/",
    size: "m",
    scene: {
      state: { ...ready, tab: "dns", dnsQuery: "api" },
      view: [603, 104, 566, 330],
      label: "The DNS log of a session",
    },
  },
  {
    title: "Pixel perfect",
    text: "Lay the design mockup over the screen, find where the app differs and export a report.",
    href: "/session-tools/pixel-perfect/",
    size: "m",
    wipe: true,
    scene: {
      state: { ...ready, tab: "pixel-perfect", ppReference: true, ppOpacity: 50, ppCompare: true, ppIssue: 1 },
      view: [305, 104, 864, 540],
      label: "A design mockup laid over the screen with the differences found",
    },
  },
  {
    title: "App data saves",
    text: "Save the app's sign-in, settings and WebView storage, and start the next session already logged in.",
    href: "/concepts/app-data/",
    size: "s",
    vignette: "appdata",
  },
  {
    title: "One-click launch, deep links",
    text: "⚡ repeats your last launch. In a session, the App row opens deep links, grants permissions and clears data.",
    href: "/guides/first-steps/quick-launch/",
    size: "s",
    vignette: "quick",
  },
  {
    title: "Logcat, files, terminal",
    text: "Logcat for the app or the whole device, a notice when it crashes, the app's files, and a shell next to the screen.",
    href: "/session-tools/logcat/",
    size: "s",
    vignette: "logcat",
  },
]

export const kept: { text: string; tone: "ok" | "mu" | "in" | "er" | "wa" | "vi" }[] = [
  { text: "Screen and taps", tone: "ok" },
  { text: "Logcat of the whole device", tone: "mu" },
  { text: "WebView network with bodies", tone: "in" },
  { text: "Console and exceptions", tone: "er" },
  { text: "WebSocket messages", tone: "in" },
  { text: "DNS and connections", tone: "in" },
  { text: "VPN location and network conditions", tone: "wa" },
  { text: "CPU, memory and frames", tone: "vi" },
]

export const recordingLinks = {
  primary: { label: "Record and share", href: "/guides/recordings/record-share/" },
  secondary: { label: "Bug report guide", href: "/guides/recordings/bug-report/" },
  text: { label: "Recordings", href: "/concepts/recordings/" },
}

export const more: { icon: IconName; title: string; text: string; href: string }[] = [
  {
    icon: "layers",
    title: "Any WebView version",
    text: "Start with a Chromium build of the milestone a bug was reported on.",
    href: "/concepts/webview-versions/",
  },
  {
    icon: "camera",
    title: "Camera and microphone",
    text: "A test card or your own camera, a test signal or your own mic.",
    href: "/concepts/camera/",
  },
  {
    icon: "globe",
    title: "Device settings",
    text: "Language, time zone, dark theme, battery.",
    href: "/guides/conditions/device-settings/",
  },
  {
    icon: "wifi",
    title: "Cache and CDN findings",
    text: "How the WebViews' requests use the HTTP cache and a CDN.",
    href: "/session-tools/cache/",
  },
  {
    icon: "rocket",
    title: "Switch the app's version",
    text: "Another build on the running device, with or without its data.",
    href: "/guides/app/switch-version/",
  },
  {
    icon: "bug",
    title: "Crash to error line",
    text: "From the crash notice to the exact error in logcat.",
    href: "/guides/app/crash/",
  },
  {
    icon: "chart",
    title: "Limits and idle timeout",
    text: "Bounded devices, idle ones reclaimed, one click to extend.",
    href: "/guides/first-steps/limits/",
  },
  {
    icon: "chrome",
    title: "Holtdroid WebView",
    text: "A WebView test browser with DevTools unlocked.",
    href: "/tools/webview/",
  },
]

export const compare: { topic: string; usual: string; here: string }[] = [
  {
    topic: "A device",
    usual: "A phone on your desk, or an emulator on your machine",
    here: "Android 11–16 in a browser tab, launched from the build's row",
  },
  {
    topic: "DevTools",
    usual: "A USB cable, developer options, chrome://inspect, and a build with WebView debugging on",
    here: "Switched on at runtime for every WebView; the APK is installed as shipped",
  },
  {
    topic: "A WebView version",
    usual: "Whatever the device ships",
    here: "The built-in one or a Chromium build picked at launch",
  },
  {
    topic: "A country",
    usual: "A VPN app on the phone",
    here: "A VPN location per device, picked at launch or switched live",
  },
  {
    topic: "A bad network",
    usual: "Hope the train goes into a tunnel",
    here: "Network presets and scenarios like a subway ride",
  },
  {
    topic: "Sharing the bug",
    usual: "A screen recording and pasted logs",
    here: "One recording link with network, logcat and markers",
  },
  {
    topic: "Getting a build",
    usual: "Downloading from chat and sideloading",
    here: "Slack, S3 and GitHub builds already on the Apps page",
  },
]

export const operate: { icon?: IconName; title: string; text: string; chips?: string[] }[] = [
  {
    title: "Android in containers",
    text: "redroid on the node's own kernel, several devices per node, with ARM translation for 64-bit ARM builds.",
  },
  {
    icon: "phone",
    title: "Real phones too",
    text: "USB phones on a small host join the same portal, with or without root.",
  },
  {
    icon: "server",
    title: "A fair line",
    text: "Slots per node and per provider. When every device is busy, a launch waits in line; idle devices are reclaimed.",
  },
  {
    icon: "shield",
    title: "Sign-in your way",
    text: "Anonymous animal names, a shared password, OIDC, a forward-auth proxy, or users with passkeys and invite links.",
    chips: ["anonymous", "password", "oidc", "header", "users"],
  },
  {
    icon: "chart",
    title: "Observable",
    text: "Prometheus metrics, OpenTelemetry traces and audit events to stdout, OTLP or a webhook.",
  },
  {
    icon: "key",
    title: "No lock-in",
    text: "Secrets from env, files or OpenBao. Storage on disk or S3. Any VPN that sing-box speaks.",
  },
]

export const operateLinks = [
  { label: "Installation", href: "/start/installation/", primary: true },
  { label: "Configuration", href: "/configuration/overview/" },
  { label: "Architecture", href: "/concepts/architecture/" },
]

export const developerLinks = [
  { label: "Connect your computer", href: "/guides/developers/connect-computer/", primary: true },
  { label: "How it works", href: "/concepts/ssh/" },
]

export const ticker = [
  "scrcpy screen",
  "WebView DevTools",
  "Clipboard sync",
  "VPN per device",
  "Network conditions",
  "Recordings",
  "App data saves",
  "Pixel perfect",
  "Logcat",
  "DNS",
  "Routes",
  "WebSockets",
  "Cache",
  "Files",
  "Terminal",
  "Camera & microphone",
  "Real USB phones",
  "Passkeys",
  "Helm",
]

export const stats: { parts: (string | number)[]; label: string }[] = [
  { parts: [11, "–", 16], label: "Android versions, one image each" },
  { parts: ["0"], label: "bytes changed in your APK" },
  { parts: ["~", 35, " s"], label: "to a freshly booted device" },
  { parts: [45, " fps"], label: "screen by default, up to 60" },
  { parts: [30, " min"], label: "idle before a device is reclaimed, by default" },
]
