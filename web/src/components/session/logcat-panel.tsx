import { useVirtualizer } from "@tanstack/react-virtual"
import { LogId } from "@yume-chan/android-bin"
import { ArrowDownToLineIcon, DownloadIcon, EraserIcon, PauseIcon, PlayIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { IconButton } from "@/components/session/icon-button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { download, stamp } from "@/lib/adb"
import { formatLine, formatTime, type LogcatStore, type LogLine, priorityLetter } from "@/lib/logcat"
import { cn } from "@/lib/utils"

const levels = [
  { value: "2", label: "Verbose" },
  { value: "3", label: "Debug" },
  { value: "4", label: "Info" },
  { value: "5", label: "Warn" },
  { value: "6", label: "Error" },
]

const levelColor: Record<string, string> = {
  V: "text-muted-foreground",
  D: "text-sky-600 dark:text-sky-400",
  I: "text-emerald-600 dark:text-emerald-400",
  W: "text-amber-600 dark:text-amber-400",
  E: "text-red-600 dark:text-red-400",
  F: "text-red-700 dark:text-red-300 font-bold",
}

function matches(l: LogLine, query: string) {
  return l.tag.toLowerCase().includes(query) || l.message.toLowerCase().includes(query)
}

export function LogcatPanel({ store }: { store: LogcatStore }) {
  "use no memo"
  const version = useSyncExternalStore(store.subscribe, store.getVersion)
  const [scope, setScope] = useState<"app" | "all">("app")
  const [minLevel, setMinLevel] = useState("2")
  const [query, setQuery] = useState("")
  const [frozenAt, setFrozenAt] = useState<number | null>(null)
  const [follow, setFollow] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)

  const appUid = store.appUid
  const lines = useMemo(() => {
    void version
    const min = Number(minLevel)
    const q = query.trim().toLowerCase()
    return store.lines.filter(
      (l) =>
        (frozenAt === null || l.id <= frozenAt) &&
        l.priority >= min &&
        (scope === "all" || appUid === undefined || l.uid === appUid) &&
        (q === "" || matches(l, q)),
    )
  }, [store, version, minLevel, query, frozenAt, scope, appUid])

  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 20,
    overscan: 20,
  })

  useEffect(() => {
    if (follow && lines.length > 0) virtualizer.scrollToIndex(lines.length - 1, { align: "end" })
  }, [follow, lines.length, virtualizer])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    if (atBottom !== follow) setFollow(atBottom)
  }

  const save = () => {
    const text = lines.map(formatLine).join("\n") + "\n"
    download(new Blob([text], { type: "text/plain" }), `logcat-${store.pkg}-${stamp()}.txt`)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <Select value={scope} onValueChange={(v) => setScope(v as "app" | "all")}>
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="app">This app</SelectItem>
            <SelectItem value="all">Everything</SelectItem>
          </SelectContent>
        </Select>
        <Select value={minLevel} onValueChange={setMinLevel}>
          <SelectTrigger size="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {levels.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter tag or message"
          className="h-8 min-w-32 flex-1"
        />
        <IconButton
          label={frozenAt === null ? "Pause" : "Resume"}
          onClick={() => setFrozenAt(frozenAt === null ? (store.lines.at(-1)?.id ?? -1) : null)}
        >
          {frozenAt === null ? <PauseIcon /> : <PlayIcon />}
        </IconButton>
        <IconButton label="Scroll to the newest" disabled={follow} onClick={() => setFollow(true)}>
          <ArrowDownToLineIcon />
        </IconButton>
        <IconButton label="Clear" onClick={() => store.clear()}>
          <EraserIcon />
        </IconButton>
        <IconButton label="Download what is shown" disabled={lines.length === 0} onClick={save}>
          <DownloadIcon />
        </IconButton>
      </div>
      {scope === "app" && appUid === undefined && (
        <p className="text-muted-foreground border-b px-3 py-1 text-xs">
          The app's user id is unknown, so every line is shown.
        </p>
      )}
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto font-mono text-xs">
        {lines.length === 0 ? (
          <div className="text-muted-foreground grid h-full place-items-center font-sans text-sm">
            {store.lines.length === 0 ? "Waiting for log lines…" : "No line matches the filters."}
          </div>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const l = lines[item.index]
              if (!l) return null
              const letter = priorityLetter(l.priority)
              return (
                <div
                  key={l.id}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className={cn(
                    "absolute left-0 flex w-full gap-2 px-2 py-px",
                    l.buffer === LogId.Crash && "bg-destructive/10",
                  )}
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <span className="text-muted-foreground shrink-0 tabular-nums">{formatTime(l.time)}</span>
                  <span className="text-muted-foreground w-11 shrink-0 text-right tabular-nums">{l.pid}</span>
                  <span className={cn("w-3 shrink-0 text-center", levelColor[letter])}>{letter}</span>
                  <span className={cn("w-36 shrink-0 truncate", levelColor[letter])} title={l.tag}>
                    {l.tag}
                  </span>
                  <span className="min-w-0 flex-1 break-all whitespace-pre-wrap">{l.message}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
