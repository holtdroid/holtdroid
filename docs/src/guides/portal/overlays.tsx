import { CircleAlertIcon, CircleCheckIcon, XIcon } from "lucide-react"
import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"

export function Modal({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="animate-in fade-in-0 absolute inset-0 z-40 grid place-items-center bg-black/10 backdrop-blur-xs duration-200">
      <div
        className={cn(
          "bg-popover text-popover-foreground animate-in zoom-in-95 fade-in-0 relative grid w-full max-w-sm gap-4 rounded-xl p-4 text-sm ring-1 ring-foreground/10 duration-200",
          className,
        )}
      >
        <span className="text-muted-foreground absolute top-3 right-3">
          <XIcon className="size-4" />
        </span>
        {children}
      </div>
    </div>
  )
}

export function ModalFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("bg-muted/50 -mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-t p-4", className)}>
      {children}
    </div>
  )
}

export function Pop({
  style,
  className,
  children,
}: {
  style?: CSSProperties
  className?: string
  children: ReactNode
}) {
  return (
    <div
      style={style}
      className={cn(
        "bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 absolute z-30 flex w-72 flex-col gap-2.5 rounded-lg p-2.5 text-sm shadow-md ring-1 ring-foreground/10 duration-150",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function ShadeBox({
  style,
  className,
  children,
}: {
  style?: CSSProperties
  className?: string
  children: ReactNode
}) {
  return (
    <div
      data-g="shade-panel"
      style={style}
      className={cn(
        "shade-surface animate-in fade-in-0 zoom-in-95 absolute z-30 flex w-96 flex-col gap-4 overflow-hidden rounded-[28px] bg-neutral-900 p-4 text-neutral-100 shadow-2xl ring-1 ring-black/10 duration-150 dark:ring-white/10",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function Toast({
  kind = "info",
  title,
  children,
  action,
}: {
  kind?: "info" | "error" | "success"
  title: string
  children?: ReactNode
  action?: string
}) {
  return (
    <div
      data-g="toast"
      className="bg-popover text-popover-foreground animate-in slide-in-from-bottom-4 fade-in-0 absolute right-5 bottom-5 z-50 flex w-96 items-start gap-2.5 rounded-xl border p-4 text-sm shadow-lg duration-300"
    >
      {kind === "error" ? (
        <CircleAlertIcon className="text-destructive mt-0.5 size-4 shrink-0" />
      ) : kind === "success" ? (
        <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      ) : null}
      <div className="grid min-w-0 flex-1 gap-1">
        <span className="font-medium">{title}</span>
        {children && <div className="text-muted-foreground text-xs">{children}</div>}
      </div>
      {action && (
        <span
          data-g="toast-action"
          className="bg-primary text-primary-foreground shrink-0 rounded-md px-2 py-1 text-xs font-medium"
        >
          {action}
        </span>
      )}
    </div>
  )
}
