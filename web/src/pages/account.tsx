import { CloudIcon, FingerprintIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import {
  type EffectiveLimits,
  type Passkey,
  passkeyError,
  roleLabel,
  useAccount,
  useAddPasskey,
  useDeletePasskey,
  useRenameAccount,
  useRenamePasskey,
} from "@/api/users"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { useReferences } from "@/api/queries"
import { FigmaTokenSection } from "@/components/figma-token"
import { useNow } from "@/hooks/use-now"
import { formatBytes, formatRelative, formatSpan } from "@/lib/format"

export function AccountPage() {
  const account = useAccount()
  const references = useReferences()
  const now = useNow(30_000)
  const data = account.data
  const user = data?.user

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-3xl content-start gap-6 p-4 lg:p-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Account</h1>
          <p className="text-muted-foreground text-sm">
            Your profile, the passkeys you sign in with and your Figma token.
          </p>
        </div>
        {account.isError && (
          <Alert variant="destructive">
            <AlertDescription>Could not load your account: {account.error.message}</AlertDescription>
          </Alert>
        )}
        {!data || !user ? (
          <Skeleton className="h-60 rounded-xl" />
        ) : (
          <>
            <section className="grid gap-3 rounded-xl border p-4">
              <NameForm key={user.name} name={user.name} />
              <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span>{user.email}</span>
                <span>{roleLabel[user.role]}</span>
                <span>Member since {new Date(user.createdAt).toLocaleDateString()}</span>
              </div>
              <LimitsSummary limits={user.effective} />
            </section>
            <section className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">Passkeys</h2>
                <AddPasskey />
              </div>
              <ul className="divide-y rounded-xl border">
                {data.passkeys.map((p) => (
                  <PasskeyRow key={p.id} passkey={p} now={now} last={data.passkeys.length === 1} />
                ))}
              </ul>
              <p className="text-muted-foreground text-xs">
                Keep at least two, e.g. one synced by your password manager and a security key, so losing a device
                doesn&apos;t lock you out. If it does, an admin can send you a recovery link.
              </p>
            </section>
            {references.data?.enabled && (
              <section className="grid gap-3">
                <div>
                  <h2 className="font-semibold">Figma</h2>
                  <p className="text-muted-foreground text-sm">
                    A personal access token lets you import frames from Figma into the Pixel perfect tab, with their
                    layers.
                  </p>
                </div>
                <div className="rounded-xl border p-4">
                  <FigmaTokenSection />
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function NameForm({ name: initial }: { name: string }) {
  const rename = useRenameAccount()
  const [name, setName] = useState(initial)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    rename.mutate(name, { onSuccess: () => toast.success("Name saved") })
  }
  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <div className="grid flex-1 gap-2">
        <Label htmlFor="account-name">Name</Label>
        <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
      </div>
      <Button type="submit" variant="outline" disabled={name.trim() === "" || name === initial || rename.isPending}>
        Save
      </Button>
    </form>
  )
}

export function LimitsSummary({ limits }: { limits: EffectiveLimits }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
      <Limit label="Devices at once" value={limits.maxSessions > 0 ? String(limits.maxSessions) : "No limit"} />
      <Limit label="Session length" value={formatSpan(limits.maxSessionTTL)} />
      <Limit label="Recordings" value={limits.recordingsQuota > 0 ? formatBytes(limits.recordingsQuota) : "No limit"} />
      <Limit
        label="App data save"
        value={limits.appDataMaxSize > 0 ? formatBytes(limits.appDataMaxSize) : "No limit"}
      />
      <Limit label="References" value={limits.referencesQuota > 0 ? formatBytes(limits.referencesQuota) : "No limit"} />
      <Limit label="Media library" value={limits.mediaQuota > 0 ? formatBytes(limits.mediaQuota) : "No limit"} />
    </dl>
  )
}

function Limit({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

function AddPasskey() {
  const add = useAddPasskey()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const submit = (e: FormEvent) => {
    e.preventDefault()
    add.mutate(name, {
      onSuccess: () => {
        setOpen(false)
        setName("")
        toast.success("Passkey added")
      },
    })
  }
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlusIcon />
        Add passkey
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Add a passkey</DialogTitle>
              <DialogDescription>Your browser asks which device or password manager should keep it.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="new-key-name">Name</Label>
              <Input
                id="new-key-name"
                placeholder="e.g. MacBook, iPhone, YubiKey"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                autoFocus
              />
            </div>
            {add.isError && <p className="text-destructive text-sm">{passkeyError(add.error)}</p>}
            <DialogFooter>
              <Button type="submit" disabled={add.isPending}>
                {add.isPending ? <Spinner /> : <FingerprintIcon />}
                Continue
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function PasskeyRow({ passkey: p, now, last }: { passkey: Passkey; now: number; last: boolean }) {
  const rename = useRenamePasskey()
  const remove = useDeletePasskey()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(p.name)

  const save = (e: FormEvent) => {
    e.preventDefault()
    rename.mutate({ id: p.id, name }, { onSuccess: () => setEditing(false) })
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <FingerprintIcon className="text-muted-foreground size-4 shrink-0" />
      {editing ? (
        <form onSubmit={save} className="flex flex-1 gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus className="h-8" />
          <Button type="submit" size="sm" disabled={name.trim() === "" || rename.isPending}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="grid min-w-0 flex-1 gap-0.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="truncate">{p.name}</span>
            {p.synced && (
              <Badge variant="secondary" className="gap-1">
                <CloudIcon className="size-3" />
                synced
              </Badge>
            )}
          </div>
          <div className="text-muted-foreground text-xs">
            Added {formatRelative(p.createdAt, now)}
            {p.lastUsedAt ? ` · last used ${formatRelative(p.lastUsedAt, now)}` : " · never used to sign in"}
          </div>
        </div>
      )}
      {!editing && (
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" aria-label="Rename" onClick={() => setEditing(true)}>
            <PencilIcon />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Remove"
            disabled={last || remove.isPending}
            title={last ? "Add another passkey before removing this one" : undefined}
            onClick={() => remove.mutate(p.id, { onError: (e) => toast.error(e.message) })}
          >
            <Trash2Icon />
          </Button>
        </div>
      )}
    </li>
  )
}
