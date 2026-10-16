import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ClipboardIcon,
  ClipboardPasteIcon,
  CopyIcon,
  EllipsisVerticalIcon,
  GlobeIcon,
  PackageIcon,
  RotateCcwIcon,
  SendIcon,
} from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { agentClient, type Clipboard, type Location, unwrap } from "@/api/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useEventSource } from "@/hooks/use-event-source"
import { countryFlag } from "@/lib/format"
import { rememberLocation } from "@/lib/last-location"

export function SessionToolbar({
  provider,
  id,
  locations,
  clipboard,
}: {
  provider: string
  id: string
  locations: Location[]
  clipboard: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      {locations.length > 0 && <LocationControl provider={provider} id={id} locations={locations} />}
      {clipboard && <ClipboardControl provider={provider} id={id} />}
      <AppActions provider={provider} id={id} />
    </div>
  )
}

function LocationControl({ provider, id, locations }: { provider: string; id: string; locations: Location[] }) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  const qc = useQueryClient()
  const queryKey = ["network", provider, id]
  const network = useQuery({ queryKey, queryFn: () => unwrap(client.GET("/v1/network")), refetchInterval: 30_000 })
  const change = useMutation({
    mutationFn: (location: string) => unwrap(client.PUT("/v1/network/location", { body: { location } })),
    onSuccess: (n) => {
      qc.setQueryData(queryKey, n)
      rememberLocation(provider, n.location)
      toast.success(`Now browsing from ${n.country || n.location}`, { description: n.externalIp })
    },
    onError: (e) => toast.error("Could not switch location", { description: e.message }),
  })

  return (
    <div className="flex items-center gap-1.5">
      <Select value={network.data?.location ?? ""} onValueChange={(v) => change.mutate(v)} disabled={change.isPending}>
        <SelectTrigger size="sm" className="w-40">
          <GlobeIcon />
          <SelectValue placeholder="Location" />
        </SelectTrigger>
        <SelectContent>
          {locations.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {network.data?.externalIp && (
        <Badge variant="outline" className="font-mono" title="External IP">
          {countryFlag(network.data.country)} {network.data.externalIp}
        </Badge>
      )}
    </div>
  )
}

function ClipboardControl({ provider, id }: { provider: string; id: string }) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  const [deviceText, setDeviceText] = useState("")
  const [draft, setDraft] = useState("")
  const [open, setOpen] = useState(false)

  useEventSource<{ clip: Clipboard }>(`/s/${provider}/${id}/v1/clipboard/events`, {
    clip: (c) => {
      setDeviceText(c.text)
      if (document.hasFocus()) {
        navigator.clipboard.writeText(c.text).then(
          () => toast("Copied from device", { description: c.text.slice(0, 80) }),
          () => undefined,
        )
      }
    },
  })

  const send = useMutation({
    mutationFn: (text: string) => unwrap(client.POST("/v1/clipboard", { body: { text } })),
    onSuccess: () => toast.success("Sent to device clipboard"),
    onError: (e) => toast.error("Could not set device clipboard", { description: e.message }),
  })

  const pasteFromBrowser = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) send.mutate(text)
    } catch {
      setOpen(true)
    }
  }

  return (
    <div className="flex items-center">
      <Button size="sm" variant="outline" className="rounded-r-none" onClick={() => void pasteFromBrowser()}>
        <ClipboardPasteIcon />
        Paste to device
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="rounded-l-none border-l-0 px-2" aria-label="Clipboard">
            <ClipboardIcon />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="grid w-80 gap-3">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium">Device clipboard</span>
            <div className="bg-muted max-h-32 overflow-auto rounded-md p-2 font-mono text-xs break-all whitespace-pre-wrap">
              {deviceText || <span className="text-muted-foreground">Nothing copied on the device yet</span>}
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={!deviceText}
              onClick={() => void navigator.clipboard.writeText(deviceText).then(() => toast("Copied"))}
            >
              <CopyIcon />
              Copy to my clipboard
            </Button>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium">Send text to the device</span>
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} placeholder="Type or paste…" />
            <Button size="sm" disabled={!draft || send.isPending} onClick={() => send.mutate(draft)}>
              <SendIcon />
              Send
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function AppActions({ provider, id }: { provider: string; id: string }) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  const action = useMutation({
    mutationFn: (a: "restart" | "reinstall") =>
      unwrap(client.POST("/v1/app/{action}", { params: { path: { action: a } } })),
    onSuccess: (_, a) => toast(a === "restart" ? "Restarting the app" : "Reinstalling the app"),
    onError: (e) => toast.error("Action failed", { description: e.message }),
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="App actions">
          <EllipsisVerticalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => action.mutate("restart")}>
          <RotateCcwIcon />
          Restart app
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => action.mutate("reinstall")}>
          <PackageIcon />
          Reinstall app
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
