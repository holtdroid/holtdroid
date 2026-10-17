import type { SSHInfo } from "@/api/client"
import { CopyBlock } from "@/components/copy-button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function KeygenCard() {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>No key yet?</CardTitle>
        <CardDescription>Create one, then paste the printed line into the form.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <CopyBlock text='ssh-keygen -t ed25519 -C "$(whoami)@$(hostname)"' />
        <CopyBlock text="cat ~/.ssh/id_ed25519.pub" />
      </CardContent>
    </Card>
  )
}

export function UsageCard({ info }: { info: SSHInfo }) {
  const host = info.host || window.location.hostname
  const port = info.port === 22 ? "" : ` -p ${info.port}`
  const target = `<session>@${host}`

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Connecting</CardTitle>
        <CardDescription>
          The user name is the session id from the session page.{" "}
          {info.clientIsolation ? "You can reach your own sessions only." : "Any running session is reachable."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {info.allowADB && (
          <div className="grid gap-1.5">
            <span className="text-xs font-medium">ADB on your machine</span>
            <CopyBlock text={`ssh -N${port} -L 5555:adb:5555 ${target}`} />
            <CopyBlock text="adb connect localhost:5555" />
          </div>
        )}
        {info.allowReverse && (
          <div className="grid gap-1.5">
            <span className="text-xs font-medium">Your dev server as localhost:3000 on the device</span>
            <CopyBlock text={`ssh -N${port} -R 3000:localhost:3000 ${target}`} />
          </div>
        )}
        <p className="text-muted-foreground text-xs">
          The SSH button on a session page shows what is connected and builds one command for your whole list of ports.
          Shells are not available — the connection only carries these tunnels.
        </p>
      </CardContent>
    </Card>
  )
}
