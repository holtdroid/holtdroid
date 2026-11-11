import {
  ChevronDownIcon,
  ClockIcon,
  CloudIcon,
  DatabaseIcon,
  FileUpIcon,
  GitBranchIcon,
  PlayIcon,
  SparklesIcon,
  UsbIcon,
  type LucideIcon,
} from "lucide-react"
import type { Display, WebViewView } from "@/api/client"
import { AppIcon } from "@/components/app-icon"
import { AndroidVersionCard } from "@/components/launch/android-version"
import { ChoiceCard, ChoiceGroup, Chip, Section } from "@/components/launch/choice-card"
import { LivePreview } from "@/components/launch/live-preview"
import { ScreenCard } from "@/components/launch/screen-card"
import { WebViewChoice } from "@/components/launch/webview-choice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { PortalState } from "../types"
import { app, locations } from "./data"
import { Modal, ModalFooter } from "./overlays"

const noop = () => undefined

const screens: (Display & { key: PortalState["screen"] })[] = [
  {
    key: "pixel",
    id: "classic",
    label: "Classic 16:9",
    like: "Galaxy S5, Nexus 5X, Moto G4",
    width: 1080,
    height: 1920,
    dpi: 480,
    radius: 12,
  },
  {
    key: "small",
    id: "hd",
    label: "HD+",
    like: "Galaxy A05, Redmi 13C",
    width: 720,
    height: 1600,
    dpi: 280,
    radius: 14,
    shape: { kind: "drop", top: 0, width: 48, height: 24 },
  },
  {
    key: "tablet",
    id: "fhd",
    label: "FHD+ 20:9",
    like: "Pixel 6a–8a, Moto G54, Realme C67",
    width: 1080,
    height: 2400,
    dpi: 420,
    radius: 28,
    shape: { kind: "circle", top: 11, width: 24 },
  },
]

const webviews: WebViewView[] = [
  {
    id: "stable",
    title: "Chromium 142",
    version: "142.0.7444.59",
    channels: ["stable"],
    package: "com.android.webview",
    abis: ["x86_64"],
    milestone: 142,
    minSdk: 29,
    released: "2026-10-14T00:00:00Z",
    size: 0,
  },
  {
    id: "beta",
    title: "Chromium 143",
    version: "143.0.7499.12",
    channels: ["beta"],
    package: "com.android.webview",
    abis: ["x86_64"],
    milestone: 143,
    minSdk: 29,
    released: "2026-10-22T00:00:00Z",
    size: 0,
  },
  {
    id: "old",
    title: "Chromium 139",
    version: "139.0.7258.158",
    channels: [],
    package: "com.android.webview",
    abis: ["x86_64"],
    milestone: 139,
    minSdk: 29,
    released: "2026-08-05T00:00:00Z",
    size: 0,
  },
]

function Segment({
  icon: Icon,
  label,
  free,
  selected,
}: {
  icon: LucideIcon
  label: string
  free: number
  selected: boolean
}) {
  return (
    <span
      className={cn(
        "flex h-[34px] flex-1 items-center justify-center gap-2 rounded-lg border px-2.5 text-[13px] font-medium [&_svg]:size-4",
        selected ? "bg-card text-foreground shadow-xs" : "text-muted-foreground border-transparent",
      )}
    >
      <Icon />
      {label}
      <Badge variant={free > 0 ? "success" : "secondary"}>{free} free</Badge>
    </span>
  )
}

