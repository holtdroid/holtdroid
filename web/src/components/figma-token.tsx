import { CheckCircle2Icon, ExternalLinkIcon, KeyRoundIcon, Loader2Icon, ServerIcon } from "lucide-react"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import { useDeleteFigmaToken, useFigmaToken, useSaveFigmaToken } from "@/api/queries"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { browserFigmaInfo, storeBrowserFigmaToken } from "@/lib/figma-token"
import { formatRelative } from "@/lib/format"

const helpURL = "https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens"

/** How to make a Figma personal access token for Holtdroid, step by step. */
export function FigmaTokenGuide({ open }: { open?: boolean }) {
  return (
    <details className="group rounded-lg border p-3 text-sm" open={open}>
      <summary className="cursor-pointer font-medium select-none">How to get a Figma token</summary>
      <ol className="mt-3 grid list-decimal gap-2 pl-5">
        <li>Open Figma (the app or figma.com) and sign in with the account that can open your design files.</li>
        <li>
          Click your name or avatar in the top left corner and choose <strong>Settings</strong>, then the{" "}
          <strong>Security</strong> tab.
        </li>
        <li>
          Under <strong>Personal access tokens</strong>, click <strong>Generate new token</strong>.
        </li>
        <li>
          Name it <code>holtdroid</code> and pick the longest <strong>expiration</strong> Figma offers; tokens
          can&apos;t be made forever.
        </li>
        <li>
          Set the scopes:
          <ul className="text-muted-foreground mt-1 grid list-disc gap-0.5 pl-5">
            <li>
              <strong className="text-foreground">File content</strong>: Read-only, to read frames and render them;
            </li>
            <li>
              <strong className="text-foreground">Current user</strong>: Read, so Holtdroid can check the token and show
              whose it is;
            </li>
            <li>everything else: No access.</li>
          </ul>
        </li>
        <li>
          Click <strong>Generate token</strong> and copy it right away: it starts with <code>figd_</code> and Figma
          shows it only once.
        </li>
        <li>Paste it below and save. Holtdroid checks it with Figma before keeping it.</li>
      </ol>
      <div className="text-muted-foreground mt-3 grid gap-1 text-xs">
        <p>
          The token reads only the files your Figma account can open, and it can&apos;t change anything. When it
          expires, imports say Figma refused it: generate a new one and replace it here. You can revoke it in the same
          place in Figma at any time.
        </p>
        <a href={helpURL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
          Figma help: Manage personal access tokens <ExternalLinkIcon className="size-3" />
        </a>
      </div>
    </details>
  )
}

/** The caller's Figma token: status, replace, remove, with the guide. */
export function FigmaTokenSection({ guideOpen }: { guideOpen?: boolean }) {
  const view = useFigmaToken()
  const save = useSaveFigmaToken()
  const remove = useDeleteFigmaToken()
  const [token, setToken] = useState("")
  const [editing, setEditing] = useState(false)
  const [local, setLocal] = useState(browserFigmaInfo)
  const v = view.data

  if (!v) return <Skeleton className="h-24 rounded-xl" />

  const account = v.storage === "account"
  const status = account
    ? v.saved
      ? { handle: v.handle ?? "", hint: v.hint ?? "", at: v.updatedAt ?? "" }
      : null
    : local
      ? { handle: local.handle, hint: local.hint, at: local.savedAt }
      : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = token.trim()
    save.mutate(t, {
      onSuccess: (r) => {
        if (!account) {
          storeBrowserFigmaToken(t, { handle: r.handle ?? "", hint: r.hint ?? "" })
          setLocal(browserFigmaInfo())
        }
        setToken("")
        setEditing(false)
        toast.success(`Figma token saved${r.handle ? ` for ${r.handle}` : ""}`)
      },
      onError: (err) => toast.error("Figma didn't accept the token", { description: err.message }),
    })
  }

  const forget = () => {
    if (!window.confirm("Remove your Figma token? Imports will need a token again.")) return
    if (account) {
      remove.mutate(undefined, { onError: (err) => toast.error("Could not remove", { description: err.message }) })
    } else {
      storeBrowserFigmaToken("")
      setLocal(null)
    }
  }

  return (
    <div className="grid gap-3">
      {v.server && (
        <p className="text-muted-foreground flex items-start gap-2 text-sm">
          <ServerIcon className="mt-0.5 size-4 shrink-0" />
          This server has a Figma token for everyone, so imports work without yours. Add your own to import files only
          your account can open.
        </p>
      )}
      {status && !editing ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
          <CheckCircle2Icon className="size-5 shrink-0 text-emerald-600" />
          <div className="grid min-w-0 flex-1 text-sm">
            <span className="truncate font-medium">{status.handle || "Figma token"}</span>
            <span className="text-muted-foreground text-xs">
              figd_…{status.hint} · saved {status.at ? formatRelative(status.at) : ""}{" "}
              {account ? "with your account" : "in this browser"}
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Replace
          </Button>
          <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={forget}>
            Remove
          </Button>
        </div>
      ) : (
        <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
          <label className="grid min-w-60 flex-1 gap-1 text-sm">
            <span className="flex items-center gap-1.5 font-medium">
              <KeyRoundIcon className="size-4" /> Personal access token
            </span>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="figd_…"
              className="font-mono"
            />
          </label>
          <Button type="submit" disabled={token.trim().length < 8 || save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            Check and save
          </Button>
          {editing && (
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </form>
      )}
      <p className="text-muted-foreground text-xs">
        {account ? (
          <>
            <Badge variant="outline" className="mr-1">
              With your account
            </Badge>
            The server keeps the token encrypted and never shows it again, so it works in every browser you sign in
            with. Only you can use it, and only to import and update your references.
          </>
        ) : (
          <>
            <Badge variant="outline" className="mr-1">
              In this browser
            </Badge>
            This server can&apos;t keep it with your account (its database is in memory or it has no session key), so
            the token stays in this browser and goes to the server only with an import, which doesn&apos;t keep it.
          </>
        )}
      </p>
      <FigmaTokenGuide open={guideOpen} />
    </div>
  )
}
