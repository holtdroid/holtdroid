import { SearchIcon, XIcon } from "lucide-react"
import { type ReactNode, useCallback, useState } from "react"
import type { Location, Metrics, SessionView } from "@/api/client"
import type { AdbSession } from "@/components/session/adb-session"
import { AppWidget } from "@/components/session/app-widget"
import { BatteryWidget } from "@/components/session/battery-widget"
import { CameraWidget } from "@/components/session/camera-widget"
import { ClipboardWidget } from "@/components/session/clipboard-widget"
import { DeviceWidget } from "@/components/session/device-widget"
import { DisplayWidget } from "@/components/session/display-widget"
import { GpsWidget } from "@/components/session/gps-widget"
import { LanguageWidget } from "@/components/session/language-widget"
import type { LiveScreen } from "@/components/session/live-screen"
import { MicrophoneWidget } from "@/components/session/microphone-widget"
import { NetworkWidget } from "@/components/session/network-widget"
import { RecordingWidget } from "@/components/session/recording-widget"
import { SectionTitle, ShadeFilter, ShadeFlag, ShadeModeContext } from "@/components/session/shade"
import { SSHWidget } from "@/components/session/ssh-widget"
import { StreamWidget } from "@/components/session/stream-widget"
import { TimeWidget } from "@/components/session/time-widget"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

type Group = "environment" | "media" | "app"

const groups: { value: Group; label: string }[] = [
  { value: "environment", label: "Environment" },
  { value: "media", label: "Media" },
  { value: "app", label: "App" },
]

export function DevicePanel({
  provider,
  id,
  session,
  live,
  locations,
  clipboard,
  metrics,
  recording,
  recordedAt,
  manage,
  appRunning,
  adb,
  onConditions,
}: {
  provider: string
  id: string
  session: SessionView
  live: LiveScreen
  locations: Location[]
  clipboard: boolean
  metrics: Metrics[]
  recording?: string
  recordedAt?: string
  manage: boolean
  appRunning: boolean
  adb: AdbSession | null
  onConditions?: () => void
}) {
  const [group, setGroup] = useState<Group>("environment")
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const filter = searching ? query.trim() : ""
  const [flags, setFlags] = useState<Record<Group, string[]>>({ environment: [], media: [], app: [] })
  const flaggers = {
    environment: useFlagger("environment", setFlags),
    media: useFlagger("media", setFlags),
    app: useFlagger("app", setFlags),
  }

  const content: Record<Group, ReactNode> = {
    environment: (
      <>
        <NetworkWidget
          provider={provider}
          id={id}
          locations={locations}
          metrics={metrics}
          onConditions={onConditions}
        />
        <GpsWidget provider={provider} id={id} vpn={locations.length > 0} />
        <BatteryWidget provider={provider} id={id} />
        <LanguageWidget provider={provider} id={id} />
        <TimeWidget provider={provider} id={id} />
        {clipboard && <ClipboardWidget provider={provider} id={id} />}
        <DisplayWidget provider={provider} id={id} />
      </>
    ),
    media: (
      <>
        <StreamWidget provider={provider} id={id} live={live} />
        <MicrophoneWidget provider={provider} id={id} />
        <CameraWidget provider={provider} id={id} />
        <RecordingWidget provider={provider} id={id} recording={recording} since={recordedAt} manage={manage} />
      </>
    ),
    app: (
      <>
        <AppWidget provider={provider} id={id} session={session} appRunning={appRunning} adb={adb} metrics={metrics} />
        <DeviceWidget session={session} adb={adb} metrics={metrics} />
        <SSHWidget provider={provider} id={id} />
      </>
    ),
  }

  return (
    <aside className="flex min-h-0 w-full flex-col overflow-hidden rounded-2xl border bg-card" aria-label="Device">
      <ShadeModeContext value="row">
        <ShadeFilter value={filter}>
          <Tabs value={group} onValueChange={(v) => setGroup(v as Group)} className="min-h-0 flex-1 gap-0">
            <div className="flex flex-col gap-3 px-4 pt-4 pb-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">Device</h2>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={searching ? "Close the search" : "Search controls"}
                  aria-pressed={searching}
                  onClick={() => {
                    setSearching(!searching)
                    setQuery("")
                  }}
                >
                  {searching ? <XIcon /> : <SearchIcon />}
                </Button>
              </div>
              {searching ? (
                <label className="flex h-[30px] items-center gap-2 rounded-[10px] border bg-muted px-3 text-muted-foreground">
                  <SearchIcon className="size-3.5" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setSearching(false)
                    }}
                    placeholder="Network, battery, camera…"
                    aria-label="Search controls"
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none"
                  />
                </label>
              ) : (
                <TabsList className="w-full">
                  {groups.map((g) => (
                    <TabsTrigger key={g.value} value={g.value} className="h-[26px]">
                      {g.label}
                      {flags[g.value].length > 0 && (
                        <span className="size-1.5 rounded-full bg-warning" aria-label="has changes" />
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 [scrollbar-width:thin]">
              {groups.map((g) => (
                <TabsContent
                  key={g.value}
                  value={g.value}
                  forceMount
                  className={cn("flex flex-col", !filter && "data-[state=inactive]:hidden")}
                >
                  {filter && (
                    <span className="pt-2">
                      <SectionTitle>{g.label}</SectionTitle>
                    </span>
                  )}
                  <ShadeFlag value={flaggers[g.value]}>{content[g.value]}</ShadeFlag>
                </TabsContent>
              ))}
            </div>
          </Tabs>
        </ShadeFilter>
      </ShadeModeContext>
    </aside>
  )
}

function useFlagger(group: Group, setFlags: (f: (prev: Record<Group, string[]>) => Record<Group, string[]>) => void) {
  return useCallback(
    (key: string, on: boolean) =>
      setFlags((prev) => {
        const has = prev[group].includes(key)
        if (has === on) return prev
        return { ...prev, [group]: on ? [...prev[group], key] : prev[group].filter((k) => k !== key) }
      }),
    [group, setFlags],
  )
}
