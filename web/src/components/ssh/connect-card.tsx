import { TerminalIcon } from "lucide-react"
import { connectCommand, useConnectCode, useSSHInfo } from "@/api/ssh"
import { CopyBlock } from "@/components/copy-button"
import { Button } from "@/components/ui/button"
import { useNow } from "@/hooks/use-now"

export function ConnectCard() {
  const code = useConnectCode()
  const insecureTLS = useSSHInfo().data?.insecureTLS ?? false
  const now = useNow(1000)
  const expiresAt = code.data ? Date.parse(code.data.expiresAt) : 0
  const left = Math.max(0, Math.round((expiresAt - now) / 1000))
  const valid = code.data !== undefined && left > 0

  return (
    <div className="grid gap-2">
      {valid ? (
        <>
          <CopyBlock text={connectCommand(code.data.code, insecureTLS)} />
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
}
