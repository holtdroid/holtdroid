import {
  CableIcon,
  DatabaseZapIcon,
  FolderIcon,
  FrameIcon,
  GlobeIcon,
  ImageIcon,
  type LucideIcon,
  PenToolIcon,
  RouteIcon,
  SignpostIcon,
  SquareCodeIcon,
  SquareTerminalIcon,
  TerminalIcon,
} from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"
import type { SessionView } from "@/api/client"
import { useReferences } from "@/api/queries"
import { AdbGate } from "@/components/session/adb-gate"
import { CachePanel } from "@/components/session/cache-panel"
import { DNSPanel } from "@/components/session/dns-panel"
import type { AdbSession } from "@/components/session/adb-session"
import { FilesPanel } from "@/components/session/files-panel"
import { ImagesPanel } from "@/components/session/images-panel"
import { LogcatPanel } from "@/components/session/logcat-panel"
import { NetworkPanel } from "@/components/session/network-panel"
import { SocketsPanel } from "@/components/session/sockets-panel"
import { SvgPanel } from "@/components/session/svg-panel"
import { RoutesPanel } from "@/components/session/routes-panel"
import { PixelPerfectPanel } from "@/components/session/pixel-perfect/panel"
import type { PixelPerfect } from "@/components/session/pixel-perfect/state"
import { TerminalPanel } from "@/components/session/terminal-panel"
import { useDevice } from "@/components/session/use-device"
import { useDNS } from "@/components/session/use-dns"
import { useConnectionsState } from "@/components/session/use-routes"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const adbTabs: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "logcat", label: "Logcat", icon: SquareTerminalIcon },
  { value: "files", label: "Files", icon: FolderIcon },
  { value: "terminal", label: "Terminal", icon: TerminalIcon },
]

const trigger = "flex-none gap-1.5 [&_svg]:size-3.5"

