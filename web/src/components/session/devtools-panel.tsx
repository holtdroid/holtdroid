import { useQuery } from "@tanstack/react-query"
import { BugIcon, RefreshCwIcon, RotateCwIcon, Settings2Icon } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { agentClient, type DevToolsTarget, sessionBase, unwrap } from "@/api/client"
import { CopyButton } from "@/components/copy-button"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cdpCall, normalizeURL } from "@/lib/cdp"
import { setDevToolsPrefs, useDevToolsPrefs } from "@/lib/devtools-prefs"
import { prepareDevTools, styleDevTools } from "@/lib/devtools-style"
import { cn } from "@/lib/utils"

const key = (t: DevToolsTarget) => `${t.socket}/${t.id}`

function pick(items: DevToolsTarget[], chosen: DevToolsTarget | null) {
  if (chosen) {
    const same = items.find((t) => key(t) === key(chosen))
    if (same) return same
    const successor = items.find((t) => t.url === chosen.url && t.type === chosen.type)
    if (successor) return successor
  }
  return items.find((t) => t.type === "page") ?? items[0] ?? null
}

const wsScheme = () => (window.location.protocol === "https:" ? "wss" : "ws")

function cdpSocket(provider: string, id: string, t: DevToolsTarget) {
  return `${window.location.host}${sessionBase(provider, id)}/devtools/${encodeURIComponent(t.socket)}/page/${encodeURIComponent(t.id)}`
}

export function devtoolsURL(provider: string, id: string, t: DevToolsTarget) {
  const base = sessionBase(provider, id)
  return `${base}/devtools-frontend/@${encodeURIComponent(t.frontendRev)}/inspector.html?${wsScheme()}=${cdpSocket(provider, id, t)}`
}

const navigable = new Set(["page", "iframe"])

export function DevToolsPanel({
  provider,
  id,
  frameRef,
  debuggableOnly = false,
}: {
  provider: string
  id: string
  frameRef: (frame: HTMLIFrameElement | null) => void
  debuggableOnly?: boolean
}) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  const targets = useQuery({
    queryKey: ["targets", provider, id],
    queryFn: () => unwrap(client.GET("/v1/devtools/targets")),
    refetchInterval: 2_000,
  })
  const items = useMemo(() => targets.data?.items ?? [], [targets.data])
  const [chosen, setChosen] = useState<DevToolsTarget | null>(null)
  const selected = useMemo(() => pick(items, chosen), [items, chosen])
  const selectedKey = selected ? key(selected) : null

  const prefs = useDevToolsPrefs()
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null)
  const attachFrame = useCallback(
    (el: HTMLIFrameElement | null) => {
      frameRef(el)
      setFrame(el)
    },
    [frameRef],
  )

  useLayoutEffect(() => {
    if (selectedKey) prepareDevTools(prefs)
  }, [selectedKey, prefs])

  useEffect(() => {
    if (!frame) return undefined
    const apply = () => styleDevTools(frame, prefs)
    apply()
    frame.addEventListener("load", apply)
    return () => frame.removeEventListener("load", apply)
  }, [frame, prefs])

  const byProcess = useMemo(() => {
    const groups = new Map<string, DevToolsTarget[]>()
    for (const t of items) {
      const label = `${t.process} (pid ${t.pid})`
      groups.set(label, [...(groups.get(label) ?? []), t])
    }
    return [...groups]
  }, [items])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b p-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="group shrink-0"
              onClick={() => void targets.refetch()}
              aria-label="Refresh targets"
            >
              <BugIcon className="text-muted-foreground group-hover:hidden group-focus-visible:hidden" />
              <RefreshCwIcon
                className={cn(
                  "hidden group-hover:block group-focus-visible:block",
                  targets.isFetching && "animate-spin",
                )}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh targets</TooltipContent>
        </Tooltip>
        <Select
          value={selected ? key(selected) : ""}
          onValueChange={(v) => setChosen(items.find((t) => key(t) === v) ?? null)}
          disabled={items.length === 0}
        >
          <SelectTrigger size="sm" className="min-w-0 flex-1">
            <SelectValue placeholder="Waiting for a WebView…" />
          </SelectTrigger>
          <SelectContent>
            {byProcess.map(([process, group]) => (
              <SelectGroup key={process}>
                <SelectLabel>{process}</SelectLabel>
                {group.map((t) => (
                  <SelectItem key={key(t)} value={key(t)}>
                    <span className="text-muted-foreground font-mono text-[10px] uppercase">{t.type}</span>
                    <span className="truncate">{t.title || t.url}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        {selected && (
          <UrlBar
            key={key(selected)}
            target={selected}
            socketURL={`${wsScheme()}://${cdpSocket(provider, id, selected)}`}
            onNavigated={() => void targets.refetch()}
          />
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="DevTools settings">
              <Settings2Icon />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="grid w-72 gap-3">
            <PrefSwitch
              id="devtools-portal-style"
              label="Portal font and colors"
              checked={prefs.portalStyle}
              onChange={(portalStyle) => setDevToolsPrefs({ portalStyle })}
            />
            <PrefSwitch
              id="devtools-screencast"
              label="Screencast on open"
              checked={prefs.screencast}
              onChange={(screencast) => setDevToolsPrefs({ screencast })}
            />
          </PopoverContent>
        </Popover>
      </div>
      {selected ? (
        <iframe
          key={key(selected)}
          ref={attachFrame}
          title="Chrome DevTools"
          src={devtoolsURL(provider, id, selected)}
          className="min-h-0 w-full flex-1 bg-white"
        />
      ) : (
        <div className="text-muted-foreground grid flex-1 place-items-center p-6 text-center text-sm">
          {targets.isError
            ? `Could not list DevTools targets: ${targets.error.message}`
            : debuggableOnly
              ? "No WebView to inspect yet. This device has no root, so only debuggable builds show their WebViews here."
              : "No debuggable WebView yet. Targets appear as soon as the app opens one."}
        </div>
      )}
    </div>
  )
}

function PrefSwitch({
  id,
  label,
  checked,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function UrlBar({
  target,
  socketURL,
  onNavigated,
}: {
  target: DevToolsTarget
  socketURL: string
  onNavigated: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canNavigate = navigable.has(target.type)

  const run = (method: string, params?: object) => {
    setBusy(true)
    cdpCall(socketURL, method, params)
      .then((result) => {
        if (typeof result.errorText === "string") throw new Error(result.errorText)
        setDraft(null)
        onNavigated()
      })
      .catch((err: unknown) => toast.error(`${method}: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => setBusy(false))
  }

  return (
    <form
      className="min-w-0 flex-[2]"
      onSubmit={(e) => {
        e.preventDefault()
        if (draft?.trim()) run("Page.navigate", { url: normalizeURL(draft) })
      }}
    >
      <InputGroup className="h-8">
        {canNavigate && (
          <InputGroupAddon>
            <InputGroupButton
              size="icon-xs"
              aria-label="Reload the page"
              disabled={busy}
              onClick={() => run("Page.reload")}
            >
              <RotateCwIcon />
            </InputGroupButton>
          </InputGroupAddon>
        )}
        <InputGroupInput
          aria-label="Page URL"
          className="font-mono text-xs"
          spellCheck={false}
          readOnly={!canNavigate}
          disabled={busy}
          value={draft ?? target.url}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setDraft(null)
          }}
          onFocus={(e) => e.target.select()}
        />
        <InputGroupAddon align="inline-end">
          <CopyButton text={draft ?? target.url} label="Copy URL" />
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
