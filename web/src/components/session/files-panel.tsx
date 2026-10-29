import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type Adb, LinuxFileType } from "@yume-chan/adb"
import {
  ArrowUpIcon,
  DownloadIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { type DragEvent, useRef, useState } from "react"
import { toast } from "sonner"
import { IconButton } from "@/components/session/icon-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { download, readFile, run, shq, writeFile } from "@/lib/adb"
import { formatBytes } from "@/lib/format"
import { cn } from "@/lib/utils"

type Entry = { name: string; dir: boolean; link: boolean; size: number; mtime: number }

function join(dir: string, name: string) {
  return dir === "/" ? `/${name}` : `${dir}/${name}`
}

function parent(dir: string) {
  const i = dir.lastIndexOf("/")
  return i <= 0 ? "/" : dir.slice(0, i)
}

async function list(adb: Adb, dir: string): Promise<Entry[]> {
  const sync = await adb.sync()
  try {
    const entries = await sync.readdir(dir)
    return entries
      .filter((e) => e.name !== "." && e.name !== "..")
      .map((e) => ({
        name: e.name,
        dir: e.type === LinuxFileType.Directory,
        link: e.type === LinuxFileType.Link,
        size: Number(e.size),
        mtime: Number(e.mtime) * 1000,
      }))
      .toSorted((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
  } finally {
    await sync.dispose()
  }
}

export function FilesPanel({ adb, pkg, shell }: { adb: Adb; pkg: string; shell: boolean }) {
  const roots = [
    { path: "/sdcard/Download", label: "Downloads" },
    { path: "/sdcard", label: "Shared storage" },
    { path: `/data/data/${pkg}`, label: "App data" },
    { path: "/data/local/tmp", label: "/data/local/tmp" },
    { path: "/", label: "Root" },
  ]
  const [dir, setDir] = useState("/sdcard/Download")
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [newFolder, setNewFolder] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const queryKey = ["adb-files", adb.serial, dir]
  const entries = useQuery({ queryKey, queryFn: () => list(adb, dir) })
  const refresh = () => void qc.invalidateQueries({ queryKey: ["adb-files", adb.serial] })

  const upload = useMutation({
    mutationFn: (files: File[]) =>
      files.reduce(
        (prev, f) =>
          prev.then(() =>
            writeFile(adb, join(dir, f.name), f, (sent) =>
              setProgress(`${f.name}: ${formatBytes(sent)} of ${formatBytes(f.size)}`),
            ),
          ),
        Promise.resolve(),
      ),
    onSuccess: (_, files) =>
      toast.success(files.length === 1 ? `Uploaded ${files[0]?.name}` : `Uploaded ${files.length} files`),
    onError: (e) => toast.error("Upload failed", { description: e.message }),
    onSettled: () => {
      setProgress(null)
      refresh()
    },
  })

  const remove = useMutation({
    mutationFn: (e: Entry) => run(adb, `rm -rf ${shq(join(dir, e.name))}`),
    onError: (e) => toast.error("Could not delete", { description: e.message }),
    onSettled: refresh,
  })

  const mkdir = useMutation({
    mutationFn: (name: string) => run(adb, `mkdir -p ${shq(join(dir, name))}`),
    onError: (e) => toast.error("Could not create the folder", { description: e.message }),
    onSettled: () => {
      setNewFolder(null)
      refresh()
    },
  })

  const pull = async (e: Entry) => {
    try {
      setProgress(`Downloading ${e.name}…`)
      download(await readFile(adb, join(dir, e.name)), e.name)
    } catch (err) {
      toast.error("Download failed", { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setProgress(null)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = [...e.dataTransfer.files]
    if (files.length > 0) upload.mutate(files)
  }

  return (
    <div
      className={cn("flex h-full flex-col", dragging && "ring-primary ring-2 ring-inset")}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <Select value={roots.find((r) => r.path === dir)?.path ?? ""} onValueChange={setDir}>
          <SelectTrigger size="sm" className="w-40">
            <SelectValue placeholder="Go to…" />
          </SelectTrigger>
          <SelectContent>
            {roots.map((r) => (
              <SelectItem key={r.path} value={r.path}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <IconButton label="Up" disabled={dir === "/"} onClick={() => setDir(parent(dir))}>
          <ArrowUpIcon />
        </IconButton>
        <Input
          key={dir}
          defaultValue={dir}
          className="h-8 min-w-32 flex-1 font-mono text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") setDir(e.currentTarget.value.replace(/\/+$/, "") || "/")
          }}
        />
        <IconButton label="Refresh" onClick={refresh}>
          <RefreshCwIcon className={entries.isFetching ? "animate-spin" : ""} />
        </IconButton>
        {shell && (
          <IconButton label="New folder" onClick={() => setNewFolder("")}>
            <FolderPlusIcon />
          </IconButton>
        )}
        <IconButton label="Upload files" disabled={upload.isPending} onClick={() => input.current?.click()}>
          <UploadIcon />
        </IconButton>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ""
            if (files.length > 0) upload.mutate(files)
          }}
        />
      </div>
      {progress && <p className="text-muted-foreground border-b px-3 py-1 text-xs">{progress}</p>}
      {shell && newFolder !== null && (
        <form
          className="flex gap-2 border-b p-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (newFolder.trim()) mkdir.mutate(newFolder.trim())
          }}
        >
          <Input
            autoFocus
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            placeholder="Folder name"
            className="h-8"
          />
          <Button size="sm" type="submit" disabled={mkdir.isPending}>
            Create
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setNewFolder(null)}>
            Cancel
          </Button>
        </form>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {entries.isError ? (
          <p className="text-muted-foreground p-6 text-center text-sm">
            Could not list {dir}: {entries.error.message}
          </p>
        ) : entries.data?.length === 0 ? (
          <p className="text-muted-foreground p-6 text-center text-sm">Empty folder. Drop files here to upload them.</p>
        ) : (
          <ul className="divide-y text-sm">
            {entries.data?.map((e) => (
              <li key={e.name} className="group hover:bg-muted/50 flex items-center gap-2 px-3 py-1.5">
                {e.dir || e.link ? (
                  <FolderIcon className="text-muted-foreground size-4 shrink-0" />
                ) : (
                  <FileIcon className="text-muted-foreground size-4 shrink-0" />
                )}
                {e.dir || e.link ? (
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left hover:underline"
                    onClick={() => setDir(join(dir, e.name))}
                  >
                    {e.name}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                )}
                <span className="text-muted-foreground w-20 shrink-0 text-right text-xs tabular-nums">
                  {e.dir ? "" : formatBytes(e.size)}
                </span>
                <span className="text-muted-foreground w-36 shrink-0 text-right text-xs tabular-nums">
                  {new Date(e.mtime).toLocaleString()}
                </span>
                <div className="flex shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  {!e.dir && !e.link && (
                    <IconButton label="Download" onClick={() => void pull(e)}>
                      <DownloadIcon />
                    </IconButton>
                  )}
                  {shell && (
                    <IconButton
                      label="Delete"
                      onClick={() => {
                        if (window.confirm(`Delete ${join(dir, e.name)}${e.dir ? " and everything in it" : ""}?`))
                          remove.mutate(e)
                      }}
                    >
                      <Trash2Icon />
                    </IconButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
