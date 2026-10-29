import {
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  LaptopIcon,
  Link2Icon,
  PauseIcon,
  PinIcon,
  PlayIcon,
  SmartphoneIcon,
  TerminalIcon,
} from "lucide-react"
import { AppIcon } from "@/components/app-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { PortalState } from "../types"
import { app, logLines, requests } from "./data"
import { PhoneScreen } from "./phone"

const markerAt = [0.22, 0.48, 0.71, 0.86]

export function RecordingsList({ s }: { s: PortalState }) {
  return (
    <div className="grid content-start gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Recordings</h1>
        <p className="text-muted-foreground text-sm">Sessions recorded on the server, to watch, download or share.</p>
      </div>
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

export function RecordingHeader() {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Button variant="ghost" size="icon-sm">
        <ArrowLeftIcon />
      </Button>
      <AppIcon src={app.icon} className="size-9" />
      <span className="grid min-w-0">
        <span className="truncate font-medium">Checkout fails in Kazakhstan</span>
        <span className="text-muted-foreground truncate font-mono text-xs">
          {app.pkg} · 2.4.0 · Classic 16:9 · Android 16
        </span>
      </span>
      <div className="ml-auto flex gap-2">
        <Button data-g="rec-share" size="sm" variant="outline">
          <Link2Icon />
          Share
        </Button>
        <Button data-g="rec-export" size="sm" variant="outline">
          <DownloadIcon />
          Export video
        </Button>
      </div>
    </div>
  )
}

export function Recording({ s }: { s: PortalState }) {
  const total = 252
  const progress = s.recTime / total
  const shown = logLines.filter((l) => l.app).slice(0, 3 + Math.round(progress * 5))
  return (
    <div className="grid h-full grid-rows-[minmax(0,1fr)_auto]">
      <div className="grid min-h-0 grid-cols-[182px_minmax(0,1fr)_minmax(0,520px)]">
        <div data-g="rec-cards" className="bg-muted/40 grid content-start gap-2 p-3">
          {[
            ["Device", "Classic 16:9 · Android 16"],
            ["Network", "🇰🇿 Kazakhstan · 4G"],
            ["App", "2.4.0 · running"],
            ["Load", "CPU 22% · 61 fps"],
          ].map(([title, value]) => (
            <div
              key={title}
              className="shade-surface grid gap-1 rounded-2xl bg-neutral-900 p-3 text-neutral-100 shadow-lg"
            >
              <span className="text-xs text-neutral-400">{title}</span>
              <span className="truncate text-sm">{value}</span>
            </div>
          ))}
        </div>
        <div className="bg-muted/40 grid min-h-0 place-items-center">
          <div className="rounded-[36px] bg-neutral-900 p-2 shadow-lg">
            <div className="h-[470px] w-[220px] overflow-hidden rounded-[30px]">
              <PhoneScreen s={{ ...s, recording: false }} />
            </div>
          </div>
        </div>
        <div className="flex min-h-0 flex-col border-l">
          <div className="flex h-9 items-end gap-1 border-b px-2">
            {(["logcat", "network", "console"] as const).map((t) => (
              <span
                key={t}
                data-g={`rec-tab-${t}`}
                className={cn(
                  "relative px-2 pb-2 text-sm font-medium capitalize",
                  s.recTab === t ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {t}
                {s.recTab === t && <span className="bg-foreground absolute inset-x-0 -bottom-px h-0.5" />}
              </span>
            ))}
          </div>
          <div className="min-h-0 flex-1 p-1 font-mono text-[11px] leading-5">
            {s.recTab === "network"
              ? requests.map((r) => (
                  <div
                    key={r.id}
                    className={cn("flex gap-2 border-b px-1", r.status >= 400 && "text-red-600 dark:text-red-400")}
                  >
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
                : shown.map((l, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex gap-2 px-1 whitespace-pre",
                        l.level === "E" && "text-red-600 dark:text-red-400",
                      )}
                    >
                      <span className="text-muted-foreground">0:{String(12 + i * 21).padStart(2, "0")}</span>
                      <span className="w-24 truncate">{l.tag}</span>
                      <span className="truncate">{l.msg}</span>
                    </div>
                  ))}
          </div>
        </div>
      </div>
      <div data-g="rec-timeline" className="flex items-center gap-3 border-t px-4 py-3">
        <Button data-g="rec-play" size="icon" variant="outline">
          {s.recPlaying ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <span className="text-muted-foreground w-24 font-mono text-xs tabular-nums">
          {Math.floor(s.recTime / 60)}:{String(s.recTime % 60).padStart(2, "0")} / 4:12
        </span>
        <div className="relative h-8 flex-1">
          <div className="bg-muted absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full" />
          <div
            className="bg-primary absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full transition-[width] duration-700"
            style={{ width: `${progress * 100}%` }}
          />
          {markerAt.slice(0, s.markers).map((at, i) => (
            <span
              key={i}
              data-g={`rec-marker-${i}`}
              className="absolute top-0 -translate-x-1/2 text-amber-500"
              style={{ left: `${at * 100}%` }}
            >
              <PinIcon className="size-4 fill-current" />
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

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
