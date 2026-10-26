import { Loader2Icon, PencilIcon, PlusIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useApps, useUpdateApp } from "@/api/queries"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

const MAX_LENGTH = 4000

export function paragraphs(text: string) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

export function AppDescription({ pkg, title }: { pkg: string; title: string }) {
  const apps = useApps()
  const [editing, setEditing] = useState(false)
  const info = apps.data?.get(pkg)

  return (
    <>
      {info ? (
        <div className="bg-card group relative flex flex-col gap-2 rounded-xl border p-3 pr-11 text-sm">
          {paragraphs(info.description).map((p, i) => (
            <p key={i} className="whitespace-pre-line">
              {p}
            </p>
          ))}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-1.5 right-1.5"
            aria-label="Edit description"
            onClick={() => setEditing(true)}
          >
            <PencilIcon />
          </Button>
        </div>
      ) : (
        apps.isSuccess && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground self-start"
            onClick={() => setEditing(true)}
          >
            <PlusIcon />
            Add a description
          </Button>
        )
      )}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          {editing && (
            <DescriptionForm
              pkg={pkg}
              title={title}
              initial={info?.description ?? ""}
              onDone={() => setEditing(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function DescriptionForm({
  pkg,
  title,
  initial,
  onDone,
}: {
  pkg: string
  title: string
  initial: string
  onDone: () => void
}) {
  const [text, setText] = useState(initial)
  const update = useUpdateApp()
  const save = () =>
    update.mutate(
      { pkg, description: text },
      {
        onSuccess: onDone,
        onError: (err) => toast.error("Couldn't save the description", { description: err.message }),
      },
    )

  return (
    <>
      <DialogHeader>
        <DialogTitle>About {title}</DialogTitle>
        <DialogDescription>
          Shown above the app's builds to everyone. Plain text; a blank line starts a new paragraph.
        </DialogDescription>
      </DialogHeader>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={MAX_LENGTH}
        rows={8}
        placeholder="What the app is for and how to test it"
        autoFocus
      />
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={save} disabled={update.isPending || text.trim() === initial.trim()}>
          {update.isPending && <Loader2Icon className="animate-spin" />}
          {text.trim() ? "Save" : "Remove"}
        </Button>
      </DialogFooter>
    </>
  )
}
