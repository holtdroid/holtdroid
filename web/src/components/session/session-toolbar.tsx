import { useMutation, useQueryClient } from "@tanstack/react-query"
import { DatabaseIcon, GlobeIcon, PackageIcon, PlayIcon, RotateCcwIcon } from "lucide-react"
import { useMemo } from "react"
import { toast } from "sonner"
import { agentClient, type Location, unwrap } from "@/api/client"
import { useAppData, useSaveAppData } from "@/api/queries"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { IconButton } from "@/components/session/icon-button"
import { SSHControl } from "@/components/session/ssh-control"
import { networkKey, useNetwork } from "@/components/session/use-device"
import { rememberLocation } from "@/lib/launch-prefs"

export function SessionToolbar({ provider, id, locations }: { provider: string; id: string; locations: Location[] }) {
  return (
    <div className="flex items-center gap-2">
      {locations.length > 0 && <LocationControl provider={provider} id={id} locations={locations} />}
      <SSHControl provider={provider} id={id} />
    </div>
  )
}

function LocationControl({ provider, id, locations }: { provider: string; id: string; locations: Location[] }) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  const qc = useQueryClient()
  const network = useNetwork(provider, id)
  const change = useMutation({
    mutationFn: (location: string) => unwrap(client.PUT("/v1/network/location", { body: { location } })),
    onSuccess: (n) => {
      qc.setQueryData(networkKey(provider, id), n)
      rememberLocation(provider, n.location)
      toast.success(`Now browsing from ${n.country || n.location}`, { description: n.externalIp })
    },
    onError: (e) => toast.error("Could not switch location", { description: e.message }),
  })

  return (
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
  )
}

export function AppActions({ provider, id, appRunning }: { provider: string; id: string; appRunning: boolean }) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  const action = useMutation({
    mutationFn: (a: "restart" | "reinstall") =>
      unwrap(client.POST("/v1/app/{action}", { params: { path: { action: a } } })),
    onSuccess: (_, a) =>
      toast(a === "reinstall" ? "Reinstalling the app" : appRunning ? "Restarting the app" : "Starting the app"),
    onError: (e) => toast.error("Action failed", { description: e.message }),
  })
  const appData = useAppData()
  const save = useSaveAppData()
  const saveNow = () =>
    save.mutate(
      { provider, id },
      {
        onSuccess: () => toast.success("App data saved", { description: "Pick it when you launch this app again." }),
        onError: (e) => toast.error("Could not save app data", { description: e.message }),
      },
    )

  return (
    <div className="flex items-center">
      <IconButton
        label={
          appRunning
            ? "Restart app"
            : "Start app. It was closed; the device’s app drawer works too, DevTools and the clipboard attach either way."
        }
        variant={appRunning ? "ghost" : "default"}
        disabled={action.isPending}
        onClick={() => action.mutate("restart")}
      >
        {appRunning ? <RotateCcwIcon /> : <PlayIcon />}
      </IconButton>
      <IconButton
        label="Reinstall app (clears data)"
        disabled={action.isPending}
        onClick={() => action.mutate("reinstall")}
      >
        <PackageIcon />
      </IconButton>
      {appData.data?.enabled && (
        <IconButton label="Save app data now (restarts the app)" disabled={save.isPending} onClick={saveNow}>
          <DatabaseIcon />
        </IconButton>
      )}
    </div>
  )
}
