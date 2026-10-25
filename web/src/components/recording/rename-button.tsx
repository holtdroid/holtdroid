import { PencilIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import type { RecordingView } from "@/api/client"
import { useRenameRecording } from "@/api/queries"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function recordingName(r: Pick<RecordingView, "title" | "label" | "package">) {
  return r.title || r.label || r.package
}

/** A pencil that opens a dialog to give a recording a name of its own. */
export function RenameButton({ recording: r }: { recording: RecordingView }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const rename = useRenameRecording()

  const save = (value: string) =>
    rename.mutate(
      { id: r.id, name: value },
      {
        onSuccess: () => setOpen(false),
        onError: (e) => toast.error("Could not rename", { description: e.message }),
      },
    )

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Rename"
            onClick={() => {
              setName(r.title ?? "")
              setOpen(true)
            }}
          >
            <PencilIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Rename</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              save(name)
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename the recording</DialogTitle>
              <DialogDescription>
                The name shows in your list, on the recording's page, to anyone with its link and in the video. Leave it
                empty to use the app&apos;s name, {r.label || r.package}.
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={name}
              maxLength={120}
              placeholder={r.label || r.package}
              onChange={(e) => setName(e.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={rename.isPending}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
