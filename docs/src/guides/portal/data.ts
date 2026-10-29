import type { PortalState } from "../types"

export const defaults: PortalState = {
  page: "home",
  dialog: "none",
  panel: "none",
  toast: "none",

  launchStage: "provider",
  provider: "emulator",
  android: "16",
  screen: "pixel",
  webview: "stable",
  location: "nl",
  appData: "fresh",
  cache: false,
  record: false,

  uploadFile: false,
  uploadNote: "",
  uploadPrivate: false,
  uploadProgress: 0,
  uploaded: false,

  search: "",
  sessions: 0,
  idleMinutes: 14,

  start: "ready",
  version: "2.4.0",
  keepData: true,
  appRunning: true,
  tab: "devtools",

  devtools: "network",
  request: "none",
  socket: "none",

  network: "full",
  locationBusy: false,
  geo: "amsterdam",
  route: false,
  clipboardMode: "both",
  phoneText: "",
  locale: "en",
  timeZone: "amsterdam",
  dark: false,
  battery: 100,
  saver: false,

  deeplink: "",
  cameraGranted: false,
  notificationsGranted: true,
  dataCleared: false,

  logScope: "app",
  logLevel: "verbose",
  crashed: false,

  filesRoot: "app",
  filesFolder: "",
  fileUploaded: false,

  ppReference: false,
  ppOpacity: 50,
  ppCompare: false,
  ppIssue: 0,

  recording: false,
  markers: 0,
  recTime: 0,
  recPlaying: false,
  recTab: "logcat",

  bundling: 0,

  terminal: 0,
  computerOnline: false,
  portPublished: false,
  phoneUrl: "app",
}

