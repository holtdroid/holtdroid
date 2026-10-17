import { useNavigate } from "@tanstack/react-router"
import { CircleCheckIcon, KeyRoundIcon, PlusIcon, TriangleAlertIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ApiError } from "@/api/client"
import { useAddSSHKey, useSSHKeyRequest, useSSHKeys } from "@/api/ssh-keys"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { useNow } from "@/hooks/use-now"
import { formatDuration } from "@/lib/format"
import { keyLabel, parsePublicKey } from "@/lib/ssh-key"

export function KeyRequestCard({ code, full }: { code: string; full: boolean }) {
  const request = useSSHKeyRequest(code)
  const keys = useSSHKeys()
  const add = useAddSSHKey()
  const navigate = useNavigate()
  const now = useNow()
  const [name, setName] = useState("")
  const dismiss = () => void navigate({ to: "/ssh", search: {} })

  if (request.isPending) {
    return (
      <Card>
        <CardContent className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner />
          Looking up the waiting connection…
        </CardContent>
      </Card>
    )
  }

  if (request.isError) {
    const gone = request.error instanceof ApiError && request.error.status === 404
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>This link no longer works</AlertTitle>
        <AlertDescription className="grid gap-2">
          {gone
            ? "The connection that printed it has ended or timed out. Run ssh again for a new link."
            : request.error.message}
          <Button variant="outline" size="sm" className="w-fit" onClick={dismiss}>
            Dismiss
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const r = request.data
  const parsed = parsePublicKey(r.publicKey)
  const key = parsed.ok ? parsed.key : null
  const listed = !!key && !!keys.data?.some((k) => k.blob === key.blob)
  const left = new Date(r.expiresAt).getTime() - now
  const fallbackName = key ? `${keyLabel(key.type, key.bits)} from ${r.clientIP}` : ""

  if (listed) {
    return (
      <Alert>
        <CircleCheckIcon className="text-emerald-600" />
        <AlertTitle>The key is in your list</AlertTitle>
        <AlertDescription className="grid gap-2">
          Your terminal connects to {r.session} as soon as the gateway has the key — usually within a few seconds.
          <Button variant="outline" size="sm" className="w-fit" onClick={dismiss}>
            Done
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const confirm = () => {
    if (!key) return
    add.mutate(
      { key, name: name.trim() || fallbackName },
      {
        onSuccess: (stored) => toast.success(`Added “${stored.name}”`),
        onError: (err) => toast.error("Could not add the key", { description: err.message }),
      },
    )
  }

  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon className="size-4 text-amber-600" />
          Add the key your terminal offered?
        </CardTitle>
        <CardDescription>
          A connection to <code className="font-mono text-xs">{r.session}</code> from {r.clientIP} is waiting for this
          key{left > 0 ? ` for ${formatDuration(left)} more` : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1.5">
          <span className="text-xs font-medium">Fingerprint — it must match the one in your terminal</span>
          <code className="bg-muted rounded-md px-2.5 py-2 font-mono text-xs break-all">{r.fingerprint}</code>
          {key && <span className="text-muted-foreground text-xs">{keyLabel(key.type, key.bits)} key</span>}
        </div>
        <Alert>
          <TriangleAlertIcon />
          <AlertDescription>
            Confirm only if you have just run ssh yourself. Whoever holds this key can use your sessions, so never add a
            key from a link someone sent you.
          </AlertDescription>
        </Alert>
        <div className="grid gap-2">
          <Label htmlFor="ssh-request-name">Name</Label>
          <Input
            id="ssh-request-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={fallbackName}
            maxLength={100}
          />
        </div>
        {!parsed.ok && <p className="text-destructive text-xs">{parsed.error} — it can&apos;t be added.</p>}
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <p className="text-muted-foreground text-xs">{full ? "You've reached the limit of 32 keys." : ""}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={dismiss}>
            Ignore
          </Button>
          <Button onClick={confirm} disabled={!key || full || left <= 0 || add.isPending}>
            {add.isPending ? <Spinner /> : <PlusIcon />}
            Add key
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
