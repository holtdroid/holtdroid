import { FileUpIcon, Loader2Icon, UploadIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import type { Visibility } from "@/api/client"
import { useUpload, useUploads } from "@/api/queries"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Textarea } from "@/components/ui/textarea"
import { formatBytes, formatSpan } from "@/lib/format"
import { cn } from "@/lib/utils"

export function UploadDialog({
  open,
  initialFile,
  onClose,
}: {
  open: boolean
  initialFile: File | null
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {open && <UploadForm key={initialFile?.name ?? ""} initialFile={initialFile} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function UploadForm({ initialFile, onClose }: { initialFile: File | null; onClose: () => void }) {
  const uploads = useUploads()
  const upload = useUpload()
  const [file, setFile] = useState(initialFile)
  const [visibility, setVisibility] = useState<Visibility>("public")
  const [temporary, setTemporary] = useState(true)
  const [note, setNote] = useState("")
  const [changelog, setChangelog] = useState("")
  const [dragging, setDragging] = useState(false)

  const maxSize = uploads.data?.maxSize ?? 0
  const tooLarge = !!file && maxSize > 0 && file.size > maxSize

  const submit = () => {
    if (!file || tooLarge) return
    upload.mutate(
      { file, visibility, temporary, note: note.trim(), changelog: changelog.trim() },
      {
        onSuccess: (a) => {
          toast.success("Uploaded", { description: a.app?.label || a.fileName })
          onClose()
        },
        onError: (err) => toast.error("Upload failed", { description: err.message }),
      },
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Upload an APK</DialogTitle>
        <DialogDescription>
          It goes to the “{uploads.data?.source}” source. You can delete it or change who sees it later.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <label
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const dropped = e.dataTransfer.files[0]
            if (dropped) setFile(dropped)
          }}
          className={cn(
            "hover:bg-accent/40 grid cursor-pointer place-items-center gap-1 rounded-xl border border-dashed p-6 text-center transition-colors",
            dragging && "bg-accent/60 border-primary",
          )}
        >
          <FileUpIcon className="text-muted-foreground size-6" />
          {file ? (
            <span className="text-sm font-medium break-all">
              {file.name} · {formatBytes(file.size)}
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">Drop an .apk here or click to choose one</span>
          )}
          <input
            type="file"
            accept=".apk,application/vnd.android.package-archive"
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {tooLarge && (
          <Alert variant="destructive">
            <AlertDescription>The file is larger than the {formatBytes(maxSize)} upload limit.</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-2">
          <Label htmlFor="upload-visibility">Who can see it</Label>
          <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
            <SelectTrigger id="upload-visibility" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="public">Everyone</SelectItem>
              <SelectItem value="private">Only me (and admins)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            id="upload-temporary"
            checked={temporary}
            onCheckedChange={(v) => setTemporary(v === true)}
            className="mt-0.5"
          />
          <div className="grid gap-1">
            <Label htmlFor="upload-temporary">Temporary</Label>
            <p className="text-muted-foreground text-sm">
              Deleted automatically {uploads.data ? formatSpan(uploads.data.temporaryTtl) : "a while"} after its last
              launch. You can make it permanent later.
            </p>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="upload-note">Note</Label>
          <Input
            id="upload-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={4000}
            placeholder="What is this build for?"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="upload-changelog">Changelog</Label>
          <Textarea
            id="upload-changelog"
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
            className="max-h-48"
            placeholder="- Fixed login on Android 15"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!file || tooLarge || upload.isPending}>
          {upload.isPending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
          {upload.isPending ? "Uploading…" : "Upload"}
        </Button>
      </DialogFooter>
    </>
  )
}
