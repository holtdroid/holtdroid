import { PauseIcon, PlayIcon, Trash2Icon } from "lucide-react"
import type { ReactNode } from "react"

const button =
  "grid size-6 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5"

/** Pause and clear for a live session panel, with a count on the right. */
export function LiveToolbar({
  paused,
  onPause,
  onClear,
  children,
}: {
  paused: boolean
  onPause: () => void
  onClear: () => void
  children?: ReactNode
}) {
  return (
    <div className="mb-2 flex h-8 shrink-0 items-center gap-1 border-b px-2">
      <button
        type="button"
        aria-label={paused ? "Resume" : "Pause"}
        title={paused ? "Resume" : "Pause"}
        onClick={onPause}
        className={button}
      >
        {paused ? <PlayIcon /> : <PauseIcon />}
      </button>
      <button type="button" aria-label="Clear" title="Clear" onClick={onClear} className={button}>
        <Trash2Icon />
      </button>
      <span className="ml-auto text-muted-foreground">{children}</span>
    </div>
  )
}
