import { Link, useNavigate } from "@tanstack/react-router"
import {
  BatteryChargingIcon,
  BatteryIcon,
  BugIcon,
  ChevronRightIcon,
  ConstructionIcon,
  CpuIcon,
  HardDriveIcon,
  Loader2Icon,
  type LucideIcon,
  MemoryStickIcon,
  ServerIcon,
  ShieldAlertIcon,
  SmartphoneIcon,
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
import { useMe, useSessions } from "@/api/queries"
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useNow } from "@/hooks/use-now"
import { formatBytes, formatDuration, formatRelative } from "@/lib/format"
import {
  celsius,
  hottest,
  type Level,
  level,
  levelFill,
  levelText,
  sensorLabel,
  temperatureLevel,
  worst,
} from "@/lib/thermal"
import { cn } from "@/lib/utils"

const stateBadge: Record<Slot["state"], string> = {
  free: "bg-emerald-600 text-white dark:bg-emerald-500",
  busy: "bg-amber-500 text-white",
  offline: "bg-muted text-muted-foreground",
  maintenance: "bg-sky-600 text-white dark:bg-sky-500",
}

const sessionKey = (provider: string, id: string) => `${provider}/${id}`

export type InventoryTab = "devices" | "devtools"

const stateDot: Record<Slot["state"], string> = {
  free: "bg-emerald-500",
  busy: "bg-amber-500",
  offline: "bg-muted-foreground/40",
  maintenance: "bg-sky-500",
}

type Selected = { provider: string; slot: string }

export function InventoryPage({ tab }: { tab: InventoryTab }) {
  const navigate = useNavigate()
  const me = useMe()
  const admin = me.data?.admin === true
  const inventory = useInventory(admin && tab === "devices")
  const sessions = useSessions()
  const now = useNow(30_000)
  const byID = new Map((sessions.data?.items ?? []).map((s) => [sessionKey(s.provider, s.id), s]))
  const [selected, setSelected] = useState<Selected | null>(null)
  const current = selected ? inventory.data?.providers.find((p) => p.name === selected.provider) : undefined
  const device = current?.devices.find((d) => d.slot.id === selected?.slot)

  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={tab}
        onValueChange={(v) => void navigate({ to: v === "devtools" ? "/inventory/devtools" : "/inventory" })}
        className="bg-background shrink-0 border-b px-4 lg:px-6"
      >
        <TabsList variant="line" className="h-11 gap-4">
          <TabsTrigger value="devices" className="gap-1.5">
            <SmartphoneIcon />
            Devices
          </TabsTrigger>
          <TabsTrigger value="devtools" className="gap-1.5">
            <BugIcon />
            DevTools frontends
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-6xl content-start gap-6 p-4 lg:p-6">
          {tab === "devices" ? (
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Devices</h1>
              <p className="text-muted-foreground max-w-2xl text-sm">
                Every slot of every provider, refreshed every 10 seconds. Open a row for the device, its machine and
                sensors. A slot held for maintenance takes no new sessions; a session already running on it keeps going
                until it ends.
              </p>
            </div>
          ) : (
            <div>
              <h1 className="text-xl font-semibold tracking-tight">DevTools frontends</h1>
              <p className="text-muted-foreground max-w-2xl text-sm">
                The Chrome DevTools builds the portal fetched for the WebViews it has seen, one per Chromium revision,
                archived in its storage and restored after a restart. Delete one to fetch it afresh.
              </p>
            </div>
          )}

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
              {admin && inventory.isPending && <Skeleton className="h-64 rounded-xl" />}
              {inventory.data?.providers.map((p) => (
                <ProviderSection
                  key={p.name}
                  provider={p}
                  sessions={byID}
                  now={now}
                  onOpen={(slot) => setSelected({ provider: p.name, slot })}
                />
              ))}
            </>
          )}
          {tab === "devtools" && admin && <DevToolsFrontendsSection now={now} />}
        </div>
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

const frontendState: Record<DevToolsFrontendView["state"], string> = {
  warming: "bg-amber-500 text-white",
  ready: "bg-emerald-600 text-white dark:bg-emerald-500",
  incomplete: "bg-destructive text-white",
}