export const app = {
  label: "Pinecone Shop",
  pkg: "com.example.pinecone",
  icon: `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="#0f766e"/><path d="M24 9c-6 7-10 13-10 19a10 10 0 0 0 20 0c0-6-4-12-10-19z" fill="#fbbf24"/><path d="M18 26h12M17 31h14M19 21h10" stroke="#92400e" stroke-width="2" stroke-linecap="round"/></svg>`,
  )}`,
}

const otherIcon = (bg: string, fg: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="${bg}"/><circle cx="24" cy="24" r="10" fill="${fg}"/></svg>`,
  )}`

export const otter = {
  label: "Otter Notes",
  pkg: "com.example.otter",
  version: "5.12.0",
  builds: 6,
  source: "slack",
  by: "maria",
  icon: otherIcon("#4338ca", "#c7d2fe"),
}

export const otherApps = [
  otter,
  {
    label: "Holtdroid WebView",
    pkg: "dev.holtdroid.webview",
    version: "1.8.2",
    builds: 3,
    source: "github",
    by: "",
    icon: otherIcon("#15803d", "#bbf7d0"),
  },
  {
    label: "Lynx Maps",
    pkg: "com.example.lynx",
    version: "0.9.4",
    builds: 2,
    source: "uploads",
    by: "oleh",
    icon: otherIcon("#b45309", "#fde68a"),
  },
]

export const locations = [
  { id: "nl", label: "Netherlands", flag: "🇳🇱", ip: "185.107.56.12", currency: "€", price: "24.90" },
  { id: "kz", label: "Kazakhstan", flag: "🇰🇿", ip: "91.198.40.7", currency: "₸", price: "12 990" },
  { id: "pl", label: "Poland", flag: "🇵🇱", ip: "37.120.211.88", currency: "zł", price: "107,00" },
  { id: "us", label: "United States", flag: "🇺🇸", ip: "45.83.91.140", currency: "$", price: "26.90" },
] as const

export function locationOf(id: PortalState["location"]) {
  return locations.find((l) => l.id === id)
}

export const networkProfiles = [
  {
    id: "full",
    name: "No emulation",
    detail: "The session's own network, nothing emulated.",
    numbers: "",
    scenario: false,
  },
  {
    id: "lte",
    name: "Typical 4G",
    detail: "About the worldwide median of a mobile connection.",
    numbers: "+60 ±15 ms · ↓ 12 Mbit/s ↑ 4 Mbit/s",
    scenario: false,
  },
  {
    id: "hspa",
    name: "3G",
    detail: "HSPA, still common in rural areas and as a fallback from 4G.",
    numbers: "+150 ±40 ms · ↓ 1.5 Mbit/s ↑ 512 kbit/s",
    scenario: false,
  },
  {
    id: "edge",
    name: "2G (EDGE)",
    detail: "Only 2G coverage: pages take tens of seconds.",
    numbers: "+400 ±100 ms · ↓ 200 kbit/s ↑ 100 kbit/s",
    scenario: false,
  },
  {
    id: "subway",
    name: "Subway",
    detail: "4G in stations, 3G between them, and tunnels with no signal for 5–20 seconds every minute or so.",
    numbers: "",
    scenario: true,
  },
] as const

export const zones = {
  amsterdam: { name: "Europe/Amsterdam", offset: "UTC+1", time: "12:04" },
  almaty: { name: "Asia/Almaty", offset: "UTC+5", time: "16:04" },
  newyork: { name: "America/New_York", offset: "UTC−5", time: "06:04" },
} as const

export const places = {
  amsterdam: { name: "Amsterdam", coords: "52.3731, 4.8922", x: 300, y: 120 },
  warsaw: { name: "Warsaw", coords: "52.2297, 21.0122", x: 380, y: 126 },
  almaty: { name: "Almaty", coords: "43.2389, 76.8897", x: 640, y: 210 },
} as const

export const builds = [
  {
    version: "2.5.0-rc1",
    note: "Release candidate, new checkout",
    by: "maria",
    when: "20 minutes ago",
    branch: "release/2.5",
  },
  { version: "2.4.0", note: "Production", by: "slack-sync", when: "2 days ago", branch: "main" },
  { version: "2.3.1", note: "Hotfix for the cart", by: "oleh", when: "3 weeks ago", branch: "hotfix/cart" },
] as const

export const requests = [
  {
    id: "catalog",
    method: "GET",
    url: "/api/v2/catalog?page=1",
    status: 200,
    type: "fetch",
    size: "18.4 kB",
    time: "142 ms",
  },
  {
    id: "price",
    method: "GET",
    url: "/api/v2/prices?region=auto",
    status: 200,
    type: "fetch",
    size: "1.2 kB",
    time: "96 ms",
  },
  { id: "cart", method: "POST", url: "/api/v2/cart/items", status: 500, type: "fetch", size: "312 B", time: "1.21 s" },
  {
    id: "font",
    method: "GET",
    url: "/static/fonts/inter.woff2",
    status: 200,
    type: "font",
    size: "48.1 kB",
    time: "38 ms",
  },
  {
    id: "logo",
    method: "GET",
    url: "/static/img/pinecone.svg",
    status: 200,
    type: "svg+xml",
    size: "3.3 kB",
    time: "21 ms",
  },
] as const

export const frames = [
  { id: "hello", dir: "out", time: "12:04:01.218", data: '{"type":"hello","client":"android","v":2}' },
  {
    id: "price",
    dir: "in",
    time: "12:04:01.402",
    data: '{"type":"price","sku":"cone-01","amount":24.9,"currency":"EUR"}',
  },
  { id: "ping", dir: "out", time: "12:04:16.001", data: '{"type":"ping"}' },
  {
    id: "order",
    dir: "in",
    time: "12:04:19.733",
    data: '{"type":"order","id":"A-1042","status":"failed","error":"out_of_stock"}',
  },
  { id: "pong", dir: "in", time: "12:04:16.044", data: '{"type":"pong"}' },
] as const

export const logLines = [
  { level: "I", tag: "ActivityManager", msg: "Start proc 4211:com.example.pinecone/u0a142", app: false },
  { level: "D", tag: "Pinecone", msg: "Catalog loaded: 24 items in 142 ms", app: true },
  {
    level: "I",
    tag: "chromium",
    msg: '[INFO:CONSOLE(12)] "price widget ready", source: https://shop.example.com/app.js',
    app: true,
  },
  { level: "W", tag: "Pinecone", msg: "Cart request took 1210 ms", app: true },
  { level: "D", tag: "WifiService", msg: "updateNetworkState: CONNECTED", app: false },
  { level: "E", tag: "AndroidRuntime", msg: "FATAL EXCEPTION: main", app: true },
  { level: "E", tag: "AndroidRuntime", msg: "Process: com.example.pinecone, PID: 4211", app: true },
  { level: "E", tag: "AndroidRuntime", msg: "java.lang.IllegalStateException: Cart is empty", app: true },
  {
    level: "E",
    tag: "AndroidRuntime",
    msg: "    at com.example.pinecone.cart.CartViewModel.checkout(CartViewModel.kt:88)",
    app: true,
  },
  {
    level: "E",
    tag: "AndroidRuntime",
    msg: "    at com.example.pinecone.cart.CartFragment.onPay(CartFragment.kt:41)",
    app: true,
  },
] as const

export const issues = [
  { title: "Button is 4 px lower", detail: "“Buy” starts at y 612, the mockup at 608.", x: 18, y: 72, w: 64, h: 8 },
  { title: "Different text colour", detail: "Price uses #0F766E, the mockup #0D9488.", x: 18, y: 36, w: 34, h: 5 },
  { title: "Missing divider", detail: "The mockup has a 1 px line under the header.", x: 0, y: 11, w: 100, h: 2 },
] as const
