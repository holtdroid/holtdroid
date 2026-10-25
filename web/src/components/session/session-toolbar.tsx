import { useMutation } from "@tanstack/react-query"
import { DatabaseIcon, PackageIcon, PlayIcon, RotateCcwIcon } from "lucide-react"
import { useMemo } from "react"
import { toast } from "sonner"
import { agentClient, unwrap } from "@/api/client"
import { useAppData, useSaveAppData } from "@/api/queries"
import { IconButton } from "@/components/session/icon-button"

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
