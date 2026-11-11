import {
  BatteryFullIcon,
  BatteryLowIcon,
  BellIcon,
  CableIcon,
  CameraIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronUpIcon,
  CircleIcon,
  ClipboardIcon,
  ClockIcon,
  KeyboardIcon,
  LanguagesIcon,
  type LucideIcon,
  MapPinIcon,
  MicIcon,
  MonitorPlayIcon,
  MonitorSmartphoneIcon,
  PackageIcon,
  PowerIcon,
  RotateCcwIcon,
  RotateCwIcon,
  ScanIcon,
  SearchIcon,
  SignalIcon,
  SquareIcon,
  SunMediumIcon,
  TimerResetIcon,
  ToggleRightIcon,
  Volume2Icon,
} from "lucide-react"
import type { ReactNode } from "react"
import { AppIcon } from "@/components/app-icon"
import { SessionStateBadge } from "@/components/session-state-badge"
import { StartProgress } from "@/components/session/start-progress"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { DeviceTab, Panel, PortalState } from "../types"
import { app, locationOf, networkProfiles, places, zones } from "./data"
import { PanelBody, VersionMenu } from "./panels"
import { Phone } from "./phone"
import { ToolTabs } from "./tools"

export function SessionHeader({ s }: { s: PortalState }) {
  const loc = locationOf(s.location)
  const webview = s.webview === "builtin" ? "" : s.webview === "beta" ? "WebView 143" : "WebView 142"
  const left = Math.max(1, Math.min(5, Math.ceil(s.idleMinutes / 6)))
  return (
    <header className="flex shrink-0 items-center gap-3.5">
      <Button variant="outline" size="icon">
        <ChevronLeftIcon />
      </Button>
      <AppIcon src={app.icon} className="size-10 rounded-[11px]" />
      <div className="grid min-w-0 gap-1">
        <div data-g="version-switcher" className="-mx-2 flex min-w-0 items-center gap-2 rounded-lg px-2 py-0.5">
          <span className="truncate text-lg font-semibold">{app.label}</span>
          <span className="text-muted-foreground shrink-0 font-mono text-[15px]">{s.version}</span>
          <span data-g="state-badge">
            <SessionStateBadge state={s.start} />
          </span>
          <ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge variant="secondary">Classic 16:9 · 1080×1920</Badge>
          <Badge variant="secondary">Android {s.android}</Badge>
          {webview && <Badge variant="secondary">{webview}</Badge>}
          {loc && (
            <Badge variant="secondary">
              {loc.flag} {loc.label}
            </Badge>
          )}
          <span className="text-muted-foreground ml-1 truncate font-mono text-xs">redroid-1</span>
        </div>
      </div>
      <span className="flex-1" />
      <div data-g="session-timer" className="flex w-44 flex-col gap-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Stops when idle in</span>
          <span className={cn("font-mono", s.idleMinutes <= 5 && "text-warning")}>{s.idleMinutes}m 00s</span>
        </div>
        <div className="flex gap-0.5" aria-hidden>
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full",
                i < left ? (s.idleMinutes <= 5 ? "bg-warning" : "bg-foreground") : "bg-border",
              )}
            />
          ))}
        </div>
      </div>
      {s.recording && (
        <Button data-g="session-record" variant="outline">
          <span className="bg-danger size-[7px] animate-pulse rounded-full" />
          <span className="font-mono">
            {Math.floor(s.recTime / 60)}:{String(s.recTime % 60).padStart(2, "0")}
          </span>
        </Button>
      )}
      <Button data-g="extend" variant="outline">
        <TimerResetIcon />
        Extend
      </Button>
      <Button data-g="stop" variant="destructive">
        <SquareIcon />
        {s.start === "stopping" ? "Saving app data…" : "Stop"}
      </Button>
    </header>
  )
}

type Row = {
  id: string
  panel?: Panel
  icon: LucideIcon
  title: string
  summary: ReactNode
  changed?: boolean
}

const groups: { value: DeviceTab; label: string }[] = [
  { value: "environment", label: "Environment" },
  { value: "media", label: "Media" },
  { value: "app", label: "App" },
]

