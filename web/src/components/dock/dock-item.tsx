import { Link, type LinkProps } from "@tanstack/react-router"
import type { ComponentProps, ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export const dockItem =
  "relative inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-2 rounded-xl px-2.5 text-[13px] font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5"

export const dockItemActive = "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"

function Tip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

export function DockLink({
  to,
  label,
  tip,
  active,
  className,
  children,
}: {
  to: LinkProps["to"]
  label: string
  tip?: ReactNode
  active?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <Tip label={tip ?? label}>
      <Link
        to={to}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cn(dockItem, active && dockItemActive, className)}
        activeOptions={active === undefined ? undefined : { exact: true }}
        activeProps={active === undefined ? { className: dockItemActive } : undefined}
      >
        {children}
      </Link>
    </Tip>
  )
}

export function DockButton({
  label,
  tip,
  className,
  children,
  ...props
}: ComponentProps<"button"> & { label: string; tip?: ReactNode }) {
  return (
    <Tip label={tip ?? label}>
      <button type="button" aria-label={label} className={cn(dockItem, className)} {...props}>
        {children}
      </button>
    </Tip>
  )
}

export function DockSeparator({ className }: { className?: string }) {
  return <span aria-hidden className={cn("mx-1 h-6 w-px shrink-0 bg-border", className)} />
}
