import { Link } from "@tanstack/react-router"
import { CableIcon, LaptopIcon, MonitorSmartphoneIcon, PlugIcon, SmartphoneIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import { sessionBase, type Tunnels } from "@/api/client"
import { useComputers, useSSHInfo } from "@/api/ssh"
import { CopyBlock } from "@/components/copy-button"
import { CardLine, Note, ShadeCard, ShadeHeader, ShadePanel, ShadeRoot } from "@/components/session/shade"
import { ConnectCard } from "@/components/ssh/connect-card"
import { PortChip } from "@/components/ssh/port-chip"
import { HoverCardTrigger } from "@/components/ui/hover-card"
import { useEventSource } from "@/hooks/use-event-source"
import { useNow } from "@/hooks/use-now"
import { formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"

const noTunnels: Tunnels = { adb: [], reverse: [] }

export function SSHWidget({ provider, id }: { provider: string; id: string }) {
  const info = useSSHInfo()
  const [tunnels, setTunnels] = useState<Tunnels>(noTunnels)
  const [open, setOpen] = useState(false)
  const url = `${sessionBase(provider, id)}/v1/tunnels${open ? "?probe=true" : ""}`
  useEventSource<{ tunnels: Tunnels }>(info.data?.enabled ? url : null, {
    tunnels: (t) => setTunnels({ ...t, adb: t.adb.filter((a) => a.client === "ssh") }),
  })

  if (!info.data?.enabled || (!info.data.allowADB && !info.data.allowReverse)) return null
  const { allowADB, allowReverse } = info.data
  const ports = tunnels.reverse.length
  const connected = tunnels.adb.length + ports > 0

  return (
    <ShadeRoot onOpenChange={setOpen}>
      <HoverCardTrigger asChild>
        <ShadeCard aria-label="SSH">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <CableIcon className={cn("size-4 shrink-0", connected ? "text-emerald-400" : "text-neutral-400")} />
            SSH
          </span>
          <CardLine icon={connected ? LaptopIcon : PlugIcon}>
            {connected ? `${tunnels.adb.length > 0 ? "ADB" : "Ports"} connected` : "Not connected"}
          </CardLine>
          {ports > 0 && (
            <CardLine icon={SmartphoneIcon}>
              {ports} {ports === 1 ? "port" : "ports"} published
            </CardLine>
          )}
        </ShadeCard>
      </HoverCardTrigger>
      <ShadePanel>
        <ShadeHeader title="SSH" summary={connected ? describe(tunnels) : summaryOf(allowADB, allowReverse)} />
        <SSHShade slug={`${provider}-${id}`} tunnels={tunnels} allowADB={allowADB} allowReverse={allowReverse} />
      </ShadePanel>
    </ShadeRoot>
  )
}

function summaryOf(allowADB: boolean, allowReverse: boolean) {
  if (allowADB && allowReverse) return "ADB and your computer's localhost, through the holtdroid client"
  return allowADB ? "ADB through the holtdroid client" : "Your computer's localhost, through the holtdroid client"
}

function describe(t: Tunnels) {
  return [
    t.adb.length > 0 && `ADB from ${t.adb.length === 1 ? t.adb[0]?.user : `${t.adb.length} computers`}`,
    t.reverse.length > 0 && `${t.reverse.length} ${t.reverse.length === 1 ? "port" : "ports"}`,
  ]
    .filter(Boolean)
    .join(" · ")
}

function SSHShade({
  slug,
  tunnels,
  allowADB,
  allowReverse,
}: {
  slug: string
  tunnels: Tunnels
  allowADB: boolean
  allowReverse: boolean
}) {
  const computers = useComputers()
  const list = computers.data?.computers ?? []
  const adb = (allowADB ? list : []).flatMap((c) =>
    c.adb.filter((a) => a.session === slug).map((a) => ({ port: a.port, hostname: c.hostname })),
  )

  return (
    <div className="dark contents">
      <Connections tunnels={tunnels} />

      {allowReverse && (
        <Note>
          SSH forwards your computer&apos;s localhost to this device: a dev server on your computer opens in the app as
          http://localhost:&lt;port&gt;, so no tunnels or IP addresses are needed.
        </Note>
      )}
      {!allowADB && <Note>ADB over SSH is turned off on this portal.</Note>}
      {!allowReverse && <Note>Publishing your computer&apos;s localhost is turned off on this portal.</Note>}

      {adb.length > 0 && (
        <Group title="ADB on your computer">
          {adb.map((a) => (
            <div key={a.hostname} className="grid gap-1.5 rounded-3xl bg-neutral-800 px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-medium">
                <LaptopIcon className="size-4 text-sky-200" />
                {a.hostname}
              </span>
              <CopyBlock text={`adb -s 127.0.0.1:${a.port} shell`} className="bg-neutral-900" />
            </div>
          ))}
        </Group>
      )}

      {computers.isSuccess && list.length === 0 ? (
        <Group title="Connect a computer">
          <div className="grid gap-2 rounded-3xl bg-neutral-800 px-4 py-3 text-neutral-100 [&_.bg-muted]:bg-neutral-900">
            <ConnectCard />
          </div>
          <Note>
            One command per computer, on macOS or Linux. It downloads the holtdroid client, which{" "}
            {allowReverse ? "publishes your dev servers on every device you run" : ""}
            {allowReverse && allowADB ? " and " : ""}
            {allowADB ? "gives each device's ADB a local port" : ""}.
          </Note>
        </Group>
      ) : allowReverse ? (
        <Note>
          Dev servers are published automatically; pin other ports on the{" "}
          <Link to="/computers" className="font-medium text-sky-200 underline underline-offset-2">
            Computers
          </Link>{" "}
          page. Apps on the device reach them as http://localhost:&lt;port&gt;.
        </Note>
      ) : null}
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h4 className="px-1 text-xs font-medium text-neutral-400">{title}</h4>
      {children}
    </section>
  )
}

function Connections({ tunnels }: { tunnels: Tunnels }) {
  const now = useNow(30_000)
  if (tunnels.adb.length === 0 && tunnels.reverse.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-full bg-neutral-800 px-4 py-3 text-sm text-neutral-300">
        <PlugIcon className="size-5 shrink-0 text-neutral-400" />
        Nothing is connected over SSH right now.
      </div>
    )
  }
  return (
    <Group title="Connected now">
      <div className="grid gap-1 overflow-hidden rounded-3xl">
        {tunnels.adb.map((a) => (
          <div key={`adb-${a.user}-${a.since}`} className="flex items-center gap-3 bg-neutral-800 px-4 py-2.5">
            <MonitorSmartphoneIcon className="size-4 shrink-0 text-emerald-400" />
            <span className="grid min-w-0">
              <span className="text-sm font-medium">ADB</span>
              <span className="truncate text-xs text-neutral-400">
                {a.user} · {formatRelative(a.since, now)}
              </span>
            </span>
          </div>
        ))}
        {tunnels.reverse.length > 0 && (
          <div className="grid gap-2 bg-neutral-800 px-4 py-2.5">
            <span className="flex items-center gap-3 text-sm font-medium">
              <SmartphoneIcon className="size-4 shrink-0 text-emerald-400" />
              Your ports on the device
            </span>
            <div className="flex flex-wrap gap-1.5">
              {tunnels.reverse.map((r) => (
                <PortChip key={r.port} tunnel={r} now={now} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Group>
  )
}
