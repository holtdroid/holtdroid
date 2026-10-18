import { InfoIcon } from "lucide-react"
import { useComputers, useSSHInfo } from "@/api/ssh"
import { ActiveTunnels } from "@/components/ssh/active-tunnels"
import { ComputerCard } from "@/components/ssh/computer-card"
import { ConnectCard } from "@/components/ssh/connect-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"

export function ComputersPage() {
  const info = useSSHInfo()
  const computers = useComputers()
  const list = computers.data?.computers ?? []

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:p-6">
        <div className="grid content-start gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Computers</h1>
            <p className="text-muted-foreground max-w-xl text-sm">
              Your computers connected with the holtdroid client. Pick which of their ports your devices reach as
              localhost; every device you run gets them, including ones you start later.
            </p>
          </div>

          {info.data && !info.data.enabled && (
            <Alert>
              <InfoIcon />
              <AlertTitle>SSH access is turned off on this server</AlertTitle>
              <AlertDescription>An administrator has to enable the SSH gateway first.</AlertDescription>
            </Alert>
          )}

          {info.data?.enabled &&
            (computers.isPending ? (
              <Skeleton className="h-40" />
            ) : computers.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{computers.error.message}</AlertDescription>
              </Alert>
            ) : list.length === 0 ? (
              <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
                No computer is connected right now.
              </p>
            ) : (
              list.map((c) => <ComputerCard key={c.id} computer={c} />)
            ))}

          {info.data?.enabled && <ActiveTunnels />}
        </div>

        {info.data?.enabled && (
          <aside className="grid content-start gap-4">
            <ConnectCard />
          </aside>
        )}
      </div>
    </div>
  )
}
