import { CheckIcon } from "lucide-react"
import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
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

export function ChoiceCard({
  selected,
  onSelect,
  disabled,
  className,
  children,
}: {
  selected: boolean
  onSelect: () => void
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "bg-card focus-visible:ring-ring/50 relative flex w-full min-w-0 flex-col gap-2 rounded-xl border p-3 text-left transition outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "border-primary bg-primary/5 ring-primary/30 ring-2" : "hover:bg-muted/50",
        className,
      )}
    >
      {selected && (
        <span className="bg-primary text-primary-foreground absolute top-2 right-2 z-10 grid size-5 place-items-center rounded-full">
          <CheckIcon className="size-3" />
        </span>
      )}
      {children}
    </button>
  )
}
