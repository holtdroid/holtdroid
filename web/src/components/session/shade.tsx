import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GlobeIcon,
  Loader2Icon,
  RotateCcwIcon,
  type LucideIcon,
} from "lucide-react"
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { Badge } from "@/components/ui/badge"
import { HoverCard, HoverCardContent } from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"

const widgetWidth = 158

export type ShadeMode = "hover" | "row"

export const ShadeModeContext = createContext<ShadeMode>("hover")

export const ShadeFilter = createContext("")

type RowState = { open: boolean; toggle: () => void }

const RowContext = createContext<RowState | null>(null)

export const ShadeFlag = createContext<((key: string, on: boolean) => void) | null>(null)

export function ShadeCard({
  changed,
  attention,
  className,
  children,
  icon: Icon,
  title,
  summary,
  aside,
  ...props
}: ComponentProps<"button"> & {
  changed?: boolean
  attention?: boolean
  icon?: LucideIcon
  title?: string
  summary?: ReactNode
  aside?: ReactNode
}) {
  const mode = use(ShadeModeContext)
  const row = use(RowContext)
  const filter = use(ShadeFilter)
  const flag = use(ShadeFlag)
  const key = useId()
  const flagged = !!changed || !!attention
  useEffect(() => {
    flag?.(key, flagged)
    return () => flag?.(key, false)
  }, [flag, key, flagged])
  if (mode === "row") {
    const name = title ?? props["aria-label"] ?? ""
    if (filter && !name.toLowerCase().includes(filter.toLowerCase())) return null
    const { onClick, ...rest } = props
    return (
      <div className={cn("flex min-h-12 items-center gap-2.5 py-2", className)}>
        <button
          type="button"
          {...rest}
          aria-expanded={onClick ? undefined : row?.open}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default"
          onClick={onClick ?? row?.toggle}
        >
          <span
            className={cn(
              "grid size-[30px] shrink-0 place-items-center rounded-[9px] border bg-muted [&_svg]:size-4",
              row?.open ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {Icon && <Icon />}
          </span>
          <span className="grid min-w-0 flex-1">
            <span className="truncate text-sm font-medium">{name}</span>
            {summary && <span className="truncate text-xs text-muted-foreground">{summary}</span>}
          </span>
        </button>
        {aside}
        {changed && <Badge variant="warning">Changed</Badge>}
        {row && (
          <button
            type="button"
            aria-label={row.open ? `Collapse ${name}` : `Expand ${name}`}
            aria-expanded={row.open}
            className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-3.5"
            onClick={row.toggle}
          >
            {row.open ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </button>
        )}
      </div>
    )
  }
  return (
    <button
      type="button"
      className={cn(
        "relative grid gap-1.5 rounded-2xl border bg-card p-3 text-left text-card-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
        props.onClick ? "cursor-pointer disabled:cursor-default" : "cursor-default",
        className,
      )}
      style={{ width: widgetWidth }}
      {...props}
    >
      {changed && <span className="absolute top-2.5 right-2.5 size-2 rounded-full bg-warning" />}
      {children}
    </button>
  )
}

export function CardLine({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  )
}

type Active = { id: string; pinned: boolean; focus?: boolean } | null

let active: Active = null
const listeners = new Set<() => void>()

function setActive(next: Active) {
  active = next
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export type ShadeSide = "right" | "bottom" | "top" | "left"

export const ShadeSideContext = createContext<ShadeSide>("right")

export const ShadeBounds = createContext<Element | null>(null)

type Pins = { pin: () => void; close: () => void; toggle: () => void; focus: boolean }

const Pin = createContext<Pins>({ pin: () => undefined, close: () => undefined, toggle: () => undefined, focus: false })

export function useShadeToggle() {
  return use(Pin).toggle
}

export function ShadeRoot({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) {
  const mode = use(ShadeModeContext)
  return mode === "row" ? (
    <RowShade onOpenChange={onOpenChange}>{children}</RowShade>
  ) : (
    <HoverShade onOpenChange={onOpenChange}>{children}</HoverShade>
  )
}

function RowShade({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const report = useEffectEvent((o: boolean) => onOpenChange?.(o))
  useEffect(() => report(open), [open])
  const state = useMemo(() => ({ open, toggle: () => setOpen((o) => !o) }), [open])
  return (
    <RowContext value={state}>
      <div className="border-b border-dashed last:border-b-0 empty:hidden">{children}</div>
    </RowContext>
  )
}

function HoverShade({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) {
  const id = useId()
  const current = useSyncExternalStore(subscribe, () => active)
  const open = current?.id === id
  const report = useEffectEvent((o: boolean) => onOpenChange?.(o))
  useEffect(() => report(open), [open])
  useEffect(
    () => () => {
      if (active?.id === id) setActive(null)
    },
    [id],
  )
  const focus = open && !!current?.focus
  const pins = useMemo(
    () => ({
      pin: () => {
        if (active?.id === id) setActive({ id, pinned: true })
      },
      close: () => {
        if (active?.id === id) setActive(null)
      },
      toggle: () => setActive(active?.id === id && active.pinned ? null : { id, pinned: true, focus: true }),
      focus,
    }),
    [id, focus],
  )
  return (
    <Pin value={pins}>
      <HoverCard
        open={open}
        openDelay={150}
        closeDelay={200}
        onOpenChange={(next) => {
          if (next) {
            if (active && active.id !== id && active.pinned) return
            setActive({ id, pinned: false })
          } else if (active?.id === id && !active.pinned) {
            setActive(null)
          }
        }}
      >
        {children}
      </HoverCard>
    </Pin>
  )
}

export function ShadePanel({ className, children, ...props }: ComponentProps<typeof HoverCardContent>) {
  const row = use(RowContext)
  if (row) return row.open ? <div className="flex flex-col gap-4 pt-1 pb-4">{children}</div> : null
  return (
    <HoverPanel className={className} {...props}>
      {children}
    </HoverPanel>
  )
}

function HoverPanel({ className, ...props }: ComponentProps<typeof HoverCardContent>) {
  const { pin, close, focus } = use(Pin)
  const side = use(ShadeSideContext)
  const bounds = use(ShadeBounds)
  return (
    <HoverCardContent
      side={side}
      align="start"
      sideOffset={10}
      collisionPadding={8}
      collisionBoundary={bounds}
      ref={(el) => {
        if (!el || !focus) return
        el.querySelector<HTMLElement>("button:not(:disabled), [tabindex]:not([tabindex='-1'])")?.focus()
        if (active?.focus) setActive({ ...active, focus: false })
      }}
      onPointerDownCapture={pin}
      onPointerDownOutside={close}
      onEscapeKeyDown={close}
      className={cn(
        "flex max-h-(--radix-hover-card-content-available-height) w-96 flex-col gap-4 overflow-y-auto rounded-2xl p-4 shadow-float",
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
  const row = use(RowContext)
  if (row && !onReset) return null
  return (
    <div className={cn("flex items-center gap-2", row ? "justify-end" : "justify-between")}>
      {!row && (
        <div className="grid min-w-0">
          <span className="text-sm font-semibold">{title}</span>
          <span className="truncate text-xs text-muted-foreground">{summary}</span>
        </div>
      )}
      {onReset && (
        <button
          type="button"
          disabled={busy}
          className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border bg-card px-2.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
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
        "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-60",
        on ? "border-primary bg-primary text-primary-foreground hover:bg-primary/85" : "bg-card hover:bg-muted",
        wide && "col-span-2",
      )}
      onClick={onClick}
    >
      <Icon className="size-4 shrink-0" />
      <span className="grid min-w-0">
        <span className="truncate text-[13px] font-medium">{label}</span>
        <span className={cn("truncate text-xs", on ? "text-primary-foreground/75" : "text-muted-foreground")}>
          {status ?? (on ? "On" : "Off")}
        </span>
      </span>
    </button>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="text-xs font-semibold tracking-[.06em] text-muted-foreground uppercase">{children}</h4>
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <SectionTitle>{title}</SectionTitle>
      <div className="grid gap-1">{children}</div>
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
        "flex w-full cursor-pointer items-center gap-3 rounded-[9px] border px-3 py-2 text-left transition-colors disabled:cursor-default",
        selected ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
      )}
      onClick={onClick}
    >
      <span className="grid size-5 shrink-0 place-items-center text-base leading-none">
        {flag ?? <Icon className="size-4" />}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-[13px] font-medium">{title}</span>
        {children && (
          <span className={cn("text-xs", selected ? "text-primary-foreground/75" : "text-muted-foreground")}>
            {children}
          </span>
        )}
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
      <SectionTitle>{title}</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            className={cn(
              "h-[26px] cursor-pointer rounded-[7px] border px-2.5 text-xs font-medium tabular-nums transition-colors",
              o.value === value
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
  return <p className="text-xs text-muted-foreground">{children}</p>
}

export function ShadeSlider({
  icon: Icon,
  label,
  value: initial,
  min = 0,
  max,
  unit = "",
  format,
  ticks = false,
  disabled,
  onCommit,
}: {
  icon: LucideIcon
  label: string
  value: number
  min?: number
  max: number
  unit?: string
  format?: (v: number) => string
  ticks?: boolean
  disabled?: boolean
  onCommit: (v: number) => void
}) {
  const [value, setValue] = useState(initial)
  const ratio = max > min ? (value - min) / (max - min) : 0
  return (
    <div
      className={cn(
        "relative h-11 overflow-hidden rounded-xl border bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
        disabled && "opacity-60",
      )}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-[11px] bg-primary transition-[width] duration-100 ease-out"
        style={{ width: `calc(2.75rem + (100% - 2.75rem) * ${ratio})` }}
      />
      {ticks &&
        Array.from({ length: max - min + 1 }, (_, i) => (
          <span
            key={i}
            className={cn(
              "pointer-events-none absolute top-1/2 size-1 -translate-1/2 rounded-full",
              i <= value - min ? "bg-primary-foreground/40" : "bg-muted-foreground/50",
            )}
            style={{ left: `calc(1.375rem + (100% - 2.75rem) * ${i / Math.max(max - min, 1)})` }}
          />
        ))}
      <Icon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-primary-foreground" />
      <span
        className={cn(
          "pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[13px] font-medium tabular-nums",
          ratio > 0.8 ? "text-primary-foreground" : "text-foreground",
        )}
      >
        {format ? format(value) : `${value}${unit}`}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={format ? format(value) : `${value}${unit}`}
        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
        onChange={(e) => setValue(Number(e.target.value))}
        onPointerUp={() => onCommit(value)}
        onKeyUp={() => onCommit(value)}
      />
    </div>
  )
}

export function ShadeButton({
  primary = false,
  className,
  ...props
}: ComponentProps<"button"> & { primary?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 cursor-pointer items-center justify-center gap-2 rounded-[9px] border px-3 text-[13px] font-medium transition-colors disabled:cursor-default disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        primary ? "border-primary bg-primary text-primary-foreground hover:bg-primary/85" : "bg-card hover:bg-muted",
        className,
      )}
      {...props}
    />
  )
}

export function InfoList({ items }: { items: [string, ReactNode, (string | number)?][] }) {
  return (
    <dl className="grid shrink-0 grid-cols-[minmax(0,1fr)] divide-y overflow-hidden rounded-xl border bg-muted text-[13px]">
      {items.map(([label, value, key]) => (
        <div key={key ?? label} className="flex min-w-0 items-baseline justify-between gap-4 px-3 py-2">
          <dt className="shrink-0 text-muted-foreground">{label}</dt>
          <dd className="min-w-0 truncate text-right font-mono text-xs">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
