import {
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FlagIcon,
  GlobeIcon,
  InfoIcon,
  LaptopIcon,
  Link2Icon,
  LinkIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  RotateCwIcon,
  Share2Icon,
  SmartphoneIcon,
  TerminalIcon,
} from "lucide-react"
import type { RecordingMarker } from "@/api/client"
import { type Lanes, pinFlips, Timeline } from "@/components/recording/timeline"
import { AppIcon } from "@/components/app-icon"
import { PageHeader } from "@/components/page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { PortalState } from "../types"
import { app, logLines, requests } from "./data"
import { Phone } from "./phone"

export function RecordingsList({ s }: { s: PortalState }) {
  return (
    <div className="grid content-start gap-4 p-6">
      <PageHeader title="Recordings" meta="2 recordings · 76 MB used" />
      <ul className="grid gap-2">
        {[0, 1].map((i) => (
          <li
            key={i}
            data-g={i === 0 ? "recording-row" : undefined}
            className="bg-card flex items-center gap-3 rounded-xl border p-3"
          >
            <div className="h-16 w-9 shrink-0 rounded-md bg-neutral-900" />
            <AppIcon src={app.icon} className="size-10" />
            <div className="grid min-w-0 flex-1">
              <span className="font-medium">{i === 0 ? "Checkout fails in Kazakhstan" : `${app.label} · 2.3.1`}</span>
              <span className="text-muted-foreground text-xs">
                {i === 0 ? `Alex · just now · 4:12 · ${s.markers} markers` : "Maria · yesterday · 11:40 · 2 markers"}
              </span>
            </div>
            <Button data-g={i === 0 ? "recording-share" : undefined} size="icon-sm" variant="ghost">
              <Link2Icon />
            </Button>
            <Button size="icon-sm" variant="ghost">
              <DownloadIcon />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

const duration = 252_000

const lanes: Lanes = {
  screen: [
    { start: 0, end: 118_000, kind: "portrait", label: "Portrait" },
    { start: 118_000, end: 136_000, kind: "off", label: "Off" },
    { start: 136_000, end: duration, kind: "portrait", label: "Portrait" },
  ],
  app: [
    { start: 0, end: 4_000, kind: "starting", label: "Starting" },
    { start: 4_000, end: 121_000, kind: "running", label: app.label },
    { start: 121_000, end: 126_000, kind: "closed", label: "Closed" },
    { start: 126_000, end: duration, kind: "running", label: app.label },
  ],
  crashes: [{ t: 121_000, kind: "crash", title: "Crash", detail: "IllegalStateException: Cart is empty" }],
  network: [
    { start: 0, end: 70_000, kind: "normal", label: "🇰🇿 Kazakhstan · Wi-Fi" },
    { start: 70_000, end: 190_000, kind: "throttled", label: "3G" },
    { start: 190_000, end: duration, kind: "normal", label: "🇰🇿 Kazakhstan · Wi-Fi" },
  ],
  dns: [{ t: 64_000, title: "DNS rewrites or TTL changed" }],
  taps: Array.from({ length: 30 }, (_, i) => ({ t: 6_000 + i * 8_000 })),
  issues: [
    {
      id: "r:cart",
      t: 119_000,
      level: "error",
      kind: "request",
      title: "POST /api/cart → 500",
      detail: "shop.example.com · 1.2 s",
    },
    {
      id: "c:price",
      t: 182_000,
      level: "warning",
      kind: "console",
      title: "Cart request took 1210 ms",
      detail: "Console",
    },
  ],
}

const markerTimes = [56_000, 121_000, 179_000, 216_000]

function recClock(sec: number) {
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`
}

function RecordingHeader({ s }: { s: PortalState }) {
  return (
    <header className="flex shrink-0 items-center gap-3.5">
      <Button variant="outline" size="icon">
        <ArrowLeftIcon />
      </Button>
      <AppIcon src={app.icon} className="size-10 rounded-[11px]" />
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-lg font-semibold">Checkout fails in Kazakhstan</span>
          <Badge variant="success">Done</Badge>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="font-mono">
            2.4.0
          </Badge>
          <Badge variant="secondary">
            <SmartphoneIcon />
            Classic 16:9
          </Badge>
          <Badge variant="secondary">
            <GlobeIcon />
            kz
          </Badge>
          <span className="text-muted-foreground ml-1 truncate text-xs">Alex · today 12:04 · 4:12 · 38 MB</span>
        </div>
      </div>
      <span className="flex-1" />
      <Badge variant="secondary">
        <InfoIcon />
        Deleted in 7 days
      </Badge>
      <Button variant="outline">Keep</Button>
      <Button variant="outline">
        <LinkIcon />
        Link at {recClock(s.recTime)}
      </Button>
      <Button data-g="rec-share" variant="outline">
        <Share2Icon />
        Share
      </Button>
      <Button data-g="rec-export" variant="outline">
        <DownloadIcon />
        Export
      </Button>
    </header>
  )
}

function SideCard({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <section className="bg-card grid gap-2.5 rounded-2xl border p-3.5">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-[.06em] uppercase">{title}</h3>
      <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-y-1.5 text-[12.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 truncate">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

const recTabs = [
  ["findings", "Findings"],
  ["logcat", "Logcat"],
  ["network", "Network"],
  ["console", "Console"],
  ["websockets", "WebSockets"],
  ["dns", "DNS"],
] as const

export function Recording({ s }: { s: PortalState }) {
  const progress = s.recTime / (duration / 1000)
  const shown = logLines.filter((l) => l.app).slice(0, 3 + Math.round(progress * 5))
  const markers: RecordingMarker[] = markerTimes
    .slice(0, s.markers)
    .map((t, i) => ({ id: `m${i}`, t, icon: i === 1 ? "bug" : "pin", label: i === 1 ? "Checkout 500" : "" }))
  return (
    <div className="flex h-full flex-col gap-2.5 px-4 pt-3">
      <RecordingHeader s={s} />
      <div className="grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)_minmax(0,500px)] gap-3">
        <div data-g="rec-cards" className="grid min-h-0 content-start gap-2.5 overflow-hidden">
          <SideCard
            title={`At ${recClock(s.recTime)}`}
            rows={[
              ["Real time", "12:06:01"],
              ["Screen", "Portrait"],
              ["App", "Running"],
            ]}
          />
          <SideCard
            title="Network"
            rows={[
              ["VPN", "🇰🇿 Kazakhstan"],
              ["Link", "3G"],
            ]}
          />
        </div>
        <section className="bg-stage relative grid min-h-0 place-items-center overflow-hidden rounded-2xl">
          <Phone s={{ ...s, recording: false }} scale={0.4} />
          <Button variant="outline" size="sm" className="shadow-float absolute right-3 bottom-3">
            <FlagIcon className="text-warning" />
            Marker
            <kbd className="text-muted-foreground rounded-[5px] border px-[5px] font-sans text-[11px]">M</kbd>
          </Button>
        </section>
        <section className="bg-card flex min-h-0 flex-col overflow-hidden rounded-2xl border">
          <div className="flex h-[42px] shrink-0 items-stretch gap-4 overflow-hidden border-b px-4">
            {recTabs.map(([id, label]) => (
              <span
                key={id}
                data-g={`rec-tab-${id}`}
                className={cn(
                  "flex items-center text-sm font-medium",
                  s.recTab === id
                    ? "text-foreground shadow-[inset_0_-2px_0_var(--foreground)]"
                    : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            ))}
          </div>
          <div className="min-h-0 flex-1 p-1 font-mono text-[11px] leading-5">
            {s.recTab === "network"
              ? requests.map((r) => (
                  <div key={r.id} className={cn("flex gap-2 border-b px-1", r.status >= 400 && "text-danger")}>
                    <span className="w-10">{r.method}</span>
                    <span className="flex-1 truncate">{r.url}</span>
                    <span>{r.status}</span>
                  </div>
                ))
              : s.recTab === "console"
                ? ["price widget ready", "Cart request took 1210 ms"].map((m) => (
                    <div key={m} className="border-b px-1">
                      {m}
                    </div>
                  ))
                : shown.map((l) => (
                    <div
                      key={`${l.tag}-${l.msg}`}
                      className={cn("flex gap-2 px-1 whitespace-pre", l.level === "E" && "text-danger")}
                    >
                      <span className="w-24 truncate">{l.tag}</span>
                      <span className="truncate">{l.msg}</span>
                    </div>
                  ))}
          </div>
        </section>
      </div>
      <section data-g="rec-timeline" className="bg-card grid shrink-0 gap-2 rounded-2xl border px-[18px] pt-3 pb-3.5">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm">
            <RotateCcwIcon />
          </Button>
          <Button data-g="rec-play" size="icon" className="rounded-xl [&_svg]:fill-current">
            {s.recPlaying ? <PauseIcon /> : <PlayIcon className="translate-x-px" />}
          </Button>
          <Button variant="outline" size="icon-sm">
            <RotateCwIcon />
          </Button>
          <span className="mx-2 font-mono text-sm">
            {recClock(s.recTime)} <span className="text-muted-foreground">/ 04:12</span>
          </span>
          <span className="flex-1" />
          <span className="text-muted-foreground text-xs">Jump to</span>
          {["Marker", "Issue", "Tap"].map((j) => (
            <Button key={j} variant="outline" size="sm">
              {j}
            </Button>
          ))}
        </div>
        <div className="relative">
          <Timeline
            duration={duration}
            time={s.recTime * 1000}
            lanes={lanes}
            markers={markers}
            editable={false}
            editing={null}
            onEditing={noop}
            onMarkers={noop}
            onSeek={noop}
          />
          {markers.map((m, i) => (
            <span
              key={m.id}
              data-g={`rec-marker-${i}`}
              aria-hidden
              className={cn(
                "pointer-events-none absolute top-0 h-5 w-5",
                pinFlips(m.t, duration) && "-translate-x-full",
              )}
              style={{ left: `${(m.t / duration) * 100}%` }}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

const noop = () => undefined

export function Computers({ s }: { s: PortalState }) {
  const lines = [
    { cmd: true, text: "curl -fsSL https://holtdroid.example.com/tunnel.sh | sh -s -- eyJhbGciOi…" },
    { text: "holtdroid: enrolled as alex-macbook, connected" },
    { cmd: true, text: "adb devices" },
    { text: "List of devices attached\nlocalhost:15037\tdevice" },
    { cmd: true, text: "npm run dev -- --port 5173" },
    { text: "VITE ready in 312 ms  ➜  Local: http://localhost:5173/" },
  ].slice(0, s.terminal)
  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(0,500px)] gap-6 p-6">
      <div className="grid content-start gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Computers</h1>
          <p className="text-muted-foreground text-sm">
            Reach your devices from your own computer: adb, Chrome's inspect page, and your local ports on the phones.
          </p>
        </div>
        <div data-g="connect-card" className="bg-card grid gap-3 rounded-xl border p-4">
          <span className="font-medium">Connect a computer</span>
          <p className="text-muted-foreground text-sm">
            Paste this into a terminal on macOS or Linux. The code works once, for ten minutes.
          </p>
          <div className="bg-muted flex items-center gap-2 rounded-lg p-2 font-mono text-xs">
            <span className="min-w-0 flex-1 truncate">
              curl -fsSL https://holtdroid.example.com/tunnel.sh | sh -s -- eyJhbGciOi…
            </span>
            <Button data-g="connect-copy" size="icon-sm" variant="ghost">
              {s.toast === "copied" ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </div>
        </div>
        {s.computerOnline && (
          <div data-g="computer-card" className="bg-card animate-in fade-in-0 grid gap-3 rounded-xl border p-4">
            <div className="flex items-center gap-2">
              <LaptopIcon className="size-4 text-emerald-600" />
              <span className="font-medium">alex-macbook</span>
              <Badge variant="secondary" className="ml-auto">
                online
              </Badge>
            </div>
            <div className="grid gap-1 text-sm">
              <span className="text-muted-foreground text-xs">ADB</span>
              <span className="flex items-center gap-2 font-mono text-xs">
                <SmartphoneIcon className="size-3.5" /> {app.label} · localhost:15037
              </span>
            </div>
            <div className="grid gap-1.5">
              <span className="text-muted-foreground text-xs">Ports published on your devices</span>
              <div className="flex flex-wrap gap-1.5">
                <span
                  data-g="port-5173"
                  className={cn(
                    "rounded-full border px-3 py-1 font-mono text-xs",
                    s.portPublished
                      ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                      : "text-muted-foreground",
                  )}
                >
                  5173 {s.portPublished ? "· published" : "· listening"}
                </span>
                <span className="text-muted-foreground rounded-full border px-3 py-1 font-mono text-xs">
                  8081 · listening
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
      <div
        data-g="terminal"
        className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-neutral-950 text-neutral-200 shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs text-neutral-400">
          <TerminalIcon className="size-3.5" />
          Terminal — your laptop
        </div>
        <div className="grid content-start gap-1 p-3 font-mono text-xs leading-5 whitespace-pre-wrap">
          {lines.map((l, i) => (
            <div key={i} className={cn(l.cmd ? "text-neutral-100" : "text-neutral-400")}>
              {l.cmd && <span className="text-emerald-400">$ </span>}
              {l.text}
            </div>
          ))}
          <div>
            <span className="text-emerald-400">$ </span>
            <span className="animate-pulse">▋</span>
          </div>
        </div>
      </div>
    </div>
  )
}
