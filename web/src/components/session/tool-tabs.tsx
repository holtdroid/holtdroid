import { type ReactNode, useState } from "react"
import type { SessionView } from "@/api/client"
import { AdbGate } from "@/components/session/adb-gate"
import type { AdbSession } from "@/components/session/adb-session"
import { AppPanel } from "@/components/session/app-panel"
import { DevicePanel } from "@/components/session/device-panel"
import { FilesPanel } from "@/components/session/files-panel"
import { LogcatPanel } from "@/components/session/logcat-panel"
import { TerminalPanel } from "@/components/session/terminal-panel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const adbTabs = [
  { value: "logcat", label: "Logcat" },
  { value: "files", label: "Files" },
  { value: "terminal", label: "Terminal" },
  { value: "app", label: "App" },
  { value: "device", label: "Device" },
]

// ToolTabs keeps every opened tab mounted, so DevTools keeps its state and
// the terminal its shell while another tab is shown.
export function ToolTabs({
  tab,
  onTab,
  adb,
  session,
  children,
}: {
  tab: string
  onTab: (tab: string) => void
  adb: AdbSession | null
  session: SessionView
  children: ReactNode
}) {
  const [opened, setOpened] = useState(() => new Set([tab]))
  if (!opened.has(tab)) setOpened(new Set([...opened, tab]))
  const tabs = adbTabs.filter((t) => t.value !== "terminal" || session.capabilities?.shell !== false)
  const current = adb && tabs.some((t) => t.value === tab) ? tab : tab === "devtools" ? tab : "devtools"

  const panel = (value: string, adbSession: AdbSession) => {
    if (value === "logcat") return <LogcatPanel store={adbSession.logcat} />
    return (
      <AdbGate session={adbSession}>
        {(a) =>
          value === "files" ? (
            <FilesPanel adb={a} pkg={session.package} />
          ) : value === "terminal" ? (
            <TerminalPanel adb={a} />
          ) : value === "app" ? (
            <AppPanel adb={a} pkg={session.package} />
          ) : (
            <DevicePanel adb={a} session={session} logcat={adbSession.logcat} />
          )
        }
      </AdbGate>
    )
  }

  return (
    <Tabs value={current} onValueChange={onTab} className="h-full gap-0">
      {adb && (
        <TabsList variant="line" className="h-9 w-full justify-start rounded-none border-b px-2">
          <TabsTrigger value="devtools" className="flex-none">
            DevTools
          </TabsTrigger>
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="flex-none">
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
    </Tabs>
  )
}