// ToolTabs keeps every opened tab mounted, so DevTools keeps its state and
// the terminal its shell while another tab is shown.
export function ToolTabs({
  tab,
  onTab,
  adb,
  session,
  pp,
  devtools,
  children,
}: {
  tab: string
  onTab: (tab: string) => void
  adb: AdbSession | null
  session: SessionView
  pp: PixelPerfect
  devtools: boolean
  children: ReactNode
}) {
  const [opened, setOpened] = useState(() => new Set([tab]))
  if (!opened.has(tab)) setOpened(new Set([...opened, tab]))
  const pixelPerfect = useReferences().data?.enabled === true
  const target = useMemo(
    () => ({
      package: session.package,
      label: session.label,
      versionName: session.versionName,
      display: session.capabilities?.screen,
    }),
    [session.package, session.label, session.versionName, session.capabilities?.screen],
  )
  const network = !!useDevice(session.provider, session.id).data?.networkProfiles
  const dns = useDNS(session.provider, session.id).data?.available === true
  const routes = useConnectionsState(session.provider, session.id).data?.available === true
  const tabs = adbTabs.filter((t) => t.value !== "terminal" || session.capabilities?.shell !== false)
  const current =
    (adb && tabs.some((t) => t.value === tab)) ||
    (pixelPerfect && tab === "pixel-perfect") ||
    (devtools && ["websockets", "cache", "images", "svg"].includes(tab)) ||
    (network && tab === "network") ||
    (dns && tab === "dns") ||
    (routes && tab === "routes")
      ? tab
      : "devtools"

  const panel = (value: string, adbSession: AdbSession) => {
    if (value === "logcat") return <LogcatPanel store={adbSession.logcat} />
    return (
      <AdbGate session={adbSession}>
        {(a) => (value === "files" ? <FilesPanel adb={a} pkg={session.package} /> : <TerminalPanel adb={a} />)}
      </AdbGate>
    )
  }

  return (
    <Tabs value={current} onValueChange={onTab} className="h-full gap-0">
      {(adb || pixelPerfect || devtools || network || dns || routes) && (
        <TabsList
          variant="line"
          className="h-9 w-full justify-start overflow-x-auto overflow-y-hidden rounded-none border-b px-2 [scrollbar-width:none]"
        >
          <TabsTrigger value="devtools" className={trigger}>
            <SquareCodeIcon />
            DevTools
          </TabsTrigger>
          {pixelPerfect && (
            <TabsTrigger value="pixel-perfect" className={trigger}>
              <FrameIcon />
              Pixel perfect
            </TabsTrigger>
          )}
          {devtools && (
            <TabsTrigger value="websockets" className={trigger}>
              <CableIcon />
              WebSockets
            </TabsTrigger>
          )}
          {devtools && (
            <TabsTrigger value="cache" className={trigger}>
              <DatabaseZapIcon />
              Cache
            </TabsTrigger>
          )}
          {devtools && (
            <TabsTrigger value="images" className={trigger}>
              <ImageIcon />
              Images
            </TabsTrigger>
          )}
          {devtools && (
            <TabsTrigger value="svg" className={trigger}>
              <PenToolIcon />
              SVG
            </TabsTrigger>
          )}
          {network && (
            <TabsTrigger value="network" className={trigger}>
              <GlobeIcon />
              Network
            </TabsTrigger>
          )}
          {dns && (
            <TabsTrigger value="dns" className={trigger}>
              <SignpostIcon />
              DNS
            </TabsTrigger>
          )}
          {routes && (
            <TabsTrigger value="routes" className={trigger}>
              <RouteIcon />
              Routes
            </TabsTrigger>
          )}
          {adb &&
            tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className={trigger}>
                <t.icon />
                {t.label}
              </TabsTrigger>
            ))}
        </TabsList>
      )}
      <TabsContent value="devtools" forceMount className="min-h-0 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
      {adb &&
        tabs.map((t) =>
          opened.has(t.value) ? (
            <TabsContent key={t.value} value={t.value} forceMount className="min-h-0 data-[state=inactive]:hidden">
              {panel(t.value, adb)}
            </TabsContent>
          ) : null,
        )}
      {devtools && opened.has("websockets") && (
        <TabsContent value="websockets" forceMount className="min-h-0 data-[state=inactive]:hidden">
          <SocketsPanel provider={session.provider} id={session.id} />
        </TabsContent>
      )}
      {devtools && opened.has("cache") && (
        <TabsContent value="cache" forceMount className="min-h-0 data-[state=inactive]:hidden">
          <CachePanel provider={session.provider} id={session.id} />
        </TabsContent>
      )}
      {devtools && opened.has("images") && (
        <TabsContent value="images" forceMount className="min-h-0 data-[state=inactive]:hidden">
          <ImagesPanel provider={session.provider} id={session.id} />
        </TabsContent>
      )}
      {devtools && opened.has("svg") && (
        <TabsContent value="svg" forceMount className="min-h-0 data-[state=inactive]:hidden">
          <SvgPanel provider={session.provider} id={session.id} />
        </TabsContent>
      )}
      {network && opened.has("network") && (
        <TabsContent value="network" forceMount className="min-h-0 data-[state=inactive]:hidden">
          <NetworkPanel provider={session.provider} id={session.id} pkg={session.package} />
        </TabsContent>
      )}
      {dns && opened.has("dns") && (
        <TabsContent value="dns" forceMount className="min-h-0 data-[state=inactive]:hidden">
          <DNSPanel provider={session.provider} id={session.id} />
        </TabsContent>
      )}
      {routes && opened.has("routes") && (
        <TabsContent value="routes" forceMount className="min-h-0 data-[state=inactive]:hidden">
          <RoutesPanel provider={session.provider} id={session.id} />
        </TabsContent>
      )}
      {pixelPerfect && opened.has("pixel-perfect") && (
        <TabsContent value="pixel-perfect" forceMount className="min-h-0 data-[state=inactive]:hidden">
          <PixelPerfectPanel pp={pp} target={target} active={current === "pixel-perfect"} />
        </TabsContent>
      )}
    </Tabs>
  )
}
