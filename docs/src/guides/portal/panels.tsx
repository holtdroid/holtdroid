import {
  ActivityIcon,
  ArrowLeftRightIcon,
  BatteryChargingIcon,
  BellIcon,
  BugIcon,
  CameraIcon,
  ClipboardPasteIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileArchiveIcon,
  GlobeIcon,
  LanguagesIcon,
  LeafIcon,
  MapPinIcon,
  MonitorSmartphoneIcon,
  MoonIcon,
  NavigationIcon,
  PinIcon,
  PlaneIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  SearchIcon,
  SignalIcon,
  SquareIcon,
  Trash2Icon,
  WifiIcon,
  ZapIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { Chips, InfoList, Note, Row, Section, ShadeButton, ShadeHeader, Tile } from "@/components/session/shade"
import { AppIcon } from "@/components/app-icon"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { PortalState } from "../types"
import { app, builds, locationOf, locations, networkProfiles, places, zones } from "./data"
import { Pop, ShadeBox } from "./overlays"

const noop = () => undefined

function G({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  return (
    <div data-g={id} className={cn("grid", className)}>
      {children}
    </div>
  )
}

function NetworkPanel({ s }: { s: PortalState }) {
  const loc = locationOf(s.location)
  const profile = networkProfiles.find((p) => p.id === s.network)
  return (
    <>
      <ShadeHeader title="Network" summary={loc ? `${loc.label} · ${loc.ip}` : "No VPN"} />
      <Section title="VPN location">
        {locations.map((l) => (
          <G key={l.id} id={`vpn-${l.id}`}>
            <Row
              selected={l.id === s.location}
              busy={s.locationBusy && l.id === s.location}
              flag={l.flag}
              title={l.label}
              onClick={noop}
            >
              {l.id === s.location ? l.ip : undefined}
            </Row>
          </G>
        ))}
      </Section>
      <Section title="Network conditions">
        <G id="net-conditions">
          <Row selected={false} icon={ActivityIcon} title={profile?.name ?? "No emulation"} onClick={noop}>
            Slow links, scenarios and regions in the Network tab
          </Row>
        </G>
      </Section>
      <div className="grid grid-cols-2 gap-2">
        <Tile icon={WifiIcon} label="Wi-Fi" on={s.network !== "subway"} onClick={noop} />
        <Tile icon={SignalIcon} label="Mobile data" on onClick={noop} />
        <G id="airplane" className="col-span-2">
          <Tile icon={PlaneIcon} label="Airplane mode" on={false} wide onClick={noop} />
        </G>
      </div>
    </>
  )
}

function WorldMap({ s }: { s: PortalState }) {
  const here = places[s.geo]
  return (
    <div data-g="gps-map" className="relative h-44 overflow-hidden rounded-3xl bg-sky-950">
      <svg viewBox="0 0 800 340" className="absolute inset-0 size-full" aria-hidden>
        <path
          d="M90 80c60-40 160-50 230-20s90 40 150 10 170-30 230 10 60 90 10 120-140 20-210 50-150 60-230 40-130-40-170-90-70-90-10-120z"
          fill="#1e3a2f"
        />
        <path d="M250 220c30-10 70 0 80 30s-10 60-40 70-60-20-60-50 0-40 20-50z" fill="#1e3a2f" />
        {s.route && (
          <path
            d={`M${places.amsterdam.x} ${places.amsterdam.y} Q 470 90 ${here.x} ${here.y}`}
            fill="none"
            stroke="#38bdf8"
            strokeWidth="4"
            strokeDasharray="10 8"
          />
        )}
      </svg>
      <span
        className="absolute size-5 -translate-1/2 rounded-full border-[3px] border-white bg-[#1a73e8] shadow transition-all duration-700"
        style={{ left: `${(here.x / 800) * 100}%`, top: `${(here.y / 340) * 100}%` }}
      />
    </div>
  )
}

function GpsPanel({ s }: { s: PortalState }) {
  const here = places[s.geo]
  return (
    <>
      <ShadeHeader title="GPS location" summary={`${here.name} · ${here.coords}`} onReset={noop} />
      <WorldMap s={s} />
      <Note>Tap the map or drag the dot to move the device.</Note>
      <G id="gps-places">
        <Chips
          title="Place"
          options={Object.entries(places).map(([value, p]) => ({ value: value as PortalState["geo"], label: p.name }))}
          value={s.geo}
          onChange={noop}
        />
      </G>
      <div className="grid grid-cols-2 gap-2">
        <G id="gps-follow">
          <Tile icon={MapPinIcon} label="Follow the VPN" on={false} status="Off, set for this session" onClick={noop} />
        </G>
        <G id="gps-route">
          <Tile
            icon={NavigationIcon}
            label="Route"
            on={s.route}
            status={s.route ? "Driving, 42 km/h" : "Off"}
            onClick={noop}
          />
        </G>
      </div>
    </>
  )
}

function ClipboardPanel({ s }: { s: PortalState }) {
  const modes = [
    { id: "both", title: "Both ways", hint: "Copy on either side, paste on the other", icon: ArrowLeftRightIcon },
    { id: "to", title: "To the device", hint: "What you copy here reaches the device", icon: ClipboardPasteIcon },
    { id: "from", title: "From the device", hint: "What the device copies lands in your clipboard", icon: CopyIcon },
  ] as const
  return (
    <>
      <ShadeHeader title="Clipboard sync" summary="On" />
      <Section title="Direction">
        {modes.map((m) => (
          <G key={m.id} id={`clip-${m.id}`}>
            <Row selected={s.clipboardMode === m.id} icon={m.icon} title={m.title} onClick={noop}>
              {m.hint}
            </Row>
          </G>
        ))}
      </Section>
      <Note>Ctrl/Cmd+V on the screen always pastes, with sync on or off.</Note>
    </>
  )
}

function LanguagePanel({ s }: { s: PortalState }) {
  const langs = [
    { id: "en", title: "English (United States)", flag: "🇺🇸" },
    { id: "uk", title: "Українська", flag: "🇺🇦" },
    { id: "de", title: "Deutsch", flag: "🇩🇪" },
  ] as const
  return (
    <>
      <ShadeHeader title="Language and keyboard" summary="System language" />
      <Section title="System language">
        {langs.map((l) => (
          <G key={l.id} id={`lang-${l.id}`}>
            <Row selected={s.locale === l.id} flag={l.flag} title={l.title} onClick={noop} />
          </G>
        ))}
      </Section>
      <Tile icon={LanguagesIcon} label="App language only" on={false} wide onClick={noop} />
    </>
  )
}

function TimePanel({ s }: { s: PortalState }) {
  const zone = zones[s.timeZone]
  return (
    <>
      <ShadeHeader title="Date and time" summary="Real time" onReset={s.timeZone === "amsterdam" ? undefined : noop} />
      <div className="grid gap-1 px-1">
        <span className="text-4xl leading-none font-light tabular-nums">{zone.time}</span>
        <span className="text-sm text-neutral-300">Thursday, 29 October</span>
        <span className="text-xs text-neutral-400">
          {zone.name} · {zone.offset}
        </span>
      </div>
      <Note>
        This Android shares the server&apos;s kernel and its clock, so the time can&apos;t be moved here. The time zone
        can.
      </Note>
      <Section title="Time zone">
        {(Object.keys(zones) as PortalState["timeZone"][]).map((id) => (
          <G key={id} id={`tz-${id}`}>
            <Row selected={s.timeZone === id} icon={GlobeIcon} title={zones[id].name} onClick={noop}>
              {zones[id].offset}
            </Row>
          </G>
        ))}
      </Section>
    </>
  )
}

function BatteryPanel({ s }: { s: PortalState }) {
  return (
    <>
      <ShadeHeader title="Battery" summary={`${s.battery}% · ${s.saver ? "Saver on" : "On battery"}`} />
      <G id="battery-level">
        <div className="relative h-14 overflow-hidden rounded-full bg-neutral-800">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-sky-200 transition-[width] duration-500"
            style={{ width: `calc(3.5rem + (100% - 3.5rem) * ${s.battery / 100})` }}
          />
          <span className="absolute top-1/2 right-5 -translate-y-1/2 text-sm font-medium tabular-nums">
            {s.battery}%
          </span>
        </div>
      </G>
      <G id="battery-presets">
        <Chips
          title="Presets"
          options={[5, 15, 50, 100].map((v) => ({ value: v, label: `${v}%` }))}
          value={s.battery}
          onChange={noop}
        />
      </G>
      <div className="grid grid-cols-2 gap-2">
        <Tile icon={BatteryChargingIcon} label="Charging" on={false} onClick={noop} />
        <G id="battery-saver">
          <Tile icon={LeafIcon} label="Battery saver" on={s.saver} onClick={noop} />
        </G>
      </div>
    </>
  )
}

function DisplayPanel({ s }: { s: PortalState }) {
  return (
    <>
      <ShadeHeader title="Display" summary={s.dark ? "Dark theme on" : "Light theme"} />
      <div className="grid grid-cols-2 gap-2">
        <G id="display-dark">
          <Tile icon={MoonIcon} label="Dark theme" on={s.dark} onClick={noop} />
        </G>
        <Tile icon={MonitorSmartphoneIcon} label="Match the portal" on={false} onClick={noop} />
      </div>
      <Chips
        title="Font size"
        options={["Small", "Default", "Large", "Larger"].map((v) => ({ value: v, label: v }))}
        value="Default"
        onChange={noop}
      />
    </>
  )
}

function Permission({
  id,
  icon: Icon,
  name,
  granted,
}: {
  id: string
  icon: typeof CameraIcon
  name: string
  granted: boolean
}) {
  return (
    <G id={id}>
      <Row selected={granted} icon={Icon} title={name} onClick={noop}>
        {granted ? "Granted, click to revoke" : "Not granted, click to grant"}
      </Row>
    </G>
  )
}

function AppPanel({ s }: { s: PortalState }) {
  return (
    <>
      <ShadeHeader title={app.label} summary={`${s.version} · ${s.appRunning ? "Running" : "Closed"}`} />
      <div className="grid grid-cols-2 gap-2">
        <G id="app-restart">
          <ShadeButton>
            <RotateCcwIcon />
            Restart app
          </ShadeButton>
        </G>
        <G id="app-save">
          <ShadeButton>
            <SaveIcon />
            Save app data
          </ShadeButton>
        </G>
        <G id="app-stop">
          <ShadeButton>
            <SquareIcon />
            Force stop
          </ShadeButton>
        </G>
        <G id="app-clear">
          <ShadeButton>
            <Trash2Icon />
            Clear data
          </ShadeButton>
        </G>
      </div>
      <section className="grid gap-1.5">
        <h4 className="px-1 text-xs font-medium text-neutral-400">Deep link</h4>
        <div className="flex gap-2">
          <div
            data-g="deeplink"
            className={cn(
              "flex h-10 min-w-0 flex-1 items-center rounded-full bg-neutral-800 px-4 font-mono text-xs",
              !s.deeplink && "text-neutral-500",
            )}
          >
            <span className="truncate">{s.deeplink || "myapp://checkout?id=42 or https://…"}</span>
          </div>
          <G id="deeplink-open">
            <ShadeButton primary>
              <ExternalLinkIcon />
              Open
            </ShadeButton>
          </G>
        </div>
      </section>
      <Section title="Permissions">
        <Permission id="perm-camera" icon={CameraIcon} name="Camera" granted={s.cameraGranted} />
        <Permission id="perm-notifications" icon={BellIcon} name="Notifications" granted={s.notificationsGranted} />
      </Section>
    </>
  )
}

function DevicePanel({ s }: { s: PortalState }) {
  return (
    <>
      <ShadeHeader title="Device" summary="Classic 16:9 · Android 16" />
      <InfoList
        items={[
          ["Model", "redroid_x86_64"],
          ["Android", "16 · API 36"],
          ["Build", "redroid_x86_64-userdebug"],
          ["Security patch", "2026-09-05"],
        ]}
      />
      <Section title="WebView provider">
        <G id="webview-builtin">
          <Row selected={s.webview === "builtin"} title="Android System WebView" onClick={noop}>
            As shipped with Android 16
          </Row>
        </G>
        <G id="webview-stable">
          <Row selected={s.webview === "stable"} title="Chromium 142" onClick={noop}>
            142.0.7444.59
          </Row>
        </G>
        <G id="webview-beta">
          <Row selected={s.webview === "beta"} title="Chromium 143" onClick={noop}>
            143.0.7499.12 · beta
          </Row>
        </G>
      </Section>
      <section className="grid gap-1.5">
        <h4 className="px-1 text-xs font-medium text-neutral-400">Bug report</h4>
        <div className="grid grid-cols-2 gap-2">
          <G id="bugreport-bundle">
            <ShadeButton primary disabled={s.bundling > 0 && s.bundling < 100}>
              <FileArchiveIcon />
              {s.bundling > 0 && s.bundling < 100 ? `Bundling… ${s.bundling}%` : "Bundle"}
            </ShadeButton>
          </G>
          <ShadeButton>
            <BugIcon />
            Full report
          </ShadeButton>
        </div>
        <Note>Bundle is a zip with a screenshot, logcat, the device's properties and what the app did.</Note>
      </section>
    </>
  )
}

function RecordingPanel({ s }: { s: PortalState }) {
  return (
    <>
      <ShadeHeader title="Recording" summary={s.recording ? `Recording · ${s.markers} markers` : "Not recording"} />
      <Note>
        The server keeps the screen, logcat, the WebViews' network and console, and what you tapped, to watch later in
        Recordings.
      </Note>
      <div className="grid grid-cols-2 gap-2">
        <G id="rec-mark">
          <ShadeButton primary disabled={!s.recording}>
            <PinIcon />
            Mark this moment
          </ShadeButton>
        </G>
        <G id="rec-stop">
          <ShadeButton>
            <SquareIcon />
            {s.recording ? "Stop recording" : "Start recording"}
          </ShadeButton>
        </G>
      </div>
    </>
  )
}

function SshPanel({ s }: { s: PortalState }) {
  return (
    <>
      <ShadeHeader title="SSH" summary={s.computerOnline ? "ADB connected" : "Not connected"} />
      <Note>
        Your computer reaches this device over SSH: adb, Chrome's inspect page and your local dev servers on the phone.
      </Note>
      <section className="grid gap-1.5">
        <h4 className="px-1 text-xs font-medium text-neutral-400">Published ports</h4>
        <div className="flex flex-wrap gap-1.5">
          <span
            data-g="ssh-port-5173"
            className={cn(
              "rounded-full px-3 py-1.5 font-mono text-xs",
              s.portPublished ? "bg-sky-200 text-sky-950" : "bg-neutral-800 text-neutral-300",
            )}
          >
            localhost:5173
          </span>
          <span className="rounded-full bg-neutral-800 px-3 py-1.5 font-mono text-xs text-neutral-300">
            localhost:8081
          </span>
        </div>
      </section>
      <ShadeButton>
        <ZapIcon />
        Connect a computer
      </ShadeButton>
    </>
  )
}

export function ShadePanelFor({ s }: { s: PortalState }) {
  const body = (() => {
    switch (s.panel) {
      case "network":
        return <NetworkPanel s={s} />
      case "gps":
        return <GpsPanel s={s} />
      case "clipboard":
        return <ClipboardPanel s={s} />
      case "language":
        return <LanguagePanel s={s} />
      case "time":
        return <TimePanel s={s} />
      case "battery":
        return <BatteryPanel s={s} />
      case "display":
        return <DisplayPanel s={s} />
      case "app":
        return <AppPanel s={s} />
      case "device":
        return <DevicePanel s={s} />
      case "recording":
        return <RecordingPanel s={s} />
      case "ssh":
        return <SshPanel s={s} />
      default:
        return null
    }
  })()
  if (!body) return null
  return <ShadeBox style={{ left: 186, top: 12, maxHeight: 610 }}>{body}</ShadeBox>
}

export function VersionMenu({ s }: { s: PortalState }) {
  return (
    <Pop style={{ left: 40, top: 4 }} className="w-96 gap-3 p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">Switch version</span>
        <span className="text-muted-foreground font-mono text-xs">App ID {app.pkg}</span>
      </div>
      <div className="border-input flex h-8 items-center gap-2 rounded-lg border px-2.5 text-sm">
        <SearchIcon className="text-muted-foreground size-4" />
        <span className="text-muted-foreground">Version, branch, uploader…</span>
      </div>
      <ul className="grid gap-1">
        {builds.map((b) => (
          <li
            key={b.version}
            data-g={`build-${b.version}`}
            className={cn("flex items-center gap-3 rounded-md px-2 py-1.5", b.version === s.version && "bg-accent")}
          >
            <AppIcon src={app.icon} className="size-8" />
            <span className="grid min-w-0 flex-1">
              <span className="text-sm font-medium">
                {b.version} <span className="text-muted-foreground font-normal">· {b.branch}</span>
              </span>
              <span className="text-muted-foreground truncate text-xs">
                {b.note} · {b.by} · {b.when}
              </span>
            </span>
            {b.version === s.version && <RefreshCwIcon className="text-muted-foreground size-3.5" />}
          </li>
        ))}
      </ul>
      <div data-g="keep-data" className="flex items-center gap-2 border-t pt-3">
        <Switch checked={s.keepData} />
        <span className="grid text-sm">
          Keep app data
          <span className="text-muted-foreground text-xs">
            {s.keepData ? "Keeping the app's data" : "The current build and its data are removed first."}
          </span>
        </span>
      </div>
    </Pop>
  )
}
