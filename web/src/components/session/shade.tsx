import { CheckIcon, GlobeIcon, Loader2Icon, RotateCcwIcon, type LucideIcon } from "lucide-react"
import { type ComponentProps, createContext, type ReactNode, use, useMemo, useState } from "react"
import { HoverCard, HoverCardContent } from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"

export const widgetWidth = 128

export function ShadeCard({
  changed,
  className,
  children,
  ...props
}: ComponentProps<"button"> & { changed?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "relative grid cursor-default gap-1.5 rounded-2xl bg-neutral-900 p-3 text-left text-neutral-100 shadow-lg ring-1 ring-black/50 transition-colors outline-none hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-sky-300 dark:ring-white/15",
        className,
      )}
      style={{ width: widgetWidth }}
      {...props}
    >
      {changed && <span className="absolute top-2.5 right-2.5 size-2 rounded-full bg-amber-500" />}
      {children}
    </button>
  )
}

export function CardLine({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-300">
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  )
}

const Pin = createContext<{ pin: () => void; close: () => void }>({ pin: () => undefined, close: () => undefined })

export function ShadeRoot({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const pins = useMemo(
    () => ({
      pin: () => setPinned(true),
      close: () => {
        setPinned(false)
        setOpen(false)
      },
    }),
    [],
  )
  return (
    <Pin value={pins}>
      <HoverCard
        open={open}
        openDelay={150}
        closeDelay={200}
        onOpenChange={(next) => {
          if (next) setOpen(true)
          else if (!pinned) setOpen(false)
        }}
      >
        {children}
      </HoverCard>
    </Pin>
  )
}

export function ShadePanel({ className, ...props }: ComponentProps<typeof HoverCardContent>) {
  const { pin, close } = use(Pin)
  return (
    <HoverCardContent
      side="right"
      align="start"
      onPointerDownCapture={pin}
      onPointerDownOutside={close}
      onEscapeKeyDown={close}
      className={cn(
        "flex max-h-(--radix-hover-card-content-available-height) w-96 flex-col gap-4 overflow-y-auto rounded-[28px] border-0 bg-neutral-900 p-4 text-neutral-100 shadow-2xl ring-1 ring-white/10",
        className,
      )}
      {...props}
    />
  )
}

export function ShadeHeader({
  title,
  summary,
  busy,
  onReset,
}: {
  title: string
  summary: ReactNode
  busy?: boolean
  onReset?: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <div className="grid min-w-0">
        <span className="text-base font-medium">{title}</span>
        <span className="truncate text-xs text-neutral-400">{summary}</span>
      </div>
      {onReset && (
        <button
          type="button"
          disabled={busy}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:bg-neutral-700 disabled:opacity-50"
          onClick={onReset}
        >
          <RotateCcwIcon className="size-3.5" />
          Reset
        </button>
      )}
    </div>
  )
}

export function Tile({
  icon: Icon,
  label,
  on,
  status,
  disabled,
  wide,
  onClick,
}: {
  icon: LucideIcon
  label: string
  on: boolean
  status?: string
  disabled?: boolean
  wide?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      className={cn(
        "flex min-h-16 items-center gap-3 rounded-full px-4 py-2 text-left transition-colors disabled:opacity-60",
        on ? "bg-sky-200 text-sky-950 hover:bg-sky-100" : "bg-neutral-800 text-neutral-100 hover:bg-neutral-700",
        wide && "col-span-2",
      )}
      onClick={onClick}
    >
      <Icon className="size-5 shrink-0" />
      <span className="grid min-w-0">
        <span className="truncate text-sm font-medium">{label}</span>
        <span className={cn("text-xs", on ? "text-sky-900" : "text-neutral-400")}>{status ?? (on ? "On" : "Off")}</span>
      </span>
    </button>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h4 className="px-1 text-xs font-medium text-neutral-400">{title}</h4>
      <div className="grid gap-1 overflow-hidden rounded-3xl">{children}</div>
    </section>
  )
}

export function Row({
  selected,
  busy = false,
  disabled,
  flag,
  icon: Icon = GlobeIcon,
  title,
  children,
  onClick,
}: {
  selected: boolean
  busy?: boolean
  disabled?: boolean
  flag?: string
  icon?: LucideIcon
  title: string
  children?: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left transition-colors first:rounded-t-3xl last:rounded-b-3xl disabled:cursor-default",
        selected ? "bg-sky-200 text-sky-950" : "bg-neutral-800 text-neutral-100 hover:bg-neutral-700",
      )}
      onClick={onClick}
    >
      <span className="grid size-6 shrink-0 place-items-center text-lg leading-none">
        {flag ?? <Icon className="size-4" />}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {children && <span className={cn("text-xs", selected ? "text-sky-900" : "text-neutral-400")}>{children}</span>}
      </span>
      {busy ? (
        <Loader2Icon className="size-4 shrink-0 animate-spin" />
      ) : (
        selected && <CheckIcon className="size-4 shrink-0" />
      )}
    </button>
  )
}

export function Chips<T extends string | number>({
  title,
  options,
  value,
  onChange,
}: {
  title: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <section className="grid gap-1.5">
      <h4 className="px-1 text-xs font-medium text-neutral-400">{title}</h4>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium tabular-nums transition-colors",
              o.value === value ? "bg-sky-200 text-sky-950" : "bg-neutral-800 text-neutral-200 hover:bg-neutral-700",
            )}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </section>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="px-1 text-xs text-neutral-400">{children}</p>
}

export function ShadeSlider({
  icon: Icon,
  label,
  value: initial,
  max,
  unit = "",
  disabled,
  onCommit,
}: {
  icon: LucideIcon
  label: string
  value: number
  max: number
  unit?: string
  disabled?: boolean
  onCommit: (v: number) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <label className="flex h-14 items-center gap-3 rounded-full bg-neutral-800 px-4">
      <Icon className="size-5 shrink-0 text-sky-200" />
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={label}
        className="h-1.5 min-w-0 flex-1 cursor-pointer accent-sky-300"
        onChange={(e) => setValue(Number(e.target.value))}
        onPointerUp={() => onCommit(value)}
        onKeyUp={() => onCommit(value)}
      />
      <span className="w-9 text-right text-sm text-neutral-300 tabular-nums">
        {value}
        {unit}
      </span>
    </label>
  )
}
