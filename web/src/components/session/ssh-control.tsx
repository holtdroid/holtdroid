import { Link } from "@tanstack/react-router"
import { CableIcon, SmartphoneIcon } from "lucide-react"
import { useState } from "react"
import { sessionBase, type Tunnels } from "@/api/client"
import { useComputers, useSSHInfo } from "@/api/ssh"
import { CopyBlock } from "@/components/copy-button"
import { ConnectCard } from "@/components/ssh/connect-card"
import { PortChip } from "@/components/ssh/port-chip"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useEventSource } from "@/hooks/use-event-source"
import { useNow } from "@/hooks/use-now"
import { formatRelative } from "@/lib/format"

const noTunnels: Tunnels = { adb: [], reverse: [] }

export function SSHControl({ provider, id }: { provider: string; id: string }) {
  const info = useSSHInfo()
  const [tunnels, setTunnels] = useState<Tunnels>(noTunnels)
  const [open, setOpen] = useState(false)
  const url = `${sessionBase(provider, id)}/v1/tunnels${open ? "?probe=true" : ""}`
  useEventSource<{ tunnels: Tunnels }>(info.data?.enabled ? url : null, {
    tunnels: (t) => setTunnels({ ...t, adb: t.adb.filter((a) => a.client === "ssh") }),
  })

  if (!info.data?.enabled || (!info.data.allowADB && !info.data.allowReverse)) return null
  const active = tunnels.adb.length + tunnels.reverse.length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline">
              <CableIcon />
              SSH
              {active > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-600 tabular-nums dark:text-emerald-400">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  {active}
                </span>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {active > 0 ? `${active} ${active === 1 ? "tunnel" : "tunnels"} open` : "ADB and your computer's ports"}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="grid max-h-[80vh] w-[28rem] gap-4 overflow-y-auto">
        <SSHPanel slug={`${provider}-${id}`} tunnels={tunnels} />
      </PopoverContent>
    </Popover>
  )
}

function SSHPanel({ slug, tunnels }: { slug: string; tunnels: Tunnels }) {
  const computers = useComputers()
  const list = computers.data?.computers ?? []
  const adb = list.flatMap((c) =>
    c.adb.filter((a) => a.session === slug).map((a) => ({ port: a.port, hostname: c.hostname })),
  )

  return (
    <>
      <div className="grid gap-1">
        <span className="font-medium">Your computer</span>
        <span className="text-muted-foreground text-xs">
          The holtdroid client publishes your computer&apos;s ports on this device and gives its ADB a local port.
        </span>
      </div>

      <ConnectionStatus tunnels={tunnels} />

      {adb.map((a) => (
        <div key={a.hostname} className="grid gap-1.5">
          <span className="text-xs font-medium">ADB on {a.hostname}</span>
          <CopyBlock text={`adb -s 127.0.0.1:${a.port} shell`} />
        </div>
      ))}

      {computers.isSuccess && list.length === 0 ? (
        <div className="grid gap-2">
          <span className="text-xs font-medium">Connect a computer</span>
          <ConnectCard compact />
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          Choose the published ports on the{" "}
          <Link to="/computers" className="font-medium underline underline-offset-2">
            Computers
          </Link>{" "}
          page. Apps on the device reach them as http://localhost:&lt;port&gt;.
        </p>
      )}
    </>
  )
}

function ConnectionStatus({ tunnels }: { tunnels: Tunnels }) {
  const now = useNow(30_000)
  if (tunnels.adb.length === 0 && tunnels.reverse.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 rounded-md border border-dashed p-2.5 text-xs">
        <span className="bg-muted-foreground/40 size-2 rounded-full" />
        Nothing is connected over SSH right now.
      </div>
    )
  }
  return (
    <div className="grid gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs">
      {tunnels.adb.map((a) => (
        <div key={`adb-${a.user}-${a.since}`} className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-500" />
          <span className="font-medium">ADB</span>
          <span className="text-muted-foreground">
            {a.user} · {formatRelative(a.since, now)}
          </span>
        </div>
      ))}
      {tunnels.reverse.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <SmartphoneIcon className="text-muted-foreground size-3.5" />
          {tunnels.reverse.map((r) => (
            <PortChip key={r.port} tunnel={r} now={now} />
          ))}
        </div>
      )}
    </div>
  )
}
