import { CircleAlertIcon, CircleCheckIcon, FileUpIcon, PlusIcon } from "lucide-react"
import { type DragEvent, type FormEvent, useRef, useState } from "react"
import { toast } from "sonner"
import { useAddSSHKey } from "@/api/ssh-keys"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { keyLabel, parsePublicKey } from "@/lib/ssh-key"
import { cn } from "@/lib/utils"

const MAX_FILE = 16 * 1024

export function AddKeyForm({ full }: { full: boolean }) {
  const add = useAddSSHKey()
  const [text, setText] = useState("")
  const [name, setName] = useState("")
  const [dragging, setDragging] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const parsed = text.trim() ? parsePublicKey(text) : null
  const key = parsed?.ok ? parsed.key : null
  const fallbackName = key ? key.comment || keyLabel(key.type, key.bits) : "e.g. Work laptop"

  const loadFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > MAX_FILE) {
      toast.error("That file is too big to be a public key")
      return
    }
    setText((await f.text()).trim())
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void loadFile(e.dataTransfer.files[0])
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!key || full) return
    add.mutate(
      { key, name: name.trim() || fallbackName },
      {
        onSuccess: (stored) => {
          setText("")
          setName("")
          toast.success(`Added “${stored.name}”`)
        },
        onError: (err) => toast.error("Could not add the key", { description: err.message }),
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a public key</CardTitle>
        <CardDescription>
          Paste the contents of your <code className="font-mono text-xs">.pub</code> file or drop the file here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="ssh-key">Public key</Label>
            <div
              className={cn("relative rounded-lg", dragging && "ring-primary ring-2 ring-offset-2")}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <Textarea
                id="ssh-key"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit()
                }}
                placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA… you@laptop"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={parsed?.ok === false}
                className="max-h-40 min-h-20 pr-28 font-mono text-xs break-all"
              />
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="absolute top-2 right-2"
                onClick={() => file.current?.click()}
              >
                <FileUpIcon />
                Open .pub
              </Button>
              <input
                ref={file}
                type="file"
                accept=".pub,text/plain"
                className="hidden"
                onChange={(e) => {
                  void loadFile(e.target.files?.[0])
                  e.target.value = ""
                }}
              />
            </div>
            <KeyFeedback parsed={parsed} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ssh-key-name">Name</Label>
            <Input
              id="ssh-key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={fallbackName}
              maxLength={100}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              {full ? "You've reached the limit of 32 keys." : "Only the public half ever leaves your machine."}
            </p>
            <Button type="submit" disabled={!key || full || add.isPending}>
              {add.isPending ? <Spinner /> : <PlusIcon />}
              Add key
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function KeyFeedback({ parsed }: { parsed: ReturnType<typeof parsePublicKey> | null }) {
  if (!parsed) {
    return (
      <p className="text-muted-foreground text-xs">ed25519, ECDSA and RSA (2048 bits or more) keys are supported.</p>
    )
  }
  if (!parsed.ok) {
    return (
      <p className="text-destructive flex items-center gap-1.5 text-xs">
        <CircleAlertIcon className="size-3.5 shrink-0" />
        {parsed.error}
      </p>
    )
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
      <CircleCheckIcon className="size-3.5 shrink-0" />
      {keyLabel(parsed.key.type, parsed.key.bits)} key
      {parsed.key.comment && <span className="text-muted-foreground truncate">· {parsed.key.comment}</span>}
    </p>
  )
}
