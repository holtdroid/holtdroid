import { Link, useNavigate } from "@tanstack/react-router"
import {
  ArrowUpRightIcon,
  BatteryChargingIcon,
  BatteryIcon,
  ConstructionIcon,
  CpuIcon,
  GlobeIcon,
  HardDriveIcon,
  Loader2Icon,
  type LucideIcon,
  MemoryStickIcon,
  ServerIcon,
  ShieldAlertIcon,
  SmartphoneIcon,
  SquareIcon,
  ThermometerIcon,
  TimerIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UsbIcon,
  WrenchIcon,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"
import type {
  DeviceInfo,
  DevToolsFrontendView,
  HostInfo,
  InventoryDevice,
  Maintenance,
  ProviderInventory,
  SessionView,
  Slot,
  Temperature,
} from "@/api/client"
import {
  type MaintenanceTarget,
  useDeleteDevToolsFrontend,
  useDevToolsFrontends,
  useFetchDevToolsFrontend,
  useInventory,
  useSetMaintenance,
} from "@/api/inventory"
import { useMe, useSessions, useStopSession } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { dataTable, EmptyPanel, Meter, PageHeader, Panel, SectionLabel } from "@/components/page"
import { SessionStateBadge } from "@/components/session-state-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { UserAvatar } from "@/components/user-avatar"
import { useNow } from "@/hooks/use-now"
import { countryFlag, formatBytes, formatDuration, formatRelative } from "@/lib/format"
import { slotTones, type SlotTone } from "@/lib/capacity"
import { sessionTone, stopsIn } from "@/lib/session-tone"
import { celsius, hottest, type Level, level, sensorLabel, temperatureLevel, worst } from "@/lib/thermal"
import { cn } from "@/lib/utils"

const levelText: Record<Level, string> = {
  ok: "text-muted-foreground",
  warn: "text-warning",
  crit: "text-danger",
}

const levelFill: Record<Level, string> = {
  ok: "bg-foreground",
  warn: "bg-warning",
  crit: "bg-danger",
}

const stateBadge: Record<Slot["state"], "success" | "warning" | "secondary" | "violet"> = {
  free: "success",
  busy: "warning",
  offline: "secondary",
  maintenance: "violet",
}

const sessionKey = (provider: string, id: string) => `${provider}/${id}`

export type InventoryTab = "devices" | "sessions" | "devtools"

const tabPaths: Record<InventoryTab, "/inventory" | "/inventory/sessions" | "/inventory/devtools"> = {
  devices: "/inventory",
  sessions: "/inventory/sessions",
  devtools: "/inventory/devtools",
}

const toneStyle = new Map(slotTones.map((t) => [t.tone, t]))

function slotTone(d: InventoryDevice, session: SessionView | undefined, now: number): SlotTone {
  switch (d.slot.state) {
    case "busy": {
      const tone = session ? sessionTone(session, now) : "ready"
      return tone === "ready" ? "running" : tone
    }
    case "maintenance":
      return "held"
    case "offline":
      return "offline"
    default:
      return "free"
  }
}

type Selected = { provider: string; slot: string }

type Node = { key: string; name: string; host?: HostInfo; devices: InventoryDevice[] }

function nodesOf(p: ProviderInventory): Node[] {
  const grouped = !p.host && p.devices.some((d) => d.slot.group || d.host?.hostname)
  if (!grouped) return [{ key: p.name, name: p.host?.hostname || p.name, host: p.host, devices: p.devices }]
  const nodes = new Map<string, Node>()
  for (const d of p.devices) {
    const name = d.slot.group || d.host?.hostname || p.name
    const n = nodes.get(name) ?? { key: `${p.name}/${name}`, name, devices: [] }
    n.host ??= d.host
    n.devices.push(d)
    nodes.set(name, n)
  }
  return [...nodes.values()]
}

function thermalOf(d: InventoryDevice) {
  return [...(d.device?.thermal ?? []), ...(d.host?.thermal ?? [])]
}

function hostLoad(h: HostInfo) {
  return h.cores ? h.load1 / h.cores : undefined
}

function hostMemory(h: HostInfo) {
  return h.memoryTotal && h.memoryAvailable ? (h.memoryTotal - h.memoryAvailable) / h.memoryTotal : undefined
}

export function InventoryPage({ tab }: { tab: InventoryTab }) {
  const navigate = useNavigate()
  const me = useMe()
  const admin = me.data?.admin === true
  const inventory = useInventory(admin && tab === "devices")
  const sessions = useSessions()
  const now = useNow(10_000)
  const items = sessions.data?.items ?? []
  const byID = new Map(items.map((s) => [sessionKey(s.provider, s.id), s]))
  const [selected, setSelected] = useState<Selected | null>(null)
  const providers = inventory.data?.providers ?? []
  const current = selected ? providers.find((p) => p.name === selected.provider) : undefined
  const device = current?.devices.find((d) => d.slot.id === selected?.slot)
  const slots = providers.reduce((n, p) => n + p.devices.length, 0)

  return (
    <div className="h-full overflow-y-auto pb-(--dock-space)">
      <div className="mx-auto grid max-w-7xl content-start gap-5 p-4 lg:px-8 lg:py-7">
        <PageHeader
          title="Inventory"
          meta="Admins only"
          description={
            tab === "devices"
              ? "Every slot of every provider by the machine it runs on, refreshed every 10 seconds. Open a slot for the device, its machine and sensors. A slot held for maintenance takes no new sessions; a session already running on it keeps going until it ends."
              : tab === "sessions"
                ? "Everyone's running devices: who holds which slot, for how long, and when it ends on its own. Stop one to free the slot now."
                : "The Chrome DevTools builds the portal fetched for the WebViews it has seen, one per Chromium revision, archived in its storage and restored after a restart. Delete one to fetch it afresh."
          }
        >
          <Tabs value={tab} onValueChange={(v) => void navigate({ to: tabPaths[v as InventoryTab] })}>
            <TabsList>
              <TabsTrigger value="devices">
                Devices
                {inventory.data && <Count n={slots} />}
              </TabsTrigger>
              <TabsTrigger value="sessions">
                Sessions
                {sessions.data && <Count n={items.length} />}
              </TabsTrigger>
              <TabsTrigger value="devtools">DevTools frontends</TabsTrigger>
            </TabsList>
          </Tabs>
        </PageHeader>

        {me.data && !admin && (
          <Alert>
            <ShieldAlertIcon />
            <AlertTitle>Only admins can see the inventory</AlertTitle>
          </Alert>
        )}
        {tab === "devices" && (
          <>
            {inventory.isError && (
              <Alert variant="destructive">
                <AlertDescription>Could not load the inventory: {inventory.error.message}</AlertDescription>
              </Alert>
            )}
            {admin && inventory.isPending && <Skeleton className="h-64 rounded-2xl" />}
            {inventory.data && <CapacitySummary providers={providers} sessions={byID} items={items} now={now} />}
            {providers.map((p) => (
              <ProviderSection
                key={p.name}
                provider={p}
                sessions={byID}
                now={now}
                onOpen={(slot) => setSelected({ provider: p.name, slot })}
              />
            ))}
            {inventory.data && items.length > 0 && (
              <LongestRunning
                items={items}
                providers={providers}
                now={now}
                onAll={() => void navigate({ to: tabPaths.sessions })}
              />
            )}
          </>
        )}
        {tab === "sessions" && admin && <SessionsSection items={items} loading={sessions.isPending} now={now} />}
        {tab === "devtools" && admin && <DevToolsFrontendsSection now={now} />}
      </div>
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {current && device && (
            <DeviceSheet
              provider={current}
              device={device}
              session={device.session ? byID.get(sessionKey(current.name, device.session)) : undefined}
              now={now}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function Count({ n }: { n: number }) {
  return (
    <span className="border-border text-muted-foreground inline-grid h-[18px] min-w-[18px] place-items-center rounded-full border px-1.5 text-[11px] tabular-nums">
      {n}
    </span>
  )
}

function CapacitySummary({
  providers,
  sessions,
  items,
  now,
}: {
  providers: ProviderInventory[]
  sessions: Map<string, SessionView>
  items: SessionView[]
  now: number
}) {
  const ticks = providers.flatMap((p) =>
    p.devices.map((d) => ({
      key: sessionKey(p.name, d.slot.id),
      tone: slotTone(d, d.session ? sessions.get(sessionKey(p.name, d.session)) : undefined, now),
    })),
  )
  const counts = new Map<SlotTone, number>()
  for (const t of ticks) counts.set(t.tone, (counts.get(t.tone) ?? 0) + 1)
  const busy = providers.reduce((n, p) => n + p.devices.filter((d) => d.slot.state === "busy").length, 0)
  const people = new Set(items.map((s) => s.owner)).size
  const uptime = items.length
    ? items.reduce((n, s) => n + (now - new Date(s.createdAt).getTime()), 0) / items.length
    : 0
  const held = ticks.filter((t) => t.tone === "held").length

  return (
    <Panel className="flex flex-wrap items-center gap-x-8 gap-y-4 px-5 py-5">
      <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-3">
        <div className="flex gap-[3px]">
          {ticks.map((t) => (
            <span key={t.key} className={cn("h-7 min-w-0.5 flex-1 rounded-xs", toneStyle.get(t.tone)?.className)} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {slotTones
            .filter((t) => t.tone === "free" || counts.get(t.tone))
            .map((t) => (
              <span key={t.tone} className="inline-flex items-center gap-1.5 tabular-nums">
                <span className={cn("h-3 w-1 rounded-xs", t.className)} />
                {counts.get(t.tone) ?? 0} {t.label}
              </span>
            ))}
        </div>
      </div>
      <div className="bg-muted grid flex-[1_1_440px] grid-cols-2 rounded-xl border py-3.5 sm:grid-cols-4">
        <Stat value={`${busy}/${ticks.length}`} label="Slots used" />
        <Stat value={String(people)} label={people === 1 ? "Person online" : "People online"} />
        <Stat value={items.length ? formatDuration(uptime) : "—"} label="Avg. session" />
        <Stat value={String(held)} label="On hold" last />
      </div>
    </Panel>
  )
}

function Stat({ value, label, last }: { value: string; label: string; last?: boolean }) {
  return (
    <div className={cn("px-2 text-center", !last && "sm:border-r")}>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  )
}

function ProviderSection({
  provider: p,
  sessions,
  now,
  onOpen,
}: {
  provider: ProviderInventory
  sessions: Map<string, SessionView>
  now: number
  onOpen: (slot: string) => void
}) {
  const nodes = nodesOf(p)

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-base font-semibold">{p.name}</h2>
        {p.kind && <Badge variant="secondary">{p.kind}</Badge>}
        <span className="text-muted-foreground text-xs tabular-nums">
          {p.devices.length} {p.devices.length === 1 ? "slot" : "slots"}
          {nodes.length > 1 && ` on ${nodes.length} machines`}
        </span>
        {!p.error && (
          <div className="ml-auto">
            <MaintenanceButton
              target={{ provider: p.name }}
              hold={p.maintenance}
              title={`Hold ${p.name} for maintenance?`}
              description="No new sessions start on any of its slots until you release it. Running sessions keep going."
              label="Hold provider"
              releaseLabel="Release provider"
              size="sm"
            />
          </div>
        )}
      </div>

      {p.maintenance && <HoldNote hold={p.maintenance} now={now} what="Every slot of this provider" />}
      {p.error && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>The provider didn&apos;t answer</AlertTitle>
          <AlertDescription>{p.error}</AlertDescription>
        </Alert>
      )}
      {!p.error && p.devices.length === 0 && (
        <EmptyPanel>No slots: nothing matches the provider&apos;s configuration right now.</EmptyPanel>
      )}
      {p.devices.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,400px),1fr))] gap-4">
          {nodes.map((n) => (
            <NodeCard key={n.key} provider={p} node={n} sessions={sessions} now={now} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  )
}

function NodeCard({
  provider: p,
  node: n,
  sessions,
  now,
  onOpen,
}: {
  provider: ProviderInventory
  node: Node
  sessions: Map<string, SessionView>
  now: number
  onOpen: (slot: string) => void
}) {
  const h = n.host
  const phones = n.devices.some((d) => d.device)
  const Icon = h ? (phones ? UsbIcon : ServerIcon) : SmartphoneIcon
  const busy = n.devices.filter((d) => d.slot.state === "busy").length
  const held = n.devices.every((d) => d.slot.maintenance)
  const conditions = h?.conditions ?? []
  const spec = h
    ? [h.cores && `${h.cores} cores`, h.memoryTotal && formatBytes(h.memoryTotal), h.os].filter(Boolean).join(" · ")
    : [p.kind, `${n.devices.length} ${n.devices.length === 1 ? "device" : "devices"}`].filter(Boolean).join(" · ")
  const load = h && hostLoad(h)
  const memory = h && hostMemory(h)
  const hot = h && hottest(h.thermal)

  return (
    <article className="bg-card flex flex-col gap-3.5 rounded-2xl border p-[18px]">
      <div className="flex items-center gap-2.5">
        <span className="bg-muted grid size-7 shrink-0 place-items-center rounded-lg border">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {h ? (
              <Popover>
                <PopoverTrigger className="hover:bg-accent min-w-0 truncate rounded-md font-mono text-[15px] font-medium underline-offset-4 hover:underline">
                  {n.name}
                </PopoverTrigger>
                <PopoverContent align="start" className="grid w-80 gap-3">
                  <HostDetails host={h} />
                  {h.thermal.length > 0 && <Sensors thermal={h.thermal} emulated={false} />}
                </PopoverContent>
              </Popover>
            ) : (
              <span className="truncate font-mono text-[15px] font-medium">{n.name}</span>
            )}
            {conditions.length > 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="destructive">
                    {conditions[0]}
                    {conditions.length > 1 && ` +${conditions.length - 1}`}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{conditions.join(", ")}</TooltipContent>
              </Tooltip>
            ) : held ? (
              <Badge variant="violet">On hold</Badge>
            ) : (
              <Badge variant="success">Ready</Badge>
            )}
          </div>
          {spec && <div className="text-muted-foreground truncate text-xs">{spec}</div>}
        </div>
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {busy} of {n.devices.length}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {n.devices.map((d) => (
          <SlotTile
            key={d.slot.id}
            device={d}
            session={d.session ? sessions.get(sessionKey(p.name, d.session)) : undefined}
            now={now}
            onOpen={() => onOpen(d.slot.id)}
          />
        ))}
      </div>

      {h && (load !== undefined || memory !== undefined || hot) && (
        <div className="grid gap-2 text-xs">
          {load !== undefined && (
            <MeterRow icon={CpuIcon} label="CPU" value={Math.min(1, load)} level={level(load, 0.8, 1.2)}>
              {Math.round(load * 100)}%
            </MeterRow>
          )}
          {memory !== undefined && (
            <MeterRow icon={MemoryStickIcon} label="Memory" value={memory} level={level(memory, 0.85, 0.95)}>
              {Math.round(memory * 100)}%
            </MeterRow>
          )}
          {hot && (
            <MeterRow icon={ThermometerIcon} label="Temp" value={hot.celsius / 100} level={temperatureLevel(hot)}>
              {Math.round(hot.celsius)}°C
            </MeterRow>
          )}
        </div>
      )}
    </article>
  )
}

function MeterRow({
  icon: Icon,
  label,
  value,
  level: l,
  children,
}: {
  icon: LucideIcon
  label: string
  value: number
  level: Level
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="text-muted-foreground size-3.5 shrink-0" />
      <span className="text-muted-foreground w-13 shrink-0">{label}</span>
      <Meter value={value} fill={levelFill[l]} />
      <span className={cn("w-11 shrink-0 text-right font-mono", l !== "ok" && levelText[l])}>{children}</span>
    </div>
  )
}

function SlotTile({
  device: d,
  session,
  now,
  onOpen,
}: {
  device: InventoryDevice
  session: SessionView | undefined
  now: number
  onOpen: () => void
}) {
  const tone = slotTone(d, session, now)
  const style = toneStyle.get(tone)
  const title = session ? session.label || session.package : d.session ? d.session : d.slot.label
  const phone = d.device
    ? [
        d.device.battery && `${d.device.battery.level}%`,
        d.device.battery && celsius(d.device.battery.celsius),
        d.device.storageTotal && `${formatBytes(d.device.storageTotal - (d.device.storageUsed ?? 0))} free`,
      ]
        .filter(Boolean)
        .join(" · ")
    : ""
  const sub = d.error
    ? d.error
    : session
      ? `${d.slot.label} · ${session.ownerName || session.owner}`
      : d.session
        ? d.slot.label
        : phone || (tone === "free" ? "Free" : style?.label)
  return (
    <button
      type="button"
      onClick={onOpen}
      title={[d.slot.label, d.slot.label !== d.slot.id && d.slot.id, style?.label, d.error, phone]
        .filter(Boolean)
        .join(" · ")}
      className={cn(
        "hover:ring-ring/40 flex min-h-11 min-w-0 items-center gap-1.5 rounded-[9px] border px-2 py-1 text-left text-xs transition-shadow hover:ring-2",
        d.error ? "border-danger/40 bg-danger-soft" : style?.tile,
      )}
    >
      {session ? (
        <AppIcon src={session.iconUrl} className="size-5 rounded-md" />
      ) : d.device ? (
        <SmartphoneIcon className="size-3.5 shrink-0 opacity-70" />
      ) : null}
      <span className="grid min-w-0">
        <span
          className={cn("truncate", (session || d.session) && "text-foreground", d.session && !session && "font-mono")}
        >
          {title}
        </span>
        {sub && (
          <span className={cn("truncate text-[11px]", d.error ? "text-danger" : "text-muted-foreground")}>{sub}</span>
        )}
      </span>
    </button>
  )
}

function LongestRunning({
  items,
  providers,
  now,
  onAll,
}: {
  items: SessionView[]
  providers: ProviderInventory[]
  now: number
  onAll: () => void
}) {
  const nodes = new Map<string, string>()
  for (const p of providers)
    for (const d of p.devices) {
      const node = d.slot.group || d.host?.hostname
      if (node) nodes.set(sessionKey(p.name, d.slot.id), node)
    }
  const longest = items.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 5)

  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center gap-2.5 px-[18px] pt-4 pb-2.5">
        <h2 className="text-base font-semibold">Longest running</h2>
        <Button size="sm" variant="outline" className="ml-auto" onClick={onAll}>
          All sessions
        </Button>
      </div>
      <Table className={dataTable}>
        <TableHeader>
          <TableRow>
            <TableHead>Session</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Device</TableHead>
            <TableHead>Node</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>State</TableHead>
            <TableHead className="text-right">Up</TableHead>
            <TableHead className="text-right">Ends in</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {longest.map((s) => {
            const node = nodes.get(sessionKey(s.provider, s.slot))
            const left = Math.max(0, stopsIn(s, now))
            const device = [s.capabilities?.model, s.capabilities?.android && `Android ${s.capabilities.android}`]
              .filter(Boolean)
              .join(" · ")
            return (
              <TableRow key={sessionKey(s.provider, s.id)}>
                <TableCell>
                  <span className="inline-flex max-w-64 items-center gap-2">
                    <AppIcon src={s.iconUrl} className="size-[22px] rounded-md" />
                    <span className="truncate">{s.label || s.package}</span>
                    {s.versionName && <span className="text-muted-foreground font-mono text-xs">{s.versionName}</span>}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5">
                    <UserAvatar user={s.owner} className="size-[22px]" />
                    <span className="max-w-40 truncate">{s.ownerName || s.owner}</span>
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{device || "—"}</TableCell>
                <TableCell className="font-mono text-xs">
                  {node ?? s.provider} · {s.slotLabel || s.slot}
                </TableCell>
                <TableCell>
                  <LocationCell location={s.location} />
                </TableCell>
                <TableCell>
                  <SessionStateBadge state={s.state} />
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatDuration(now - new Date(s.createdAt).getTime())}
                </TableCell>
                <TableCell className={cn("text-right font-mono text-xs", left < 5 * 60_000 && "text-warning")}>
                  {formatDuration(left)}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="icon-sm" variant="outline" asChild>
                    <Link
                      to="/session/$provider/$id"
                      params={{ provider: s.provider, id: s.id }}
                      aria-label="Open session"
                    >
                      <ArrowUpRightIcon />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Panel>
  )
}

function LocationCell({ location }: { location?: string }) {
  if (!location) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center gap-1">
      {countryFlag(location) || <GlobeIcon className="size-3" />}
      {location}
    </span>
  )
}

function sameHold(a: Maintenance | undefined, b: Maintenance | undefined) {
  return !!a && !!b && a.since === b.since && a.reason === b.reason && a.by === b.by
}

const frontendState: Record<DevToolsFrontendView["state"], "warning" | "success" | "destructive"> = {
  warming: "warning",
  ready: "success",
  incomplete: "destructive",
}

const act = (run: Promise<unknown>, done: string) =>
  run.then(() => toast.success(done)).catch((e: Error) => toast.error(e.message))

function DevToolsFrontendsSection({ now }: { now: number }) {
  const frontends = useDevToolsFrontends(true)
  const remove = useDeleteDevToolsFrontend()
  const fetchAgain = useFetchDevToolsFrontend()
  const items = frontends.data?.items ?? []

  return (
    <section className="grid gap-3">
      {frontends.isError && (
        <Alert>
          <AlertDescription>{frontends.error.message}</AlertDescription>
        </Alert>
      )}
      {frontends.data && (
        <p className="text-muted-foreground text-xs">Archives live in {frontends.data.storage} storage.</p>
      )}
      {frontends.isPending && <Skeleton className="h-24 rounded-2xl" />}
      {frontends.data && items.length === 0 && (
        <EmptyPanel>Nothing fetched yet. Revisions appear as WebViews are seen.</EmptyPanel>
      )}
      {items.length > 0 && (
        <Panel className="overflow-hidden">
          <Table className={dataTable}>
            <TableHeader>
              <TableRow>
                <TableHead>Revision</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Files</TableHead>
                <TableHead className="text-right">Archive</TableHead>
                <TableHead>Archived</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((f) => (
                <TableRow key={f.rev}>
                  <TableCell className="font-mono text-xs" title={f.rev}>
                    {f.rev.slice(0, 12)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={frontendState[f.state]}>
                      {f.state === "warming" && <Loader2Icon className="size-3 animate-spin" />}
                      {f.state}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {f.files > 0 || !f.archived ? f.files : "—"}
                    {f.failed > 0 && <span className="text-destructive"> · {f.failed} failed</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {f.archived ? formatBytes(f.size ?? 0) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {f.archivedAt ? formatRelative(f.archivedAt, now) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={f.state === "warming"}
                        onClick={() => void act(fetchAgain.mutateAsync(f.rev), "Fetching " + f.rev.slice(0, 12))}
                      >
                        <WrenchIcon />
                        Fetch
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-destructive"
                        disabled={f.state === "warming"}
                        onClick={() => void act(remove.mutateAsync(f.rev), "Deleted " + f.rev.slice(0, 12))}
                      >
                        <Trash2Icon />
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}
    </section>
  )
}

function DeviceSheet({
  provider: p,
  device: d,
  session,
  now,
}: {
  provider: ProviderInventory
  device: InventoryDevice
  session: SessionView | undefined
  now: number
}) {
  const hold = d.slot.maintenance
  const inherited = sameHold(hold, p.maintenance)
  const thermal = thermalOf(d)
  const Icon = d.host && !d.device ? ServerIcon : SmartphoneIcon

  return (
    <div className="grid gap-5 p-4">
      <SheetHeader className="p-0">
        <SheetTitle className="flex items-center gap-2">
          <Icon className="text-muted-foreground size-5" />
          <span className="min-w-0 truncate">{d.slot.label}</span>
          <Badge variant={stateBadge[d.slot.state]} className="capitalize">
            {d.slot.state}
          </Badge>
        </SheetTitle>
        <SheetDescription className="font-mono text-xs">
          {p.name} · {d.slot.id}
        </SheetDescription>
      </SheetHeader>

      {hold && <HoldNote hold={hold} now={now} what={inherited ? "Held with the whole provider" : "Held"} compact />}

      {d.session && (
        <div className="bg-muted grid gap-0.5 rounded-xl border px-3 py-2 text-xs">
          <span className="text-muted-foreground">Session</span>
          <Link
            to="/session/$provider/$id"
            params={{ provider: p.name, id: d.session }}
            className="font-mono underline-offset-2 hover:underline"
          >
            {d.session}
          </Link>
          {session && (
            <>
              <span className="text-muted-foreground min-w-0 truncate">
                {session.label || session.package} · {session.ownerName || session.owner}
              </span>
              <SessionMeta session={session} now={now} />
            </>
          )}
        </div>
      )}

      {d.slot.capabilities && (
        <Section title="Capabilities">
          <Capabilities caps={d.slot.capabilities} />
        </Section>
      )}
      {d.device && (
        <Section title="Device">
          <DeviceDetails device={d.device} />
        </Section>
      )}
      {d.host && (
        <Section title={d.device ? "Host" : "Machine"} hint={d.host.hostname}>
          <HostDetails host={d.host} />
        </Section>
      )}
      {thermal.length > 0 && <Sensors thermal={thermal} emulated={!!d.host && !!d.device} />}
      {d.error && <p className="text-muted-foreground text-xs">{d.error}</p>}

      <div className="flex justify-end">
        {inherited ? (
          <span className="text-muted-foreground text-xs">Release the provider to free it</span>
        ) : (
          <MaintenanceButton
            target={{ provider: p.name, slot: d.slot.id }}
            hold={hold}
            title={`Hold ${d.slot.label} for maintenance?`}
            description={
              d.session
                ? "The running session keeps going; once it ends, no new session starts here until you release it."
                : "No new session starts here until you release it."
            }
            label="Hold for maintenance"
            releaseLabel="Release"
            size="sm"
          />
        )}
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline gap-2">
        <SectionLabel>{title}</SectionLabel>
        {hint && <span className="text-muted-foreground font-mono text-xs">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function sessionTimes(s: SessionView, now: number) {
  const idleLeft = new Date(s.idleDeadline).getTime() - now
  const ttlLeft = new Date(s.ttlDeadline).getTime() - now
  return {
    up: now - new Date(s.createdAt).getTime(),
    idle: now - new Date(s.lastActivity).getTime(),
    left: Math.max(0, Math.min(idleLeft, ttlLeft)),
    byIdle: idleLeft <= ttlLeft,
  }
}

function SessionMeta({ session: s, now }: { session: SessionView; now: number }) {
  const t = sessionTimes(s, now)
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-[11px] tabular-nums">
      <span>up {formatDuration(t.up)}</span>
      <span>idle {formatDuration(t.idle)}</span>
      <span className={cn(t.left < 5 * 60_000 && "text-warning")}>
        {t.byIdle ? "idle stop" : "TTL"} in {formatDuration(t.left)}
      </span>
      {s.location && (
        <span className="inline-flex items-center gap-0.5">
          {countryFlag(s.location) || <GlobeIcon className="size-3" />}
          {s.location}
        </span>
      )}
      {s.webview && <span>WebView {s.webview}</span>}
    </div>
  )
}

function Capabilities({ caps: c }: { caps: NonNullable<Slot["capabilities"]> }) {
  const chips = [
    { label: c.root ? "Root" : "No root", on: c.root },
    {
      label: c.devtools === "all" ? "DevTools for every WebView" : "DevTools for debuggable builds",
      on: c.devtools === "all",
    },
    { label: "ADB", on: c.adb },
    { label: "Shell", on: c.shell },
    { label: "App data", on: c.appData },
  ]
  const device = [c.model, c.android && `Android ${c.android}`].filter(Boolean).join(" · ")
  return (
    <div className="flex flex-wrap gap-1">
      {device && <Badge variant="outline">{device}</Badge>}
      {c.screen && (
        <Badge variant="outline">
          {c.screen.width}×{c.screen.height} · {c.screen.dpi} dpi
        </Badge>
      )}
      {chips.map((ch) => (
        <Badge
          key={ch.label}
          variant={ch.on ? "secondary" : "outline"}
          className={cn(!ch.on && "text-muted-foreground")}
        >
          {ch.label}
        </Badge>
      ))}
      {c.abis.length > 0 && <Badge variant="outline">{c.abis.join(", ")}</Badge>}
    </div>
  )
}

function SessionsSection({ items, loading, now }: { items: SessionView[]; loading: boolean; now: number }) {
  const owners = new Set(items.map((s) => s.owner)).size
  if (loading) return <Skeleton className="h-40 rounded-2xl" />
  if (items.length === 0) {
    return <EmptyPanel>No device is running right now.</EmptyPanel>
  }
  return (
    <section className="grid gap-2">
      <p className="text-muted-foreground text-xs tabular-nums">
        {items.length} {items.length === 1 ? "session" : "sessions"} · {owners} {owners === 1 ? "user" : "users"}
      </p>
      <Panel className="overflow-hidden">
        <Table className={dataTable}>
          <TableHeader>
            <TableRow>
              <TableHead>App</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Slot</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Up</TableHead>
              <TableHead className="text-right">Idle</TableHead>
              <TableHead className="text-right">Ends in</TableHead>
              <TableHead>Location</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((s) => (
              <SessionRow key={sessionKey(s.provider, s.id)} session={s} now={now} />
            ))}
          </TableBody>
        </Table>
      </Panel>
    </section>
  )
}

function SessionRow({ session: s, now }: { session: SessionView; now: number }) {
  const t = sessionTimes(s, now)
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <AppIcon src={s.iconUrl} className="size-7 shrink-0" />
          <div className="min-w-0">
            <Link
              to="/session/$provider/$id"
              params={{ provider: s.provider, id: s.id }}
              className="block max-w-56 truncate font-medium underline-offset-2 hover:underline"
            >
              {s.label || s.package}
            </Link>
            <div className="text-muted-foreground max-w-56 truncate text-[11px]">
              {[s.versionName, s.webview && `WebView ${s.webview}`].filter(Boolean).join(" · ") || s.package}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5">
          <UserAvatar user={s.owner} className="size-5" />
          <span className="max-w-40 truncate">{s.ownerName || s.owner}</span>
        </span>
      </TableCell>
      <TableCell>
        <div className="min-w-0">
          <div className="truncate">{s.slotLabel || s.slot}</div>
          <div className="text-muted-foreground font-mono text-[11px]">
            {s.provider} · {s.slot} · {s.id}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <SessionStateBadge state={s.state} />
        {s.reason && <div className="text-destructive mt-0.5 max-w-40 truncate text-[11px]">{s.reason}</div>}
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums">{formatDuration(t.up)}</TableCell>
      <TableCell className="text-right text-xs tabular-nums">{formatDuration(t.idle)}</TableCell>
      <TableCell className="text-right text-xs tabular-nums">
        <span className={cn(t.left < 5 * 60_000 && "text-warning")}>{formatDuration(t.left)}</span>
        <div className="text-muted-foreground text-[11px]">{t.byIdle ? "idle timeout" : "max lifetime"}</div>
      </TableCell>
      <TableCell className="text-xs">
        {s.location ? (
          <span className="inline-flex items-center gap-1">
            {countryFlag(s.location) || <GlobeIcon className="size-3" />}
            {s.location}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <StopButton session={s} />
      </TableCell>
    </TableRow>
  )
}

function StopButton({ session: s }: { session: SessionView }) {
  const stop = useStopSession()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        className="text-destructive"
        disabled={stop.isPending || s.state === "stopping"}
        onClick={() => setOpen(true)}
      >
        <SquareIcon />
        Stop
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop {s.ownerName || s.owner}&apos;s device?</DialogTitle>
            <DialogDescription>
              {s.label || s.package} on {s.slotLabel || s.slot} stops now and the slot frees up. Whatever they were
              doing in it is gone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={stop.isPending}
              onClick={() =>
                stop.mutate(s, {
                  onSuccess: () => {
                    setOpen(false)
                    toast.success("Stopped")
                  },
                  onError: (e) => toast.error("Could not stop the session", { description: e.message }),
                })
              }
            >
              Stop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function HoldNote({ hold, now, what, compact }: { hold: Maintenance; now: number; what: string; compact?: boolean }) {
  return (
    <div
      className={cn(
        "bg-violet-soft text-violet flex items-start gap-2 rounded-xl",
        compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm",
      )}
    >
      <ConstructionIcon className={cn("mt-0.5 shrink-0", compact ? "size-3.5" : "size-4")} />
      <div className="min-w-0">
        <span className="font-medium">{what} for maintenance</span>
        <span className="opacity-80">
          {hold.by && ` by ${hold.by}`} {formatRelative(hold.since, now)}
        </span>
        {hold.reason && <p className="break-words opacity-90">{hold.reason}</p>}
      </div>
    </div>
  )
}

const fail = (e: Error) => toast.error("Could not change maintenance", { description: e.message })

function MaintenanceButton({
  target,
  hold,
  title,
  description,
  label,
  releaseLabel,
  size = "default",
}: {
  target: MaintenanceTarget
  hold: Maintenance | undefined
  title: string
  description: string
  label: string
  releaseLabel: string
  size?: "sm" | "default"
}) {
  const set = useSetMaintenance()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")

  if (hold) {
    return (
      <Button
        variant="outline"
        size={size}
        disabled={set.isPending}
        onClick={() => set.mutate({ ...target, enabled: false }, { onError: fail })}
      >
        {releaseLabel}
      </Button>
    )
  }
  return (
    <>
      <Button variant="outline" size={size} onClick={() => setOpen(true)}>
        <ConstructionIcon />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="maintenance-reason">Reason (optional)</Label>
            <Textarea
              id="maintenance-reason"
              value={reason}
              maxLength={500}
              placeholder="Replacing the USB cable"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={set.isPending}
              onClick={() =>
                set.mutate(
                  { ...target, enabled: true, reason: reason.trim() },
                  {
                    onSuccess: () => {
                      setOpen(false)
                      setReason("")
                    },
                    onError: fail,
                  },
                )
              }
            >
              Hold for maintenance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function DeviceDetails({ device: d }: { device: DeviceInfo }) {
  const model = [d.manufacturer, d.model].filter(Boolean).join(" ")
  return (
    <dl className="grid gap-1.5 text-xs">
      {model && <Row label="Model">{d.device ? `${model} (${d.device})` : model}</Row>}
      {d.android && <Row label="Android">{d.sdk ? `${d.android} · API ${d.sdk}` : d.android}</Row>}
      {d.build && (
        <Row label="Build">
          <span className="font-mono">{d.build}</span>
        </Row>
      )}
      {d.securityPatch && <Row label="Security patch">{d.securityPatch}</Row>}
      {d.abis.length > 0 && <Row label="ABIs">{d.abis.join(", ")}</Row>}
      {!!(d.cores || d.memoryTotal) && (
        <Row label="CPU · RAM">
          {[d.cores && `${d.cores} cores`, d.memoryTotal && formatBytes(d.memoryTotal)].filter(Boolean).join(" · ")}
        </Row>
      )}
      {d.storageTotal ? (
        <BytesMeter icon={HardDriveIcon} label="Storage" used={d.storageUsed ?? 0} total={d.storageTotal} />
      ) : null}
      {d.battery && <BatteryRow battery={d.battery} />}
      {d.uptime ? (
        <Row icon={TimerIcon} label="Up">
          {formatDuration(d.uptime * 1000)}
        </Row>
      ) : null}
    </dl>
  )
}

function BatteryRow({ battery: b }: { battery: NonNullable<DeviceInfo["battery"]> }) {
  const unhealthy = b.health !== "good" && b.health !== "unknown"
  const l = worst(level(b.celsius, 40, 45), unhealthy ? "crit" : "ok")
  return (
    <Row icon={b.status === "charging" ? BatteryChargingIcon : BatteryIcon} label="Battery">
      <span className={levelText[l]}>
        {b.level}% · {b.status.replace("-", " ")}
        {b.plugged && ` (${b.plugged})`} · {celsius(b.celsius)}
        {b.voltage ? ` · ${b.voltage.toFixed(2)} V` : ""}
        {unhealthy && ` · ${b.health.replace("-", " ")}`}
      </span>
    </Row>
  )
}

function HostDetails({ host: h }: { host: HostInfo }) {
  const load = h.cores ? h.load1 / h.cores : 0
  return (
    <dl className="grid gap-1.5 text-xs">
      {h.conditions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {h.conditions.map((c) => (
            <Badge key={c} variant="destructive">
              {c}
            </Badge>
          ))}
        </div>
      )}
      {h.os && <Row label="OS">{h.os}</Row>}
      {!!(h.kernel || h.arch) && <Row label="Kernel">{[h.kernel, h.arch].filter(Boolean).join(" · ")}</Row>}
      {!!(h.cpu || h.cores) && (
        <Row icon={CpuIcon} label="CPU">
          {[h.cpu, h.cores && `${h.cores} cores`].filter(Boolean).join(" · ")}
        </Row>
      )}
      {h.memoryTotal ? (
        h.memoryAvailable ? (
          <BytesMeter
            icon={MemoryStickIcon}
            label="Memory"
            used={h.memoryTotal - h.memoryAvailable}
            total={h.memoryTotal}
          />
        ) : (
          <Row icon={MemoryStickIcon} label="Memory">
            {formatBytes(h.memoryTotal)}
          </Row>
        )
      ) : null}
      {h.uptime ? (
        <Row label="Load">
          <span className={levelText[level(load, 0.8, 1.2)]}>
            {[h.load1, h.load5, h.load15].map((v) => v.toFixed(2)).join(" · ")}
          </span>
        </Row>
      ) : null}
      {h.uptime ? (
        <Row icon={TimerIcon} label="Up">
          {formatDuration(h.uptime * 1000)}
        </Row>
      ) : null}
      {!!(h.kubelet || h.runtime) && <Row label="Kubelet">{[h.kubelet, h.runtime].filter(Boolean).join(" · ")}</Row>}
    </dl>
  )
}

function sensorKeys(ts: Temperature[]) {
  const seen = new Map<string, number>()
  return ts.map((t) => {
    const base = `${t.source}/${t.type}/${t.name}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { t, key: n ? `${base}/${n}` : base }
  })
}

function Sensors({ thermal, emulated }: { thermal: Temperature[]; emulated: boolean }) {
  const [all, setAll] = useState(false)
  const sorted = sensorKeys(thermal.toSorted((a, b) => b.celsius - a.celsius))
  const shown = all ? sorted : sorted.slice(0, 6)
  const l: Level = worst(...thermal.map(temperatureLevel))
  return (
    <div className="grid gap-1.5">
      <div className={cn("flex items-center gap-1 text-xs", levelText[l])}>
        <ThermometerIcon className="size-3.5" />
        Sensors
        {emulated && <span className="text-muted-foreground">· the emulator makes its own values up</span>}
      </div>
      <div className="flex flex-wrap gap-1">
        {shown.map(({ t, key }) => {
          const tl = temperatureLevel(t)
          return (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums",
                    tl !== "ok" && levelText[tl],
                  )}
                >
                  <span
                    className={cn("size-1.5 rounded-full", tl === "ok" ? "bg-muted-foreground/60" : levelFill[tl])}
                  />
                  <span className="text-muted-foreground max-w-28 truncate">{t.name}</span>
                  {celsius(t.celsius)}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {sensorLabel(t)} · {t.source === "host" ? "machine" : "device"}
              </TooltipContent>
            </Tooltip>
          )
        })}
        {sorted.length > 6 && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground px-1 text-[11px]"
            onClick={() => setAll(!all)}
          >
            {all ? "fewer" : `+${sorted.length - 6} more`}
          </button>
        )}
      </div>
    </div>
  )
}

function Row({ icon: Icon, label, children }: { icon?: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground inline-flex items-center gap-1">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function BytesMeter({
  icon: Icon,
  label,
  used,
  total,
}: {
  icon: LucideIcon
  label: string
  used: number
  total: number
}) {
  const ratio = total > 0 ? used / total : 0
  const l = level(ratio, 0.85, 0.95)
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2">
      <dt className="text-muted-foreground inline-flex items-center gap-1">
        <Icon className="size-3.5" />
        {label}
      </dt>
      <dd className="grid gap-1">
        <span className={cn("tabular-nums", l !== "ok" && levelText[l])}>
          {formatBytes(used)} of {formatBytes(total)}
        </span>
        <span className="bg-muted h-1 overflow-hidden rounded-full">
          <span
            className={cn("block h-full rounded-full", levelFill[l])}
            style={{ width: `${Math.min(100, ratio * 100)}%` }}
          />
        </span>
      </dd>
    </div>
  )
}