export function LaunchDialog({ s }: { s: PortalState }) {
  const screen = screens.find((d) => d.key === s.screen) ?? screens[0]!
  const loc = locations.find((l) => l.id === s.location)
  const webview = webviews.find((w) => w.id === s.webview)
  return (
    <Modal className="h-[640px] max-w-[1000px] grid-cols-[minmax(0,1fr)_280px] grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden p-0">
      <div className="flex min-h-0 flex-col">
        <div className="flex items-center gap-3 border-b px-5 py-4">
          <AppIcon src={app.icon} className="size-10 rounded-[11px]" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold">{app.label}</span>
              <span className="text-muted-foreground font-mono">{s.uploaded ? "2.5.0-rc1" : "2.4.0"}</span>
              <Badge variant="info">Latest</Badge>
            </div>
            <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
              <GitBranchIcon className="size-3.5" />
              main · build {s.uploaded ? 250 : 240} · minSdk 29
            </div>
          </div>
        </div>
        <div
          data-scroll
          className="relative grid min-h-0 content-start gap-5 overflow-y-auto px-5 py-4 [scrollbar-width:none]"
        >
          <div className="bg-muted flex gap-0.5 rounded-[11px] border p-[3px]">
            <span data-g="provider-emulator" className="flex flex-1">
              <Segment
                icon={CloudIcon}
                label="Virtual device"
                free={5 - s.sessions}
                selected={s.provider === "emulator"}
              />
            </span>
            <span data-g="provider-physical" className="flex flex-1">
              <Segment icon={UsbIcon} label="Physical phone" free={1} selected={s.provider === "physical"} />
            </span>
          </div>
          <LaunchOptions s={s} />
        </div>
      </div>
      <aside className="bg-muted flex min-h-0 flex-col border-l">
        <div className="text-muted-foreground border-b px-4 py-3.5 font-mono text-xs">Preview</div>
        <div className="relative min-h-0 flex-1">
          <div data-g="launch-preview" className="absolute inset-0 grid place-items-center overflow-hidden">
            <div className="scale-[0.7]">
              <LivePreview display={screen} />
            </div>
          </div>
        </div>
        <div className="px-4 text-center">
          <div className="font-semibold">{screen.label}</div>
          <div className="text-muted-foreground text-xs">{screen.like}</div>
        </div>
        <dl className="mx-4 my-3 grid grid-cols-[80px_minmax(0,1fr)] gap-y-2 text-[13px]">
          <dt className="text-muted-foreground">Android</dt>
          <dd>{s.android}</dd>
          <dt className="text-muted-foreground">WebView</dt>
          <dd className="truncate font-mono text-xs leading-5">
            {webview ? `Chromium ${webview.version}` : "Built-in"}
          </dd>
          <dt className="text-muted-foreground">Location</dt>
          <dd className="truncate">{loc ? `${loc.flag} ${loc.label}` : "Direct"}</dd>
          <dt className="text-muted-foreground">App data</dt>
          <dd>{s.appData === "saved" ? "Saved 2 hours ago" : "Fresh install"}</dd>
        </dl>
        <div className="grid gap-3 border-t px-4 pt-3.5 pb-4">
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <ClockIcon className="size-3.5" />
            {5 - s.sessions} of 6 devices free
          </p>
          <div data-g="record" className="flex items-center gap-2">
            <Checkbox checked={s.record} />
            <Label className="font-normal">Record from start</Label>
          </div>
          <Button data-g="launch-submit" size="lg" className="w-full">
            <PlayIcon />
            Launch
          </Button>
        </div>
      </aside>
    </Modal>
  )
}

