import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export const dataTable =
  "[&_td]:h-11 [&_td]:px-3 [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th]:h-9 [&_th]:px-3 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_th:first-child]:pl-4 [&_th:last-child]:pr-4 [&_tbody_tr]:border-dashed [&_thead_tr]:hover:bg-transparent"

export function PageHeader({
  title,
  meta,
  description,
  children,
  className,
}: {
  title: ReactNode
  meta?: ReactNode
  description?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <header className={cn("grid gap-1.5", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="mr-2 flex items-baseline gap-2.5">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{title}</h1>
          {meta && <span className="text-muted-foreground text-xs">{meta}</span>}
        </div>
        {children}
      </div>
      {description && <p className="text-muted-foreground max-w-2xl text-sm">{description}</p>}
    </header>
  )
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn("text-muted-foreground text-xs font-semibold tracking-[0.06em] uppercase", className)}>
      {children}
    </h2>
  )
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("bg-card text-card-foreground rounded-2xl border", className)}>{children}</section>
}

export function ListPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ul className={cn("bg-card divide-border divide-y divide-dashed rounded-2xl border", className)}>{children}</ul>
  )
}

export function EmptyPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("text-muted-foreground rounded-2xl border border-dashed p-8 text-center text-sm", className)}>
      {children}
    </div>
  )
}

export function Meter({ value, className, fill }: { value: number; className?: string; fill?: string }) {
  return (
    <span className={cn("bg-border block h-1 flex-1 overflow-hidden rounded-full", className)}>
      <span
        className={cn("block h-full rounded-full", fill ?? "bg-foreground")}
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
      />
    </span>
  )
}
