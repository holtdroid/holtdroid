import { PauseIcon, PlayIcon, Trash2Icon } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { type DevToolsEntry, sessionBase } from "@/api/client"
import { CacheView } from "@/components/recording/cache-view"
import { useEventSource } from "@/hooks/use-event-source"
import { analyzeCache, type CacheRequest } from "@/lib/recording/cache"

const maxRequests = 5000

const wallClock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour12: false, fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions)

/** The Cache tab of a session: the WebViews' finished requests as they come, checked for how they cache. */
export function CachePanel({ provider, id }: { provider: string; id: string }) {
  const [requests, setRequests] = useState<Map<string, CacheRequest>>(() => new Map())
  const [paused, setPaused] = useState(false)
  const [picked, setPicked] = useState<string>()
  const pending = useRef<CacheRequest[]>([])
  const timer = useRef<number | undefined>(undefined)
  const lastSeq = useRef(0)

  const flush = () => {
    timer.current = undefined
    const lines = pending.current
    pending.current = []
    setRequests((prev) => {
      const next = new Map(prev)
      for (const r of lines) next.set(r.key, r)
      for (const k of next.keys()) {
        if (next.size <= maxRequests) break
        next.delete(k)
      }
      return next
    })
  }

  useEventSource<{ line: DevToolsEntry }>(paused ? null : `${sessionBase(provider, id)}/v1/devtools/live`, {
    line: (e) => {
      if (e.seq) {
        if (e.seq <= lastSeq.current) return
        lastSeq.current = e.seq
      }
      if (!e.request) return
      pending.current.push({ ...e.request, key: `${e.target ?? ""}/${e.request.id}` })
      timer.current ??= window.setTimeout(flush, 300)
    },
  })

  const report = useMemo(() => analyzeCache([...requests.values()]), [requests])

  return (
    <div className="devtools-skin flex h-full flex-col bg-background text-[12px]">
      <div className="mb-2 flex h-8 shrink-0 items-center gap-1 border-b px-2">
        <button
          type="button"
          aria-label={paused ? "Resume" : "Pause"}
          title={paused ? "Resume" : "Pause"}
          onClick={() => setPaused((v) => !v)}
          className="grid size-6 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>
        <button
          type="button"
          aria-label="Clear"
          title="Clear"
          onClick={() => {
            setRequests(new Map())
            setPicked(undefined)
          }}
          className="grid size-6 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
        >
          <Trash2Icon />
        </button>
        <span className="ml-auto text-muted-foreground">{requests.size} requests</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <CacheView
          report={report}
          picked={picked}
          onPick={setPicked}
          wallClock={wallClock}
          empty={
            paused
              ? "Paused."
              : "No finished requests in the app's WebViews yet. Everything they load during the session shows up here, also after a reload."
          }
        />
      </div>
    </div>
  )
}
