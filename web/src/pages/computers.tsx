import { InfoIcon } from "lucide-react"
import { useComputers, useSSHInfo } from "@/api/ssh"
import { ActiveTunnels } from "@/components/ssh/active-tunnels"
import { ComputerCard } from "@/components/ssh/computer-card"
import { ConnectCard } from "@/components/ssh/connect-card"
import { EmptyPanel, PageHeader } from "@/components/page"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"

export function ComputersPage() {
  const info = useSSHInfo()
  const computers = useComputers()
  const list = computers.data?.computers ?? []

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-7xl gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-8 lg:py-7">
        <div className="grid content-start gap-4">
          <PageHeader
            title="Computers"
            meta={list.length > 0 ? `${list.length} connected` : undefined}
            description="Your computers connected with the holtdroid client. Pick which of their ports your devices reach as localhost; every device you run gets them, including ones you start later."
          />

          {info.data && !info.data.enabled && (
            <Alert>
              <InfoIcon />
              <AlertTitle>SSH access is turned off on this server</AlertTitle>
              <AlertDescription>An administrator has to enable the SSH gateway first.</AlertDescription>
            </Alert>
          )}

          {info.data?.enabled &&
            (computers.isPending ? (
              <Skeleton className="h-40 rounded-2xl" />
            ) : computers.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{computers.error.message}</AlertDescription>
              </Alert>
            ) : list.length === 0 ? (
              <EmptyPanel>No computer is connected right now.</EmptyPanel>
            ) : (
              list.map((c) => <ComputerCard key={c.id} computer={c} />)
            ))}

          {info.data?.enabled && <ActiveTunnels />}
        </div>

        {info.data?.enabled && (
          <aside className="bg-card grid content-start gap-3 self-start rounded-2xl border p-5 text-sm lg:sticky lg:top-6 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto">
            <h2 className="text-base font-semibold">Connect a computer</h2>
            <p className="text-muted-foreground">
              One command per computer, on macOS or Linux. It downloads the holtdroid client, which makes its own key
              for this portal, publishes the ports you pick on every device you run and gives each device&apos;s ADB a
              local port.
            </p>
            <ConnectCard />
          </aside>
        )}
      </div>
    </div>
  )
}
