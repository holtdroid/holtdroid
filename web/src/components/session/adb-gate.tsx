import type { Adb } from "@yume-chan/adb"
import { RotateCcwIcon } from "lucide-react"
import type { ReactNode } from "react"
import { type AdbSession, useAdbStatus } from "@/components/session/adb-session"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

export function AdbGate({ session, children }: { session: AdbSession; children: (adb: Adb) => ReactNode }) {
  const status = useAdbStatus(session)
  if (status.state === "ready") return children(status.adb)
  return (
    <div className="text-muted-foreground grid h-full place-items-center p-6 text-center text-sm">
      {status.state === "error" ? (
        <div className="grid justify-items-center gap-3">
          <p>Could not reach the device over ADB: {status.error}</p>
          <Button size="sm" variant="outline" onClick={() => void session.reopen()}>
            <RotateCcwIcon />
            Reconnect
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Spinner />
          Connecting to ADB…
        </div>
      )}
    </div>
  )
}
