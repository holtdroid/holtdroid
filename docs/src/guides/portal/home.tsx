import {
  ArrowUpRightIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  ClapperboardIcon,
  ClockIcon,
  DatabaseIcon,
  EllipsisIcon,
  HardDriveIcon,
  LaptopIcon,
  LayoutGridIcon,
  MoonIcon,
  PackageIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  TimerResetIcon,
  UploadIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react"
import { AppIcon } from "@/components/app-icon"
import { SessionStateBadge } from "@/components/session-state-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import logo from "@/logo.svg?url"
import type { PortalState } from "../types"
import { app, locationOf, otherApps, otter } from "./data"
import { Pop } from "./overlays"

function DockSep() {
  return <span aria-hidden className="bg-border mx-1 h-6 w-px shrink-0" />
}

const dockItem =
  "relative inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-2 rounded-xl px-2.5 text-[13px] font-medium text-muted-foreground [&_svg]:size-5"

export function Dock({ s }: { s: PortalState }) {
  const nav: [string, LucideIcon, boolean][] = [
    ["nav-apps", LayoutGridIcon, s.page === "home"],
    ["nav-app-data", DatabaseIcon, false],
    ["nav-recordings", ClapperboardIcon, s.page === "recordings" || s.page === "recording"],
    ["nav-computers", LaptopIcon, s.page === "computers"],
  ]
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-2.5 z-10 flex justify-center px-3">
      <nav className="bg-card shadow-float pointer-events-auto flex items-center gap-1 rounded-[18px] border p-1.5">
        <span className={cn(dockItem, "px-0")}>
          <img src={logo} alt="" className="size-7" />
        </span>
        <DockSep />
        {nav.map(([id, Icon, active]) => (
          <span key={id} data-g={id} className={cn(dockItem, active && "bg-primary text-primary-foreground")}>
            <Icon />
            {id === "nav-computers" && s.computerOnline && (
              <span className="bg-success text-success-foreground absolute top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] leading-none font-semibold">
                1
              </span>
            )}
          </span>
        ))}
        <DockSep />
        {s.sessions > 0 && (
          <span
            data-g="dock-device"
            className={cn(
              "bg-muted text-foreground inline-flex h-10 items-center gap-2 rounded-xl border pr-2.5 pl-1.5 text-[13px] font-medium",
              s.page === "session" && "border-foreground",
            )}
          >
            <AppIcon src={app.icon} className="size-7 rounded-lg" />
            {app.label}
            <span
              className={cn(
                "size-[7px] rounded-full",
                s.start === "ready" ? "bg-success" : s.start === "stopping" ? "bg-muted-foreground" : "bg-info",
              )}
            />
          </span>
        )}
        <span className={cn(dockItem, "border border-dashed")}>
          <PlusIcon />
        </span>
        <DockSep />
        <span className={cn(dockItem, "bg-card w-44 justify-start border px-3 [&_svg]:size-4")}>
          <SearchIcon />
          Search
          <kbd className="ml-auto rounded-[5px] border px-[5px] py-px font-sans text-[11px]">⌘K</kbd>
        </span>
        <span className={dockItem}>
          <BookOpenIcon />
        </span>
        <span className={dockItem}>
          <MoonIcon />
        </span>
        <span className={cn(dockItem, "px-1.5")}>
          <span className="grid size-7 place-items-center rounded-full bg-warning-soft text-xs font-semibold text-warning">
            A
          </span>
        </span>
      </nav>
    </div>
  )
}

