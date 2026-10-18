import { TerminalIcon } from "lucide-react"
import { connectCommand, useConnectCode } from "@/api/ssh"
import { CopyBlock } from "@/components/copy-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useNow } from "@/hooks/use-now"

export function ConnectCard({ compact = false }: { compact?: boolean }) {
  const code = useConnectCode()
  const now = useNow(1000)
  const expiresAt = code.data ? Date.parse(code.data.expiresAt) : 0
  const left = Math.max(0, Math.round((expiresAt - now) / 1000))
  const valid = code.data !== undefined && left > 0

  const body = (
    <div className="grid gap-2">
      {valid ? (
        <>
          <CopyBlock text={connectCommand(code.data.code)} />
          <p className="text-muted-foreground text-xs">
            Run it in a terminal on the computer whose ports you want on your devices. The code in it works once, for
            the next {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}. Afterwards{" "}
            <code className="font-mono">~/.cache/holtdroid/holtdroid</code> reconnects without a new one.
          </p>
        </>
      ) : (
        <Button
          variant="secondary"
          className="justify-self-start"
          disabled={code.isPending}
          onClick={() => code.mutate()}
        >
          <TerminalIcon />
          {code.data ? "Get a new command" : "Get the command"}
        </Button>
      )}
      {code.isError && <p className="text-destructive text-xs">{code.error.message}</p>}
    </div>
  )
  if (compact) return body

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect a computer</CardTitle>
        <CardDescription>
          One command per computer, on macOS or Linux. It downloads the holtdroid client, which makes its own key for
          this portal, publishes the ports you pick on every device you run and gives each device&apos;s ADB a local
          port.
        </CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}
