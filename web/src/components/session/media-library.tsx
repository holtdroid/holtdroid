import { FileMusicIcon, ImageIcon, Loader2Icon, Trash2Icon, UploadIcon, VideoIcon } from "lucide-react"
import { useRef } from "react"
import { toast } from "sonner"
import type { MediaView } from "@/api/client"
import { useDeleteMedia, useMedia, useUploadMedia } from "@/api/queries"
import { Note, ShadeButton } from "@/components/session/shade"
import { formatBytes } from "@/lib/format"
import { cn } from "@/lib/utils"

export function MediaLibrary({
  kinds,
  accept,
  add: addLabel,
  note,
  playing,
  pending,
  onPlay,
}: {
  kinds: MediaView["kind"][]
  accept: string
  add: string
  note: string
  playing?: string
  pending?: string
  onPlay: (id: string) => void
}) {
  const media = useMedia()
  const upload = useUploadMedia()
  const remove = useDeleteMedia()
  const input = useRef<HTMLInputElement>(null)
  const l = media.data
  if (!l?.enabled) return null
  const items = l.items.filter((item) => kinds.includes(item.kind))

  const add = (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      upload.mutate(file, {
        onError: (e) => toast.error(`Could not add ${file.name}`, { description: e.message }),
      })
    }
  }

  return (
    <section className="grid gap-1.5">
      <div className="flex items-baseline justify-between px-1 text-xs text-neutral-400">
        <h4 className="font-medium">Media library</h4>
        <span className="tabular-nums">
          {formatBytes(l.used)}
          {l.quota > 0 && ` of ${formatBytes(l.quota)}`}
        </span>
      </div>
      {items.length > 0 && (
        <div className="grid gap-1 overflow-hidden rounded-3xl">
          {items.map((item) => (
            <MediaRow
              key={item.id}
              item={item}
              selected={item.id === playing}
              busy={item.id === pending}
              deleting={remove.isPending && remove.variables === item.id}
              onPlay={() => onPlay(item.id)}
              onDelete={() => remove.mutate(item.id)}
            />
          ))}
        </div>
      )}
      <ShadeButton disabled={upload.isPending} onClick={() => input.current?.click()}>
        {upload.isPending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
        {addLabel}
      </ShadeButton>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple
        hidden
        onChange={(e) => {
          add(e.target.files)
          e.target.value = ""
        }}
      />
      <Note>
        {note} Up to {formatBytes(l.maxFileSize)} a file.
      </Note>
    </section>
  )
}

function MediaRow({
  item,
  selected,
  busy,
  deleting,
  onPlay,
  onDelete,
}: {
  item: MediaView
  selected: boolean
  busy: boolean
  deleting: boolean
  onPlay: () => void
  onDelete: () => void
}) {
  const Icon = item.kind === "video" ? VideoIcon : item.kind === "image" ? ImageIcon : FileMusicIcon
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-md pr-2 transition-colors first:rounded-t-3xl last:rounded-b-3xl",
        selected ? "bg-sky-200 text-sky-950" : "bg-neutral-800 text-neutral-100 hover:bg-neutral-700",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left"
        onClick={onPlay}
      >
        {busy ? <Loader2Icon className="size-4 shrink-0 animate-spin" /> : <Icon className="size-4 shrink-0" />}
        <span className="grid min-w-0">
          <span className="truncate text-sm font-medium">{item.name}</span>
          <span className={cn("text-xs", selected ? "text-sky-900" : "text-neutral-400")}>
            {formatBytes(item.size)}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={`Delete ${item.name}`}
        disabled={deleting}
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-50",
          selected ? "hover:bg-sky-300" : "text-neutral-400 hover:bg-neutral-600 hover:text-neutral-100",
        )}
        onClick={onDelete}
      >
        {deleting ? <Loader2Icon className="size-4 animate-spin" /> : <Trash2Icon className="size-4" />}
      </button>
    </div>
  )
}
