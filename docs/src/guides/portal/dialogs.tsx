import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  DatabaseIcon,
  FileUpIcon,
  MonitorSmartphoneIcon,
  RocketIcon,
  SmartphoneIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react"
import type { Display, WebViewView } from "@/api/client"
import { AppIcon } from "@/components/app-icon"
import { AndroidVersionCard } from "@/components/launch/android-version"
import { ChoiceCard, ChoiceGroup, Section } from "@/components/launch/choice-card"
import { ScreenCard } from "@/components/launch/screen-card"
import { WebViewChoice } from "@/components/launch/webview-choice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
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
    package: "org.chromium.webview",
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
    package: "org.chromium.webview",
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
    package: "org.chromium.webview",
    abis: ["x86_64"],
    milestone: 139,
    minSdk: 29,
    released: "2026-08-05T00:00:00Z",
    size: 0,
  },
]

function Provider({
  icon: Icon,
  title,
  name,
  blurb,
  free,
  total,
  recommended,
  selected,
}: {
  icon: LucideIcon
  title: string
  name: string
  blurb: string
  free: number
  total: number
  recommended?: boolean
  selected: boolean
}) {
  return (
    <ChoiceCard selected={selected} onSelect={noop} className="gap-3 p-4">
      <div className="flex items-center gap-3">
        <span className="bg-primary/10 text-primary grid size-11 shrink-0 place-items-center rounded-xl">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{title}</span>
            {recommended && <Badge variant="secondary">Recommended</Badge>}
          </div>
          <div className="text-muted-foreground truncate text-xs">{name}</div>
        </div>
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed">{blurb}</p>
      <div className="flex items-center gap-1.5 text-xs">
        <span className={cn("size-2 rounded-full", free > 0 ? "bg-emerald-500" : "bg-amber-500")} />
        <span className="font-medium tabular-nums">
          {free} of {total}
        </span>
        <span className="text-muted-foreground">available</span>
      </div>
    </ChoiceCard>
  )
}

export function LaunchDialog({ s }: { s: PortalState }) {
  return (
    <Modal className="max-h-[640px] max-w-[772px] grid-rows-[auto_minmax(0,1fr)_auto]">
      <div className="flex items-center gap-3 pr-6">
        <AppIcon src={app.icon} className="size-10" />
        <div className="min-w-0">
          <div className="truncate text-base leading-none font-medium">Launch {app.label}</div>
          <div className="text-muted-foreground mt-1.5 truncate font-mono text-xs">
            {app.pkg} · {s.uploaded ? "2.5.0-rc1" : "2.4.0"}
          </div>
        </div>
      </div>
      <div
        data-scroll
        className="relative -mx-1 grid min-h-0 content-start gap-5 overflow-y-auto px-1 py-1 [scrollbar-width:none]"
      >
        {s.launchStage === "provider" ? (
          <Section title="Where should it run?" hint="A virtual device is the most flexible choice.">
            <ChoiceGroup label="Provider" className="grid-cols-2">
              <div data-g="provider-emulator" className="grid">
                <Provider
                  icon={MonitorSmartphoneIcon}
                  title="Virtual device"
                  name="emulator"
                  blurb="Android in a container. Pick the Android version and screen, switch locations on the fly. Ready in about half a minute."
                  free={5 - s.sessions}
                  total={6}
                  recommended
                  selected={s.provider === "emulator"}
                />
              </div>
              <div data-g="provider-physical" className="grid">
                <Provider
                  icon={SmartphoneIcon}
                  title="Real phone"
                  name="phones"
                  blurb="A physical phone over USB: real hardware, real sensors, the vendor's own Android."
                  free={1}
                  total={2}
                  selected={s.provider === "physical"}
                />
              </div>
            </ChoiceGroup>
          </Section>
        ) : (
          <LaunchOptions s={s} />
        )}
      </div>
      <ModalFooter className="items-center justify-between">
        {s.launchStage === "options" ? (
          <Button variant="ghost">
            <ArrowLeftIcon />
            Back
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="outline">Cancel</Button>
          {s.launchStage === "provider" ? (
            <Button data-g="launch-continue">
              Continue
              <ArrowRightIcon />
            </Button>
          ) : (
            <Button data-g="launch-submit">
              <RocketIcon />
              Launch
            </Button>
          )}
        </div>
      </ModalFooter>
    </Modal>
  )
}

function LaunchOptions({ s }: { s: PortalState }) {
  const versions: PortalState["android"][] = ["16", "15", "14", "13"]
  const webview = s.webview === "builtin" ? "" : s.webview
  return (
    <div className="grid content-start gap-5">
      <Section title="Android version" hint="The newest one the app supports is picked for you.">
        <ChoiceGroup label="Android version" className="grid-cols-5">
          {versions.map((v) => (
            <div key={v} data-g={`android-${v}`} className="grid">
              <AndroidVersionCard version={v} selected={s.android === v} onSelect={noop} />
            </div>
          ))}
        </ChoiceGroup>
      </Section>
      <Section title="Screen" hint="The size is fixed for the session; the density can still be changed later.">
        <ChoiceGroup label="Screen" className="grid-cols-3">
          {screens.map((d) => (
            <div key={d.id} data-g={`screen-${d.key}`} className="grid">
              <ScreenCard display={d} selected={s.screen === d.key} onSelect={noop} />
            </div>
          ))}
        </ChoiceGroup>
      </Section>
      <div data-g="webview">
        <WebViewChoice webviews={webviews} selected={webview} android={s.android} onSelect={noop} />
      </div>
      <Section title="VPN location" hint="You can switch the location any time during the session.">
        <div data-g="launch-locations" className="flex flex-wrap gap-1.5">
          {locations.map((l) => (
            <Button
              key={l.id}
              data-g={`launch-location-${l.id}`}
              className="h-9 gap-2 px-3"
              variant={l.id === s.location ? "default" : "outline"}
            >
              <span className="text-lg leading-none">{l.flag}</span>
              {l.label}
              {l.id === "nl" && <span className="opacity-60">· default</span>}
            </Button>
          ))}
        </div>
      </Section>
      <Section
        title="App data"
        hint="What the app keeps on the device: logins, settings and databases. It is saved when a session stops."
      >
        <ChoiceGroup label="App data" className="grid-cols-2">
          <div data-g="data-fresh" className="grid">
            <ChoiceCard selected={s.appData === "fresh"} onSelect={noop}>
              <div className="flex items-center gap-2.5">
                <span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg">
                  <SparklesIcon className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium">Fresh install</div>
                  <div className="text-muted-foreground text-xs">A clean device, nothing saved</div>
                </div>
              </div>
            </ChoiceCard>
          </div>
          <div data-g="data-saved" className="grid">
            <ChoiceCard selected={s.appData === "saved"} onSelect={noop}>
              <div className="flex items-center gap-2.5">
                <span className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-lg">
                  <DatabaseIcon className="size-4" />
                </span>
                <div className="min-w-0 pr-5">
                  <div className="text-sm font-medium">Saved 2 hours ago</div>
                  <div className="text-muted-foreground truncate text-xs">2.4.0 · 18.2 MB</div>
                </div>
              </div>
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
      <div data-g="record" className="flex items-start gap-2.5">
        <Switch checked={s.record} />
        <Label className="grid gap-0.5 font-normal">
          <span>Record the session</span>
          <span className="text-muted-foreground text-xs">
            The screen, logcat, device and network on the server, to watch or share later in Recordings
          </span>
        </Label>
      </div>
    </div>
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
