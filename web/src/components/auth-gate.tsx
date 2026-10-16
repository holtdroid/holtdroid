import { KeyRoundIcon, LogInIcon } from "lucide-react"
import { type FormEvent, type ReactNode, useState } from "react"
import { useAuth, useLogin } from "@/api/queries"
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
  if (auth.data?.identity) return children

  return (
    <div className="bg-muted/40 grid h-dvh place-items-center p-4">
      <div className="bg-card grid w-full max-w-sm gap-6 rounded-2xl border p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <img src={logo} alt="" className="size-10" />
          <div>
            <h1 className="font-semibold tracking-tight">Holtdroid</h1>
            <p className="text-muted-foreground text-sm">Android sandboxes for your test builds</p>
          </div>
        </div>
        {auth.isError ? (
          <Alert variant="destructive">
            <AlertDescription>Could not reach the server: {auth.error.message}</AlertDescription>
          </Alert>
        ) : auth.data?.mode === "password" ? (
          <PasswordForm />
        ) : auth.data?.mode === "oidc" && auth.data.loginUrl ? (
          <Button asChild size="lg">
            <a
              href={`${auth.data.loginUrl}?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`}
            >
              <LogInIcon />
              Sign in
            </a>
          </Button>
        ) : (
          <Alert>
            <AlertDescription>
              You are not signed in. This server expects an authenticating proxy in front of it.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
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
