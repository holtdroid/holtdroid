import { CheckIcon } from "lucide-react"
import type { ComponentProps, CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"

export function Section({
  title,
  hint,
  className,
  children,
}: {
  title: string
  hint?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn("grid gap-2.5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

export function ChoiceGroup({
  label,
  className,
  style,
  children,
}: {
  label: string
  className?: string
  style?: CSSProperties & Record<`--${string}`, string>
  children: ReactNode
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid gap-2", className)} style={style}>
      {children}
    </div>
  )
}

export function SelectedTick({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-primary text-primary-foreground absolute top-2.5 right-2.5 z-10 grid size-[18px] place-items-center rounded-full",
        className,
      )}
    >
      <CheckIcon className="size-[11px] stroke-3" />
    </span>
  )
}

export const optionClass = (selected: boolean) =>
  cn(
    "bg-card focus-visible:ring-ring/50 relative flex w-full min-w-0 flex-col gap-1.5 rounded-xl border p-3 text-left transition outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-45",
    selected ? "border-foreground ring-foreground ring-1 ring-inset" : "hover:bg-muted",
  )

export function ChoiceCard({
  selected,
  onSelect,
  disabled,
  tick = true,
  className,
  children,
  ...props
}: {
  selected: boolean
  onSelect: () => void
  disabled?: boolean
  tick?: boolean
  className?: string
  children: ReactNode
} & Omit<ComponentProps<"button">, "onClick" | "onSelect">) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(optionClass(selected), className)}
      {...props}
    >
      {selected && tick && <SelectedTick />}
      {children}
    </button>
  )
}

export function Chip({
  selected,
  onSelect,
  className,
  children,
  ...props
}: {
  selected: boolean
  onSelect: () => void
  className?: string
  children: ReactNode
} & Omit<ComponentProps<"button">, "onClick" | "onSelect">) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "focus-visible:ring-ring/50 inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium whitespace-nowrap transition outline-none focus-visible:ring-3",
        selected ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function Count({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-grid h-[18px] min-w-[18px] place-items-center rounded-full border border-current/25 px-[5px] text-[11px] font-medium opacity-80",
        className,
      )}
    >
      {children}
    </span>
  )
}
