import { type ReactNode, useState } from "react"
import type { SessionView } from "@/api/client"
import { useReferences } from "@/api/queries"
import { AdbGate } from "@/components/session/adb-gate"
import type { AdbSession } from "@/components/session/adb-session"
import { FilesPanel } from "@/components/session/files-panel"
import { LogcatPanel } from "@/components/session/logcat-panel"
import { SocketsPanel } from "@/components/session/sockets-panel"
import { PixelPerfectPanel } from "@/components/session/pixel-perfect/panel"
import type { PixelPerfect } from "@/components/session/pixel-perfect/state"
import { TerminalPanel } from "@/components/session/terminal-panel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const adbTabs = [
  { value: "logcat", label: "Logcat" },
  { value: "files", label: "Files" },
  { value: "terminal", label: "Terminal" },
]

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
  const tabs = adbTabs.filter((t) => t.value !== "terminal" || session.capabilities?.shell !== false)
  const current =
    (adb && tabs.some((t) => t.value === tab)) ||
    (pixelPerfect && tab === "pixel-perfect") ||
    (devtools && tab === "websockets")
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
      {(adb || pixelPerfect || devtools) && (
        <TabsList variant="line" className="h-9 w-full justify-start rounded-none border-b px-2">
          <TabsTrigger value="devtools" className="flex-none">
            DevTools
          </TabsTrigger>
          {devtools && (
            <TabsTrigger value="websockets" className="flex-none">
              WebSockets
            </TabsTrigger>
          )}
          {adb &&
            tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="flex-none">
                {t.label}
              </TabsTrigger>
            ))}
          {pixelPerfect && (
            <TabsTrigger value="pixel-perfect" className="flex-none">
              Pixel perfect
            </TabsTrigger>
          )}
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
      {pixelPerfect && opened.has("pixel-perfect") && (
        <TabsContent value="pixel-perfect" forceMount className="min-h-0 data-[state=inactive]:hidden">
          <PixelPerfectPanel pp={pp} session={session} active={current === "pixel-perfect"} />
        </TabsContent>
      )}
    </Tabs>
  )
}
