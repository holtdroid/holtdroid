import { ChevronDownIcon } from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"
import type { SessionView } from "@/api/client"
import { useReferences } from "@/api/queries"
import { AdbGate } from "@/components/session/adb-gate"
import type { AdbSession } from "@/components/session/adb-session"
import { CachePanel } from "@/components/session/cache-panel"
import { DNSPanel } from "@/components/session/dns-panel"
import { FilesPanel } from "@/components/session/files-panel"
import { LogcatPanel } from "@/components/session/logcat-panel"
import { PixelPerfectPanel } from "@/components/session/pixel-perfect/panel"
import type { PixelPerfect } from "@/components/session/pixel-perfect/state"
import { RoutesPanel } from "@/components/session/routes-panel"
import { SocketsPanel } from "@/components/session/sockets-panel"
import { TerminalPanel } from "@/components/session/terminal-panel"
import { useDNS } from "@/components/session/use-dns"
import { useConnectionsState } from "@/components/session/use-routes"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

type Tool = { value: string; label: string }

const primary: Tool[] = [
  { value: "devtools", label: "DevTools" },
  { value: "logcat", label: "Logcat" },
  { value: "dns", label: "DNS" },
  { value: "routes", label: "Routes" },
  { value: "files", label: "Files" },
  { value: "terminal", label: "Terminal" },
]

const secondary: Tool[] = [
  { value: "websockets", label: "WebSockets" },
  { value: "cache", label: "Cache" },
  { value: "pixel-perfect", label: "Pixel perfect" },
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
  const target = useMemo(
    () => ({
      package: session.package,
      label: session.label,
      versionName: session.versionName,
      display: session.capabilities?.screen,
    }),
    [session.package, session.label, session.versionName, session.capabilities?.screen],
  )
  const dns = useDNS(session.provider, session.id).data?.available === true
  const routes = useConnectionsState(session.provider, session.id).data?.available === true
  const shell = session.capabilities?.shell !== false
  const available: Record<string, boolean> = {
    devtools: true,
    logcat: !!adb,
    files: !!adb,
    terminal: !!adb && shell,
    dns,
    routes,
    websockets: devtools,
    cache: devtools,
    "pixel-perfect": pixelPerfect,
  }
  const current = available[tab] ? tab : "devtools"
  const shown = primary.filter((t) => available[t.value])
  const more = secondary.filter((t) => available[t.value])
  const active = more.find((t) => t.value === current)
  const mounted = (value: string) => available[value] && opened.has(value)

  const adbPanel = (value: string, adbSession: AdbSession) => (
    <AdbGate session={adbSession}>
      {(a) =>
        value === "logcat" ? (
          <LogcatPanel store={adbSession.logcat} />
        ) : value === "files" ? (
          <FilesPanel adb={a} pkg={session.package} shell={shell} />
        ) : (
          <TerminalPanel adb={a} />
        )
      }
    </AdbGate>
  )

  const content = "min-h-0 data-[state=inactive]:hidden"

  return (
    <section className="flex size-full min-h-0 flex-col overflow-hidden rounded-2xl border bg-card" aria-label="Tools">
      <Tabs value={current} onValueChange={onTab} className="min-h-0 flex-1 gap-0">
        <div className="flex items-center gap-5 border-b px-[18px]">
          <TabsList
            variant="line"
            className="min-w-0 flex-1 justify-start overflow-x-auto overflow-y-hidden border-b-0 [scrollbar-width:none] *:after:hidden *:data-active:shadow-[inset_0_-2px_0_var(--foreground)]"
          >
            {shown.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
            {active && <TabsTrigger value={active.value}>{active.label}</TabsTrigger>}
          </TabsList>
          {more.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "flex h-[42px] shrink-0 cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground",
                )}
              >
                More
                <ChevronDownIcon className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuRadioGroup value={current} onValueChange={onTab}>
                  {more.map((t) => (
                    <DropdownMenuRadioItem key={t.value} value={t.value}>
                      {t.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <TabsContent value="devtools" forceMount className={content}>
          {children}
        </TabsContent>
        {adb &&
          ["logcat", "files", "terminal"].map((value) =>
            mounted(value) ? (
              <TabsContent key={value} value={value} forceMount className={content}>
                {adbPanel(value, adb)}
              </TabsContent>
            ) : null,
          )}
        {mounted("websockets") && (
          <TabsContent value="websockets" forceMount className={content}>
            <SocketsPanel provider={session.provider} id={session.id} />
          </TabsContent>
        )}
        {mounted("cache") && (
          <TabsContent value="cache" forceMount className={content}>
            <CachePanel provider={session.provider} id={session.id} />
          </TabsContent>
        )}
        {mounted("dns") && (
          <TabsContent value="dns" forceMount className={content}>
            <DNSPanel provider={session.provider} id={session.id} />
          </TabsContent>
        )}
        {mounted("routes") && (
          <TabsContent value="routes" forceMount className={content}>
            <RoutesPanel provider={session.provider} id={session.id} />
          </TabsContent>
        )}
        {mounted("pixel-perfect") && (
          <TabsContent value="pixel-perfect" forceMount className={content}>
            <PixelPerfectPanel pp={pp} target={target} active={current === "pixel-perfect"} />
          </TabsContent>
        )}
      </Tabs>
    </section>
  )
}