function AppRow({
  title,
  pkg,
  icon,
  version,
  builds,
  source,
  latest,
  running,
  target,
  s,
}: {
  title: string
  pkg: string
  icon: string
  version: string
  builds: number
  source: string
  latest: string
  running: number
  target?: boolean
  s: PortalState
}) {
  return (
    <li data-g={target ? "app-card" : undefined} className="border-b border-dashed py-3 last:border-0">
      <div className="flex items-center gap-3">
        <AppIcon src={icon} className="size-9 rounded-[10px]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold">{title}</span>
            <Badge variant="secondary" className="font-mono">
              {version}
            </Badge>
            <Badge variant="secondary">{source}</Badge>
            {running > 0 && (
              <Badge variant="success" dot>
                {running} running
              </Badge>
            )}
          </div>
          <div className="text-muted-foreground mt-0.5 truncate font-mono text-xs">{pkg}</div>
        </div>
        <div className="flex min-w-[84px] flex-col items-end gap-0.5">
          <span className="text-[13px]">{builds} builds</span>
          <span className="text-muted-foreground text-xs">{latest}</span>
        </div>
        <span className="relative">
          <Button data-g={target ? "quick-launch" : undefined} variant="outline" size="icon">
            <ZapIcon />
          </Button>
          {target && s.panel === "quick" && <QuickMenu />}
        </span>
        <Button data-g={target ? "launch" : undefined}>
          <PlayIcon />
          Launch
        </Button>
        <Button variant="outline" size="icon">
          <ChevronDownIcon />
        </Button>
      </div>
    </li>
  )
}

function QuickMenu() {
  const item = (id: string, Icon: LucideIcon, label: string, hint: string, active = false) => (
    <div data-g={id} className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm">
      <Icon className="text-muted-foreground size-4 shrink-0" />
      <span className="grid min-w-0 flex-1">
        <span className={cn(active && "font-medium")}>{label}</span>
        <span className="text-muted-foreground truncate text-xs font-normal">{hint}</span>
      </span>
      {active && <CheckIcon className="size-4" />}
    </div>
  )
  return (
    <Pop className="top-full right-0 mt-1 w-72 p-1">
      <p className="text-muted-foreground px-2 py-1.5 text-xs">Quick launch on Android 16 · Classic 16:9</p>
      {item("quick-fresh", PackageIcon, "Fresh install", "Without app data", true)}
      {item("quick-data", DatabaseIcon, "With app data", "Saved 2 hours ago")}
      {item("quick-cache", HardDriveIcon, "With app data and cache", "Saved 2 hours ago")}
    </Pop>
  )
}

