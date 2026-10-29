import {
  ActivityIcon,
  ArrowLeftIcon,
  CameraIcon,
  MicIcon,
  MicOffIcon,
  MonitorPlayIcon,
  TvIcon,
  VideoIcon,
  BatteryFullIcon,
  BatteryLowIcon,
  CableIcon,
  ClipboardIcon,
  ClockIcon,
  CpuIcon,
  GaugeIcon,
  GlobeIcon,
  KeyboardIcon,
  LanguagesIcon,
  LaptopIcon,
  Link2Icon,
  MapPinIcon,
  MonitorSmartphoneIcon,
  MoonIcon,
  NavigationIcon,
  OctagonXIcon,
  PackageIcon,
  PinIcon,
  PlayIcon,
  PlugIcon,
  SmartphoneIcon,
  SquareIcon,
  SunIcon,
  SunMediumIcon,
  TimerResetIcon,
  TypeIcon,
  WifiIcon,
} from "lucide-react"
import { AppIcon } from "@/components/app-icon"
import { SessionStateBadge } from "@/components/session-state-badge"
import { StartProgress } from "@/components/session/start-progress"
import { CardLine, ShadeCard } from "@/components/session/shade"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { PortalState } from "../types"
import { app, locationOf, networkProfiles, places, zones } from "./data"
import { ShadePanelFor, VersionMenu } from "./panels"
import { Phone } from "./phone"
import { ToolTabs } from "./tools"

export function SessionHeader({ s }: { s: PortalState }) {
  const webview = s.webview === "builtin" ? "" : s.webview === "beta" ? " · WebView 143" : " · WebView 142"
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Button variant="ghost" size="icon-sm">
        <ArrowLeftIcon />
      </Button>
      <div data-g="version-switcher" className="-ml-2 flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1">
        <AppIcon src={app.icon} className="size-9" />
        <span className="grid min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{app.label}</span>
            <span data-g="state-badge">
              <SessionStateBadge state={s.start} />
            </span>
          </span>
          <span className="text-muted-foreground truncate font-mono text-xs">
            {app.pkg} · {s.version} · redroid-1{webview}
          </span>
        </span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <span
          data-g="session-timer"
          className="text-muted-foreground inline-flex items-center gap-1 text-xs tabular-nums"
        >
          <ClockIcon className="size-3.5" />
          {s.idleMinutes}m
        </span>
        <Button data-g="share" size="sm" variant="outline">
          <Link2Icon />
          Share
        </Button>
        <Button data-g="extend" size="sm" variant="outline">
          <TimerResetIcon />
          Extend
        </Button>
        <Button data-g="stop" size="sm" variant="destructive">
          <SquareIcon />
          {s.start === "stopping" ? "Saving app data…" : "Stop"}
        </Button>
      </div>
    </div>
  )
}

