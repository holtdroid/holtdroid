import { FingerprintIcon, HourglassIcon, KeyRoundIcon, LogInIcon, LogOutIcon } from "lucide-react"
import { type FormEvent, type ReactNode, useState } from "react"
import { useAuth, useLogin, useLogout } from "@/api/queries"
import { passkeyError, usePasskeySignIn } from "@/api/users"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import logo from "@/logo.svg"

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth()

  if (auth.isPending) {
    return (
      <div className="grid h-dvh place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }
  if (auth.data?.identity?.pending) return <Pending name={auth.data.identity.name || auth.data.identity.user} />
  if (auth.data?.identity) return children

  return (
    <AuthCard>
      {auth.isError ? (
        <Alert variant="destructive">
          <AlertDescription>Could not reach the server: {auth.error.message}</AlertDescription>
        </Alert>
      ) : auth.data?.mode === "password" ? (
        <PasswordForm />
      ) : auth.data?.mode === "users" ? (
        <PasskeySignIn loginUrl={auth.data.loginUrl} />
      ) : auth.data?.mode === "oidc" && auth.data.loginUrl ? (
        <SSOButton loginUrl={auth.data.loginUrl} label="Sign in" />
      ) : (
        <Alert>
          <AlertDescription>
            You are not signed in. This server expects an authenticating proxy in front of it.
          </AlertDescription>
        </Alert>
      )}
    </AuthCard>
  )
}

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="bg-muted/40 grid min-h-dvh place-items-center p-4">
      <div className="bg-card grid w-full max-w-sm gap-6 rounded-2xl border p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <img src={logo} alt="" className="size-10" />
          <div>
            <h1 className="font-semibold tracking-tight">Holtdroid</h1>
            <p className="text-muted-foreground text-sm">Android sandboxes for your test builds</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

function SSOButton({ loginUrl, label, variant }: { loginUrl: string; label: string; variant?: "outline" }) {
  return (
    <Button asChild size="lg" variant={variant}>
      <a href={`${loginUrl}?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`}>
        <LogInIcon />
        {label}
      </a>
    </Button>
  )
}

function PasskeySignIn({ loginUrl }: { loginUrl?: string }) {
  const signIn = usePasskeySignIn()
  return (
    <div className="grid gap-3">
      <Button size="lg" onClick={() => signIn.mutate()} disabled={signIn.isPending}>
        {signIn.isPending ? <Spinner /> : <FingerprintIcon />}
        Sign in with a passkey
      </Button>
      {signIn.isError && <p className="text-destructive text-sm">{passkeyError(signIn.error)}</p>}
      {loginUrl && <SSOButton loginUrl={loginUrl} label="Sign in with SSO" variant="outline" />}
      <p className="text-muted-foreground text-xs">
        No account yet? Ask an admin for an invite link. Lost your passkey? An admin can send you a recovery link.
      </p>
    </div>
  )
}

function Pending({ name }: { name: string }) {
  const logout = useLogout()
  return (
    <AuthCard>
      <div className="grid gap-2">
        <div className="flex items-center gap-2 font-medium">
          <HourglassIcon className="size-4" />
          Waiting for approval
        </div>
        <p className="text-muted-foreground text-sm">
          Thanks, {name}. Your account is created; an admin has to give it a role before you can launch devices. Reload
          this page once they have.
        </p>
      </div>
      <Button variant="outline" onClick={() => logout.mutate()} disabled={logout.isPending}>
        <LogOutIcon />
        Sign out
      </Button>
    </AuthCard>
  )
}

function PasswordForm() {
  const login = useLogin()
  const [password, setPassword] = useState("")

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (password) login.mutate(password)
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={login.isError}
        />
        {login.isError && <p className="text-destructive text-sm">{login.error.message}</p>}
      </div>
      <Button type="submit" disabled={!password || login.isPending}>
        {login.isPending ? <Spinner /> : <KeyRoundIcon />}
        Continue
      </Button>
      <p className="text-muted-foreground text-xs">
        You'll get a random animal name so others can tell sessions apart.
      </p>
    </form>
  )
}
