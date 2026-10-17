import { type LucideIcon, RotateCcwIcon } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export function RailControl({
  label,
  icon: Icon,
  active = false,
  changed = false,
  summary,
  hint,
  onClick,
  onReset,
  disabled,
  children,
}: {
  label: string
  icon: LucideIcon
  active?: boolean
  changed?: boolean
  summary?: ReactNode
  hint?: string
  onClick?: () => void
  onReset?: () => void
  disabled?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const later = (fn: () => void, ms: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(fn, ms)
  }
  const show = () => later(() => setOpen(true), open ? 0 : 150)
  const hide = () => {
    if (pinned) window.clearTimeout(timer.current)
    else later(() => setOpen(false), 200)
  }
  const onOpenChange = (next: boolean) => {
    window.clearTimeout(timer.current)
    setOpen(next)
    if (!next) setPinned(false)
  }
  const pin = () => {
    setOpen(true)
    setPinned(true)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          disabled={disabled}
          className={cn("relative", active && "bg-accent text-accent-foreground")}
          onPointerEnter={show}
          onPointerLeave={hide}
          onClick={onClick ?? pin}
        >
          <Icon />
          {changed && (
            <span className="ring-background absolute top-0.5 right-0.5 size-2 rounded-full bg-amber-500 ring-2" />
          )}
        </Button>
      </PopoverAnchor>
      <PopoverContent
        side="left"
        align="start"
        className="flex max-h-(--radix-popover-content-available-height) w-80 flex-col gap-0 overflow-y-auto p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={show}
        onPointerLeave={hide}
        onPointerDownCapture={() => setPinned(true)}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <div className="grid min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              {label}
              {changed && <span className="size-1.5 rounded-full bg-amber-500" />}
            </span>
            {summary && <span className="text-muted-foreground truncate text-xs">{summary}</span>}
          </div>
          {changed && onReset && (
            <Button size="xs" variant="ghost" onClick={onReset}>
              <RotateCcwIcon />
              Reset
            </Button>
          )}
        </div>
        <div className="grid gap-4 p-3">{children}</div>
        {hint && <p className="text-muted-foreground border-t px-3 py-2 text-xs">{hint}</p>}
      </PopoverContent>
    </Popover>
  )
}

export function ControlGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="grid gap-2.5">
      {title && <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</h4>}
      {children}
    </section>
  )
}
