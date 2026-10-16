import { CircleAlertIcon, KeyRoundIcon, PencilIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useRemoveSSHKey, useRenameSSHKey, useRestoreSSHKey } from "@/api/ssh-keys"
import { CopyButton } from "@/components/copy-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useNow } from "@/hooks/use-now"
import { formatRelative } from "@/lib/format"
import { keyLabel } from "@/lib/ssh-key"
import type { StoredKey } from "@/lib/ssh-store"
import { cn } from "@/lib/utils"

export function KeyList({
  keys,
  loading,
  errors,
}: {
  keys: StoredKey[]
  loading: boolean
  errors: Map<string, string>
}) {
  const now = useNow(60_000)

  if (loading) return <Skeleton className="h-20 rounded-xl" />
  if (keys.length === 0) {
    return (
      <div className="grid justify-items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
        <div className="bg-muted grid size-10 place-items-center rounded-full">
          <KeyRoundIcon className="text-muted-foreground size-5" />
        </div>
        <p className="font-medium">No keys yet</p>
        <p className="text-muted-foreground max-w-sm text-sm">
          Add the public half of an SSH key to reach devices from your terminal: ADB, Android Studio, scrcpy and your
          local dev servers.
        </p>
      </div>
    )
  }
  return (
    <ul className="divide-y rounded-xl border">
      {keys.map((k) => (
        <KeyRow key={k.blob} sshKey={k} now={now} error={errors.get(k.blob)} />
      ))}
    </ul>
  )
}

function KeyRow({ sshKey, now, error }: { sshKey: StoredKey; now: number; error?: string }) {
  const rename = useRenameSSHKey()
  const remove = useRemoveSSHKey()
  const restore = useRestoreSSHKey()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(sshKey.name)

  const startEditing = () => {
    setDraft(sshKey.name)
    setEditing(true)
  }

  const save = () => {
    setEditing(false)
    const name = draft.trim()
    if (!name || name === sshKey.name) return
    rename.mutate(
      { key: sshKey, name },
      { onError: (err) => toast.error("Could not rename the key", { description: err.message }) },
    )
  }

  const onRemove = () =>
    remove.mutate(sshKey, {
      onSuccess: () =>
        toast(`Removed “${sshKey.name}”`, {
          action: { label: "Undo", onClick: () => restore.mutate(sshKey) },
        }),
      onError: (err) => toast.error("Could not remove the key", { description: err.message }),
    })

  return (
    <li className={cn("flex items-start gap-3 p-3", error && "bg-destructive/5")}>
      <div
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          error ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
        )}
      >
        <KeyRoundIcon className="size-4" />
      </div>

      <div className="grid min-w-0 flex-1 gap-1">
        {editing ? (
          <Input
            autoFocus
            value={draft}
            maxLength={100}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") save()
              if (e.key === "Escape") setEditing(false)
            }}
            className="h-7"
            aria-label="Key name"
          />
        ) : (
          <button type="button" className="truncate text-left font-medium" onClick={startEditing} title="Rename">
            {sshKey.name}
          </button>
        )}

        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Badge variant="outline" className="font-normal">
            {keyLabel(sshKey.type, sshKey.bits)}
          </Badge>
          {sshKey.fingerprint && (
            <span className="flex min-w-0 items-center gap-0.5">
              <code className="truncate font-mono">{sshKey.fingerprint}</code>
              <CopyButton text={sshKey.fingerprint} label="Copy fingerprint" />
            </span>
          )}
          <span>added {formatRelative(sshKey.addedAt, now)}</span>
        </div>

        {error && (
          <p className="text-destructive flex items-center gap-1.5 text-xs">
            <CircleAlertIcon className="size-3.5 shrink-0" />
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center">
        <CopyButton text={sshKey.publicKey} label="Copy public key" className="size-7" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={startEditing}>
              <PencilIcon />
              <span className="sr-only">Rename</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Rename</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="hover:text-destructive"
              onClick={onRemove}
              disabled={remove.isPending}
            >
              <Trash2Icon />
              <span className="sr-only">Remove</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove</TooltipContent>
        </Tooltip>
      </div>
    </li>
  )
}