function Capacity({ s }: { s: PortalState }) {
  const tones = [
    ...Array.from({ length: s.sessions }, (_, i) =>
      i === 0 && s.start !== "ready" && s.start !== "stopping"
        ? "bg-info"
        : i === 0 && s.idleMinutes <= 5
          ? "bg-warning"
          : "bg-success",
    ),
    "bg-success",
    ...Array.from({ length: 5 - s.sessions }, () => "bg-border"),
  ]
  const count = (c: string) => tones.filter((t) => t === c).length
  return (
    <div data-g="slots" className="grid gap-2.5">
      <div className="flex gap-[3px]">
        {tones.map((t, i) => (
          <span key={`redroid-${i + 1}`} className={cn("h-5 flex-1 rounded-[2px]", t)} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {(
          [
            ["bg-success", "Running"],
            ["bg-info", "Starting"],
            ["bg-warning", "Idle"],
            ["bg-border", "Free"],
          ] as const
        )
          .filter(([c]) => count(c) > 0)
          .map(([c, label]) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span className={cn("h-3 w-1 rounded-[2px]", c)} />
              {count(c)} {label}
            </span>
          ))}
      </div>
    </div>
  )
}

function SessionRow({ s, index }: { s: PortalState; index: number }) {
  const first = index === 0
  const loc = locationOf(s.location)
  const idle = first && s.idleMinutes <= 5
  const starting = first && s.start !== "ready" && s.start !== "stopping"
  return (
    <li
      data-g={first ? "session-card" : undefined}
      className="flex items-center gap-2.5 border-b border-dashed py-3 last:border-0"
    >
      <AppIcon src={first ? app.icon : otter.icon} className="size-7 rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 font-medium">
          <span className="truncate">{first ? app.label : otter.label}</span>
          {idle ? (
            <Badge data-g="idle-timer" variant="warning">
              <ClockIcon />
              Stops in {s.idleMinutes}m
            </Badge>
          ) : starting ? (
            <SessionStateBadge state={s.start === "stopping" ? "ready" : s.start} />
          ) : (
            <Badge data-g={first ? "idle-timer" : undefined} variant="success">
              Running
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground truncate text-xs">
          {first
            ? `Pixel 6a · Android ${s.android}${loc ? ` · ${loc.label}` : ""} · up 4m`
            : "maria · Galaxy A05 · Android 15 · Poland · up 38m"}
        </div>
      </div>
      {idle && (
        <Button data-g="session-extend" variant="outline" size="sm">
          <TimerResetIcon />
          Extend
        </Button>
      )}
      <Button variant="ghost" size="icon">
        <EllipsisIcon />
      </Button>
      <Button data-g={first ? "session-open" : undefined} variant="outline" size="icon">
        <ArrowUpRightIcon />
      </Button>
    </li>
  )
}

export function Home({ s }: { s: PortalState }) {
  const q = s.search.toLowerCase()
  const rows = [
    {
      title: app.label,
      pkg: app.pkg,
      icon: app.icon,
      version: s.uploaded ? "2.5.0-rc1" : "2.4.0",
      builds: s.uploaded ? 4 : 3,
      source: s.uploaded ? "uploads" : "slack",
      latest: s.uploaded ? "just now" : "2 days ago",
      running: s.sessions > 0 ? 1 : 0,
      target: true,
    },
    ...otherApps.map((a) => ({
      title: a.label,
      pkg: a.pkg,
      icon: a.icon,
      version: a.version,
      builds: a.builds,
      source: a.source,
      latest: "3 days ago",
      running: a === otter && s.sessions > 1 ? 1 : 0,
      target: false,
    })),
  ].filter((c) => !q || c.title.toLowerCase().includes(q) || c.pkg.includes(q))

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden px-6 pt-5">
      <header className="flex items-center gap-3">
        <div className="mr-1 flex items-baseline gap-2.5">
          <h1 className="text-[22px] font-semibold tracking-[-.01em]">Apps</h1>
          <span className="text-muted-foreground text-xs">4 apps · {s.uploaded ? 15 : 14} builds</span>
        </div>
        <div className="bg-muted inline-flex h-9 items-center gap-0.5 rounded-[11px] border p-[3px] text-[13px] font-medium">
          <span className="bg-card text-foreground rounded-md border px-3 py-1">All</span>
          <span className="text-muted-foreground px-3">slack</span>
          <span className="text-muted-foreground px-3">uploads</span>
        </div>
        <span className="flex-1" />
        <label
          data-g="search"
          className="bg-card text-muted-foreground flex h-9 w-60 items-center gap-2 rounded-[10px] border px-3"
        >
          <SearchIcon className="size-4 shrink-0" />
          <input
            readOnly
            value={s.search}
            placeholder="App, package or branch"
            className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          <kbd className="rounded-[5px] border px-[5px] py-px font-sans text-[11px]">/</kbd>
        </label>
        <Button data-g="upload" className="h-9">
          <UploadIcon />
          Upload APK
        </Button>
      </header>
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_320px] items-start gap-5">
        <ul className="bg-card rounded-2xl border px-5 py-1">
          {rows.map((r) => (
            <AppRow key={r.pkg} s={s} {...r} />
          ))}
        </ul>
        <section data-g="sessions" className="bg-card flex min-w-0 flex-col gap-4 rounded-2xl border p-5">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Devices</h2>
            {s.sessions > 0 && (
              <Badge variant="secondary">{s.sessions === 1 ? "1 running" : `1 of ${s.sessions} yours`}</Badge>
            )}
          </div>
          <Capacity s={s} />
          {s.sessions === 0 ? (
            <p className="text-muted-foreground rounded-xl border border-dashed py-8 text-center text-sm">
              No devices running. Launch an app to start one.
            </p>
          ) : (
            <ul className="flex flex-col">
              {Array.from({ length: s.sessions }, (_, i) => (
                <SessionRow key={i} s={s} index={i} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