function LaunchOptions({ s }: { s: PortalState }) {
  const versions: PortalState["android"][] = ["13", "14", "15", "16"]
  const webview = s.webview === "builtin" ? "" : s.webview
  return (
    <>
      <Section title="Android" hint="Pinecone Shop runs on Android 10 and newer">
        <ChoiceGroup label="Android version" className="grid-cols-4">
          {versions.map((v) => (
            <div key={v} data-g={`android-${v}`} className="grid">
              <AndroidVersionCard version={v} selected={s.android === v} onSelect={noop} />
            </div>
          ))}
        </ChoiceGroup>
      </Section>
      <Section title="Screen" hint="Size is fixed for the session; density can change later">
        <ChoiceGroup label="Screen" className="grid-cols-4">
          {screens.map((d) => (
            <div key={d.id} data-g={`screen-${d.key}`} className="grid">
              <ScreenCard display={d} selected={s.screen === d.key} favorite={d.key === "small"} onSelect={noop} />
            </div>
          ))}
          <span className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-3 text-center">
            <span className="text-xl font-semibold">64</span>
            <span className="text-[13px] font-medium">All devices</span>
            <span className="text-muted-foreground text-xs">Samsung, Xiaomi…</span>
          </span>
        </ChoiceGroup>
      </Section>
      <div data-g="webview">
        <WebViewChoice webviews={webviews} selected={webview} android={s.android} onSelect={noop} />
      </div>
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5">
        <Section title="VPN location" hint="Switchable during the session">
          <div data-g="launch-locations" className="flex flex-wrap gap-1.5">
            {locations.map((l) => (
              <span key={l.id} data-g={`launch-location-${l.id}`}>
                <Chip selected={l.id === s.location} onSelect={noop}>
                  <span
                    className={cn(
                      "font-mono text-[11px]",
                      l.id === s.location ? "opacity-70" : "text-muted-foreground",
                    )}
                  >
                    {l.id.toUpperCase()}
                  </span>
                  {l.label}
                </Chip>
              </span>
            ))}
          </div>
        </Section>
        <Section title="App data">
          <ChoiceGroup label="App data" className="grid-cols-2">
            <div data-g="data-fresh" className="grid">
              <ChoiceCard selected={s.appData === "fresh"} onSelect={noop} className="px-3 py-2.5">
                <span className="flex items-center gap-1.5 pr-5 text-[13px] font-medium">
                  <SparklesIcon className="size-3.5" />
                  Fresh install
                </span>
                <span className="text-muted-foreground text-xs">Nothing saved</span>
              </ChoiceCard>
            </div>
            <div data-g="data-saved" className="grid">
              <ChoiceCard selected={s.appData === "saved"} onSelect={noop} className="px-3 py-2.5">
                <span className="flex items-center gap-1.5 pr-5 text-[13px] font-medium">
                  <DatabaseIcon className="size-3.5" />
                  Saved 2 hours ago
                </span>
                <span className="text-muted-foreground truncate text-xs">2.4.0 · 18.2 MB</span>
              </ChoiceCard>
            </div>
          </ChoiceGroup>
          {s.appData === "saved" && (
            <div data-g="data-cache" className="flex items-center gap-2">
              <Checkbox checked={s.cache} />
              <Label className="font-normal">Also restore the cache</Label>
            </div>
          )}
        </Section>
      </div>
    </>
  )
}

export function UploadDialog({ s }: { s: PortalState }) {
  const uploading = s.uploadProgress > 0
  return (
    <Modal className="max-w-md">
      <div className="grid gap-2">
        <div className="text-base leading-none font-medium">Upload an APK</div>
        <p className="text-muted-foreground text-sm">
          It goes to the “uploads” source. You can delete it or change who sees it later.
        </p>
      </div>
      <div className="grid gap-4">
        <div
          data-g="upload-drop"
          className={cn(
            "grid place-items-center gap-1 rounded-xl border border-dashed p-6 text-center transition-colors",
            s.uploadFile && "border-primary bg-accent/40",
          )}
        >
          <FileUpIcon className="text-muted-foreground size-6" />
          {s.uploadFile ? (
            <span className="text-sm font-medium">pinecone-2.5.0-rc1-debug.apk · 42.7 MB</span>
          ) : (
            <span className="text-muted-foreground text-sm">Drop an .apk here or click to choose one</span>
          )}
        </div>
        <div data-g="upload-visibility" className="grid gap-2">
          <Label>Who can see it</Label>
          <div className="border-input flex h-8 w-full items-center justify-between rounded-lg border px-2.5 text-sm">
            {s.uploadPrivate ? "Only me (and admins)" : "Everyone"}
            <ChevronDownIcon className="text-muted-foreground size-4" />
          </div>
        </div>
        <div data-g="upload-temporary" className="flex items-start gap-3">
          <Checkbox checked className="mt-0.5" />
          <div className="grid gap-1">
            <Label>Temporary</Label>
            <p className="text-muted-foreground text-sm">
              Deleted automatically 7 days after its last launch. You can make it permanent later.
            </p>
          </div>
        </div>
        <div data-g="upload-note" className="grid gap-2">
          <Label>Note</Label>
          <Input readOnly value={s.uploadNote} placeholder="What is this build for?" />
        </div>
        <div className="grid gap-2">
          <Label>Changelog</Label>
          <Textarea readOnly className="min-h-14" placeholder="- Fixed login on Android 15" />
        </div>
        {uploading && <Progress value={s.uploadProgress} className="h-1.5" />}
      </div>
      <ModalFooter>
        <Button variant="outline">Cancel</Button>
        <Button data-g="upload-submit" disabled={!s.uploadFile}>
          {uploading ? "Uploading…" : "Upload"}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