function Widgets({ s }: { s: PortalState }) {
  const loc = locationOf(s.location)
  const profile = networkProfiles.find((p) => p.id === s.network)
  const recMinutes = Math.floor(s.recTime / 60)
  return (
    <div data-scroll className="relative min-h-0 overflow-y-auto [scrollbar-width:none]">
      <div data-g="widgets" className="flex flex-col gap-2 p-3">
        <ShadeCard data-g="w-app" aria-label="App">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <AppIcon src={app.icon} className="size-4 shrink-0 rounded" />
            <span className="truncate">{app.label}</span>
          </span>
          <CardLine icon={s.appRunning ? PlayIcon : OctagonXIcon}>{s.appRunning ? "Running" : "Closed"}</CardLine>
          <CardLine icon={PackageIcon}>{s.version}</CardLine>
          <CardLine icon={CpuIcon}>12% · 184 MB</CardLine>
        </ShadeCard>
        <ShadeCard data-g="w-network" aria-label="Network" changed={s.network !== "full"}>
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <span className="text-base leading-none">{loc?.flag ?? <GlobeIcon className="size-4" />}</span>
            <span className="truncate">{loc?.label ?? "No VPN"}</span>
          </span>
          {loc && <span className="truncate font-mono text-[11px] text-neutral-400">{loc.ip}</span>}
          <CardLine icon={s.network === "full" ? WifiIcon : GaugeIcon}>
            {s.network === "full" ? "Wi-Fi" : profile?.name}
          </CardLine>
        </ShadeCard>
        <ShadeCard data-g="w-gps" aria-label="GPS location" changed={s.geo !== "amsterdam" || s.route}>
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <MapPinIcon className="size-4 shrink-0 text-neutral-400" />
            <span className="truncate">{places[s.geo].name}</span>
          </span>
          <CardLine icon={s.route ? NavigationIcon : GlobeIcon}>{s.route ? "Driving" : "Follows the VPN"}</CardLine>
        </ShadeCard>
        <ShadeCard data-g="w-ssh" aria-label="SSH">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <CableIcon className={cn("size-4 shrink-0", s.computerOnline ? "text-emerald-400" : "text-neutral-400")} />
            SSH
          </span>
          <CardLine icon={s.computerOnline ? LaptopIcon : PlugIcon}>
            {s.computerOnline ? "ADB connected" : "Not connected"}
          </CardLine>
          {s.portPublished && <CardLine icon={SmartphoneIcon}>1 port published</CardLine>}
        </ShadeCard>
        <ShadeCard data-g="w-stream" aria-label="Stream and keyboard">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <MonitorPlayIcon className="size-4 shrink-0 text-neutral-400" />
            <span className="truncate">H.264</span>
          </span>
          <CardLine icon={VideoIcon}>1080p · 60 fps</CardLine>
          <CardLine icon={ActivityIcon}>58 fps · 4.1 Mbit/s</CardLine>
        </ShadeCard>
        <ShadeCard data-g="w-display" aria-label="Display" changed={s.dark}>
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold tabular-nums">
            <SunMediumIcon className="size-4 shrink-0 text-neutral-400" />
            Auto
          </span>
          <CardLine icon={s.dark ? MoonIcon : SunIcon}>{s.dark ? "Dark theme" : "Light theme"}</CardLine>
          <CardLine icon={TypeIcon}>Font 100%</CardLine>
        </ShadeCard>
        <ShadeCard data-g="w-clipboard" aria-label="Clipboard" changed={s.clipboardMode !== "both"}>
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <ClipboardIcon className="size-4 shrink-0 text-neutral-400" />
            Clipboard
          </span>
          <CardLine icon={ClipboardIcon}>
            {s.clipboardMode === "both" ? "Both ways" : s.clipboardMode === "to" ? "To the device" : "From the device"}
          </CardLine>
        </ShadeCard>
        <ShadeCard data-g="w-microphone" aria-label="Microphone">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <MicIcon className="size-4 shrink-0 text-neutral-400" />
            <span className="truncate">Microphone</span>
          </span>
          <CardLine icon={MicOffIcon}>Off</CardLine>
        </ShadeCard>
        <ShadeCard data-g="w-camera" aria-label="Camera">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <CameraIcon className="size-4 shrink-0 text-neutral-400" />
            <span className="truncate">Camera</span>
          </span>
          <CardLine icon={TvIcon}>Test card</CardLine>
        </ShadeCard>
        <ShadeCard data-g="w-battery" aria-label="Battery" changed={s.battery !== 100 || s.saver}>
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium tabular-nums">
            {s.battery <= 15 ? (
              <BatteryLowIcon className="size-4 shrink-0 text-red-400" />
            ) : (
              <BatteryFullIcon className="size-4 shrink-0 text-neutral-400" />
            )}
            {s.battery}%
          </span>
          <CardLine icon={PlugIcon}>{s.saver ? "Saver on" : "On battery"}</CardLine>
        </ShadeCard>
        <ShadeCard data-g="w-language" aria-label="Language and keyboard" changed={s.locale !== "en"}>
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <LanguagesIcon className="size-4 shrink-0 text-neutral-400" />
            <span className="truncate">
              {s.locale === "en" ? "English" : s.locale === "uk" ? "Українська" : "Deutsch"}
            </span>
          </span>
          <CardLine icon={KeyboardIcon}>{s.locale === "en" ? "US" : s.locale === "uk" ? "UA" : "DE"}</CardLine>
        </ShadeCard>
        <ShadeCard data-g="w-time" aria-label="Date and time" changed={s.timeZone !== "amsterdam"}>
          <span className="text-xl font-light tabular-nums">{zones[s.timeZone].time}</span>
          <CardLine icon={GlobeIcon}>{zones[s.timeZone].name.split("/")[1]?.replace("_", " ")}</CardLine>
        </ShadeCard>
        <ShadeCard data-g="w-recording" aria-label="Recording">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <span
              className={cn(
                "size-2.5 shrink-0 rounded-full",
                s.recording ? "animate-pulse bg-red-500" : "bg-neutral-500",
              )}
            />
            Recording
          </span>
          <CardLine icon={ClockIcon}>
            {s.recording ? `${recMinutes}:${String(s.recTime % 60).padStart(2, "0")}` : "Not recording"}
          </CardLine>
          <CardLine icon={PinIcon}>{s.recording ? `Click to mark · ${s.markers}` : "Click to start"}</CardLine>
        </ShadeCard>
        <ShadeCard data-g="w-device" aria-label="Device">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <MonitorSmartphoneIcon className="size-4 shrink-0 text-neutral-400" />
            Classic 16:9
          </span>
          <CardLine icon={CpuIcon}>CPU 18% · 2.1 GB</CardLine>
        </ShadeCard>
      </div>
    </div>
  )
}

export function Session({ s }: { s: PortalState }) {
  if (s.start !== "ready" && s.start !== "stopping") {
    return (
      <div data-g="start-progress" className="h-full">
        <StartProgress
          state={s.start}
          appData={s.appData === "saved" ? (s.cache ? "cache" : "data") : undefined}
          webview={s.webview === "builtin" ? undefined : s.webview === "beta" ? "143" : "142"}
        />
      </div>
    )
  }
  return (
    <div className="relative grid h-full grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
      <div className="bg-muted/40 grid min-h-0 grid-cols-[182px_minmax(0,1fr)]">
        <Widgets s={s} />
        <div className="grid min-h-0 place-items-center">
          <Phone s={s} />
        </div>
      </div>
      <ToolTabs s={s} />
      <ShadePanelFor s={s} />
      {s.panel === "versions" && <VersionMenu s={s} />}
    </div>
  )
}
