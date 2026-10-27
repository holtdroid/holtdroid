import { CheckIcon, FingerprintIcon, LifeBuoyIcon, PlusIcon, Trash2Icon, UserPlusIcon } from "lucide-react"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import {
  type EffectiveLimits,
  type Invite,
  type Overrides,
  type Role,
  roleLabel,
  type UserDetail,
  type UserView,
  useCreateInvite,
  useCreateUser,
  useDeleteInvite,
  useDeleteUser,
  useDeleteUserPasskey,
  useInvites,
  useRecoveryLink,
  useUpdateUser,
  useUser,
  useUsers,
} from "@/api/users"
import { CopyButton } from "@/components/copy-button"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { UserAvatar } from "@/components/user-avatar"
import { useNow } from "@/hooks/use-now"
import { formatBytes, formatRelative, formatSpan } from "@/lib/format"

const PENDING = "pending"
const toSelect = (role: Role) => role || PENDING
const fromSelect = (value: string): Role => (value === PENDING ? "" : (value as Role))
const GiB = 1 << 30
const MiB = 1 << 20

export function UsersPage() {
  const list = useUsers()
  const invites = useInvites()
  const now = useNow(30_000)
  const [selected, setSelected] = useState<string>()
  const pending = list.data?.items.filter((u) => u.role === "").length ?? 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-5xl content-start gap-4 p-4 lg:p-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Users</h1>
          <p className="text-muted-foreground text-sm">
            People sign up with an invite link, or you create their account and send them a link to register a passkey.
            They sign in with passkeys.
            {list.data && list.data.allowedDomains.length > 0 && (
              <> Only addresses at {list.data.allowedDomains.join(", ")} may sign up.</>
            )}
          </p>
        </div>
        {list.isError && (
          <Alert variant="destructive">
            <AlertDescription>Could not load users: {list.error.message}</AlertDescription>
          </Alert>
        )}
        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users">
              Users{pending > 0 && <Badge className="ml-1.5 h-5 px-1.5">{pending} waiting</Badge>}
            </TabsTrigger>
            <TabsTrigger value="invites">Invite links</TabsTrigger>
          </TabsList>
          <TabsContent value="users" className="mt-3 grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-sm">
                A new user gets a single-use link to register their first passkey.
              </p>
              <NewUser onOpen={setSelected} />
            </div>
            {list.isPending ? (
              <Skeleton className="h-60 rounded-xl" />
            ) : (
              <ul className="divide-y rounded-xl border">
                {list.data?.items.map((u) => (
                  <UserRow key={u.id} user={u} now={now} onOpen={() => setSelected(u.id)} />
                ))}
              </ul>
            )}
          </TabsContent>
          <TabsContent value="invites" className="mt-3 grid gap-3">
            <InviteList invites={invites.data ?? []} now={now} loading={invites.isPending} />
          </TabsContent>
        </Tabs>
      </div>
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(undefined)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected && list.data && (
            <UserSheet id={selected} defaults={list.data.defaults} now={now} onDeleted={() => setSelected(undefined)} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function RoleBadge({ role }: { role: Role }) {
  return <Badge variant={role === "" ? "default" : role === "admin" ? "secondary" : "outline"}>{roleLabel[role]}</Badge>
}

function UserRow({ user: u, now, onOpen }: { user: UserView; now: number; onOpen: () => void }) {
  const update = useUpdateUser()
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <UserAvatar user={u.id} className="size-8" />
        <div className="grid min-w-0 gap-0.5">
          <div className="flex items-center gap-2 text-sm">
            <span className="truncate font-medium">{u.name}</span>
            <RoleBadge role={u.role} />
          </div>
          <div className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
            <span className="truncate">{u.email}</span>
            <span>
              {u.passkeys} passkey{u.passkeys === 1 ? "" : "s"}
            </span>
            <span>{u.lastSeenAt ? `seen ${formatRelative(u.lastSeenAt, now)}` : "never signed in"}</span>
          </div>
        </div>
      </button>
      {u.role === "" && (
        <Button
          size="sm"
          disabled={update.isPending}
          onClick={() =>
            update.mutate(
              { id: u.id, name: u.name, email: u.email, role: "user", limits: u.limits },
              {
                onSuccess: () => toast.success(`${u.name} can now launch devices`),
                onError: (e) => toast.error(e.message),
              },
            )
          }
        >
          <CheckIcon />
          Approve
        </Button>
      )}
    </li>
  )
}

type LimitField = { key: keyof Overrides; label: string; unit: string; scale: number }

const limitFields: LimitField[] = [
  { key: "maxSessions", label: "Devices at once", unit: "", scale: 1 },
  { key: "maxSessionTTL", label: "Session length", unit: "hours", scale: 3600 },
  { key: "recordingsQuota", label: "Recordings quota", unit: "GiB", scale: GiB },
  { key: "appDataMaxSize", label: "App data save size", unit: "MiB", scale: MiB },
  { key: "referencesQuota", label: "Pixel perfect references", unit: "MiB", scale: MiB },
  { key: "mediaQuota", label: "Media library", unit: "GiB", scale: GiB },
]

function describeDefault(key: keyof Overrides, d: EffectiveLimits) {
  if (key === "maxSessionTTL") return formatSpan(d.maxSessionTTL)
  const v = d[key]
  if (v <= 0) return "no limit"
  return key === "maxSessions" ? String(v) : formatBytes(v)
}

function UserSheet({
  id,
  defaults,
  now,
  onDeleted,
}: {
  id: string
  defaults: Record<string, EffectiveLimits>
  now: number
  onDeleted: () => void
}) {
  const user = useUser(id)
  if (!user.data) {
    return user.isError ? (
      <Alert variant="destructive" className="m-4">
        <AlertDescription>{user.error.message}</AlertDescription>
      </Alert>
    ) : (
      <Skeleton className="m-4 h-80" />
    )
  }
  return <UserEditor key={user.data.id} user={user.data} defaults={defaults} now={now} onDeleted={onDeleted} />
}

function UserEditor({
  user,
  defaults,
  now,
  onDeleted,
}: {
  user: UserDetail
  defaults: Record<string, EffectiveLimits>
  now: number
  onDeleted: () => void
}) {
  const update = useUpdateUser()
  const removeKey = useDeleteUserPasskey()
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [role, setRole] = useState<Role>(user.role)
  const [limits, setLimits] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      limitFields.map((f) => {
        const v = user.limits[f.key]
        return [f.key, v === undefined || v === null ? "" : String(v / f.scale)]
      }),
    ),
  )
  const roleDefaults = defaults[role || "user"] ?? defaults.user

  const save = (e: FormEvent) => {
    e.preventDefault()
    const overrides: Overrides = {}
    for (const f of limitFields) {
      const raw = limits[f.key]?.trim()
      if (raw) overrides[f.key] = Math.round(Number(raw) * f.scale)
    }
    update.mutate(
      { id: user.id, name, email, role, limits: overrides },
      { onSuccess: () => toast.success("Saved"), onError: (err) => toast.error(err.message) },
    )
  }

  return (
    <div className="grid gap-6 p-4">
      <SheetHeader className="p-0">
        <SheetTitle>{user.name}</SheetTitle>
        <SheetDescription>
          Joined {new Date(user.createdAt).toLocaleDateString()} ·{" "}
          {user.lastSeenAt ? `seen ${formatRelative(user.lastSeenAt, now)}` : "never signed in"} · {user.sessions}{" "}
          device{user.sessions === 1 ? "" : "s"} running
        </SheetDescription>
      </SheetHeader>

      <form onSubmit={save} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="user-name">Name</Label>
          <Input id="user-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="user-email">Email</Label>
          <Input id="user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label>Role</Label>
          <Select value={toSelect(role)} onValueChange={(v) => setRole(fromSelect(v))}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="admin">Admin: manages users, inventory and the audit log</SelectItem>
              <SelectItem value={PENDING}>Waiting for approval: can&apos;t use the portal</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>Limits</Label>
          <p className="text-muted-foreground -mt-1 text-xs">
            Leave empty for the {roleLabel[role || "user"].toLowerCase()} default. 0 means no limit, except for the
            session length.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {limitFields.map((f) => (
              <div key={f.key} className="grid gap-1">
                <Label htmlFor={`limit-${f.key}`} className="text-xs font-normal">
                  {f.label}
                  {f.unit && <span className="text-muted-foreground"> ({f.unit})</span>}
                </Label>
                <Input
                  id={`limit-${f.key}`}
                  type="number"
                  min={0}
                  step="any"
                  placeholder={roleDefaults ? describeDefault(f.key, roleDefaults) : ""}
                  value={limits[f.key] ?? ""}
                  onChange={(e) => setLimits({ ...limits, [f.key]: e.target.value })}
                />
              </div>
            ))}
          </div>
        </div>
        <Button type="submit" disabled={update.isPending || name.trim() === "" || !email.includes("@")}>
          Save changes
        </Button>
      </form>

      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">Passkeys</h3>
        {user.passkeys.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No passkeys: the user can only get back in with a recovery link.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {user.passkeys.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <FingerprintIcon className="text-muted-foreground size-4" />
                <div className="grid min-w-0 flex-1">
                  <span className="truncate">{p.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {p.lastUsedAt ? `used ${formatRelative(p.lastUsedAt, now)}` : "never used"}
                  </span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove passkey"
                  disabled={removeKey.isPending}
                  onClick={() =>
                    removeKey.mutate({ id: user.id, passkey: p.id }, { onError: (e) => toast.error(e.message) })
                  }
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <RecoverySection id={user.id} />
      </section>

      <DeleteUser user={user} onDeleted={onDeleted} />
    </div>
  )
}

const ttlOptions = [
  { value: "3600", label: "1 hour" },
  { value: "86400", label: "1 day" },
  { value: "604800", label: "7 days" },
  { value: "2592000", label: "30 days" },
]

function RecoverySection({ id }: { id: string }) {
  const recovery = useRecoveryLink()
  const [ttl, setTtl] = useState("86400")
  return (
    <div className="grid gap-2 rounded-lg border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2">
        <LifeBuoyIcon className="size-4" />
        <span className="flex-1 text-sm">Recovery link to register a new passkey</span>
        <Select value={ttl} onValueChange={setTtl}>
          <SelectTrigger size="sm" className="w-30">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ttlOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={recovery.isPending}
          onClick={() => recovery.mutate({ id, ttl: Number(ttl) })}
        >
          Create
        </Button>
      </div>
      {recovery.data && (
        <LinkBox
          link={recovery.data.link}
          note="Single use; earlier recovery links stop working. It is shown only now."
        />
      )}
      {recovery.isError && <p className="text-destructive text-sm">{recovery.error.message}</p>}
    </div>
  )
}

function LinkBox({ link, note }: { link: string; note: string }) {
  return (
    <div className="grid min-w-0 gap-1">
      <div className="bg-muted flex min-w-0 items-center gap-1 rounded-md px-2 py-1">
        <code className="min-w-0 flex-1 truncate text-xs">{link}</code>
        <CopyButton text={link} label="Copy link" />
      </div>
      <p className="text-muted-foreground text-xs">{note}</p>
    </div>
  )
}

function DeleteUser({ user, onDeleted }: { user: UserDetail; onDeleted: () => void }) {
  const remove = useDeleteUser()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
        <Trash2Icon />
        Delete user
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {user.name}?</DialogTitle>
            <DialogDescription>
              Their passkeys are removed and they are signed out. Devices they run keep going until stopped or reaped;
              their recordings and app data stay until they expire.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(user.id, {
                  onSuccess: () => {
                    setOpen(false)
                    onDeleted()
                  },
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

const expiryOptions = [
  { value: "86400", label: "in 1 day" },
  { value: "604800", label: "in 7 days" },
  { value: "2592000", label: "in 30 days" },
  { value: "0", label: "never" },
]

function InviteList({ invites, now, loading }: { invites: Invite[]; now: number; loading: boolean }) {
  const remove = useDeleteInvite()
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          A link signs people up with its role. Use &quot;waiting for approval&quot; for an open link you approve by
          hand.
        </p>
        <NewInvite />
      </div>
      {loading ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : invites.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
          No invite links yet.
        </div>
      ) : (
        <ul className="divide-y rounded-xl border">
          {invites.map((inv) => {
            const expired =
              (inv.expiresAt && new Date(inv.expiresAt).getTime() <= now) || (inv.singleUse && inv.uses > 0)
            return (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{inv.note || "Invite link"}</span>
                    <RoleBadge role={inv.role} />
                    {expired && <Badge variant="outline">{inv.singleUse && inv.uses > 0 ? "used" : "expired"}</Badge>}
                  </div>
                  <div className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
                    <span>{inv.singleUse ? "single use" : `reusable · used ${inv.uses}×`}</span>
                    <span>
                      {inv.expiresAt
                        ? `${new Date(inv.expiresAt).getTime() > now ? "expires" : "expired"} ${formatRelative(inv.expiresAt, now)}`
                        : "never expires"}
                    </span>
                    {inv.domains.length > 0 && <span>{inv.domains.join(", ")}</span>}
                    <span>created {formatRelative(inv.createdAt, now)}</span>
                  </div>
                </div>
                {inv.link && !expired && <CopyButton text={inv.link} label="Copy link" className="size-9" />}
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Revoke"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(inv.id)}
                >
                  <Trash2Icon />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function NewInvite() {
  const create = useCreateInvite()
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<Role>("user")
  const [ttl, setTtl] = useState("604800")
  const [singleUse, setSingleUse] = useState(true)
  const [domains, setDomains] = useState("")
  const [note, setNote] = useState("")

  const start = () => {
    create.reset()
    setOpen(true)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate({
      role,
      ttl: Number(ttl),
      singleUse,
      note,
      domains: domains
        .split(/[\s,]+/)
        .map((d) => d.trim())
        .filter(Boolean),
    })
  }

  return (
    <>
      <Button size="sm" onClick={start}>
        <PlusIcon />
        New invite
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="grid-cols-[minmax(0,1fr)]">
          <DialogHeader>
            <DialogTitle>New invite link</DialogTitle>
            <DialogDescription>Anyone with the link can sign up while it is valid.</DialogDescription>
          </DialogHeader>
          {create.data ? (
            <LinkBox
              link={create.data.link}
              note={singleUse ? "It works once." : "It works until it expires or you revoke it."}
            />
          ) : (
            <form id="new-invite" onSubmit={submit} className="grid gap-4">
              <div className="grid gap-2">
                <Label>Role of new users</Label>
                <Select value={toSelect(role)} onValueChange={(v) => setRole(fromSelect(v))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value={PENDING}>Waiting for approval</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Expires</Label>
                  <Select value={ttl} onValueChange={setTtl}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {expiryOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="single-use">Single use</Label>
                  <Switch id="single-use" checked={singleUse} onCheckedChange={setSingleUse} className="mt-2" />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invite-domains">Email domains (optional)</Label>
                <Input
                  id="invite-domains"
                  placeholder="example.com, example.org"
                  value={domains}
                  onChange={(e) => setDomains(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invite-note">Note (optional)</Label>
                <Input
                  id="invite-note"
                  placeholder="Who it is for"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                />
              </div>
              {create.isError && <p className="text-destructive text-sm">{create.error.message}</p>}
            </form>
          )}
          <DialogFooter>
            {create.data ? (
              <Button key="done" type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            ) : (
              <Button key="create" type="submit" form="new-invite" disabled={create.isPending}>
                <UserPlusIcon />
                Create link
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function NewUser({ onOpen }: { onOpen: (id: string) => void }) {
  const create = useCreateUser()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("user")
  const [ttl, setTtl] = useState("604800")

  const start = () => {
    create.reset()
    setName("")
    setEmail("")
    setOpen(true)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate({ name, email, role, ttl: Number(ttl) })
  }

  return (
    <>
      <Button size="sm" onClick={start}>
        <UserPlusIcon />
        New user
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="grid-cols-[minmax(0,1fr)]">
          <DialogHeader>
            <DialogTitle>{create.data ? `${create.data.user.name} is added` : "New user"}</DialogTitle>
            <DialogDescription>
              {create.data
                ? "Send them this link: it registers their first passkey and signs them in."
                : "The account has no passkey until they open the link you send them."}
            </DialogDescription>
          </DialogHeader>
          {create.data ? (
            <LinkBox
              link={create.data.link.link}
              note={`Single use, expires ${new Date(create.data.link.expiresAt).toLocaleString()}. It is shown only now; make a new one from the user's page if it gets lost.`}
            />
          ) : (
            <form id="new-user" onSubmit={submit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="new-user-name">Name</Label>
                <Input id="new-user-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-user-email">Email</Label>
                <Input id="new-user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Role</Label>
                  <Select value={toSelect(role)} onValueChange={(v) => setRole(fromSelect(v))}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value={PENDING}>Waiting for approval</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Link expires in</Label>
                  <Select value={ttl} onValueChange={setTtl}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ttlOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {create.isError && <p className="text-destructive text-sm">{create.error.message}</p>}
            </form>
          )}
          <DialogFooter>
            {create.data ? (
              <>
                <Button
                  key="open"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setOpen(false)
                    if (create.data) onOpen(create.data.user.id)
                  }}
                >
                  Set limits
                </Button>
                <Button key="done" type="button" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </>
            ) : (
              <Button
                key="create"
                type="submit"
                form="new-user"
                disabled={create.isPending || name.trim() === "" || !email.includes("@")}
              >
                <UserPlusIcon />
                Create user
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
