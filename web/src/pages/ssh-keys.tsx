import { InfoIcon } from "lucide-react"
import { useSSHInfo, useSSHKeys, useSSHKeySync } from "@/api/ssh-keys"
import { AddKeyForm } from "@/components/ssh/add-key-form"
import { KeyList } from "@/components/ssh/key-list"
import { SyncStatus } from "@/components/ssh/sync-status"
import { KeygenCard, UsageCard } from "@/components/ssh/usage-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

const MAX_KEYS = 32

export function SSHKeysPage() {
  const info = useSSHInfo()
  const keys = useSSHKeys()
  const sync = useSSHKeySync()
  const list = keys.data ?? []

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-6">
        <div className="grid content-start gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">SSH keys</h1>
              <p className="text-muted-foreground max-w-xl text-sm">
                Keys let you tunnel ADB and your local ports to a device. They live in this browser and are sent to the
                SSH gateway while the portal is open — nothing is stored on the server.
              </p>
            </div>
            <SyncStatus sync={sync} />
          </div>

          {info.data && !info.data.enabled && (
            <Alert>
              <InfoIcon />
              <AlertTitle>SSH access is turned off on this server</AlertTitle>
              <AlertDescription>
                You can still keep your keys here; they will be sent automatically once an administrator enables it.
              </AlertDescription>
            </Alert>
          )}

          <AddKeyForm full={list.length >= MAX_KEYS} />

          <section className="grid gap-2">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold">Your keys</h2>
              <span className="text-muted-foreground text-xs">
                {list.length} of {MAX_KEYS}
              </span>
            </div>
            {keys.isError ? (
              <Alert variant="destructive">
                <AlertDescription>Could not read the browser storage: {keys.error.message}</AlertDescription>
              </Alert>
            ) : (
              <KeyList keys={list} loading={keys.isPending} errors={sync.keyErrors} />
            )}
          </section>
        </div>

        <aside className="grid content-start gap-4">
          {info.data?.enabled && <UsageCard info={info.data} />}
          <KeygenCard />
          <p className="text-muted-foreground px-1 text-xs">
            Haven&apos;t opened the portal for a while? Open it once before connecting so the gateway gets your keys
            again. Keys are tied to this browser — add them again on another one.
          </p>
        </aside>
      </div>
    </div>
  )
}