function rows(s: PortalState): Record<DeviceTab, Row[]> {
  const loc = locationOf(s.location)
  const profile = networkProfiles.find((p) => p.id === s.network)
  const rec = `${Math.floor(s.recTime / 60)}:${String(s.recTime % 60).padStart(2, "0")}`
  return {
    environment: [
      {
        id: "w-network",
        panel: "network",
        icon: SignalIcon,
        title: "Network",
        summary: [loc ? `${loc.flag} ${loc.label}` : "No VPN", s.network === "full" ? "Wi-Fi" : profile?.name].join(
          " · ",
        ),
        changed: s.network !== "full",
      },
      {
        id: "w-gps",
        panel: "gps",
        icon: MapPinIcon,
        title: "Location",
        summary: `${places[s.geo].name} · ${s.route ? "Driving" : "Follows the VPN"}`,
        changed: s.geo !== "amsterdam" || s.route,
      },
      {
        id: "w-battery",
        panel: "battery",
        icon: s.battery <= 15 ? BatteryLowIcon : BatteryFullIcon,
        title: "Battery",
        summary: `${s.battery}% · ${s.saver ? "Saver on" : "On battery"}`,
        changed: s.battery !== 100 || s.saver,
      },
      {
        id: "w-language",
        panel: "language",
        icon: LanguagesIcon,
        title: "Language",
        summary: s.locale === "en" ? "English · US" : s.locale === "uk" ? "Українська · UA" : "Deutsch · DE",
        changed: s.locale !== "en",
      },
      {
        id: "w-time",
        panel: "time",
        icon: ClockIcon,
        title: "Time",
        summary: `${zones[s.timeZone].time} · ${zones[s.timeZone].name.split("/")[1]?.replace("_", " ")}`,
        changed: s.timeZone !== "amsterdam",
      },
      {
        id: "w-clipboard",
        panel: "clipboard",
        icon: ClipboardIcon,
        title: "Clipboard",
        summary:
          s.clipboardMode === "both" ? "Both ways" : s.clipboardMode === "to" ? "To the device" : "From the device",
        changed: s.clipboardMode !== "both",
      },
      {
        id: "w-display",
        panel: "display",
        icon: SunMediumIcon,
        title: "Display",
        summary: `${s.dark ? "Dark theme" : "Light theme"} · Font 100%`,
        changed: s.dark,
      },
    ],
    media: [
      {
        id: "w-stream",
        icon: MonitorPlayIcon,
        title: "Stream",
        summary: "H.264 · 1080p · 60 fps · 58 fps · 4.1 Mbit/s",
      },
      { id: "w-microphone", icon: MicIcon, title: "Microphone", summary: "Off" },
      { id: "w-camera", icon: CameraIcon, title: "Camera", summary: "Test card" },
      {
        id: "w-recording",
        panel: "recording",
        icon: CircleIcon,
        title: "Recording",
        summary: s.recording ? `${rec} · ${s.markers} markers` : "Not recording",
      },
    ],
    app: [
      {
        id: "w-app",
        panel: "app",
        icon: PackageIcon,
        title: "App",
        summary: `${s.appRunning ? "Running" : "Closed"} · ${s.version} · 12% · 184 MB`,
      },
      {
        id: "w-device",
        panel: "device",
        icon: MonitorSmartphoneIcon,
        title: "Device",
        summary: "Classic 16:9 · CPU 18% · 2.1 GB",
      },
      {
        id: "w-ssh",
        panel: "ssh",
        icon: CableIcon,
        title: "SSH",
        summary: [s.computerOnline ? "ADB connected" : "Not connected", s.portPublished && "1 port published"]
          .filter(Boolean)
          .join(" · "),
      },
    ],
  }
}

export function deviceTabOf(s: PortalState): DeviceTab {
  const all = rows(s)
  for (const g of groups) if (all[g.value].some((r) => r.panel && r.panel === s.panel)) return g.value
  return s.deviceTab
}

