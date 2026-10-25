import { CopyIcon, SearchIcon } from "lucide-react"
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { levelRank, logLevels } from "@/lib/recording/android"
import type { Player } from "@/lib/recording/player"
import { clock, type LogLine } from "@/lib/recording/timeline"
import { cn } from "@/lib/utils"

const shown = 400
const filters = ["V", "D", "I", "W", "E"] as const

function Badge({ level }: { level: string }) {
  const color = logLevels[level]?.color ?? "#bbbbbb"
  return (
    <span
      className="grid size-[18px] shrink-0 place-items-center rounded-[5px] text-[11px] leading-none font-bold"
      style={{ color, background: `${color}26` }}
      title={logLevels[level]?.name}
    >
      {level}
    </span>
  )
}

export function LogcatView({ player, time }: { player: Player; time: number }) {
  const [minLevel, setMinLevel] = useState<(typeof filters)[number]>("V")
  const [query, setQuery] = useState("")
  const [held, setHeld] = useState<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  useSyncExternalStore(player.logcat.subscribe, () => player.logcat.version)

  const at = held ?? time
  const needle = query.trim().toLowerCase()
  const lines = player.logcat.before(
    at,
    shown,
    (l) =>
      (levelRank[l.level] ?? 0) >= levelRank[minLevel]! &&
      (!needle || l.message.toLowerCase().includes(needle) || l.tag.toLowerCase().includes(needle)),
  )

  const onSelection = useEffectEvent(() => {
    const sel = document.getSelection()
    const inside = !!sel && !sel.isCollapsed && !!scroller.current?.contains(sel.anchorNode)
    setHeld((h) => (inside ? (h ?? time) : null))
  })
  useEffect(() => {
    document.addEventListener("selectionchange", onSelection)
    return () => document.removeEventListener("selectionchange", onSelection)
  }, [])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && held === null) el.scrollTop = el.scrollHeight
  })

  const copy = () => {
    const text = lines.map((l) => `${clock(l.t, true)}  ${l.raw}`).join("\n")
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`Copied ${lines.length} lines`),
      () => toast.error("Could not copy"),
    )
  }

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-[28px] bg-[#1c211e]">
      <header className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-2">
        <h2 className="mr-auto text-sm font-medium tracking-wide text-[#c0c9c1]">Logcat</h2>
        <div className="flex gap-1" role="group" aria-label="Minimum level">
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={minLevel === f}
              onClick={() => setMinLevel(f)}
              className={cn(
                "grid size-7 place-items-center rounded-full text-xs font-bold transition-colors",
                minLevel === f ? "bg-[#354b3b] text-[#d1e8d5]" : "text-[#8a938c] hover:bg-[#262b28]",
              )}
              title={`${logLevels[f]?.name} and above`}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copy}
          className="grid size-7 place-items-center rounded-full text-[#c0c9c1] hover:bg-[#262b28]"
          title="Copy the lines on screen"
          aria-label="Copy the lines on screen"
        >
          <CopyIcon className="size-4" />
        </button>
      </header>
      <label className="mx-4 mb-2 flex items-center gap-2 rounded-full bg-[#262b28] px-3 py-1.5 text-sm">
        <SearchIcon className="size-4 shrink-0 text-[#8a938c]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by tag or message"
          className="min-w-0 flex-1 bg-transparent text-[#e0e3de] outline-none placeholder:text-[#8a938c]"
        />
      </label>
      {held !== null && (
        <p className="mx-5 mb-1 text-xs text-[#78dc9a]">Paused while you select — click elsewhere to follow again</p>
      )}
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-2 pb-3 font-mono text-[12.5px] leading-[1.45]">
        {lines.length === 0 ? (
          <p className="px-3 py-6 text-center font-sans text-sm text-[#8a938c]">
            {needle || minLevel !== "V" ? "No lines match" : "No logcat yet"}
          </p>
        ) : (
          lines.map((l) => <Line key={l.id} line={l} onSeek={(t) => void player.seek(t)} />)
        )}
      </div>
    </section>
  )
}

function Line({ line: l, onSeek }: { line: LogLine; onSeek: (t: number) => void }) {
  const color = logLevels[l.level]?.color ?? "#bbbbbb"
  const loud = l.level === "W" || l.level === "E" || l.level === "F" || l.level === "A"
  return (
    <div className="flex items-start gap-2 rounded-lg px-2 py-px hover:bg-[#262b28]">
      <button
        type="button"
        onClick={() => onSeek(l.t)}
        className="w-14 shrink-0 cursor-pointer text-left text-[#6f7872] tabular-nums hover:text-[#78dc9a]"
        title={`Go to ${clock(l.t, true)}`}
      >
        {clock(l.t)}
      </button>
      <Badge level={l.level} />
      <span
        className="min-w-0 flex-1 break-words whitespace-pre-wrap text-[#e0e3de]"
        style={loud ? { color } : undefined}
      >
        {l.tag && (
          <span className="mr-1.5" style={{ color: loud ? color : "#7fb2e5" }}>
            {l.tag}
          </span>
        )}
        {l.message}
      </span>
    </div>
  )
}
