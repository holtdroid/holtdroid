import { useNavigate } from "@tanstack/react-router"
import { FingerprintIcon } from "lucide-react"
import { type FormEvent, useState } from "react"
import { useAuth } from "@/api/queries"
import { type InviteInfo, passkeyError, roleLabel, useInvite, useRegister } from "@/api/users"
import { AuthCard } from "@/components/auth-gate"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"

export function InvitePage({ token }: { token: string }) {
  const invite = useInvite(token)

  return (
    <AuthCard>
      {invite.isPending ? (
        <Spinner className="mx-auto size-6" />
      ) : invite.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{invite.error.message}</AlertDescription>
        </Alert>
      ) : (
        <RegisterForm token={token} info={invite.data} />
      )}
    </AuthCard>
  )
}

function RegisterForm({ token, info }: { token: string; info: InviteInfo }) {
  const auth = useAuth()
  const register = useRegister(token)
  const navigate = useNavigate()
  const recovery = info.kind === "recovery"
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [keyName, setKeyName] = useState("")
  const domain = email.includes("@") ? email.slice(email.lastIndexOf("@") + 1).toLowerCase() : ""
  const wrongDomain = domain !== "" && info.domains.length > 0 && !info.domains.includes(domain)
  const ready = recovery || (name.trim() !== "" && email.includes("@") && !wrongDomain)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    register.mutate(
      { name: recovery ? undefined : name, email: recovery ? undefined : email, keyName },
      { onSuccess: () => void navigate({ to: "/" }) },
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-1">
        <h2 className="font-medium">{recovery ? "Register a new passkey" : "Create your account"}</h2>
        <p className="text-muted-foreground text-sm">
          {recovery
            ? `For ${info.name} (${info.email}). Your other passkeys keep working.`
            : info.kind === "bootstrap"
              ? "You are setting up the first admin of this server."
              : info.role === ""
                ? "An admin approves new accounts before they can launch devices."
                : `You'll join as ${roleLabel[info.role].toLowerCase()}.`}{" "}
          You sign in with a passkey: Touch ID, Face ID, Windows Hello, a security key or your password manager.
        </p>
      </div>
      {auth.data?.identity && !recovery && (
        <Alert>
          <AlertDescription>
            You are signed in as {auth.data.identity.name || auth.data.identity.user}; this creates another account.
          </AlertDescription>
        </Alert>
      )}
      {!recovery && (
        <>
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={wrongDomain}
            />
            {info.domains.length > 0 && (
              <p className={wrongDomain ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
                Only addresses at {info.domains.join(", ")}.
              </p>
            )}
          </div>
        </>
      )}
      <div className="grid gap-2">
        <Label htmlFor="key-name">Passkey name</Label>
        <Input
          id="key-name"
          placeholder="e.g. MacBook, iPhone, YubiKey"
          value={keyName}
          onChange={(e) => setKeyName(e.target.value)}
        />
      </div>
      {register.isError && <p className="text-destructive text-sm">{passkeyError(register.error)}</p>}
      <Button type="submit" size="lg" disabled={!ready || register.isPending}>
        {register.isPending ? <Spinner /> : <FingerprintIcon />}
        {recovery ? "Register passkey" : "Create account with a passkey"}
      </Button>
    </form>
  )
}
