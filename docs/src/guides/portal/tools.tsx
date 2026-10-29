import {
  ActivityIcon,
  ArrowDownIcon,
  CableIcon,
  DatabaseZapIcon,
  FrameIcon,
  GlobeIcon,
  PenToolIcon,
  RouteIcon,
  SignalIcon,
  SignpostIcon,
  SquareCodeIcon,
  SquareTerminalIcon,
  TerminalIcon,
  type LucideIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  ImageIcon,
  PauseIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { PortalState, Tab } from "../types"
import { frames, issues, locationOf, logLines, networkProfiles, requests } from "./data"
import { Dns, Images, Routes, Svg } from "./insights"

const tabs: [Tab, string, LucideIcon][] = [
  ["devtools", "DevTools", SquareCodeIcon],
  ["pixel-perfect", "Pixel perfect", FrameIcon],
  ["websockets", "WebSockets", CableIcon],
  ["cache", "Cache", DatabaseZapIcon],
  ["images", "Images", ImageIcon],
  ["svg", "SVG", PenToolIcon],
  ["network", "Network", GlobeIcon],
  ["dns", "DNS", SignpostIcon],
  ["routes", "Routes", RouteIcon],
  ["logcat", "Logcat", SquareTerminalIcon],
  ["files", "Files", FolderIcon],
  ["terminal", "Terminal", TerminalIcon],
]

export function ToolTabs({ s }: { s: PortalState }) {
  return (
    <div className="flex h-full min-h-0 flex-col border-l">
      <div
        data-scroll
        className="flex h-9 shrink-0 items-end gap-1 overflow-x-auto border-b px-2 [scrollbar-width:none]"
      >
        {tabs.map(([id, label, Icon]) => (
          <span
            key={id}
            data-g={`tab-${id}`}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 px-2 pb-2 text-sm font-medium [&_svg]:size-3.5",
              s.tab === id ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <Icon />
            {label}
            {s.tab === id && <span className="bg-foreground absolute inset-x-0 -bottom-px h-0.5" />}
          </span>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {s.tab === "devtools" && <DevTools s={s} />}
        {s.tab === "websockets" && <Sockets s={s} />}
        {s.tab === "logcat" && <Logcat s={s} />}
        {s.tab === "files" && <Files s={s} />}
        {s.tab === "terminal" && <Terminal />}
        {s.tab === "pixel-perfect" && <PixelPerfect s={s} />}
        {s.tab === "network" && <Network s={s} />}
        {s.tab === "dns" && <Dns s={s} />}
        {s.tab === "routes" && <Routes s={s} />}
        {s.tab === "images" && <Images s={s} />}
        {s.tab === "svg" && <Svg s={s} />}
      </div>
    </div>
  )
}

function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2">{children}</div>
}

function DevTools({ s }: { s: PortalState }) {
  const selected = requests.find((r) => r.id === s.request)
  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <span className="bg-muted text-muted-foreground flex h-7 min-w-0 flex-1 items-center rounded-md px-2 font-mono text-xs">
          https://shop.example.com/
        </span>
        <Button size="icon-sm" variant="ghost">
          <RefreshCwIcon />
        </Button>
        <Button size="icon-sm" variant="ghost">
          <SettingsIcon />
        </Button>
      </Toolbar>
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b bg-neutral-50 px-1 text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
        {(["elements", "console", "sources", "network", "application"] as const).map((t) => (
          <span
            key={t}
            data-g={`dt-${t}`}
            className={cn(
              "px-2.5 py-1.5 capitalize",
              s.devtools === t && "border-b-2 border-sky-600 text-neutral-950 dark:text-white",
            )}
          >
            {t}
          </span>
        ))}
      </div>
      {s.devtools === "network" && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto] font-mono text-[11px]">
          <div className="min-w-0">
            <div className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_44px_52px_64px] gap-2 border-b px-2 py-1">
              <span>Name</span>
              <span>Status</span>
              <span>Size</span>
              <span>Time</span>
            </div>
            {requests.map((r) => (
              <div
                key={r.id}
                data-g={`req-${r.id}`}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_44px_52px_64px] gap-2 border-b px-2 py-1",
                  r.status >= 400 && "text-red-600 dark:text-red-400",
                  r.id === s.request && "bg-sky-100 dark:bg-sky-950",
                )}
              >
                <span className="truncate">{r.url}</span>
                <span>{r.status}</span>
                <span>{r.size}</span>
                <span>{r.time}</span>
              </div>
            ))}
          </div>
          {selected && (
            <div data-g="req-details" className="w-64 border-l p-2">
              <div className="mb-2 flex gap-3 border-b pb-1 text-xs">
                <span className="font-sans font-medium">Headers</span>
                <span className="text-muted-foreground font-sans">Response</span>
                <span className="text-muted-foreground font-sans">Timing</span>
              </div>
              <div className="grid gap-1 break-all">
                <span>
                  <span className="text-muted-foreground">Request URL:</span> https://shop.example.com{selected.url}
                </span>
                <span>
                  <span className="text-muted-foreground">Method:</span> {selected.method}
                </span>
                <span>
                  <span className="text-muted-foreground">Status:</span> {selected.status}
                </span>
                {selected.id === "cart" && (
                  <pre className="bg-muted mt-2 rounded p-2 whitespace-pre-wrap text-red-600 dark:text-red-400">
                    {'{\n  "error": "price_mismatch",\n  "expected": "24.90 EUR"\n}'}
                  </pre>
                )}
                {selected.id === "price" && (
                  <pre className="bg-muted mt-2 rounded p-2 whitespace-pre-wrap">
                    {'{\n  "region": "' + s.location.toUpperCase() + '",\n  "currency": "auto"\n}'}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {s.devtools === "console" && (
        <div className="min-h-0 flex-1 font-mono text-[11px]">
          <div className="border-b px-2 py-1">price widget ready</div>
          <div className="border-b px-2 py-1 text-amber-700 dark:text-amber-400">⚠ Cart request took 1210 ms</div>
          <div
            data-g="console-error"
            className="border-b bg-red-50 px-2 py-1 text-red-600 dark:bg-red-950/40 dark:text-red-400"
          >
            ✖ Uncaught TypeError: Cannot read properties of undefined (reading 'amount')
            <div className="text-muted-foreground pl-4">at renderPrice (app.js:212:31)</div>
          </div>
          <div className="text-muted-foreground px-2 py-1">›</div>
        </div>
      )}
      {s.devtools === "elements" && (
        <div className="min-h-0 flex-1 p-2 font-mono text-[11px] leading-5">
          <div>{"<html>"}</div>
          <div className="pl-4">{'<body class="shop">'}</div>
          <div className="bg-sky-100 pl-8 dark:bg-sky-950">{'<div class="price">24.90 €</div>'}</div>
          <div className="pl-8">{'<button class="buy">Buy</button>'}</div>
        </div>
      )}
    </div>
  )
}

function Sockets({ s }: { s: PortalState }) {
  const selected = frames.find((f) => f.id === s.socket)
  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <Badge variant="secondary" className="font-mono">
          wss://shop.example.com/live
        </Badge>
        <span className="border-input text-muted-foreground ml-auto flex h-7 w-40 items-center rounded-md border px-2 text-xs">
          Filter
        </span>
        <Button size="icon-sm" variant="ghost">
          <PauseIcon />
        </Button>
      </Toolbar>
      <div className="font-mono text-[11px]">
        <div className="text-muted-foreground grid grid-cols-[20px_minmax(0,1fr)_50px_90px] gap-2 border-b px-2 py-1 font-sans">
          <span />
          <span>Data</span>
          <span>Length</span>
          <span>Time</span>
        </div>
        {frames.map((f) => (
          <div
            key={f.id}
            data-g={`frame-${f.id}`}
            className={cn(
              "grid grid-cols-[20px_minmax(0,1fr)_50px_90px] gap-2 border-b px-2 py-1",
              f.dir === "out" ? "bg-emerald-50/60 dark:bg-emerald-950/30" : "",
              f.id === s.socket && "bg-sky-100 dark:bg-sky-950",
            )}
          >
            {f.dir === "out" ? (
              <ArrowUpIcon className="size-3 text-emerald-600" />
            ) : (
              <ArrowDownIcon className="size-3 text-red-500" />
            )}
            <span className="truncate">{f.data}</span>
            <span>{f.data.length}</span>
            <span>{f.time}</span>
          </div>
        ))}
      </div>
      {selected && (
        <pre data-g="frame-details" className="bg-muted m-2 rounded-lg p-3 font-mono text-xs whitespace-pre-wrap">
          {JSON.stringify(JSON.parse(selected.data), null, 2)}
        </pre>
      )}
    </div>
  )
}

const levelColor: Record<string, string> = {
  E: "text-red-600 dark:text-red-400",
  W: "text-amber-700 dark:text-amber-400",
  I: "text-sky-700 dark:text-sky-400",
  D: "text-muted-foreground",
}

function Logcat({ s }: { s: PortalState }) {
  const lines = logLines
    .filter((l) => s.logScope === "all" || l.app)
    .filter((l) => s.logLevel === "verbose" || l.level === "E")
    .filter((l) => s.crashed || l.level !== "E")
  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <div data-g="log-scope" className="bg-muted flex rounded-lg p-0.5 text-xs">
          {(["app", "all"] as const).map((v) => (
            <span key={v} className={cn("rounded-md px-2 py-1", s.logScope === v && "bg-background shadow-sm")}>
              {v === "app" ? "This app" : "Everything"}
            </span>
          ))}
        </div>
        <span data-g="log-level" className="border-input flex h-7 items-center rounded-md border px-2 text-xs">
          {s.logLevel === "verbose" ? "Verbose" : "Error"}
        </span>
        <span className="border-input text-muted-foreground flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2 text-xs">
          <SearchIcon className="size-3.5" />
          Filter tag or message
        </span>
        <Button size="icon-sm" variant="ghost">
          <PauseIcon />
        </Button>
        <Button size="icon-sm" variant="ghost">
          <Trash2Icon />
        </Button>
        <Button data-g="log-download" size="icon-sm" variant="ghost">
          <DownloadIcon />
        </Button>
      </Toolbar>
      <div className="min-h-0 flex-1 p-1 font-mono text-[11px] leading-5">
        {lines.map((l, i) => (
          <div
            key={i}
            data-g={l.msg.includes("IllegalState") ? "log-exception" : undefined}
            className={cn("flex gap-2 px-1 whitespace-pre", levelColor[l.level])}
          >
            <span className="text-muted-foreground shrink-0">12:04:{String(10 + i).padStart(2, "0")}</span>
            <span className="w-3 shrink-0">{l.level}</span>
            <span className="w-28 shrink-0 truncate">{l.tag}</span>
            <span className="truncate">{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Files({ s }: { s: PortalState }) {
  const roots = [
    ["app", "App data"],
    ["shared", "Shared storage"],
    ["tmp", "/data/local/tmp"],
  ] as const
  const path =
    s.filesRoot === "app"
      ? `/data/data/com.example.pinecone${s.filesFolder === "shared_prefs" ? "/shared_prefs" : ""}`
      : s.filesRoot === "shared"
        ? `/sdcard${s.filesFolder === "Download" ? "/Download" : ""}`
        : "/data/local/tmp"
  const entries: [string, "dir" | "file" | "image", string][] =
    s.filesRoot === "app"
      ? s.filesFolder === "shared_prefs"
        ? [
            ["session.xml", "file", "1.1 kB"],
            ["onboarding.xml", "file", "214 B"],
            ["feature_flags.xml", "file", "640 B"],
          ]
        : [
            ["app_webview", "dir", ""],
            ["cache", "dir", ""],
            ["databases", "dir", ""],
            ["files", "dir", ""],
            ["shared_prefs", "dir", ""],
          ]
      : s.filesRoot === "shared" && s.filesFolder === "Download"
        ? [
            ...(s.fileUploaded ? ([["receipt-test.pdf", "file", "88.4 kB"]] as [string, "file", string][]) : []),
            ["avatar.png", "image", "212 kB"],
          ]
        : [
            ["DCIM", "dir", ""],
            ["Download", "dir", ""],
            ["Pictures", "dir", ""],
          ]
  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        {roots.map(([id, label]) => (
          <Button key={id} data-g={`files-${id}`} size="sm" variant={s.filesRoot === id ? "secondary" : "ghost"}>
            {label}
          </Button>
        ))}
        <Button data-g="files-upload" size="sm" variant="outline" className="ml-auto">
          <UploadIcon />
          Upload
        </Button>
      </Toolbar>
      <div className="text-muted-foreground flex h-8 items-center gap-1 border-b px-3 font-mono text-xs">
        {path
          .split("/")
          .filter(Boolean)
          .map((p, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRightIcon className="size-3" />}
              {p}
            </span>
          ))}
      </div>
      <ul data-g="files-list" className="min-h-0 flex-1 text-sm">
        {entries.map(([name, kind, size]) => (
          <li
            key={name}
            data-g={`file-${name}`}
            className={cn(
              "flex items-center gap-2.5 border-b px-3 py-1.5",
              name === "receipt-test.pdf" && "animate-in fade-in-0 bg-emerald-50 dark:bg-emerald-950/30",
            )}
          >
            {kind === "dir" ? (
              <FolderIcon className="size-4 text-sky-600" />
            ) : kind === "image" ? (
              <ImageIcon className="text-muted-foreground size-4" />
            ) : name.endsWith(".xml") ? (
              <FileTextIcon className="text-muted-foreground size-4" />
            ) : (
              <FileIcon className="text-muted-foreground size-4" />
            )}
            <span className="flex-1 truncate">{name}</span>
            <span className="text-muted-foreground text-xs tabular-nums">{size}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Terminal() {
  return (
    <div className="h-full bg-neutral-950 p-3 font-mono text-xs leading-5 text-neutral-200">
      <div>
        <span className="text-emerald-400">redroid:/ $</span> getprop ro.build.version.release
      </div>
      <div>16</div>
      <div>
        <span className="text-emerald-400">redroid:/ $</span> pm list packages | grep pinecone
      </div>
      <div>package:com.example.pinecone</div>
      <div>
        <span className="text-emerald-400">redroid:/ $</span> <span className="animate-pulse">▋</span>
      </div>
    </div>
  )
}

function PixelPerfect({ s }: { s: PortalState }) {
  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <span className="text-sm font-medium">References</span>
        <span className="text-muted-foreground text-xs">Drop an image, choose a file or paste with ⌘V</span>
        <Button data-g="pp-export" size="sm" variant="outline" className="ml-auto" disabled={!s.ppCompare}>
          <DownloadIcon />
          Export report
        </Button>
      </Toolbar>
      <div className="grid min-h-0 flex-1 grid-cols-[180px_minmax(0,1fr)]">
        <ul className="grid content-start gap-2 border-r p-2">
          {s.ppReference ? (
            <li data-g="pp-ref" className="bg-accent grid gap-1.5 rounded-lg p-2 ring-2 ring-fuchsia-500/50">
              <div className="h-24 rounded bg-gradient-to-b from-fuchsia-200 to-fuchsia-100 dark:from-fuchsia-900 dark:to-fuchsia-950" />
              <span className="truncate text-xs font-medium">Home · 360×800.svg</span>
            </li>
          ) : (
            <li
              data-g="pp-drop"
              className="text-muted-foreground grid h-32 place-items-center rounded-lg border border-dashed p-2 text-center text-xs"
            >
              Drop a mockup here
            </li>
          )}
        </ul>
        <div className="grid content-start gap-4 p-3">
          {s.ppReference && (
            <div data-g="pp-opacity" className="grid gap-1.5">
              <div className="flex justify-between text-xs">
                <span>Opacity</span>
                <span className="tabular-nums">{s.ppOpacity}%</span>
              </div>
              <div className="bg-muted relative h-1.5 rounded-full">
                <div
                  className="bg-primary absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${s.ppOpacity}%` }}
                />
                <span
                  className="bg-background border-primary absolute top-1/2 size-4 -translate-1/2 rounded-full border-2"
                  style={{ left: `${s.ppOpacity}%` }}
                />
              </div>
            </div>
          )}
          {s.ppReference && (
            <Button data-g="pp-compare" size="sm" variant={s.ppCompare ? "secondary" : "default"} className="w-fit">
              {s.ppCompare ? "3 differences found" : "Find differences"}
            </Button>
          )}
          {s.ppCompare && (
            <ul className="grid gap-1.5">
              {issues.map((issue, i) => (
                <li
                  key={issue.title}
                  data-g={`pp-item-${i}`}
                  className={cn(
                    "grid rounded-lg border p-2 text-sm",
                    i === s.ppIssue && "border-red-500 bg-red-50 dark:bg-red-950/30",
                  )}
                >
                  <span className="font-medium">{issue.title}</span>
                  <span className="text-muted-foreground text-xs">{issue.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function Network({ s }: { s: PortalState }) {
  const current = networkProfiles.find((p) => p.id === s.network)
  const groups = [
    {
      title: "Access link",
      note: "The device's own connection: latency, bandwidth and loss on every request.",
      items: networkProfiles.filter((p) => !p.scenario),
    },
    {
      title: "Scenarios",
      note: "The access link changes over time.",
      items: networkProfiles.filter((p) => p.scenario),
    },
  ]
  return (
    <div className="grid content-start gap-5 p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">
          {current?.name ?? "No emulation"} · {locationOf(s.location)?.label ?? "No VPN"}
        </h3>
      </div>
      {groups.map((g) => (
        <section key={g.title} className="grid gap-3">
          <div className="grid gap-0.5">
            <h4 className="text-sm font-medium">{g.title}</h4>
            <p className="text-muted-foreground text-xs">{g.note}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {g.items.map((p) => (
              <div
                key={p.id}
                data-g={`net-${p.id}`}
                className={cn("grid gap-1 rounded-lg border p-3", p.id === s.network && "border-primary bg-primary/5")}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {p.scenario ? <ActivityIcon className="size-3.5" /> : <SignalIcon className="size-3.5" />}
                  {p.name}
                </span>
                <span className="text-muted-foreground text-xs">{p.detail}</span>
                {p.numbers && <span className="text-muted-foreground font-mono text-[11px]">{p.numbers}</span>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
