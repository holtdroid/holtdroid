import { Loader2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import type { ReferenceView } from "@/api/client"
import { useImportFigma } from "@/api/queries"
import { FigmaTokenSection } from "@/components/figma-token"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { browserFigmaToken, isFigmaLink } from "@/lib/figma-token"

export function FigmaImport({
  pkg,
  hasToken,
  initialUrl,
  onDone,
}: {
  pkg: string
  hasToken: boolean
  initialUrl?: string
  onDone: (v: ReferenceView | null) => void
}) {
  const run = useImportFigma()
  const [url, setUrl] = useState(initialUrl ?? "")
  const [format, setFormat] = useState<"svg" | "png">("svg")

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    run.mutate(
      { url: url.trim(), format, pkg, token: browserFigmaToken() },
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
      {!hasToken && (
        <div className="grid gap-2 rounded-md border border-dashed p-2">
          <span className="font-medium">Importing needs your Figma token first</span>
          <FigmaTokenSection />
        </div>
      )}
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
        <Button type="submit" size="sm" disabled={run.isPending || !isFigmaLink(url) || !hasToken}>
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
