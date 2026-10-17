import { Link } from "@tanstack/react-router"
import {
  CableIcon,
  KeyRoundIcon,
  PlusIcon,
  RotateCcwIcon,
  SmartphoneIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { useState } from "react"
import { sessionBase, type SSHInfo, type Tunnels } from "@/api/client"
import { useSSHInfo, useSSHKeys } from "@/api/ssh-keys"
import { CopyBlock } from "@/components/copy-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useEventSource } from "@/hooks/use-event-source"
import { useNow } from "@/hooks/use-now"
import { formatRelative } from "@/lib/format"
import {
  DEFAULT_PORT_RULES,
  expandRules,
  formatPortRule,
  loadIncludeADB,
  loadPortRules,
  type PortRule,
  parsePortRule,
  ruleForwards,
  saveIncludeADB,
  savePortRules,
  sshCommand,
} from "@/lib/ssh-ports"
import { cn } from "@/lib/utils"

const noTunnels: Tunnels = { adb: [], reverse: [] }

export function SSHControl({ provider, id }: { provider: string; id: string }) {
  const info = useSSHInfo()
  const [tunnels, setTunnels] = useState<Tunnels>(noTunnels)
  useEventSource<{ tunnels: Tunnels }>(info.data?.enabled ? `${sessionBase(provider, id)}/v1/tunnels` : null, {
    tunnels: setTunnels,
  })

  if (!info.data?.enabled || (!info.data.allowADB && !info.data.allowReverse)) return null
  const active = tunnels.adb.length + tunnels.reverse.length

  return (
    <Popover>
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
          {active > 0 ? `${active} ${active === 1 ? "tunnel" : "tunnels"} open` : "ADB and your local ports over SSH"}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="grid max-h-[80vh] w-[32rem] gap-4 overflow-y-auto">
        <SSHPanel info={info.data} slug={`${provider}-${id}`} tunnels={tunnels} />
      </PopoverContent>
    </Popover>
  )
}

function SSHPanel({ info, slug, tunnels }: { info: SSHInfo; slug: string; tunnels: Tunnels }) {
  const keys = useSSHKeys()
  const [rules, setRules] = useState(loadPortRules)
  const [includeADB, setIncludeADB] = useState(loadIncludeADB)
  const host = info.host || window.location.hostname

  const updateRules = (next: PortRule[]) => {
    setRules(next)
    savePortRules(next)
  }
  const toggleADB = (on: boolean) => {
    setIncludeADB(on)
    saveIncludeADB(on)
  }

  const forwards = info.allowReverse ? expandRules(rules) : []
  const adb = info.allowADB && (includeADB || !info.allowReverse)
  const tunnelCount = forwards.length + (adb ? 1 : 0)
  const command = sshCommand({ user: slug, host, port: info.port, forwards, adb })
  const published = new Set(tunnels.reverse.map((r) => r.port))

  return (
    <>
      <div className="grid gap-1">
        <span className="font-medium">SSH tunnels</span>
        <span className="text-muted-foreground text-xs">
          User <code className="font-mono">{slug}</code> on {host}:{info.port}. No shell — only ADB and your ports.
        </span>
      </div>

      {keys.isSuccess && keys.data.length === 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs">
          <KeyRoundIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
          <span>
            Add your public key on the{" "}
            <Link to="/ssh" className="font-medium underline underline-offset-2">
              SSH keys
            </Link>{" "}
            page first; the gateway only lets registered keys in.
          </span>
        </div>
      )}

      <ConnectionStatus tunnels={tunnels} />

      {info.allowReverse && (
        <PortEditor rules={rules} published={published} onChange={updateRules} maxTunnels={info.maxTunnels} />
      )}

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium">Command</span>
          {info.allowADB && info.allowReverse && (
            <Label className="text-muted-foreground gap-2 text-xs font-normal">
              Include ADB
              <Switch size="sm" checked={includeADB} onCheckedChange={toggleADB} />
            </Label>
          )}
        </div>
        <CopyBlock text={command} />
        {adb && <CopyBlock text="adb connect localhost:5555" />}
        {tunnelCount > info.maxTunnels && (
          <p className="text-destructive flex items-center gap-1.5 text-xs">
            <TriangleAlertIcon className="size-3.5" />
            {tunnelCount} tunnels, the gateway allows {info.maxTunnels} per connection. Remove some ports or split them
            over two commands.
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          {forwards.length > 0 && "Apps on the device reach your machine's servers as http://localhost:<port>. "}
          {adb && "The first adb connection shows an authorization prompt on the device screen. "}
          Leave the command running; Ctrl+C closes the tunnels.
        </p>
      </div>
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
            <Tooltip key={r.port}>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="gap-1 border-emerald-500/40 font-mono">
                  localhost:{r.port}
                  {r.connections > 0 && (
                    <span className="text-emerald-600 dark:text-emerald-400">·{r.connections}</span>
                  )}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                Published by {r.user} {formatRelative(r.since, now)}
                {r.connections > 0 && `, ${r.connections} open ${r.connections === 1 ? "connection" : "connections"}`}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  )
}

function PortEditor({
  rules,
  published,
  onChange,
  maxTunnels,
}: {
  rules: PortRule[]
  published: Set<number>
  onChange: (rules: PortRule[]) => void
  maxTunnels: number
}) {
  const [draft, setDraft] = useState("")
  const parsed = draft.trim() ? parsePortRule(draft) : null
  const error = typeof parsed === "string" ? parsed : null
  const isDefault = rules.map(formatPortRule).join(",") === DEFAULT_PORT_RULES.join(",")
  const count = expandRules(rules).length

  const add = () => {
    if (!parsed || typeof parsed === "string") return
    const text = formatPortRule(parsed)
    if (!rules.some((r) => formatPortRule(r) === text)) onChange([...rules, parsed])
    setDraft("")
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">
          Ports to publish on the device{" "}
          <span className={cn("text-muted-foreground font-normal", count > maxTunnels && "text-destructive")}>
            · {count}
          </span>
        </span>
        {!isDefault && (
          <Button
            size="xs"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => onChange(DEFAULT_PORT_RULES.map((t) => parsePortRule(t) as PortRule))}
          >
            <RotateCcwIcon />
            Defaults
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rules.length === 0 && <span className="text-muted-foreground text-xs">No ports — only ADB.</span>}
        {rules.map((rule) => {
          const text = formatPortRule(rule)
          const ports = ruleForwards(rule)
          const up = ports.filter((f) => published.has(f.device)).length
          return (
            <Badge
              key={text}
              variant="outline"
              className={cn(
                "gap-1 pr-0.5 font-mono",
                up === ports.length && "border-emerald-500/50 bg-emerald-500/10",
                up > 0 && up < ports.length && "border-amber-500/50 bg-amber-500/10",
              )}
              title={
                up === 0
                  ? "Not published right now"
                  : up === ports.length
                    ? "Published"
                    : `${up} of ${ports.length} published`
              }
            >
              {rule.local === undefined ? text : `${rule.from} → ${rule.local}`}
              <button
                type="button"
                className="hover:bg-muted rounded-sm p-0.5"
                aria-label={`Remove ${text}`}
                onClick={() => onChange(rules.filter((r) => r !== rule))}
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          )
        })}
      </div>
      <form
        className="flex items-start gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <div className="grid flex-1 gap-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="8080, 5173-5175 or 8080:3000 (device:local)"
            aria-invalid={error !== null}
            className="h-8 font-mono text-xs"
          />
          {error && <span className="text-destructive text-xs">{error}</span>}
        </div>
        <Button type="submit" size="sm" variant="secondary" disabled={!parsed || error !== null}>
          <PlusIcon />
          Add
        </Button>
      </form>
    </div>
  )
}
