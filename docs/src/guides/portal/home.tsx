import {
  BookOpenIcon,
  CheckIcon,
  ClapperboardIcon,
  ClockIcon,
  DatabaseIcon,
  GlobeIcon,
  HardDriveIcon,
  LaptopIcon,
  LayoutGridIcon,
  MonitorSmartphoneIcon,
  MoonIcon,
  PackageIcon,
  RocketIcon,
  SearchIcon,
  SquareIcon,
  TimerResetIcon,
  UploadIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { AppIcon } from "@/components/app-icon"
import { SessionStateBadge } from "@/components/session-state-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import logo from "@/logo.svg?url"
import type { PortalState } from "../types"
import { app, locationOf, otherApps, otter } from "./data"
import { Pop } from "./overlays"

export function Header({ s, children }: { s: PortalState; children?: ReactNode }) {
  const nav: [string, LucideIcon, boolean][] = [
    ["nav-apps", LayoutGridIcon, s.page === "home"],
    ["nav-app-data", DatabaseIcon, false],
    ["nav-recordings", ClapperboardIcon, s.page === "recordings" || s.page === "recording"],
    ["nav-computers", LaptopIcon, s.page === "computers"],
  ]
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
      {children ?? (
        <span className="flex items-center gap-2 font-semibold tracking-tight">
          <img src={logo} alt="" className="size-7" />
          Holtdroid
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        {nav.map(([id, Icon, active]) => (
          <Button key={id} data-g={id} variant="ghost" size="icon" className={cn("relative", active && "bg-muted")}>
            <Icon />
            {id === "nav-computers" && s.computerOnline && (
              <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-emerald-500 px-1 text-[10px] leading-none font-semibold text-white">
                1
              </span>
            )}
          </Button>
        ))}
        <Button variant="ghost" size="icon">
          <BookOpenIcon />
        </Button>
        <Button variant="ghost" size="icon">
          <MoonIcon />
        </Button>
        <span className="ml-1 flex items-center gap-2 px-1.5">
          <span className="grid size-7 place-items-center rounded-full bg-amber-200 text-xs font-semibold text-amber-900">
            A
          </span>
          <span className="text-sm">Alex</span>
        </span>
      </div>
    </header>
  )
}

function AppCard({
  title,
  pkg,
  icon,
  version,
  builds,
  sources,
  latest,
  target,
  s,
}: {
  title: string
  pkg: string
  icon: string
  version: string
  builds: number
  sources: string[]
  latest: string
  target?: boolean
  s: PortalState
}) {
  return (
    <li
      data-g={target ? "app-card" : undefined}
      className="bg-card relative flex flex-col gap-2 rounded-xl border p-3 transition-colors"
    >
      <div className="flex items-start gap-3">
        <AppIcon src={icon} className="size-12" />
        <div className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          <span className="text-muted-foreground block truncate font-mono text-xs">{pkg}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant="secondary">{version}</Badge>
        <Badge variant="outline">{builds} builds</Badge>
        {sources.map((src) => (
          <Badge key={src} variant="outline" className="font-normal">
            {src}
          </Badge>
        ))}
      </div>
      <div className="mt-auto flex items-center gap-2">
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{latest}</span>
        <div className="relative flex shrink-0 items-center gap-1">
          <span className="relative">
            <Button data-g={target ? "quick-launch" : undefined} variant="outline" size="icon">
              <ZapIcon />
            </Button>
            {target && s.panel === "quick" && <QuickMenu />}
          </span>
          <Button data-g={target ? "launch" : undefined}>
            <RocketIcon />
            Launch
          </Button>
        </div>
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

function SlotPills({ busy }: { busy: number }) {
  const slots = 6
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {Array.from({ length: slots }, (_, i) => (
        <span
          key={i}
          className={cn("h-2.5 max-w-6 min-w-1 flex-1 rounded-full", i < busy ? "bg-amber-500" : "bg-emerald-500/70")}
        />
      ))}
      <span className="text-muted-foreground ml-auto pl-1 whitespace-nowrap tabular-nums">
        {slots - busy}/{slots}
      </span>
    </div>
  )
}

function SessionCard({ s, index }: { s: PortalState; index: number }) {
  const first = index === 0
  const label = first ? app.label : otter.label
  const loc = locationOf(s.location)
  const minutes = first ? s.idleMinutes : 9
  return (
    <li data-g={first ? "session-card" : undefined} className="bg-card grid gap-3 rounded-xl border p-3">
      <div className="flex items-start gap-3">
        <AppIcon src={first ? app.icon : otter.icon} className="size-10" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate font-medium">{label}</span>
            <SessionStateBadge state={first && s.start !== "stopping" ? s.start : "ready"} />
          </div>
          <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 text-xs">
            <span>Alex</span>
            <span>{first ? "redroid-1" : "redroid-3"}</span>
            <span>up {first ? "4m" : "38m"}</span>
            {loc && (
              <span className="inline-flex items-center gap-1">
                <GlobeIcon className="size-3" />
                {first ? loc.label : "Poland"}
              </span>
            )}
          </div>
        </div>
      </div>
      <div data-g={first ? "idle-timer" : undefined} className="grid gap-1">
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="size-3" />
            Stops when idle in {minutes}m
          </span>
          <span>TTL 7h 52m</span>
        </div>
        <Progress value={(minutes / 30) * 100} className="h-1" />
      </div>
      <div className="flex gap-2">
        <Button data-g={first ? "session-open" : undefined} size="sm" className="flex-1">
          Open
        </Button>
        <Button data-g={first ? "session-extend" : undefined} size="sm" variant="outline">
          <TimerResetIcon />
          Extend
        </Button>
        <Button data-g={first ? "session-stop" : undefined} size="sm" variant="outline">
          <SquareIcon />
          Stop
        </Button>
      </div>
    </li>
  )
}

export function Home({ s }: { s: PortalState }) {
  const q = s.search.toLowerCase()
  const cards = [
    {
      title: app.label,
      pkg: app.pkg,
      icon: app.icon,
      version: s.uploaded ? "2.5.0-rc1" : "2.4.0",
      builds: s.uploaded ? 4 : 3,
      sources: s.uploaded ? ["slack", "uploads"] : ["slack"],
      latest: s.uploaded ? "Latest just now by Alex" : "Latest 2 days ago by slack-sync",
      target: true,
    },
    ...otherApps.map((a) => ({
      title: a.label,
      pkg: a.pkg,
      icon: a.icon,
      version: a.version,
      builds: a.builds,
      sources: [a.source],
      latest: `Latest 3 days ago${a.by ? ` by ${a.by}` : ""}`,
      target: false,
    })),
  ].filter((c) => !q || c.title.toLowerCase().includes(q) || c.pkg.includes(q))

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_340px] items-start gap-6 overflow-hidden p-6">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Apps</h1>
          <p className="text-muted-foreground text-sm">
            Launch the latest build of an app on a fresh Android device, or open it to pick another build.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div data-g="search" className="relative flex-1">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              readOnly
              value={s.search}
              placeholder="Search by name, package, version, uploader, changelog…"
              className="pl-8"
            />
          </div>
          <Button data-g="upload" variant="outline">
            <UploadIcon />
            Upload
          </Button>
        </div>
        <ul className="grid grid-cols-2 gap-2">
          {cards.map((c) => (
            <AppCard key={c.pkg} s={s} {...c} />
          ))}
        </ul>
      </div>
      <section data-g="sessions" className="flex min-w-0 flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Active sessions</h2>
          <span className="text-muted-foreground text-xs">{s.sessions} running</span>
        </div>
        <div data-g="slots" className="flex min-w-0 items-center gap-2 text-xs">
          <MonitorSmartphoneIcon className="text-muted-foreground size-4 shrink-0" />
          <span className="w-24 shrink-0 truncate font-medium">emulator</span>
          <SlotPills busy={s.sessions + 1} />
        </div>
        {s.sessions === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
            No devices running. Pick an APK to launch one.
          </p>
        ) : (
          <ul className="grid gap-2">
            {Array.from({ length: s.sessions }, (_, i) => (
              <SessionCard key={i} s={s} index={i} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
