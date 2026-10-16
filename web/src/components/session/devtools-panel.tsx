import { useQuery } from "@tanstack/react-query"
import { BugIcon, RefreshCwIcon } from "lucide-react"
import { type Ref, useMemo, useState } from "react"
import { agentClient, type DevToolsTarget, sessionBase, unwrap } from "@/api/client"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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

export function devtoolsURL(provider: string, id: string, t: DevToolsTarget) {
  const base = sessionBase(provider, id)
  const scheme = window.location.protocol === "https:" ? "wss" : "ws"
  const socket = `${window.location.host}${base}/devtools/${encodeURIComponent(t.socket)}/page/${encodeURIComponent(t.id)}`
  return `${base}/devtools-frontend/@${encodeURIComponent(t.frontendRev)}/inspector.html?${scheme}=${socket}`
}

export function DevToolsPanel({
  provider,
  id,
  frameRef,
}: {
  provider: string
  id: string
  frameRef: Ref<HTMLIFrameElement>
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
        <BugIcon className="text-muted-foreground size-4 shrink-0" />
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
        <Button variant="ghost" size="icon-sm" onClick={() => void targets.refetch()} aria-label="Refresh targets">
          <RefreshCwIcon className={targets.isFetching ? "animate-spin" : ""} />
        </Button>
      </div>
      {selected ? (
        <iframe
          key={key(selected)}
          ref={frameRef}
          title="Chrome DevTools"
          src={devtoolsURL(provider, id, selected)}
          className="min-h-0 w-full flex-1 bg-white"
        />
      ) : (
        <div className="text-muted-foreground grid flex-1 place-items-center p-6 text-center text-sm">
          {targets.isError
            ? `Could not list DevTools targets: ${targets.error.message}`
            : "No debuggable WebView yet. Targets appear as soon as the app opens one."}
        </div>
      )}
    </div>
  )
}
