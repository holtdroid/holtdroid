export type Lang = "en" | "ru" | "uk"

export type Text = Record<Lang, string>

export type Page = "home" | "session" | "recordings" | "recording" | "computers"

export type Dialog = "none" | "launch" | "upload"

export type Panel =
  | "none"
  | "app"
  | "network"
  | "gps"
  | "ssh"
  | "display"
  | "clipboard"
  | "battery"
  | "language"
  | "time"
  | "recording"
  | "device"
  | "versions"
  | "quick"

export type Tab =
  | "devtools"
  | "pixel-perfect"
  | "websockets"
  | "cache"
  | "images"
  | "svg"
  | "network"
  | "dns"
  | "routes"
  | "logcat"
  | "files"
  | "terminal"

export type StartState =
  | "provisioning"
  | "booting"
  | "installing"
  | "restoring"
  | "instrumenting"
  | "ready"
  | "stopping"

export type PortalState = {
  page: Page
  dialog: Dialog
  panel: Panel
  toast:
    | "none"
    | "crash"
    | "uploaded"
    | "saved"
    | "bundle"
    | "copied"
    | "link"
    | "rec-link"
    | "installing"
    | "installed"

  launchStage: "provider" | "options"
  provider: "emulator" | "physical"
  android: "13" | "14" | "15" | "16"
  screen: "pixel" | "small" | "tablet"
  webview: "builtin" | "stable" | "beta"
  location: "none" | "nl" | "kz" | "us" | "pl"
  appData: "fresh" | "saved"
  cache: boolean
  record: boolean

  uploadFile: boolean
  uploadNote: string
  uploadPrivate: boolean
  uploadProgress: number
  uploaded: boolean

  search: string
  sessions: number
  idleMinutes: number

  start: StartState
  version: "2.4.0" | "2.3.1" | "2.5.0-rc1"
  keepData: boolean
  appRunning: boolean
  tab: Tab

  devtools: "elements" | "console" | "network"
  request: "none" | "catalog" | "cart" | "price"
  socket: "none" | "price" | "order"

  network: "full" | "lte" | "hspa" | "edge" | "subway"
  locationBusy: boolean
  geo: "amsterdam" | "almaty" | "warsaw"
  route: boolean
  clipboardMode: "both" | "to" | "from"
  phoneText: string
  locale: "en" | "uk" | "de"
  timeZone: "amsterdam" | "almaty" | "newyork"
  dark: boolean
  battery: number
  saver: boolean

  deeplink: string
  cameraGranted: boolean
  notificationsGranted: boolean
  dataCleared: boolean

  logScope: "app" | "all"
  logLevel: "verbose" | "error"
  crashed: boolean

  filesRoot: "shared" | "app" | "tmp"
  filesFolder: "" | "shared_prefs" | "Download"
  fileUploaded: boolean

  ppReference: boolean
  ppOpacity: number
  ppCompare: boolean
  ppIssue: number

  recording: boolean
  markers: number
  recTime: number
  recPlaying: boolean
  recTab: "logcat" | "network" | "console"

  bundling: number

  terminal: number
  computerOnline: boolean
  portPublished: boolean
  phoneUrl: "app" | "dev"
}

export type TextKey = { [K in keyof PortalState]: string extends PortalState[K] ? K : never }[keyof PortalState]

export type Step = {
  text: Text
  target?: string
  action?: "click" | "hover" | "type" | "look"
  set?: Partial<PortalState>
  type?: { key: TextKey; value: string }
  hold?: number
}

export type Scenario = {
  initial?: Partial<PortalState>
  height?: number
  steps: Step[]
}
