import { Loader2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import type { ReferenceView } from "@/api/client"
import { useImportFigma } from "@/api/queries"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const tokenKey = "holtdroid:figma-token"

export function storedFigmaToken() {
  try {
    return localStorage.getItem(tokenKey) ?? ""
  } catch {
    return ""
  }
}

function storeFigmaToken(token: string) {
  try {
    if (token) localStorage.setItem(tokenKey, token)
    else localStorage.removeItem(tokenKey)
  } catch {
    // storage may be unavailable; the token then lasts for this form
  }
}

/** A link copied with Figma's Copy link to selection. */
export function isFigmaLink(text: string) {
  return /^https:\/\/(www\.)?figma\.com\/(design|file|proto)\/[^\s]+node-id=/.test(text.trim())
}

export function FigmaImport({
  pkg,
  serverToken,
  initialUrl,
  onDone,
}: {
  pkg: string
  serverToken: boolean
  initialUrl?: string
  onDone: (v: ReferenceView | null) => void
}) {
  const run = useImportFigma()
  const [url, setUrl] = useState(initialUrl ?? "")
  const [format, setFormat] = useState<"svg" | "png">("svg")
  const [token, setToken] = useState(storedFigmaToken)
  const needsToken = !serverToken && !token.trim()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    storeFigmaToken(token.trim())
    run.mutate(
      { url: url.trim(), format, pkg, token: token.trim() },
      {
        onSuccess: (v) => onDone(v),
        onError: (err) => toast.error("Could not import from Figma", { description: err.message }),
      },
    )
  }

  return (
    <form className="grid gap-2 rounded-lg border p-2 text-xs" onSubmit={submit}>
      <label className="grid gap-1">
        <span className="text-muted-foreground">Link to a frame (select it in Figma → Copy link to selection)</span>
        <Input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.figma.com/design/…?node-id=…"
          className="h-8 text-sm"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-muted-foreground">
          {serverToken ? "Your Figma token (optional: the server has one)" : "Your Figma personal access token"}
        </span>
        <Input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="figd_…"
          className="h-8 font-mono text-sm"
        />
        <span className="text-muted-foreground">
          Figma → Settings → Security → Personal access tokens, with read access to files. It stays in this browser and
          goes to the server only with an import, which doesn&apos;t keep it.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={format}
          onValueChange={(v) => v && setFormat(v as "svg" | "png")}
        >
          <ToggleGroupItem value="svg" title="Drawn at any size, sharp edges">
            SVG
          </ToggleGroupItem>
          <ToggleGroupItem value="png" title="Rendered at 3×, for frames with photos or heavy effects">
            PNG 3×
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="flex-1" />
        <Button type="button" size="sm" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={run.isPending || !isFigmaLink(url) || needsToken}>
          {run.isPending && <Loader2Icon className="animate-spin" />}
          Import
        </Button>
      </div>
      <p className="text-muted-foreground">
        Brings the frame&apos;s picture and its layers: differences then name the layer and show its size, colours, font
        and spacing from the design.
      </p>
    </form>
  )
}