function DevicePanel({ s }: { s: PortalState }) {
  const tab = deviceTabOf(s)
  return (
    <aside
      data-g="device-panel"
      className="bg-card flex min-h-0 w-[280px] shrink-0 flex-col overflow-hidden rounded-2xl border"
    >
      <div className="flex flex-col gap-3 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Device</h2>
          <Button variant="outline" size="icon-sm">
            <SearchIcon />
          </Button>
        </div>
        <div className="bg-muted flex rounded-[11px] p-[3px]">
          {groups.map((g) => (
            <span
              key={g.value}
              data-g={`device-tab-${g.value}`}
              className={cn(
                "flex h-[26px] flex-1 items-center justify-center rounded-md text-[13px] font-medium",
                g.value === tab ? "bg-background text-foreground shadow-xs" : "text-muted-foreground",
              )}
            >
              {g.label}
            </span>
          ))}
        </div>
      </div>
      <div data-scroll className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 [scrollbar-width:none]">
        {rows(s)[tab].map((r) => (
          <DeviceRow key={r.id} row={r} open={!!r.panel && r.panel === s.panel} s={s} />
        ))}
      </div>
    </aside>
  )
}

function DeviceRow({ row: r, open, s }: { row: Row; open: boolean; s: PortalState }) {
  const Icon = r.icon
  return (
    <div className="border-b border-dashed last:border-b-0">
      <div data-g={r.id} className="flex min-h-12 items-center gap-2.5 py-2">
        <span
          className={cn(
            "bg-muted grid size-[30px] shrink-0 place-items-center rounded-[9px] border [&_svg]:size-4",
            open ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <Icon />
        </span>
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-sm font-medium">{r.title}</span>
          <span className="text-muted-foreground truncate text-xs">{r.summary}</span>
        </span>
        {r.changed && <Badge variant="warning">Changed</Badge>}
        <span className="bg-card text-muted-foreground grid size-7 shrink-0 place-items-center rounded-md border [&_svg]:size-3.5">
          {open ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </span>
      </div>
      {open && (
        <div className="flex flex-col gap-4 pt-1 pb-4">
          <PanelBody s={s} />
        </div>
      )}
    </div>
  )
}

const tools: (LucideIcon | null)[] = [
  ChevronLeftIcon,
  CircleIcon,
  SquareIcon,
  BellIcon,
  ToggleRightIcon,
  null,
  RotateCcwIcon,
  ScanIcon,
  KeyboardIcon,
  Volume2Icon,
  PowerIcon,
  null,
  RotateCwIcon,
]

function StageToolbar() {
  return (
    <div data-g="stage-toolbar" className="flex shrink-0 flex-col gap-1.5">
      {tools.map((Icon, i) =>
        Icon ? (
          <span
            key={i}
            className="bg-card text-muted-foreground grid size-8 place-items-center rounded-[10px] border [&_svg]:size-4"
          >
            <Icon />
          </span>
        ) : (
          <span key={i} aria-hidden className="bg-border mx-1.5 my-0.5 h-px" />
        ),
      )}
    </div>
  )
}

export function Session({ s }: { s: PortalState }) {
  const starting = s.start !== "ready" && s.start !== "stopping"
  return (
    <div className="relative flex h-full flex-col gap-3 px-4 pt-4">
      <SessionHeader s={s} />
      {starting ? (
        <div data-g="start-progress" className="min-h-0 flex-1 overflow-hidden">
          <StartProgress
            state={s.start}
            appData={s.appData === "saved" ? (s.cache ? "cache" : "data") : undefined}
            webview={s.webview === "builtin" ? undefined : s.webview === "beta" ? "143" : "142"}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 pb-3">
          <DevicePanel s={s} />
          <div className="flex shrink-0 items-center gap-3 px-1">
            <Phone s={s} />
            <StageToolbar />
          </div>
          <div className="bg-card min-w-0 flex-1 overflow-hidden rounded-2xl border">
            <ToolTabs s={s} />
          </div>
        </div>
      )}
      {s.panel === "versions" && <VersionMenu s={s} />}
    </div>
  )
}