function DevToolsFrontendsSection({ now }: { now: number }) {
  const frontends = useDevToolsFrontends(true)
  const remove = useDeleteDevToolsFrontend()
  const fetchAgain = useFetchDevToolsFrontend()
  const items = frontends.data?.items ?? []
  const act = (run: Promise<unknown>, done: string) =>
    run.then(() => toast.success(done)).catch((e: Error) => toast.error(e.message))

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
      {frontends.isPending && <Skeleton className="h-24 rounded-xl" />}
      {frontends.data && items.length === 0 && (
        <p className="text-muted-foreground text-sm">Nothing fetched yet. Revisions appear as WebViews are seen.</p>
      )}
      {items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
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
                    <Badge className={cn("gap-1", frontendState[f.state])}>
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
        </div>
      )}
    </section>
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
  const counts = new Map<Slot["state"], number>()
  for (const d of p.devices) counts.set(d.slot.state, (counts.get(d.slot.state) ?? 0) + 1)
  const machines = p.devices.some((d) => d.host && !d.device)

  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-base font-semibold">{p.name}</h2>
        {p.kind && <Badge variant="outline">{p.kind}</Badge>}
        <div className="text-muted-foreground flex items-center gap-2.5 text-xs">
          {(["free", "busy", "maintenance", "offline"] as const)
            .filter((s) => counts.get(s))
            .map((s) => (
              <span key={s} className="inline-flex items-center gap-1 tabular-nums">
                <span className={cn("size-1.5 rounded-full", stateDot[s])} />
                {counts.get(s)} {s}
              </span>
            ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {p.host && <HostSummary host={p.host} />}
          {!p.error && (
            <MaintenanceButton
              target={{ provider: p.name }}
              hold={p.maintenance}
              title={`Hold ${p.name} for maintenance?`}
              description="No new sessions start on any of its slots until you release it. Running sessions keep going."
              label="Hold provider"
              releaseLabel="Release provider"
              size="sm"
            />
          )}
        </div>
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
        <p className="text-muted-foreground rounded-xl border border-dashed py-8 text-center text-sm">
          No slots: nothing matches the provider&apos;s configuration right now.
        </p>
      )}
      {p.devices.length > 0 && (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slot</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Session</TableHead>
                <TableHead>{machines ? "Machine" : "Device"}</TableHead>
                <TableHead className="text-right">{machines ? "Load · RAM" : "Battery · Storage"}</TableHead>
                <TableHead className="text-right">Temp</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.devices.map((d) => (
                <DeviceRow
                  key={d.slot.id}
                  provider={p}
                  device={d}
                  session={d.session ? sessions.get(sessionKey(p.name, d.session)) : undefined}
                  onOpen={() => onOpen(d.slot.id)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}

function HostSummary({ host: h }: { host: HostInfo }) {
  const load = h.cores ? h.load1 / h.cores : 0
  const mem = h.memoryTotal && h.memoryAvailable ? (h.memoryTotal - h.memoryAvailable) / h.memoryTotal : 0
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-muted-foreground hidden items-center gap-2 text-xs tabular-nums sm:inline-flex">
          <UsbIcon className="size-3.5" />
          {h.hostname && <span className="font-mono">{h.hostname}</span>}
          {h.cores ? <Stat level={level(load, 0.8, 1.2)}>load {Math.round(load * 100)}%</Stat> : null}
          {mem ? <Stat level={level(mem, 0.85, 0.95)}>RAM {Math.round(mem * 100)}%</Stat> : null}
        </span>
      </TooltipTrigger>
      <TooltipContent className="w-72">
        <HostDetails host={h} />
      </TooltipContent>
    </Tooltip>
  )
}

function Stat({ level: l, children }: { level: Level; children: ReactNode }) {
  return <span className={cn(l !== "ok" && levelText[l])}>{children}</span>
}

function sameHold(a: Maintenance | undefined, b: Maintenance | undefined) {
  return !!a && !!b && a.since === b.since && a.reason === b.reason && a.by === b.by
}

function thermalOf(d: InventoryDevice) {
  return [...(d.device?.thermal ?? []), ...(d.host?.thermal ?? [])]
}

function DeviceRow({
  provider: p,
  device: d,
  session,
  onOpen,
}: {
  provider: ProviderInventory
  device: InventoryDevice
  session: SessionView | undefined
  onOpen: () => void
}) {
  const Icon = d.host && !d.device ? ServerIcon : SmartphoneIcon
  const hot = hottest(thermalOf(d))
  const hold = d.slot.maintenance

  return (
    <TableRow className="cursor-pointer" onClick={onOpen}>
      <TableCell>
        <div className="flex items-center gap-2">
          <Icon className="text-muted-foreground size-4 shrink-0" />
          <div className="min-w-0">
            <div className="truncate font-medium">{d.slot.label}</div>
            {d.slot.label !== d.slot.id && (
              <div className="text-muted-foreground truncate font-mono text-[11px]">{d.slot.id}</div>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge className={cn("capitalize", stateBadge[d.slot.state])}>{d.slot.state}</Badge>
        {hold?.reason && (
          <div className="text-muted-foreground mt-0.5 max-w-40 truncate text-[11px]">{hold.reason}</div>
        )}
      </TableCell>
      <TableCell>
        {d.session ? (
          <div className="min-w-0">
            <Link
              to="/session/$provider/$id"
              params={{ provider: p.name, id: d.session }}
              className="font-mono text-xs underline-offset-2 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {d.session}
            </Link>
            {session && (
              <div className="text-muted-foreground max-w-48 truncate text-[11px]">
                {session.label || session.package} · {session.ownerName || session.owner}
              </div>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        {d.device ? (
          <div className="min-w-0">
            <div className="truncate">{[d.device.manufacturer, d.device.model].filter(Boolean).join(" ") || "—"}</div>
            {d.device.android && (
              <div className="text-muted-foreground text-[11px]">
                Android {d.device.android}
                {d.device.sdk ? ` · API ${d.device.sdk}` : ""}
              </div>
            )}
          </div>
        ) : d.host ? (
          <div className="min-w-0">
            <div className="truncate">{d.host.os || d.host.hostname || "—"}</div>
            <div className="text-muted-foreground text-[11px]">
              {[d.host.cores && `${d.host.cores} cores`, d.host.memoryTotal && formatBytes(d.host.memoryTotal)]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">{d.error || "—"}</span>
        )}
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums">
        <Resources device={d} />
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums">
        {hot ? (
          <Stat level={temperatureLevel(hot)}>{celsius(hot.celsius)}</Stat>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="pr-2">
        <ChevronRightIcon className="text-muted-foreground size-4" />
      </TableCell>
    </TableRow>
  )
}

function Resources({ device: d }: { device: InventoryDevice }) {
  if (d.device) {
    const b = d.device.battery
    const storage = d.device.storageTotal ? (d.device.storageUsed ?? 0) / d.device.storageTotal : 0
    return (
      <span className="inline-flex items-center gap-2">
        {b && (
          <Stat level={level(b.celsius, 40, 45)}>
            <span className="inline-flex items-center gap-0.5">
              {b.status === "charging" ? (
                <BatteryChargingIcon className="size-3.5" />
              ) : (
                <BatteryIcon className="size-3.5" />
              )}
              {b.level}%
            </span>
          </Stat>
        )}
        {d.device.storageTotal ? (
          <Stat level={level(storage, 0.85, 0.95)}>
            <span className="inline-flex items-center gap-0.5">
              <HardDriveIcon className="size-3.5" />
              {Math.round(storage * 100)}%
            </span>
          </Stat>
        ) : null}
      </span>
    )
  }
  if (d.host) {
    const h = d.host
    const load = h.cores ? h.load1 / h.cores : 0
    const mem = h.memoryTotal && h.memoryAvailable ? (h.memoryTotal - h.memoryAvailable) / h.memoryTotal : 0
    return (
      <span className="inline-flex items-center gap-2">
        {h.cores ? (
          <Stat level={level(load, 0.8, 1.2)}>
            <span className="inline-flex items-center gap-0.5">
              <CpuIcon className="size-3.5" />
              {Math.round(load * 100)}%
            </span>
          </Stat>
        ) : null}
        {mem ? (
          <Stat level={level(mem, 0.85, 0.95)}>
            <span className="inline-flex items-center gap-0.5">
              <MemoryStickIcon className="size-3.5" />
              {Math.round(mem * 100)}%
            </span>
          </Stat>
        ) : null}
      </span>
    )
  }
  return <span className="text-muted-foreground">—</span>
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
          <Badge className={cn("capitalize", stateBadge[d.slot.state])}>{d.slot.state}</Badge>
        </SheetTitle>
        <SheetDescription className="font-mono text-xs">
          {p.name} · {d.slot.id}
        </SheetDescription>
      </SheetHeader>

      {hold && <HoldNote hold={hold} now={now} what={inherited ? "Held with the whole provider" : "Held"} compact />}

      {d.session && (
        <div className="bg-muted/50 grid gap-0.5 rounded-lg px-3 py-2 text-xs">
          <span className="text-muted-foreground">Session</span>
          <Link
            to="/session/$provider/$id"
            params={{ provider: p.name, id: d.session }}
            className="font-mono underline-offset-2 hover:underline"
          >
            {d.session}
          </Link>
          {session && (
            <span className="text-muted-foreground min-w-0 truncate">
              {session.label || session.package} · {session.ownerName || session.owner}
            </span>
          )}
        </div>
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
      <div className="flex items-baseline gap-2 text-sm font-medium">
        {title}
        {hint && <span className="text-muted-foreground font-mono text-xs font-normal">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function HoldNote({ hold, now, what, compact }: { hold: Maintenance; now: number; what: string; compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-900 dark:text-sky-100",
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
        <Meter icon={HardDriveIcon} label="Storage" used={d.storageUsed ?? 0} total={d.storageTotal} />
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
          <Meter icon={MemoryStickIcon} label="Memory" used={h.memoryTotal - h.memoryAvailable} total={h.memoryTotal} />
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
                  <span className={cn("size-1.5 rounded-full", levelFill[tl])} />
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

function Meter({ icon: Icon, label, used, total }: { icon: LucideIcon; label: string; used: number; total: number }) {
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
